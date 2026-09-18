package ru.sborka.picker.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import ru.sborka.picker.domain.DEFAULT_SPEECH_RATE

private val Context.pickerDataStore by preferencesDataStore(name = "picker_settings")

enum class VoiceSource { ALENA, SYSTEM }

data class PickerSettings(
    val voiceSource: VoiceSource = VoiceSource.ALENA,
    val speechRate: Float = DEFAULT_SPEECH_RATE,
    val soundEnabled: Boolean = true,
    val acceptedSoundEnabled: Boolean = true,
    val pieceSoundEnabled: Boolean = true,
    val problemSoundEnabled: Boolean = true,
    val errorSoundEnabled: Boolean = true,
    val completedSoundEnabled: Boolean = true,
    val vibrationEnabled: Boolean = true,
    val shortNames: Boolean = true,
    val announceCategories: Boolean = true,
)

interface PickerSettingsRepository {
    val settings: Flow<PickerSettings>
    suspend fun update(value: PickerSettings)
}

class SettingsStore(private val context: Context) : PickerSettingsRepository {
    override val settings: Flow<PickerSettings> = context.pickerDataStore.data.map { values ->
        PickerSettings(
            voiceSource = runCatching {
                VoiceSource.valueOf(values[VOICE_SOURCE] ?: VoiceSource.ALENA.name)
            }.getOrDefault(VoiceSource.ALENA),
            speechRate = values[SPEECH_RATE] ?: DEFAULT_SPEECH_RATE,
            soundEnabled = values[SOUND_ENABLED] ?: true,
            acceptedSoundEnabled = values[ACCEPTED_SOUND_ENABLED] ?: true,
            pieceSoundEnabled = values[PIECE_SOUND_ENABLED] ?: true,
            problemSoundEnabled = values[PROBLEM_SOUND_ENABLED] ?: true,
            errorSoundEnabled = values[ERROR_SOUND_ENABLED] ?: true,
            completedSoundEnabled = values[COMPLETED_SOUND_ENABLED] ?: true,
            vibrationEnabled = values[VIBRATION_ENABLED] ?: true,
            shortNames = values[SHORT_NAMES] ?: true,
            announceCategories = values[ANNOUNCE_CATEGORIES] ?: true,
        )
    }

    override suspend fun update(value: PickerSettings) {
        context.pickerDataStore.edit { preferences ->
            preferences[VOICE_SOURCE] = value.voiceSource.name
            preferences[SPEECH_RATE] = value.speechRate
            preferences[SOUND_ENABLED] = value.soundEnabled
            preferences[ACCEPTED_SOUND_ENABLED] = value.acceptedSoundEnabled
            preferences[PIECE_SOUND_ENABLED] = value.pieceSoundEnabled
            preferences[PROBLEM_SOUND_ENABLED] = value.problemSoundEnabled
            preferences[ERROR_SOUND_ENABLED] = value.errorSoundEnabled
            preferences[COMPLETED_SOUND_ENABLED] = value.completedSoundEnabled
            preferences[VIBRATION_ENABLED] = value.vibrationEnabled
            preferences[SHORT_NAMES] = value.shortNames
            preferences[ANNOUNCE_CATEGORIES] = value.announceCategories
        }
    }

    private companion object {
        val VOICE_SOURCE = stringPreferencesKey("voice_source")
        val SPEECH_RATE = floatPreferencesKey("speech_rate")
        val SOUND_ENABLED = booleanPreferencesKey("sound_enabled")
        val ACCEPTED_SOUND_ENABLED = booleanPreferencesKey("accepted_sound_enabled")
        val PIECE_SOUND_ENABLED = booleanPreferencesKey("piece_sound_enabled")
        val PROBLEM_SOUND_ENABLED = booleanPreferencesKey("problem_sound_enabled")
        val ERROR_SOUND_ENABLED = booleanPreferencesKey("error_sound_enabled")
        val COMPLETED_SOUND_ENABLED = booleanPreferencesKey("completed_sound_enabled")
        val VIBRATION_ENABLED = booleanPreferencesKey("vibration_enabled")
        val SHORT_NAMES = booleanPreferencesKey("short_names")
        val ANNOUNCE_CATEGORIES = booleanPreferencesKey("announce_categories")
    }
}
