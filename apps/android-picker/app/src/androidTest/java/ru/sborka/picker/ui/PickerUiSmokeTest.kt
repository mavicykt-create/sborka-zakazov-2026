package ru.sborka.picker.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import ru.sborka.picker.data.PickType
import ru.sborka.picker.data.PickerItem
import ru.sborka.picker.data.PickerOrder
import ru.sborka.picker.data.PickerQueue
import ru.sborka.picker.data.PickerQueueSummary
import ru.sborka.picker.data.PickerWorker

class PickerUiSmokeTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun loginScreenAcceptsCredentials() {
        var submitted = ""
        compose.setContent {
            LoginScreen(false, "") { login, password -> submitted = "$login:$password" }
        }

        compose.onNodeWithTag("login-screen").assertIsDisplayed()
        compose.onNodeWithTag("login-input").performTextInput("anna")
        compose.onNodeWithTag("password-input").performTextInput("secret-password")
        compose.onNodeWithTag("login-button").assertIsEnabled().performClick()
        assertEquals("anna:secret-password", submitted)
    }

    @Test
    fun currentItemScreenShowsOnlyOneActiveProduct() {
        compose.setContent {
            PickerApp(
                state = PickerUiState(
                    checkingSession = false,
                    loggedIn = true,
                    workerName = "Анна",
                    queue = queue(listOf(item(), item().copy(id = "i2", name = "Второй товар"))),
                    sessionTotal = 16,
                ),
                onLogin = { _, _ -> },
                onLogout = {},
                onRefresh = {},
                onCommand = {},
                onSettings = {},
            )
        }

        compose.onNodeWithTag("current-item-screen").assertIsDisplayed()
        compose.onAllNodesWithTag("current-item").assertCountEquals(1)
        compose.onNodeWithTag("picked-button").assertIsDisplayed().assertIsEnabled()
    }

    @Test
    fun completedScreenOffersRefresh() {
        compose.setContent {
            PickerApp(
                state = PickerUiState(
                    checkingSession = false,
                    loggedIn = true,
                    workerName = "Анна",
                    queue = queue(emptyList()),
                    sessionTotal = 16,
                    completed = true,
                ),
                onLogin = { _, _ -> },
                onLogout = {},
                onRefresh = {},
                onCommand = {},
                onSettings = {},
            )
        }

        compose.onNodeWithTag("completed-screen").assertIsDisplayed()
        compose.onNodeWithTag("refresh-button").assertIsDisplayed().assertIsEnabled()
    }
}

private fun worker() = PickerWorker("w1", "anna", "Анна", true, "BUSY")

private fun item() = PickerItem(
    id = "i1",
    orderId = "o1",
    sourceLine = 1,
    sortIndex = 0,
    groupKey = "КОФЕ",
    name = "КОФЕ MONARCH 3В1 крепкий",
    barcode = "4607001773207",
    packageQuantity = 1.0,
    pieceQuantity = 24.0,
    pickType = PickType.PACKAGE,
    pickQuantity = 1.0,
    status = "ASSIGNED",
    assignedAt = null,
    pickedAt = null,
    order = PickerOrder("o1", "12293", "2026-09-10T00:00:00.000Z", "PICKING"),
)

private fun queue(items: List<PickerItem>) = PickerQueue(
    worker = worker(),
    summary = PickerQueueSummary(items.size, 0, items.size),
    items = items,
    lastCompleted = null,
)
