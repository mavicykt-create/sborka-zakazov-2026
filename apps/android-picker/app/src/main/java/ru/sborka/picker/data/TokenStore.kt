package ru.sborka.picker.data

interface TokenStore {
    fun read(): String?
    fun write(token: String)
    fun clear()
}
