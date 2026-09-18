package ru.sborka.picker.domain

data class RecognitionReadiness(
    val foreground: Boolean,
    val microphoneGranted: Boolean,
    val loggedIn: Boolean,
    val completed: Boolean,
    val backendBusy: Boolean,
    val speaking: Boolean,
)

fun RecognitionReadiness.shouldListen(): Boolean =
    foreground && microphoneGranted && loggedIn && !completed && !backendBusy && !speaking
