package ru.sborka.picker.domain

import ru.sborka.picker.data.VoiceSource
import ru.sborka.picker.data.UnauthorizedException

fun interface SpeechBackend {
    suspend fun speak(text: String, rate: Float): Boolean
}

class FallbackSpeechOutput(
    private val alena: SpeechBackend,
    private val androidTts: SpeechBackend,
) {
    suspend fun speak(text: String, source: VoiceSource, rate: Float): Boolean {
        if (source == VoiceSource.SYSTEM) return androidTts.speak(text, rate)
        val remoteSucceeded = try {
            alena.speak(text, rate)
        } catch (_: UnauthorizedException) {
            return false
        } catch (_: Exception) {
            false
        }
        return remoteSucceeded || androidTts.speak(text, rate)
    }
}
