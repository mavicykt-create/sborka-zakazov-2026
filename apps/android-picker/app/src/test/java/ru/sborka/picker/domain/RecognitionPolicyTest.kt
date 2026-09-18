package ru.sborka.picker.domain

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecognitionPolicyTest {
    private val ready = RecognitionReadiness(
        foreground = true,
        microphoneGranted = true,
        loggedIn = true,
        completed = false,
        backendBusy = false,
        speaking = false,
    )

    @Test
    fun `foreground picker resumes recognition when ready`() {
        assertTrue(ready.shouldListen())
    }

    @Test
    fun `recognition stays stopped while speech is playing`() {
        assertFalse(ready.copy(speaking = true).shouldListen())
    }

    @Test
    fun `recognition requires foreground permission and active session`() {
        assertFalse(ready.copy(foreground = false).shouldListen())
        assertFalse(ready.copy(microphoneGranted = false).shouldListen())
        assertFalse(ready.copy(loggedIn = false).shouldListen())
    }

    @Test
    fun `recognition waits for backend and unfinished queue`() {
        assertFalse(ready.copy(backendBusy = true).shouldListen())
        assertFalse(ready.copy(completed = true).shouldListen())
    }
}
