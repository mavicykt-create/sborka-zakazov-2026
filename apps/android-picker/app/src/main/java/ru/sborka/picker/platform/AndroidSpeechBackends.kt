package ru.sborka.picker.platform

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.io.File
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine
import ru.sborka.picker.data.PickerRepository
import ru.sborka.picker.data.UnauthorizedException
import ru.sborka.picker.domain.SpeechBackend

class AndroidTtsBackend(context: Context) : SpeechBackend {
    private val ready = CompletableDeferred<Boolean>()
    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        ready.complete(status == TextToSpeech.SUCCESS)
    }

    override suspend fun speak(text: String, rate: Float): Boolean {
        if (!ready.await()) return false
        tts.language = Locale.forLanguageTag("ru-RU")
        tts.setSpeechRate(rate)
        tts.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        return suspendCancellableCoroutine { continuation ->
            val utteranceId = UUID.randomUUID().toString()
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) = Unit
                override fun onDone(id: String?) {
                    if (id == utteranceId && continuation.isActive) continuation.resume(true)
                }
                @Deprecated("Deprecated in Java")
                override fun onError(id: String?) {
                    if (id == utteranceId && continuation.isActive) continuation.resume(false)
                }
                override fun onError(id: String?, errorCode: Int) = onError(id)
            })
            val result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)
            if (result == TextToSpeech.ERROR && continuation.isActive) continuation.resume(false)
            continuation.invokeOnCancellation { tts.stop() }
        }
    }

    fun shutdown() {
        tts.stop()
        tts.shutdown()
    }
}

class AlenaSpeechBackend(
    private val context: Context,
    private val repository: PickerRepository,
    private val onUnauthorized: () -> Unit,
) : SpeechBackend {
    override suspend fun speak(text: String, rate: Float): Boolean {
        val audio = try {
            repository.speechAudio(text)
        } catch (error: UnauthorizedException) {
            onUnauthorized()
            throw error
        }
        val file = File.createTempFile("alena-", ".mp3", context.cacheDir).apply { writeBytes(audio) }
        return try {
            suspendCancellableCoroutine { continuation ->
                val player = MediaPlayer()
                player.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                player.setDataSource(file.absolutePath)
                player.setOnPreparedListener {
                    it.playbackParams = it.playbackParams.setSpeed(rate)
                    it.start()
                }
                player.setOnCompletionListener {
                    it.release()
                    if (continuation.isActive) continuation.resume(true)
                }
                player.setOnErrorListener { mediaPlayer, _, _ ->
                    mediaPlayer.release()
                    if (continuation.isActive) continuation.resume(false)
                    true
                }
                continuation.invokeOnCancellation {
                    runCatching { player.release() }
                }
                player.prepareAsync()
            }
        } finally {
            file.delete()
        }
    }
}
