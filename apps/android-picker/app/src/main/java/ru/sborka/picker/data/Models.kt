package ru.sborka.picker.data

data class PickerWorker(
    val id: String,
    val login: String,
    val name: String,
    val isActive: Boolean,
    val shiftStatus: String,
)

data class PickerOrder(
    val id: String,
    val documentNumber: String,
    val documentDate: String,
    val status: String,
)

data class PickerItem(
    val id: String,
    val orderId: String,
    val sourceLine: Int,
    val sortIndex: Int,
    val groupKey: String,
    val name: String,
    val barcode: String?,
    val packageQuantity: Double?,
    val pieceQuantity: Double?,
    val pickType: PickType,
    val pickQuantity: Double,
    val status: String,
    val assignedAt: String?,
    val pickedAt: String?,
    val order: PickerOrder,
)

enum class PickType { PACKAGE, PIECE, REVIEW }

data class PickerQueueSummary(val total: Int, val active: Int, val waiting: Int)

data class PickerQueue(
    val worker: PickerWorker,
    val summary: PickerQueueSummary,
    val items: List<PickerItem>,
    val lastCompleted: PickerItem?,
)

data class PickerLoginRequest(val login: String, val password: String)

data class PickerLoginResponse(
    val token: String,
    val expiresAt: String,
    val worker: PickerWorker,
)

data class PickerStatusRequest(val status: String, val deviceAt: String)
data class PickerUndoRequest(val deviceAt: String)
data class SpeechRequest(val text: String)
data class SpeechSettingsResponse(val yandexEnabled: Boolean, val voice: String)
