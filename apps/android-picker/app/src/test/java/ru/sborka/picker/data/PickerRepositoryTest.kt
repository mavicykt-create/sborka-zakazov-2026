package ru.sborka.picker.data

import kotlinx.coroutines.test.runTest
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertNull
import org.junit.Assert.assertEquals
import org.junit.Test
import ru.sborka.picker.testItem
import ru.sborka.picker.testQueue
import retrofit2.HttpException
import retrofit2.Response

class PickerRepositoryTest {
    @Test(expected = UnauthorizedException::class)
    fun `401 clears picker token`() = runTest {
        val tokens = MemoryTokenStore("secret-picker-token")
        val repository = NetworkPickerRepository(UnauthorizedApi(), tokens)

        try {
            repository.loadQueue()
        } finally {
            assertNull(tokens.read())
        }
    }

    @Test
    fun `assigned item is activated before final status`() = runTest {
        val queue = testQueue(emptyList())
        val api = RecordingApi(queue)
        val repository = NetworkPickerRepository(api, MemoryTokenStore("token"))

        repository.updateStatus(testItem(), "PICKED")

        assertEquals(listOf("ACTIVE", "PICKED"), api.statuses)
    }
}

private class MemoryTokenStore(private var value: String?) : TokenStore {
    override fun read() = value
    override fun write(token: String) { value = token }
    override fun clear() { value = null }
}

private class UnauthorizedApi : PickerApi {
    private fun unauthorized(): Nothing = throw HttpException(Response.error<ResponseBody>(401, "".toResponseBody()))
    override suspend fun login(request: PickerLoginRequest): PickerLoginResponse = unauthorized()
    override suspend fun logout(authorization: String): ResponseBody = unauthorized()
    override suspend fun queue(authorization: String): PickerQueue = unauthorized()
    override suspend fun updateStatus(authorization: String, itemId: String, request: PickerStatusRequest): ResponseBody = unauthorized()
    override suspend fun undo(authorization: String, itemId: String, request: PickerUndoRequest): ResponseBody = unauthorized()
    override suspend fun speechSettings(authorization: String): SpeechSettingsResponse = unauthorized()
    override suspend fun speech(authorization: String, request: SpeechRequest): ResponseBody = unauthorized()
}

private class RecordingApi(private val result: PickerQueue) : PickerApi {
    val statuses = mutableListOf<String>()
    private fun unsupported(): Nothing = error("Unexpected API call")

    override suspend fun login(request: PickerLoginRequest): PickerLoginResponse = unsupported()
    override suspend fun logout(authorization: String): ResponseBody = unsupported()
    override suspend fun queue(authorization: String): PickerQueue = result
    override suspend fun updateStatus(
        authorization: String,
        itemId: String,
        request: PickerStatusRequest,
    ): ResponseBody {
        statuses += request.status
        return ByteArray(0).toResponseBody()
    }
    override suspend fun undo(authorization: String, itemId: String, request: PickerUndoRequest): ResponseBody =
        unsupported()
    override suspend fun speechSettings(authorization: String): SpeechSettingsResponse = unsupported()
    override suspend fun speech(authorization: String, request: SpeechRequest): ResponseBody = unsupported()
}
