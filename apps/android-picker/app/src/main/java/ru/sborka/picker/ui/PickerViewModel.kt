package ru.sborka.picker.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.sborka.picker.data.PickType
import ru.sborka.picker.data.PickerItem
import ru.sborka.picker.data.PickerQueue
import ru.sborka.picker.data.PickerRepository
import ru.sborka.picker.data.PickerSettings
import ru.sborka.picker.data.PickerSettingsRepository
import ru.sborka.picker.data.UnauthorizedException
import ru.sborka.picker.data.toPickerMessage
import ru.sborka.picker.domain.PauseCommandGate
import ru.sborka.picker.domain.VoiceCommand
import ru.sborka.picker.domain.VoiceCommandParser
import ru.sborka.picker.domain.categorySpeech
import ru.sborka.picker.domain.itemSpeech
import ru.sborka.picker.domain.quantitySpeech
import ru.sborka.picker.domain.remainingSpeech

data class PickerUiState(
    val checkingSession: Boolean = true,
    val loggedIn: Boolean = false,
    val workerName: String = "",
    val queue: PickerQueue? = null,
    val sessionTotal: Int = 0,
    val busy: Boolean = false,
    val paused: Boolean = false,
    val completed: Boolean = false,
    val alenaAvailable: Boolean = false,
    val message: String = "",
    val settings: PickerSettings = PickerSettings(),
) {
    val current: PickerItem?
        get() = queue?.items?.firstOrNull { it.status == "ACTIVE" } ?: queue?.items?.firstOrNull()
    val remaining: Int get() = queue?.items?.size ?: 0
    val completedCount: Int get() = (sessionTotal - remaining).coerceAtLeast(0)
    val progressLabel: String
        get() = if (sessionTotal == 0) "0 / 0" else "${(completedCount + 1).coerceAtMost(sessionTotal)} / $sessionTotal"
}

enum class FeedbackKind { ACCEPTED, PIECE, PROBLEM, ERROR, COMPLETED }

sealed interface PickerEffect {
    data class Speak(val text: String, val pieceAlert: Boolean = false) : PickerEffect
    data class Feedback(val kind: FeedbackKind) : PickerEffect
    data object Listen : PickerEffect
    data object StopListening : PickerEffect
}

class PickerViewModel(
    private val repository: PickerRepository,
    private val settingsStore: PickerSettingsRepository,
) : ViewModel() {
    private val gate = PauseCommandGate()
    private val _state = MutableStateFlow(PickerUiState())
    val state: StateFlow<PickerUiState> = _state.asStateFlow()
    private val _effects = Channel<PickerEffect>(Channel.BUFFERED)
    val effects = _effects.receiveAsFlow()

    init {
        viewModelScope.launch {
            settingsStore.settings.collect { settings -> _state.update { it.copy(settings = settings) } }
        }
        viewModelScope.launch { restoreSession() }
    }

    fun login(login: String, password: String) {
        if (login.isBlank() || password.isBlank() || _state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, message = "") }
            runCatching {
                val session = repository.login(login, password)
                val queue = repository.loadQueue()
                if (!loadSpeechAvailability()) return@runCatching
                _state.update { it.copy(loggedIn = true, workerName = session.worker.name) }
                applyQueue(queue, announce = true)
            }.onFailure(::handleFailure)
            _state.update { it.copy(checkingSession = false, busy = false) }
        }
    }

    fun logout() {
        viewModelScope.launch {
            _effects.send(PickerEffect.StopListening)
            runCatching { repository.logout() }
            resetToLogin("")
        }
    }

    fun refresh() {
        if (!_state.value.loggedIn || _state.value.busy) return
        viewModelScope.launch {
            _state.update { it.copy(busy = true, message = "") }
            runCatching { repository.loadQueue() }
                .onSuccess { applyQueue(it, announce = true) }
                .onFailure(::handleFailure)
            _state.update { it.copy(busy = false) }
        }
    }

    fun handleTranscript(transcript: String) = handleCommand(VoiceCommandParser.parse(transcript))

    fun handleCommand(command: VoiceCommand) {
        if (!_state.value.loggedIn || _state.value.busy) return
        val accepted = gate.accept(command)
        _state.update { it.copy(paused = gate.paused) }
        if (accepted == null) {
            _state.update { it.copy(message = "Пауза. Скажите «Продолжить».") }
            _effects.trySend(PickerEffect.Listen)
            return
        }
        when (accepted) {
            VoiceCommand.PICKED -> submitStatus("PICKED", FeedbackKind.ACCEPTED)
            VoiceCommand.NOT_FOUND -> submitStatus("NOT_FOUND", FeedbackKind.PROBLEM)
            VoiceCommand.SKIP -> submitStatus("SKIPPED", FeedbackKind.PROBLEM)
            VoiceCommand.UNDO -> undo()
            VoiceCommand.REPEAT -> announceCurrent(pieceAlert = false)
            VoiceCommand.QUANTITY -> speakQuantity()
            VoiceCommand.REMAINING -> speakRemaining()
            VoiceCommand.PAUSE -> {
                _state.update { it.copy(paused = true, message = "Пауза. Скажите «Продолжить».") }
                _effects.trySend(PickerEffect.Listen)
            }
            VoiceCommand.CONTINUE -> {
                _state.update { it.copy(paused = false, message = "") }
                announceCurrent(pieceAlert = false)
            }
            VoiceCommand.UNKNOWN -> {
                _state.update { it.copy(message = "Команда не распознана") }
                _effects.trySend(PickerEffect.Feedback(FeedbackKind.ERROR))
                _effects.trySend(PickerEffect.Listen)
            }
        }
    }

    fun onRecognitionFailure(message: String = "Не расслышал. Повторите команду.") {
        if (!_state.value.loggedIn || _state.value.completed) return
        _state.update { it.copy(message = message) }
        _effects.trySend(PickerEffect.Feedback(FeedbackKind.ERROR))
        _effects.trySend(PickerEffect.Listen)
    }

    fun onUnauthorized() {
        resetToLogin("Сессия завершена. Войдите снова.")
        _effects.trySend(PickerEffect.StopListening)
    }

    fun updateSettings(settings: PickerSettings) {
        viewModelScope.launch { settingsStore.update(settings) }
    }

    private suspend fun restoreSession() {
        if (!repository.hasSession()) {
            _state.update { it.copy(checkingSession = false) }
            return
        }
        runCatching { repository.loadQueue() }
            .onSuccess { queue ->
                if (!loadSpeechAvailability()) return@onSuccess
                _state.update { it.copy(loggedIn = true, workerName = queue.worker.name) }
                applyQueue(queue, announce = true)
            }
            .onFailure(::handleFailure)
        _state.update { it.copy(checkingSession = false) }
    }

    private fun submitStatus(status: String, feedback: FeedbackKind) {
        val item = _state.value.current ?: return
        if (item.pickType == PickType.REVIEW) {
            _state.update { it.copy(message = "Позиция ожидает проверки администратора") }
            _effects.trySend(PickerEffect.Feedback(FeedbackKind.ERROR))
            _effects.trySend(PickerEffect.Listen)
            return
        }
        _effects.trySend(PickerEffect.StopListening)
        viewModelScope.launch {
            _state.update { it.copy(busy = true, message = "") }
            runCatching { repository.updateStatus(item, status) }
                .onSuccess { queue ->
                    _effects.send(PickerEffect.Feedback(feedback))
                    applyQueue(queue, announce = true)
                }
                .onFailure { error ->
                    handleFailure(error)
                    if (error !is UnauthorizedException) {
                        _effects.send(PickerEffect.Feedback(FeedbackKind.ERROR))
                        _effects.send(PickerEffect.Listen)
                    }
                }
            _state.update { it.copy(busy = false) }
        }
    }

    private fun undo() {
        val itemId = _state.value.queue?.lastCompleted?.id
        if (itemId == null) {
            _state.update { it.copy(message = "Нет последнего действия для отмены") }
            _effects.trySend(PickerEffect.Feedback(FeedbackKind.ERROR))
            _effects.trySend(PickerEffect.Listen)
            return
        }
        _effects.trySend(PickerEffect.StopListening)
        viewModelScope.launch {
            _state.update { it.copy(busy = true, message = "") }
            runCatching { repository.undo(itemId) }
                .onSuccess { applyQueue(it, announce = true) }
                .onFailure { error ->
                    handleFailure(error)
                    if (error !is UnauthorizedException) {
                        _effects.send(PickerEffect.Feedback(FeedbackKind.ERROR))
                        _effects.send(PickerEffect.Listen)
                    }
                }
            _state.update { it.copy(busy = false) }
        }
    }

    private suspend fun applyQueue(queue: PickerQueue, announce: Boolean) {
        val previousState = _state.value
        val previousCategory = previousState.current?.let(::categorySpeech)
        val nextCurrent = queue.items.firstOrNull { it.status == "ACTIVE" } ?: queue.items.firstOrNull()
        val nextCategory = nextCurrent?.let(::categorySpeech)
        val shouldAnnounceCategory =
            previousState.settings.announceCategories && nextCategory != null && nextCategory != previousCategory
        val startsNewAssignment = previousState.completed && queue.items.isNotEmpty()
        val total = if (startsNewAssignment) {
            maxOf(queue.summary.total, queue.items.size)
        } else {
            maxOf(previousState.sessionTotal, queue.summary.total, queue.items.size)
        }
        val completed = queue.items.isEmpty()
        _state.update {
            it.copy(
                loggedIn = true,
                workerName = queue.worker.name,
                queue = queue,
                sessionTotal = total,
                completed = completed,
                message = if (completed) "Ваша часть заказа собрана." else "",
            )
        }
        if (completed) {
            _effects.send(PickerEffect.Feedback(FeedbackKind.COMPLETED))
        } else if (announce) {
            announceCurrent(
                pieceAlert = _state.value.current?.pickType == PickType.PIECE,
                category = if (shouldAnnounceCategory) nextCategory else null,
            )
        }
    }

    private fun announceCurrent(pieceAlert: Boolean, category: String? = null) {
        val value = _state.value
        val current = value.current ?: return
        val itemText = itemSpeech(current, value.settings.shortNames) ?: return
        val text = if (category.isNullOrBlank()) itemText else "$category. $itemText"
        _effects.trySend(PickerEffect.Speak(text, pieceAlert))
    }

    private fun speakQuantity() {
        val text = _state.value.current?.let(::quantitySpeech) ?: return
        _effects.trySend(PickerEffect.Speak(text))
    }

    private fun speakRemaining() {
        _effects.trySend(PickerEffect.Speak(remainingSpeech(_state.value.remaining)))
    }

    private fun handleFailure(error: Throwable) {
        if (error is UnauthorizedException) {
            resetToLogin(error.toPickerMessage())
            return
        }
        _state.update { it.copy(message = error.toPickerMessage()) }
    }

    private suspend fun loadSpeechAvailability(): Boolean {
        var authorized = true
        runCatching { repository.speechSettings() }
            .onSuccess { settings -> _state.update { it.copy(alenaAvailable = settings.yandexEnabled) } }
            .onFailure { error ->
                if (error is UnauthorizedException) {
                    authorized = false
                    handleFailure(error)
                }
                else _state.update { it.copy(alenaAvailable = false) }
            }
        return authorized
    }

    private fun resetToLogin(message: String) {
        gate.reset()
        _state.value = PickerUiState(checkingSession = false, message = message, settings = _state.value.settings)
    }
}

class PickerViewModelFactory(
    private val repository: PickerRepository,
    private val settingsStore: PickerSettingsRepository,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
        PickerViewModel(repository, settingsStore) as T
}
