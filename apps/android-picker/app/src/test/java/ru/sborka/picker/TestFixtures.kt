package ru.sborka.picker

import ru.sborka.picker.data.PickType
import ru.sborka.picker.data.PickerItem
import ru.sborka.picker.data.PickerOrder
import ru.sborka.picker.data.PickerQueue
import ru.sborka.picker.data.PickerQueueSummary
import ru.sborka.picker.data.PickerWorker

fun testWorker() = PickerWorker("w1", "anna", "Анна", true, "BUSY")

fun testItem(
    id: String = "i1",
    pickType: PickType = PickType.PACKAGE,
    pickQuantity: Double = 2.0,
) = PickerItem(
    id = id,
    orderId = "o1",
    sourceLine = 1,
    sortIndex = if (id == "i1") 0 else 1,
    groupKey = "ТОВАР",
    name = "Товар",
    barcode = "4600000000000",
    packageQuantity = if (pickType == PickType.PACKAGE) pickQuantity else null,
    pieceQuantity = if (pickType == PickType.PIECE) pickQuantity else null,
    pickType = pickType,
    pickQuantity = pickQuantity,
    status = "ASSIGNED",
    assignedAt = null,
    pickedAt = null,
    order = PickerOrder("o1", "12293", "2026-09-10T00:00:00.000Z", "PICKING"),
)

fun testQueue(items: List<PickerItem>, lastCompleted: PickerItem? = null) = PickerQueue(
    worker = testWorker(),
    summary = PickerQueueSummary(items.size, 0, items.size),
    items = items,
    lastCompleted = lastCompleted,
)
