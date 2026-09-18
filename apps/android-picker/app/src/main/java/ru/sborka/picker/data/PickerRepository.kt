package ru.sborka.picker.data

import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.CancellationException
import okhttp3.ResponseBody
import retrofit2.HttpException

class UnauthorizedException : Exception("Сессия завершена. Войдите снова.")
class NoSessionException : Exception("Требуется вход сборщика")

interface PickerRepository {
    fun hasSession(): Boolean
    suspend fun login(login: String, password: String): PickerLoginResponse
    suspend fun logout()
    suspend fun loadQueue(): PickerQueue
    suspend fun updateStatus(item: PickerItem, status: String): PickerQueue
    suspend fun undo(itemId: String): PickerQueue
    suspend fun speechSettings(): SpeechSettingsResponse
    suspend fun speechAudio(text: String): ByteArray
}

class NetworkPickerRepository(
    private val api: PickerApi,
    private val tokenStore: TokenStore,
    private val now: () -> Instant = Instant::now,
) : PickerRepository {
    override fun hasSession(): Boolean = tokenStore.read() != null

    override suspend fun login(login: String, password: String): PickerLoginResponse {
        val response = api.login(PickerLoginRequest(login.trim(), password))
        tokenStore.write(response.token)
        return response
    }

    override suspend fun logout() {
        val token = tokenStore.read()
        try {
            if (token != null) api.logout(token.authorization())
        } finally {
            tokenStore.clear()
        }
    }

    override suspend fun loadQueue(): PickerQueue = authorized { token -> api.queue(token.authorization()) }

    override suspend fun updateStatus(item: PickerItem, status: String): PickerQueue = authorized { token ->
        if (item.status == "ASSIGNED" && status != "ACTIVE") {
            try {
                api.updateStatus(
                    token.authorization(),
                    item.id,
                    PickerStatusRequest("ACTIVE", now().toString()),
                ).close()
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                val queue = queueAfterAmbiguousFailure(token)
                val remoteItem = queue?.items?.find { it.id == item.id }
                if (queue != null && remoteItem == null) return@authorized queue
                if (remoteItem?.status != "ACTIVE") throw error
            }
        }
        try {
            api.updateStatus(token.authorization(), item.id, PickerStatusRequest(status, now().toString())).close()
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            val queue = queueAfterAmbiguousFailure(token)
            if (queue != null && queue.items.none { it.id == item.id }) return@authorized queue
            throw error
        }
        api.queue(token.authorization())
    }

    override suspend fun undo(itemId: String): PickerQueue = authorized { token ->
        api.undo(token.authorization(), itemId, PickerUndoRequest(now().toString())).close()
        api.queue(token.authorization())
    }

    override suspend fun speechSettings(): SpeechSettingsResponse =
        authorized { token -> api.speechSettings(token.authorization()) }

    override suspend fun speechAudio(text: String): ByteArray = authorized { token ->
        api.speech(token.authorization(), SpeechRequest(text)).use(ResponseBody::bytes)
    }

    private suspend fun <T> authorized(call: suspend (String) -> T): T {
        val token = tokenStore.read() ?: throw NoSessionException()
        return try {
            call(token)
        } catch (error: HttpException) {
            if (error.code() == 401) {
                tokenStore.clear()
                throw UnauthorizedException()
            }
            throw error
        }
    }

    private suspend fun queueAfterAmbiguousFailure(token: String): PickerQueue? = try {
        api.queue(token.authorization())
    } catch (error: HttpException) {
        if (error.code() == 401) throw error
        null
    } catch (error: IOException) {
        null
    }

    private fun String.authorization() = "Bearer $this"
}

fun Throwable.toPickerMessage(): String = when (this) {
    is UnauthorizedException, is NoSessionException -> message ?: "Требуется вход сборщика"
    is IOException -> "Нет связи. Не удалось сохранить. Повторите команду."
    is HttpException -> if (code() >= 500) "Сервер недоступен" else "Сервер отклонил действие"
    else -> message ?: "Не удалось выполнить действие"
}
