# Android-приложение сборщика

Нативный клиент находится в `apps/android-picker` и предназначен только для сборщика. В нём нет
административных функций, загрузки XLSX, распределения заказов или аналитики. Приложение работает
только с существующими маршрутами `/api/picker/*` backend в Amvera.

## Требования

- Android Studio Quail 4 (2026.1.4) или новее;
- JDK 17;
- Android SDK Platform 36 и Build Tools 36.0.0;
- устройство с Android 8.0 (API 26) или новее.

Откройте в Android Studio именно каталог `apps/android-picker` и дождитесь Gradle Sync.

## Backend URL

URL не зашит в исходники и передаётся в `BuildConfig.BACKEND_URL`. Он обязан использовать HTTPS.
Yandex SpeechKit API key приложению не нужен: Alena вызывается через защищённый backend.

Для debug задайте адрес опубликованного backend в `%USERPROFILE%/.gradle/gradle.properties`:

```properties
PICKER_DEBUG_BASE_URL=https://your-app.amvera.io/
```

Либо передайте его только текущей команде:

```powershell
./gradlew assembleDebug -PPICKER_DEBUG_BASE_URL=https://your-app.amvera.io/
```

Для release обязательно задайте production-домен Amvera через secret окружения или Gradle property:

```powershell
$env:PICKER_PRODUCTION_BASE_URL='https://your-app.amvera.io/'
./gradlew assembleRelease
```

Сборка release без production URL намеренно завершается ошибкой. В Git нельзя добавлять пароли,
picker token, `local.properties`, keystore или URL с чувствительными параметрами.

## Сборка и тесты

Из `apps/android-picker`:

```powershell
./gradlew test
./gradlew assembleDebug
```

UI smoke-тесты требуют подключённого устройства или эмулятора:

```powershell
./gradlew connectedDebugAndroidTest
```

Debug APK создаётся в:

```text
apps/android-picker/app/build/outputs/apk/debug/app-debug.apk
```

Unsigned release APK создаётся в `app/build/outputs/apk/release/`. Для распространения release
версии добавьте signing config локально или в защищённом CI, не сохраняя ключ и пароли в GitHub.

## Установка

Разрешите установку приложений из выбранного источника на телефоне и установите APK через файловый
менеджер либо ADB:

```powershell
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

При первом запуске разрешите доступ к микрофону. Android автоматически использует активный
Bluetooth- или проводной аудиомаршрут. Кнопки гарнитуры в MVP не обрабатываются.

## Безопасность и поведение

- picker token шифруется AES-GCM ключом из Android Keystore и исключён из backup;
- при `401` token удаляется, приложение возвращается на вход;
- пароль, token и Yandex API key не логируются;
- результат позиции не меняется локально до успешного ответа backend;
- при недоступности Alena используется Android TextToSpeech `ru-RU`;
- скорость голоса выбирается из `0.5×`, `0.65×`, `0.8×`, `1.0×`, `1.12×`, `1.22×`, `1.35×`, `1.5×`
  и сохраняется в DataStore; значение по умолчанию — `1.22×`;
- Alena синтезируется backend со скоростью `1.22`, поэтому Android применяет к MP3 только относительный
  коэффициент `выбранная скорость / 1.22`; если устройство отвергает коэффициент, используется Android TTS;
- распознавание выключается на время речи и включается только после окончания аудио;
- после возврата из background распознавание возобновляется только для активной сессии без текущей речи
  или backend-операции;
- во время паузы распознаётся только команда «Продолжить».

Основные официальные ориентиры: [Android 16 SDK](https://developer.android.com/about/versions/16/setup-sdk),
[AGP 9.0](https://developer.android.com/build/releases/agp-9-0-0-release-notes),
[Compose BOM](https://developer.android.com/develop/ui/compose/bom).
