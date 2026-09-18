package ru.sborka.picker.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceCommandTest {
    @Test
    fun `parses exact Russian commands and variants`() {
        assertEquals(VoiceCommand.PICKED, VoiceCommandParser.parse("Взял"))
        assertEquals(VoiceCommand.NOT_FOUND, VoiceCommandParser.parse("Не нашёл"))
        assertEquals(VoiceCommand.NOT_FOUND, VoiceCommandParser.parse("не нашел"))
        assertEquals(VoiceCommand.CONTINUE, VoiceCommandParser.parse("Продолжить!"))
    }

    @Test
    fun `next never means picked`() {
        assertEquals(VoiceCommand.UNKNOWN, VoiceCommandParser.parse("Дальше"))
    }

    @Test
    fun `pause admits only continue`() {
        val gate = PauseCommandGate()
        assertEquals(VoiceCommand.PAUSE, gate.accept(VoiceCommand.PAUSE))
        assertTrue(gate.paused)
        assertNull(gate.accept(VoiceCommand.PICKED))
        assertNull(gate.accept(VoiceCommand.NOT_FOUND))
        assertEquals(VoiceCommand.CONTINUE, gate.accept(VoiceCommand.CONTINUE))
        assertTrue(!gate.paused)
    }
}
