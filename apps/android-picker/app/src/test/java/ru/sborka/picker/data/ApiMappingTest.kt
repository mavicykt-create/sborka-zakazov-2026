package ru.sborka.picker.data

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApiMappingTest {
    @Test
    fun `maps picker queue payload from backend`() {
        val json = """
            {
              "worker":{"id":"w1","login":"anna","name":"Анна","isActive":true,"shiftStatus":"BUSY"},
              "summary":{"total":16,"active":1,"waiting":15},
              "items":[{
                "id":"i1","orderId":"o1","sourceLine":12,"sortIndex":0,"groupKey":"КОФЕ",
                "name":"КОФЕ MONARCH 3В1 крепкий 10/24 13гр","barcode":"4607001773207",
                "packageQuantity":"1","pieceQuantity":"24","pickType":"PACKAGE","pickQuantity":"1",
                "status":"ACTIVE","assignedAt":"2026-09-18T00:00:00.000Z","pickedAt":null,
                "order":{"id":"o1","documentNumber":"12293","documentDate":"2026-09-10T00:00:00.000Z","status":"PICKING"}
              }],
              "lastCompleted":null
            }
        """.trimIndent()

        val queue = Gson().fromJson(json, PickerQueue::class.java)

        assertEquals(16, queue.summary.total)
        assertEquals("КОФЕ MONARCH 3В1 крепкий 10/24 13гр", queue.items.single().name)
        assertEquals(1.0, queue.items.single().pickQuantity, 0.0)
        assertEquals(PickType.PACKAGE, queue.items.single().pickType)
        assertNull(queue.lastCompleted)
    }
}
