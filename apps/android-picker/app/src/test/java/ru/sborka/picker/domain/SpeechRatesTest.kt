package ru.sborka.picker.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class SpeechRatesTest {
    @Test
    fun `Alena playback speed is relative to server synthesis rate`() {
        assertEquals(0.4098f, alenaPlaybackSpeed(0.5f), 0.0001f)
        assertEquals(0.6557f, alenaPlaybackSpeed(0.8f), 0.0001f)
        assertEquals(1.0f, alenaPlaybackSpeed(1.22f), 0.0001f)
        assertEquals(1.2295f, alenaPlaybackSpeed(1.5f), 0.0001f)
    }

    @Test
    fun `default Alena rate does not accelerate audio twice`() {
        assertEquals(ALENA_SERVER_BASE_RATE, DEFAULT_SPEECH_RATE, 0f)
        assertEquals(1.0f, alenaPlaybackSpeed(DEFAULT_SPEECH_RATE), 0f)
    }

    @Test
    fun `all supported speech rates are available`() {
        assertEquals(listOf(0.5f, 0.65f, 0.8f, 1.0f, 1.12f, 1.22f, 1.35f, 1.5f), SPEECH_RATE_OPTIONS)
    }
}
