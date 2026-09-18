package ru.sborka.picker.data

import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

interface PickerApi {
    @POST("api/picker/login")
    suspend fun login(@Body request: PickerLoginRequest): PickerLoginResponse

    @POST("api/picker/logout")
    suspend fun logout(@Header("Authorization") authorization: String): ResponseBody

    @GET("api/picker/queue")
    suspend fun queue(@Header("Authorization") authorization: String): PickerQueue

    @PATCH("api/picker/items/{id}/status")
    suspend fun updateStatus(
        @Header("Authorization") authorization: String,
        @Path("id") itemId: String,
        @Body request: PickerStatusRequest,
    ): ResponseBody

    @POST("api/picker/items/{id}/undo")
    suspend fun undo(
        @Header("Authorization") authorization: String,
        @Path("id") itemId: String,
        @Body request: PickerUndoRequest,
    ): ResponseBody

    @GET("api/picker/speech/settings")
    suspend fun speechSettings(@Header("Authorization") authorization: String): SpeechSettingsResponse

    @POST("api/picker/speech")
    suspend fun speech(
        @Header("Authorization") authorization: String,
        @Body request: SpeechRequest,
    ): ResponseBody
}
