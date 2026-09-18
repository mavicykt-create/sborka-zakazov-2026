package ru.sborka.picker.domain

// Keep this synchronized with YANDEX_SPEECHKIT_SPEED in the backend.
const val ALENA_SERVER_BASE_RATE = 1.22f
const val DEFAULT_SPEECH_RATE = 1.22f

val SPEECH_RATE_OPTIONS = listOf(0.5f, 0.65f, 0.8f, 1.0f, 1.12f, 1.22f, 1.35f, 1.5f)

fun alenaPlaybackSpeed(requestedRate: Float): Float = requestedRate / ALENA_SERVER_BASE_RATE
