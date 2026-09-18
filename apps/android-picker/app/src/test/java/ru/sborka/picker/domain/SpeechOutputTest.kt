package ru.sborka.picker.domain

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.sborka.picker.data.VoiceSource
import ru.sborka.picker.data.UnauthorizedException

class SpeechOutputTest {
    @Test
    fun `falls back from Alena to Android TTS`() = runTest {
        var remoteCalls = 0
        var localCalls = 0
        var localRate = 0f
        val output = FallbackSpeechOutput(
            alena = SpeechBackend { _, _ -> remoteCalls += 1; false },
            androidTts = SpeechBackend { _, rate -> localCalls += 1; localRate = rate; true },
        )

        assertTrue(output.speak("Товар", VoiceSource.ALENA, 0.5f))
        assertEquals(1, remoteCalls)
        assertEquals(1, localCalls)
        assertEquals(0.5f, localRate, 0f)
    }

    @Test
    fun `Android TTS receives requested rate directly`() = runTest {
        var localRate = 0f
        val output = FallbackSpeechOutput(
            alena = SpeechBackend { _, _ -> error("Alena must not be called") },
            androidTts = SpeechBackend { _, rate -> localRate = rate; true },
        )

        assertTrue(output.speak("Товар", VoiceSource.SYSTEM, 1.5f))
        assertEquals(1.5f, localRate, 0f)
    }

    @Test
    fun `expired Alena session does not speak after logout`() = runTest {
        var localCalls = 0
        val output = FallbackSpeechOutput(
            alena = SpeechBackend { _, _ -> throw UnauthorizedException() },
            androidTts = SpeechBackend { _, _ -> localCalls += 1; true },
        )

        assertTrue(!output.speak("Товар", VoiceSource.ALENA, 1.22f))
        assertEquals(0, localCalls)
    }
}
