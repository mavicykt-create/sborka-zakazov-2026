package ru.sborka.picker.domain

enum class VoiceCommand {
    PICKED,
    REPEAT,
    QUANTITY,
    NOT_FOUND,
    SKIP,
    UNDO,
    REMAINING,
    PAUSE,
    CONTINUE,
    UNKNOWN,
}

object VoiceCommandParser {
    fun parse(transcript: String): VoiceCommand {
        val normalized = transcript
            .lowercase()
            .replace('ё', 'е')
            .replace(Regex("[^а-я]+"), " ")
            .trim()
            .replace(Regex("\\s+"), " ")
        return when (normalized) {
            "взял" -> VoiceCommand.PICKED
            "повтори" -> VoiceCommand.REPEAT
            "сколько" -> VoiceCommand.QUANTITY
            "не нашел" -> VoiceCommand.NOT_FOUND
            "пропусти" -> VoiceCommand.SKIP
            "отмени" -> VoiceCommand.UNDO
            "осталось" -> VoiceCommand.REMAINING
            "пауза" -> VoiceCommand.PAUSE
            "продолжить" -> VoiceCommand.CONTINUE
            else -> VoiceCommand.UNKNOWN
        }
    }
}

class PauseCommandGate(initiallyPaused: Boolean = false) {
    var paused: Boolean = initiallyPaused
        private set

    fun accept(command: VoiceCommand): VoiceCommand? {
        if (paused && command != VoiceCommand.CONTINUE) return null
        if (command == VoiceCommand.PAUSE) paused = true
        if (command == VoiceCommand.CONTINUE) paused = false
        return command
    }

    fun reset() {
        paused = false
    }
}
