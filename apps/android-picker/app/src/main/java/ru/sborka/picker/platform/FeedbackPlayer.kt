package ru.sborka.picker.platform

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import kotlinx.coroutines.delay
import ru.sborka.picker.data.PickerSettings
import ru.sborka.picker.ui.FeedbackKind

class FeedbackPlayer(private val context: Context) {
    private val tone = ToneGenerator(AudioManager.STREAM_MUSIC, 60)

    suspend fun play(kind: FeedbackKind, settings: PickerSettings) {
        if (settings.soundEnabled) {
            when (kind) {
                FeedbackKind.ACCEPTED -> tone.startTone(ToneGenerator.TONE_DTMF_5, 100)
                FeedbackKind.PIECE -> tone.startTone(ToneGenerator.TONE_DTMF_9, 90)
                FeedbackKind.PROBLEM -> tone.startTone(ToneGenerator.TONE_PROP_NACK, 120)
                FeedbackKind.ERROR -> {
                    tone.startTone(ToneGenerator.TONE_PROP_NACK, 70)
                    delay(115)
                    tone.startTone(ToneGenerator.TONE_PROP_NACK, 70)
                }
                FeedbackKind.COMPLETED -> tone.startTone(ToneGenerator.TONE_CDMA_ABBR_ALERT, 240)
            }
        }
        if (settings.vibrationEnabled && kind != FeedbackKind.PIECE) vibrate(kind)
        if (settings.soundEnabled && kind != FeedbackKind.ERROR) delay(120)
    }

    fun release() = tone.release()

    private fun vibrate(kind: FeedbackKind) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        val pattern = when (kind) {
            FeedbackKind.ACCEPTED, FeedbackKind.PIECE -> longArrayOf(0, 55)
            FeedbackKind.COMPLETED -> longArrayOf(0, 80, 70, 140)
            FeedbackKind.PROBLEM, FeedbackKind.ERROR -> longArrayOf(0, 110, 70, 110)
        }
        vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
    }
}
