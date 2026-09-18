package ru.sborka.picker

import android.app.Application
import ru.sborka.picker.data.AndroidKeystoreTokenStore
import ru.sborka.picker.data.ApiClient
import ru.sborka.picker.data.NetworkPickerRepository
import ru.sborka.picker.data.PickerRepository
import ru.sborka.picker.data.SettingsStore

class PickerApplication : Application() {
    lateinit var repository: PickerRepository
        private set
    lateinit var settingsStore: SettingsStore
        private set

    override fun onCreate() {
        super.onCreate()
        repository = NetworkPickerRepository(
            api = ApiClient.create(BuildConfig.BACKEND_URL),
            tokenStore = AndroidKeystoreTokenStore(this),
        )
        settingsStore = SettingsStore(this)
    }
}
