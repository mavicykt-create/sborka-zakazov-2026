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
    fun `removes empty bracket groups with Android compatible regex`() {
        assertEquals("Товар вкус", sanitizeProductName("Товар () [] {} вкус"))
    }
    @Test
    fun `does not pronounce service markers`() {
        assertEquals(
            "Печенье Oreo 228г",
            sanitizeProductName("ПЧН Печенье Oreo МКШ 228г МРМ"),
        )
    }

    @Test
    fun `maps known warehouse categories to spoken names`() {
        assertEquals("Печенье", categorySpeech(testItem().copy(groupKey = "ПЧН", name = "ПЧН Oreo")))
        assertEquals("Мармелад", categorySpeech(testItem().copy(groupKey = "МРМ", name = "МРМ Fruittella")))
        assertEquals(
            "Шоколадные батончики",
            categorySpeech(testItem().copy(groupKey = "Шоколадные", name = "Шоколадные батончики Snickers")),
        )
        assertEquals("Плитки", categorySpeech(testItem().copy(groupKey = "Плитки", name = "Плитки Alpen Gold")))
        assertEquals(
            "Жидкие конфеты",
            categorySpeech(testItem().copy(groupKey = "Жидкие", name = "Жидкие конфеты Slime")),
        )
        assertEquals("Прикасса", categorySpeech(testItem().copy(groupKey = "Прикасса", name = "Прикасса Mentos")))
        assertEquals(
            "Жевательные резинки",
            categorySpeech(testItem().copy(groupKey = "Жевательные", name = "Жевательные резинки Orbit")),
        )
        assertEquals(
            "Жевательные конфеты",
            categorySpeech(testItem().copy(groupKey = "Жевательные", name = "Жевательные конфеты Mamba")),
        )
        assertEquals("Кофе", categorySpeech(testItem().copy(groupKey = "Кофе", name = "Кофе Jardin")))
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
