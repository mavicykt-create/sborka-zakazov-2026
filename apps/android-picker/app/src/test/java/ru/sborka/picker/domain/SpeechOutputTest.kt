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
        val output = FallbackSpeechOutput(
            alena = SpeechBackend { _, _ -> remoteCalls += 1; false },
            androidTts = SpeechBackend { _, _ -> localCalls += 1; true },
        )

        assertTrue(output.speak("Товар", VoiceSource.ALENA, 1.22f))
        assertEquals(1, remoteCalls)
        assertEquals(1, localCalls)
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
