package ru.sborka.picker.domain

import java.math.BigDecimal
import ru.sborka.picker.data.PickType
import ru.sborka.picker.data.PickerItem

private val masculine = listOf("", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять")
private val feminine = listOf("", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять")
private val teens = listOf("десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать")
private val tens = listOf("", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто")
private val hundreds = listOf("", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот")

fun sanitizeProductName(name: String): String = name
    .replace(Regex("(?<![\\p{L}\\p{N}])\\d+\\s*(?:[/\\\\*xх]\\s*\\d+){1,2}(?![\\p{L}\\p{N}])", RegexOption.IGNORE_CASE), " ")
    .replace(Regex("[\\p{IsHan}\\p{IsHiragana}\\p{IsKatakana}\\p{IsHangul}]+"), " ")
    .replace(Regex("\\(\\s*\\)|\\[\\s*\\]|\\{\\s*\\}"), " ")
    .replace(Regex("\\s+([,.;:!?])"), "$1")
    .trim(' ', ',', '.', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}', '-', '–', '—', '/', '\\', '*')
    .replace(Regex("\\s+"), " ")

fun numberToRussian(value: Double, useFeminine: Boolean): String {
    val integer = value.toInt()
    if (value != integer.toDouble() || integer !in 0..999) {
        return BigDecimal.valueOf(value).stripTrailingZeros().toPlainString().replace('.', ',')
    }
    if (integer == 0) return "ноль"
    val words = mutableListOf<String>()
    val hundred = integer / 100
    val remainder = integer % 100
    if (hundred > 0) words += hundreds[hundred]
    if (remainder in 10..19) {
        words += teens[remainder - 10]
    } else {
        val ten = remainder / 10
        val one = remainder % 10
        if (ten > 0) words += tens[ten]
        if (one > 0) words += (if (useFeminine) feminine else masculine)[one]
    }
    return words.joinToString(" ")
}

private fun plural(value: Int, one: String, few: String, many: String): String {
    val lastTwo = value % 100
    val last = lastTwo % 10
    return when {
        lastTwo in 11..19 -> many
        last == 1 -> one
        last in 2..4 -> few
        else -> many
    }
}

fun quantitySpeech(item: PickerItem): String? {
    if (item.pickType == PickType.REVIEW) return null
    val feminineNumber = item.pickType == PickType.PIECE
    val number = numberToRussian(item.pickQuantity, feminineNumber)
    val integer = item.pickQuantity.toInt()
    val isInteger = item.pickQuantity == integer.toDouble()
    val unit = if (!isInteger) {
        if (item.pickType == PickType.PIECE) "штуки" else "блока"
    } else if (item.pickType == PickType.PIECE) {
        plural(integer, "штука", "штуки", "штук")
    } else {
        plural(integer, "блок", "блока", "блоков")
    }
    return "$number $unit"
}

fun itemSpeech(item: PickerItem, shortNames: Boolean): String? {
    val quantity = quantitySpeech(item) ?: return null
    val sanitized = sanitizeProductName(item.name)
    val name = if (shortNames) sanitized.split(Regex("\\s+")).take(8).joinToString(" ") else sanitized
    val prefix = if (item.pickType == PickType.PIECE) "Штучный товар. " else ""
    return "$prefix$name. $quantity."
}

fun remainingSpeech(value: Int): String =
    "Осталось ${numberToRussian(value.toDouble(), true)} ${plural(value, "позиция", "позиции", "позиций")}."
