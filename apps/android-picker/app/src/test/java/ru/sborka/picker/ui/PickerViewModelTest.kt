package ru.sborka.picker.ui

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.sborka.picker.MainDispatcherRule
import ru.sborka.picker.data.PickerLoginResponse
import ru.sborka.picker.data.PickerQueue
import ru.sborka.picker.data.PickerRepository
import ru.sborka.picker.data.PickerSettings
import ru.sborka.picker.data.PickerSettingsRepository
import ru.sborka.picker.data.SpeechSettingsResponse
import ru.sborka.picker.data.UnauthorizedException
import ru.sborka.picker.domain.VoiceCommand
import ru.sborka.picker.testItem
import ru.sborka.picker.testQueue
import ru.sborka.picker.testWorker

@OptIn(ExperimentalCoroutinesApi::class)
class PickerViewModelTest {
    @get:Rule
    val mainDispatcher = MainDispatcherRule()

    @Test
    fun `picked advances only after successful backend response`() = runTest(mainDispatcher.dispatcher) {
        val first = testItem("i1")
        val second = testItem("i2")
        val repository = FakeRepository(testQueue(listOf(first, second)))
        val viewModel = PickerViewModel(repository, FakeSettings())
        runCurrent()
        val response = CompletableDeferred<PickerQueue>()
        repository.nextUpdate = response

        viewModel.handleCommand(VoiceCommand.PICKED)
        runCurrent()
        assertEquals("i1", viewModel.state.value.current?.id)
        assertTrue(viewModel.state.value.busy)

        response.complete(testQueue(listOf(second), first))
        runCurrent()
        assertEquals("i2", viewModel.state.value.current?.id)
        assertFalse(viewModel.state.value.busy)
    }

    @Test
    fun `network failure keeps current item`() = runTest(mainDispatcher.dispatcher) {
        val first = testItem("i1")
        val repository = FakeRepository(testQueue(listOf(first))).apply {
            updateFailure = java.io.IOException("offline")
        }
        val viewModel = PickerViewModel(repository, FakeSettings())
        runCurrent()

        viewModel.handleCommand(VoiceCommand.PICKED)
        runCurrent()

        assertEquals("i1", viewModel.state.value.current?.id)
        assertTrue(viewModel.state.value.message.contains("Нет связи"))
    }

    @Test
    fun `401 returns to login`() = runTest(mainDispatcher.dispatcher) {
        val repository = FakeRepository(testQueue(listOf(testItem()))).apply {
            updateFailure = UnauthorizedException()
        }
        val viewModel = PickerViewModel(repository, FakeSettings())
        runCurrent()

        viewModel.handleCommand(VoiceCommand.PICKED)
        runCurrent()

        assertFalse(viewModel.state.value.loggedIn)
        assertTrue(viewModel.state.value.message.contains("Сессия"))
    }

    @Test
    fun `pause ignores work commands until continue`() = runTest(mainDispatcher.dispatcher) {
        val repository = FakeRepository(testQueue(listOf(testItem())))
        val viewModel = PickerViewModel(repository, FakeSettings())
        runCurrent()

        viewModel.handleCommand(VoiceCommand.PAUSE)
        viewModel.handleCommand(VoiceCommand.PICKED)
        runCurrent()
        assertTrue(viewModel.state.value.paused)
        assertEquals(0, repository.updateCalls)

        viewModel.handleCommand(VoiceCommand.CONTINUE)
        runCurrent()
        assertFalse(viewModel.state.value.paused)
    }

    @Test
    fun `empty queue becomes completed state`() = runTest(mainDispatcher.dispatcher) {
        val item = testItem()
        val repository = FakeRepository(testQueue(listOf(item))).apply {
            completedQueue = testQueue(emptyList(), item)
        }
        val viewModel = PickerViewModel(repository, FakeSettings())
        runCurrent()

        viewModel.handleCommand(VoiceCommand.PICKED)
        runCurrent()

        assertTrue(viewModel.state.value.completed)
        assertEquals("Ваша часть заказа собрана.", viewModel.state.value.message)
    }

    @Test
    fun `refresh after completion starts progress for new assignment`() = runTest(mainDispatcher.dispatcher) {
        val first = testItem()
        val repository = FakeRepository(testQueue(listOf(first))).apply {
            completedQueue = testQueue(emptyList(), first)
        }
        val viewModel = PickerViewModel(repository, FakeSettings())
        runCurrent()

        viewModel.handleCommand(VoiceCommand.PICKED)
        runCurrent()
        repository.queue = testQueue(listOf(testItem("new-1"), testItem("new-2")))

        viewModel.refresh()
        runCurrent()

        assertFalse(viewModel.state.value.completed)
        assertEquals(2, viewModel.state.value.sessionTotal)
        assertEquals("1 / 2", viewModel.state.value.progressLabel)
    }

    @Test
    fun `category is announced once when entering a category`() = runTest(mainDispatcher.dispatcher) {
        val first = testItem("i1").copy(groupKey = "ПЧН", name = "ПЧН Oreo")
        val second = testItem("i2").copy(groupKey = "ПЧН", name = "ПЧН Choco Pie")
        val repository = FakeRepository(testQueue(listOf(first))).apply {
            completedQueue = testQueue(listOf(second), first)
        }
        val viewModel = PickerViewModel(repository, FakeSettings())
        runCurrent()

        val initial = viewModel.effects.first() as PickerEffect.Speak
        assertTrue(initial.text.startsWith("Печенье. "))
        assertFalse(initial.text.contains("ПЧН"))

        viewModel.handleCommand(VoiceCommand.PICKED)
        runCurrent()
        val effects = viewModel.effects.take(3).toList()
        val nextSpeech = effects[2] as PickerEffect.Speak

        assertFalse(nextSpeech.text.startsWith("Печенье. "))
        assertFalse(nextSpeech.text.contains("ПЧН"))
    }

    @Test
    fun `successful transition emits accepted before next piece announcement`() = runTest(mainDispatcher.dispatcher) {
        val first = testItem("i1")
        val piece = testItem("i2", pickType = ru.sborka.picker.data.PickType.PIECE)
        val repository = FakeRepository(testQueue(listOf(first))).apply {
            completedQueue = testQueue(listOf(piece), first)
        }
        val viewModel = PickerViewModel(repository, FakeSettings())
        runCurrent()
        viewModel.effects.first() // Initial item announcement.

        viewModel.handleCommand(VoiceCommand.PICKED)
        runCurrent()
        val effects = viewModel.effects.take(3).toList()

        assertEquals(PickerEffect.StopListening, effects[0])
        assertEquals(PickerEffect.Feedback(FeedbackKind.ACCEPTED), effects[1])
        assertEquals(true, (effects[2] as PickerEffect.Speak).pieceAlert)
    }
}

private class FakeSettings : PickerSettingsRepository {
    override val settings = MutableStateFlow(PickerSettings())
    override suspend fun update(value: PickerSettings) { settings.value = value }
}

private class FakeRepository(initialQueue: PickerQueue) : PickerRepository {
    var queue = initialQueue
    var nextUpdate: CompletableDeferred<PickerQueue>? = null
    var updateFailure: Throwable? = null
    var completedQueue: PickerQueue? = null
    var updateCalls = 0

    override fun hasSession() = true
    override suspend fun login(login: String, password: String) =
        PickerLoginResponse("token", "2026-09-19T00:00:00.000Z", testWorker())
    override suspend fun logout() = Unit
    override suspend fun loadQueue() = queue
    override suspend fun updateStatus(item: ru.sborka.picker.data.PickerItem, status: String): PickerQueue {
        updateCalls += 1
        updateFailure?.let { throw it }
        val value = nextUpdate?.await() ?: completedQueue ?: queue
        queue = value
        return value
    }
    override suspend fun undo(itemId: String) = queue
    override suspend fun speechSettings() = SpeechSettingsResponse(true, "alena")
    override suspend fun speechAudio(text: String) = byteArrayOf(1)
}
