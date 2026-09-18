package ru.sborka.picker.platform

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

class SpeechRecognizerController(
    private val context: Context,
    private val onResult: (String) -> Unit,
    private val onFailure: () -> Unit,
) : RecognitionListener {
    private val recognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
        setRecognitionListener(this@SpeechRecognizerController)
    }
    private var active = false

    fun start() {
        if (active || !SpeechRecognizer.isRecognitionAvailable(context)) return
        active = true
        recognizer.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            },
        )
    }

    fun stop() {
        if (active) recognizer.cancel()
        active = false
    }

    fun destroy() {
        stop()
        recognizer.destroy()
    }

    override fun onResults(results: Bundle) {
        active = false
        val value = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
        if (value.isNullOrBlank()) onFailure() else onResult(value)
    }

    override fun onError(error: Int) {
        active = false
        if (error != SpeechRecognizer.ERROR_CLIENT && error != SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
            onFailure()
        }
    }

    override fun onReadyForSpeech(params: Bundle?) = Unit
    override fun onBeginningOfSpeech() = Unit
    override fun onRmsChanged(rmsdB: Float) = Unit
    override fun onBufferReceived(buffer: ByteArray?) = Unit
    override fun onEndOfSpeech() = Unit
    override fun onPartialResults(partialResults: Bundle?) = Unit
    override fun onEvent(eventType: Int, params: Bundle?) = Unit

}
