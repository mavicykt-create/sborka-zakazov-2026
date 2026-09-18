package ru.sborka.picker

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.runtime.getValue
import kotlinx.coroutines.launch
import ru.sborka.picker.data.VoiceSource
import ru.sborka.picker.domain.FallbackSpeechOutput
import ru.sborka.picker.platform.AlenaSpeechBackend
import ru.sborka.picker.platform.AndroidTtsBackend
import ru.sborka.picker.platform.FeedbackPlayer
import ru.sborka.picker.platform.SpeechRecognizerController
import ru.sborka.picker.ui.FeedbackKind
import ru.sborka.picker.ui.PickerApp
import ru.sborka.picker.ui.PickerEffect
import ru.sborka.picker.ui.PickerViewModel
import ru.sborka.picker.ui.PickerViewModelFactory

class MainActivity : ComponentActivity() {
    private val applicationDependencies get() = application as PickerApplication
    private val viewModel: PickerViewModel by viewModels {
        PickerViewModelFactory(applicationDependencies.repository, applicationDependencies.settingsStore)
    }
    private lateinit var recognition: SpeechRecognizerController
    private lateinit var androidTts: AndroidTtsBackend
    private lateinit var speech: FallbackSpeechOutput
    private lateinit var feedback: FeedbackPlayer
    private var microphoneGranted = false

    private val microphonePermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        microphoneGranted = granted
        if (granted && viewModel.state.value.loggedIn && !viewModel.state.value.completed) recognition.start()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        microphoneGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        recognition = SpeechRecognizerController(
            context = this,
            onResult = viewModel::handleTranscript,
            onFailure = viewModel::onRecognitionFailure,
        )
        androidTts = AndroidTtsBackend(this)
        speech = FallbackSpeechOutput(
            alena = AlenaSpeechBackend(this, applicationDependencies.repository, viewModel::onUnauthorized),
            androidTts = androidTts,
        )
        feedback = FeedbackPlayer(this)

        setContent {
            val state by viewModel.state.collectAsStateWithLifecycle()
            PickerApp(
                state = state,
                onLogin = viewModel::login,
                onLogout = viewModel::logout,
                onRefresh = viewModel::refresh,
                onCommand = viewModel::handleCommand,
                onSettings = viewModel::updateSettings,
            )
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.effects.collect(::handleEffect)
            }
        }
        if (!microphoneGranted) microphonePermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    override fun onStop() {
        recognition.stop()
        super.onStop()
    }

    override fun onDestroy() {
        recognition.destroy()
        androidTts.shutdown()
        feedback.release()
        super.onDestroy()
    }

    private suspend fun handleEffect(effect: PickerEffect) {
        when (effect) {
            is PickerEffect.Feedback -> feedback.play(effect.kind, viewModel.state.value.settings)
            is PickerEffect.Speak -> {
                recognition.stop()
                try {
                    val state = viewModel.state.value
                    val source = if (state.settings.voiceSource == VoiceSource.ALENA && !state.alenaAvailable) {
                        VoiceSource.SYSTEM
                    } else {
                        state.settings.voiceSource
                    }
                    if (effect.pieceAlert) feedback.play(FeedbackKind.PIECE, state.settings)
                    speech.speak(
                        text = effect.text,
                        source = source,
                        rate = state.settings.speechRate,
                    )
                } finally {
                    startRecognitionIfNeeded()
                }
            }
            PickerEffect.Listen -> startRecognitionIfNeeded()
            PickerEffect.StopListening -> recognition.stop()
        }
    }

    private fun startRecognitionIfNeeded() {
        val state = viewModel.state.value
        if (microphoneGranted && state.loggedIn && !state.completed && !state.busy) recognition.start()
    }
}
