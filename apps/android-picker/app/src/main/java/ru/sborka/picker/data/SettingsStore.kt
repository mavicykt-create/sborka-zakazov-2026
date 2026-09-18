package ru.sborka.picker.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.pickerDataStore by preferencesDataStore(name = "picker_settings")

enum class VoiceSource { ALENA, SYSTEM }

data class PickerSettings(
    val voiceSource: VoiceSource = VoiceSource.ALENA,
    val speechRate: Float = 1.22f,
    val soundEnabled: Boolean = true,
    val vibrationEnabled: Boolean = true,
    val shortNames: Boolean = true,
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
            speechRate = values[SPEECH_RATE] ?: 1.22f,
            soundEnabled = values[SOUND_ENABLED] ?: true,
            vibrationEnabled = values[VIBRATION_ENABLED] ?: true,
            shortNames = values[SHORT_NAMES] ?: true,
        )
    }

    override suspend fun update(value: PickerSettings) {
        context.pickerDataStore.edit { preferences ->
            preferences[VOICE_SOURCE] = value.voiceSource.name
            preferences[SPEECH_RATE] = value.speechRate
            preferences[SOUND_ENABLED] = value.soundEnabled
            preferences[VIBRATION_ENABLED] = value.vibrationEnabled
            preferences[SHORT_NAMES] = value.shortNames
        }
    }

    private companion object {
        val VOICE_SOURCE = stringPreferencesKey("voice_source")
        val SPEECH_RATE = floatPreferencesKey("speech_rate")
        val SOUND_ENABLED = booleanPreferencesKey("sound_enabled")
        val VIBRATION_ENABLED = booleanPreferencesKey("vibration_enabled")
        val SHORT_NAMES = booleanPreferencesKey("short_names")
    }
}
