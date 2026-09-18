package ru.sborka.picker.data

import com.google.gson.GsonBuilder
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object ApiClient {
    fun create(baseUrl: String): PickerApi {
        require(baseUrl.startsWith("https://")) { "Backend URL must use HTTPS" }
        val normalized = if (baseUrl.endsWith('/')) baseUrl else "$baseUrl/"
        val client = OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build()
        return Retrofit.Builder()
            .baseUrl(normalized)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create(GsonBuilder().create()))
            .build()
            .create(PickerApi::class.java)
    }
}
