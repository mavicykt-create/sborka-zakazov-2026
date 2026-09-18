package ru.sborka.picker.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.sborka.picker.testItem

class SpeechTextTest {
    @Test
    fun `removes packaging schemes and hieroglyphs but keeps useful digits`() {
        val value = sanitizeProductName("КОФЕ 3в1 1/12/12 13гр 漢字 250мл 6х12")

        assertTrue(value.contains("3в1"))
        assertTrue(value.contains("13гр"))
        assertTrue(value.contains("250мл"))
        assertFalse(value.contains("1/12/12"))
        assertFalse(value.contains("6х12"))
        assertFalse(value.contains("漢字"))
    }

    @Test
    fun `builds piece phrase`() {
        val speech = itemSpeech(testItem(pickType = ru.sborka.picker.data.PickType.PIECE, pickQuantity = 7.0), true)
        assertEquals("Штучный товар. Товар. семь штук.", speech)
    }

    @Test
    fun `safety cleanup applies when short names are disabled`() {
        val item = testItem().copy(name = "КОФЕ 3в1 1/24 漢字 250мл")

        assertEquals("КОФЕ 3в1 250мл. два блока.", itemSpeech(item, false))
    }

    @Test
    fun `uses correct unit for decimal quantity`() {
        assertEquals("1,5 блока", quantitySpeech(testItem(pickQuantity = 1.5)))
    }
}
