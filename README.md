# Сборка заказов 2026

Монорепозиторий для складского сервиса сборки заказов. Текущая версия принимает товарный чек XLSX, распределяет его между сборщиками, сопровождает проверку и закрытие заказа, формирует итоговые PDF и показывает операционную сводку смены.

## Что работает

1. Ручная загрузка XLSX через веб-терминал или HTTP API.
2. Извлечение номера/даты документа, склада и товарных строк.
3. Сохранение штрихкода, названия, количества упаковок и количества штук.
4. Определение типа отбора `PACKAGE`, `PIECE` или `REVIEW`.
5. Группировка по первому слову и алфавитная сортировка групп и товаров.
6. Защита от повторного импорта одного документа.
7. Список заказов и карточка заказа с позициями в React/Vite.
8. Сборщики, активность и статусы смены `OFF_SHIFT / AVAILABLE / BUSY`.
9. Равномерное распределение и перераспределение незавершённых позиций.
10. Статусы позиций, прогресс заказа и блок проблемных товаров.
11. Неизменяемый журнал назначений, действий и завершения заказа.
12. Разделы «Проблемы» и «История» с административной проверкой.
13. Контролируемое закрытие заказа только после решения всех проблем.
14. Короткий печатный и полный электронный PDF «Лист сборки» с QR-кодом.
15. Главный экран с текущими заказами, сменой и единым блоком внимания.
16. Постоянный журнал успешных, повторных и ошибочных импортов.
17. Аналитика за 7/30/90 дней по заказам, позициям и сборщикам.
18. Защищённый веб-режим сборщика с личной очередью и отменой последнего действия.
19. Голосовая сборка с русскими командами, настраиваемым TTS и шестью локальными звуковыми сигналами.

В `test-data/sample-order-12293.xlsx` лежит реальный тестовый документ на 48 позиций.

## Требования

- Node.js 22 или новее;
- Docker Desktop с поддержкой `docker compose`;
- свободные порты `5432`, `8080` и `5173`.

## Первый запуск

```bash
cp .env.example .env
docker compose up -d
npm install
npm --workspace @assembly/api run prisma:generate
npm --workspace @assembly/api run prisma:migrate
```

Запустите API и главный терминал в двух отдельных окнах терминала:

```bash
npm run dev:api
```

```bash
npm run dev:admin
```

Перед запуском задайте в локальном `.env` собственные `ADMIN_PASSWORD` длиной не менее 12 символов
и `ADMIN_SESSION_SECRET`. Эти значения являются секретами и не должны попадать в Git.

API: `http://localhost:8080`  
Admin: `http://localhost:5173`

Проверка доступности API:

```bash
curl http://localhost:8080/health
```

## Импорт XLSX

`POST /api/orders/import-xlsx` принимает `multipart/form-data` с полем `file`.

```bash
curl -F "file=@test-data/sample-order-12293.xlsx" http://localhost:8080/api/orders/import-xlsx
```

После импорта заказ доступен через `GET /api/orders` и `GET /api/orders/:id`. Повторный запрос вернёт существующий заказ с `"duplicate": true` и не создаст копию.

## Сборка по email

Вкладка «Сборка по email» показывает состояние подключения почты, позволяет вручную проверить
XLSX-вложение и ведёт журнал писем со ссылками на созданные заказы. Для Яндекс 360 включите в настройках
ящика доступ почтовых программ по IMAP, создайте отдельный пароль приложения типа «Почта» и задайте
`IMAP_USER=mail@sladkayaplaneta.ru` и `IMAP_PASSWORD=<пароль приложения>`. Подключение выполняется к
`imap.yandex.com:993` через SSL; обычный пароль от Яндекс ID сервису не нужен. По умолчанию каждые
5 секунд выбираются непрочитанные письма с XLSX-вложением. Папка, необязательный фильтр отправителя и
период меняются через `IMAP_MAILBOX`, `IMAP_SENDER` и `IMAP_POLL_INTERVAL_MS`. Если заказы отправляются
из самого подключённого ящика, выберите папку отправленных через `IMAP_MAILBOX` и задайте
`IMAP_UNSEEN_ONLY=false`, потому что отправленные письма уже имеют признак прочитанных.

Gmail OAuth остаётся запасным вариантом через `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` и
`GMAIL_REFRESH_TOKEN`. Если заданы IMAP-параметры, сервис использует Яндекс Почту в первую очередь.

Повторное письмо или одинаковое вложение не создаёт второй заказ. Новое письмо с тем же номером
обновляет строки и сумму существующего заказа, а письмо со следующим номером закрывает предыдущий.
Ручная проверка доступна и до подключения почтового ящика.

Планшетный PWA открывается по адресу `/picker`. Фотографии товаров сопоставляются по коду из XML
`https://milku.ru/site1/export-google-whatsp/` (`g:id` → `g:image_link`); адрес можно заменить через
`PRODUCT_FEED_URL`. Каталог кэшируется на сервере на 10 минут.

## Обмен с 1С:УНФ

`POST /api/integrations/1c/expense-invoices` принимает расходные накладные из локальной 1С:УНФ в JSON. Запрос должен содержать заголовок `Authorization: Bearer <ONEC_EXCHANGE_TOKEN>`. Ключ задаётся отдельно в окружении сервера, должен состоять минимум из 32 символов и не хранится в репозитории.

Пример тела запроса:

```json
{
  "sourceId": "16e9a5f4-7e0e-4d65-91ee-64f3a7b64c38",
  "revision": "2026-09-22T11:45:00",
  "posted": true,
  "documentNumber": "РН-000123",
  "documentDate": "2026-09-22",
  "warehouse": "Основной склад",
  "customer": "Покупатель",
  "items": [
    {
      "lineNumber": 1,
      "productId": "a9bbf73c-2d1e-4727-8704-534cc70a989e",
      "sku": "10101",
      "barcode": "4600000000001",
      "name": "Товар",
      "quantity": 2,
      "unit": "шт",
      "pickType": "PIECE"
    }
  ]
}
```

Повтор того же состояния безопасен и возвращает `duplicate: true`. Пока заказ не передан сборщикам, изменение документа заменяет его состав. После начала сборки изменение из 1С получает HTTP 409 и требует проверки администратора. `posted: false` отменяет ещё не начатый заказ и сохраняет это в журнале.

Каждая попытка сохраняется в журнале. Последние загрузки доступны в разделе «Настройки» и через `GET /api/imports`; ошибки за последние 24 часа выводятся на главной странице.

Маршруты главного терминала:

- `GET /api/dashboard` — агрегированная сводка заказов, смены и внимания;
- `GET /api/analytics?days=30` — динамика и показатели за 7, 30 или 90 дней;
- `GET /api/imports?status=FAILED&limit=30` — журнал попыток импорта;
- `GET /api/settings` — безопасная диагностика без секретов окружения.

Все маршруты главного терминала под `/api/orders`, `/api/order-items`, `/api/workers`,
`/api/dashboard`, `/api/analytics`, `/api/imports`, `/api/problems` и `/api/settings` требуют
административную HttpOnly cookie. Вход выполняется через `POST /api/admin/login`, проверка сессии —
через `GET /api/admin/me`, выход — через `POST /api/admin/logout`. Браузер не получает пароль,
секрет сессии и не хранит административный токен в `localStorage`.

## Сборщики и распределение

Создать сборщика можно в разделе «Сборщики» главного терминала или через API:

```bash
curl -X POST http://localhost:8080/api/workers \
  -H "Content-Type: application/json" \
  -d '{"login":"anna","password":"change-me-123","name":"Анна","shiftStatus":"AVAILABLE"}'
```

API никогда не возвращает `passwordHash`. Для локальной демонстрации можно создать трёх сборщиков командой ниже. Если `DEMO_WORKER_PASSWORD` не задан, команда сгенерирует временный пароль и покажет его только в терминале.

```bash
npm --workspace @assembly/api run prisma:seed
```

## Веб-режим сборщика

Откройте раздел «Сборка» главного терминала и войдите под логином сборщика. После назначения заказа сотрудник видит только свои незавершённые позиции и может начать позицию, отметить её как собранную, не найденную или пропущенную, а также отменить последний результат.

Для воспроизводимой локальной демонстрации задайте общий пароль перед заполнением базы:

```powershell
$env:DEMO_WORKER_PASSWORD='change-me-local-123'
npm --workspace @assembly/api run prisma:seed
```

Сессия действует 12 часов. В базе хранится только SHA-256-хеш случайного токена; пароль хранится как `scrypt`-хеш. Выход немедленно отзывает сессию. Защищённые маршруты `/api/picker/*` принимают токен в заголовке `Authorization: Bearer ...` и проверяют назначение каждой позиции вошедшему сборщику.

### Голосовая сборка

В личной очереди нажмите «Начать голосовую сборку» и разрешите браузеру доступ к микрофону. Режим использует локальные браузерные `SpeechSynthesis`, `SpeechRecognition` / `webkitSpeechRecognition` и Web Audio API без внешних CDN. Лучше всего поддерживается актуальным Chrome или Edge.

Точные русские команды: «Взял», «Повтори», «Сколько», «Не нашёл», «Пропусти», «Отмени», «Осталось», «Пауза» и «Продолжить». Команда «Дальше» намеренно не подтверждает товар. Во время паузы распознавание работает в безопасном режиме ожидания: все команды игнорируются, кроме голосовой команды «Продолжить». После неё приложение повторяет текущую позицию и возвращается к обычной сборке; возобновить работу также можно большой экранной кнопкой. Все результативные действия доступны кнопками и без Web Speech API.

Скорость речи по умолчанию равна `1.22`; доступны варианты `1.0`, `1.12`, `1.22` и `1.35`. Если браузер предоставляет несколько русских голосов, их можно выбрать в панели сборщика. Скорость, голос и переключатель «Короткие названия» сохраняются в `localStorage`. Короткие названия включены по умолчанию: только перед TTS из названия удаляются упаковочные схемы и фрагменты азиатских письменностей, исходные данные заказа не меняются.

Сигнал «Принято» звучит только после успешного ответа backend. Следующая позиция произносится сразу без дополнительного сигнала, а команда «Повтори» не добавляет отдельный звук. При сетевой ошибке текущая позиция не меняется, переход не выполняется, а интерфейс показывает просьбу повторить команду. Позиции `REVIEW` заблокированы до решения администратора. В панели «Проверить сигналы» можно отдельно прослушать шесть локальных сигналов.

#### Yandex SpeechKit Alena

Сборщик может выбрать источник речи «Alena — Yandex SpeechKit» или оставить системный «Голос телефона». Без ключа вариант Alena показан как недоступный, а вся голосовая сборка продолжает работать через браузерный TTS. При timeout, ошибке SpeechKit или невозможности проиграть аудио приложение автоматически произносит ту же фразу системным голосом и продолжает слушать команды через 200 мс.

Секрет хранится только на backend. Добавьте значения в локальный `.env` или переменные production-окружения; настоящий ключ не должен попадать в `VITE_*`, браузер или репозиторий:

```dotenv
YANDEX_SPEECHKIT_API_KEY=
YANDEX_SPEECHKIT_FOLDER_ID=
YANDEX_SPEECHKIT_VOICE=alena
```

Интеграция использует актуальный SpeechKit API v1: `POST https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize`, авторизацию `Api-Key`, MP3, голос `alena` и серверную скорость `1.22`. Для API-ключа сервисного аккаунта `folderId` в запрос не передаётся согласно официальной документации; переменная оставлена для будущей поддержки IAM-аутентификации. Аудио повторяющихся нормализованных фраз хранится в ограниченном in-memory LRU/TTL-кэше. Тесты используют только mock-провайдер.

Официальная документация: [метод API v1](https://yandex.cloud/ru/docs/speechkit/tts/request), [голоса SpeechKit](https://yandex.cloud/ru/docs/speechkit/tts/voices), [API-ключи](https://yandex.cloud/ru/docs/iam/concepts/authorization/api-key).

## Локальный production-запуск

Production-сборка объединяет Fastify API и React/Vite frontend на одном порту. Клиент без
`VITE_API_URL` обращается к `/api/*` на текущем origin, поэтому production runtime не зависит от
Vite-переменных сборки.

```powershell
npm run build:prod
$env:NODE_ENV='production'
$env:DATABASE_URL='postgresql://assembly:assembly@localhost:5432/assembly2026?schema=public'
$env:JWT_SECRET='replace-with-a-long-random-secret'
$env:ADMIN_USERNAME='admin'
$env:ADMIN_PASSWORD='replace-with-a-strong-admin-password'
$env:ADMIN_SESSION_SECRET='replace-with-a-long-random-session-secret'
$env:PORT='8080'
$env:ADMIN_ORIGIN='http://localhost:8080'
$env:ADMIN_PUBLIC_URL='http://localhost:8080'
npm run start:prod
```

`start:prod` сначала выполняет `prisma migrate deploy` и останавливается при ошибке миграции, затем
запускает скомпилированный API. Production-старт также отклоняет пустые `DATABASE_URL`,
`ADMIN_USERNAME`, `ADMIN_SESSION_SECRET`, пароль администратора короче 12 символов, а также пустой
или небезопасный `JWT_SECRET=change-me`.

Проверки после запуска:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/health/ready
curl -c admin-cookie.txt -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"replace-with-a-strong-admin-password"}' \
  http://localhost:8080/api/admin/login
curl -b admin-cookie.txt http://localhost:8080/api/settings
```

Откройте `http://localhost:8080` и произвольный SPA-маршрут, например
`http://localhost:8080/orders/current`. `/health` является liveness-проверкой без секретов, а
`/health/ready` отдельно проверяет подключение к PostgreSQL.

## Развёртывание на Amvera

Проект использует один Amvera Node.js application и отдельный managed PostgreSQL. Backend раздаёт
`apps/admin/dist`, поэтому терминал, сборщики и API работают с одного HTTPS-домена без production
CORS и отдельного frontend-проекта.

1. Создайте managed PostgreSQL в Amvera и дождитесь статуса «PostgreSQL запущен».
2. На странице «Инфо» базы скопируйте внутренний hostname для чтения/записи вида
   `amvera-<account>-cnpg-<db-project>-rw`.
3. Создайте Node.js application, привяжите GitHub-репозиторий и ветку `main`. Корневой `amvera.yml`
   использует Node.js 22, `npm run build:prod`, `npm run start:prod` и порт `8080`.
4. Добавьте secrets `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `DATABASE_URL`, `JWT_SECRET` и,
   при использовании Alena, `YANDEX_SPEECHKIT_API_KEY`. Пароль администратора должен содержать не
   менее 12 символов, а пароль PostgreSQL в URL должен быть URL-encoded. Шаблон:

   ```text
   postgresql://<user>:<urlencoded-password>@amvera-<account>-cnpg-<db-project>-rw:5432/<db-name>?schema=public
   ```

5. Добавьте runtime variables `NODE_ENV=production`, `PORT=8080`, `ADMIN_USERNAME=admin`,
   `YANDEX_SPEECHKIT_VOICE=alena`, `ONEC_EXCHANGE_TOKEN=<случайная строка от 32 символов>`,
   при автоматическом импорте из Яндекс Почты — `IMAP_HOST=imap.yandex.com`, `IMAP_PORT=993`,
   `IMAP_SECURE=true`, `IMAP_USER=mail@sladkayaplaneta.ru`, `IMAP_PASSWORD=<пароль приложения>`,
   `IMAP_MAILBOX=INBOX`, `IMAP_UNSEEN_ONLY=true`, `IMAP_POLL_INTERVAL_MS=5000`; а также
   `ADMIN_PUBLIC_URL=https://<production-domain>` и
   `ADMIN_ORIGIN=https://<production-domain>`. `VITE_API_URL` не задавайте. Значения secrets не
   дублируйте в обычных variables.
6. В настройках application активируйте бесплатный HTTPS-домен Amvera или подключите собственный и
   дождитесь выпуска сертификата.
7. Запустите сборку или перезапуск. На build phase секреты не требуются; миграции выполняются при
   старте контейнера до API.
8. Проверьте `https://<production-domain>/health` (HTTP 200), затем
   `https://<production-domain>/health/ready` (PostgreSQL connected) и откройте сам терминал.
9. Импортируйте тестовый XLSX и убедитесь, что заказ №12293 содержит 48 позиций и повторная загрузка
   определяется как дубль.
10. В режиме сборщика проверьте системный TTS. Если настроен secret SpeechKit, выберите Alena и
    проверьте речь и fallback без раскрытия API-ключа в браузере.

Актуальная справка: [Node.JS Server](https://docs.amvera.ru/applications/environments/nodejs-server.html),
[managed PostgreSQL](https://docs.amvera.ru/databases/postgreSQL.html),
[HTTPS и сеть](https://docs.amvera.ru/applications/configuration/network.html).

Основные маршруты workflow:

- `GET /api/workers`, `POST /api/workers`, `PATCH /api/workers/:id`;
- `POST /api/orders/:id/assign`, `POST /api/orders/:id/reassign`;
- `PATCH /api/order-items/:id/status`, `POST /api/order-items/:id/undo`;
- `GET /api/picker/speech/settings`, `POST /api/picker/speech` — защищённые маршруты SpeechKit;
- `GET /api/orders/:id/events`.

Маршруты проверки и отчётности:

- `GET /api/problems` — актуальные проблемные позиции;
- `PATCH /api/order-items/:id/review` — определить `PACKAGE/PIECE` для позиции `REVIEW`;
- `POST /api/order-items/:id/resolve-problem` — подтвердить отсутствие/пропуск или вернуть позицию в работу;
- `POST /api/orders/:id/close` — закрыть проверенный заказ;
- `GET /api/orders/history` — история завершённых и закрытых заказов;
- `GET /api/orders/:id/events?paginated=true` — фильтруемый журнал;
- `GET /api/orders/:id/reports/short.pdf` — короткий лист A4;
- `GET /api/orders/:id/reports/full.pdf` — полный электронный отчёт.

PDF доступен после завершения сборки. QR-код использует `ADMIN_PUBLIC_URL` и ведёт на карточку заказа. Для production задайте в этой переменной публичный адрес главного терминала.

Для назначения передайте `{ "workerIds": ["..."] }`. Позиции распределяются детерминированно и максимально равномерно: 48 строк между тремя сборщиками дают `16/16/16`.

## Проверки

```bash
npm test
npm run lint
npm run build:prod
```

Тест парсера проверяет документ №12293 от 10.09.2026, склад «Основной склад», ровно 48 позиций, первую товарную строку, группировку и сортировку. Unit-тесты дополнительно проверяют распределение, переходы статусов и хэширование пароля.

Интеграционный тест использует PostgreSQL, временно создаёт и удаляет тестовый заказ №12293 и тестовых сборщиков. Он проверяет журнал успешного, повторного и ошибочного импорта, dashboard, аналитику, распределение `16/16/16`, вход и отзыв сессии сборщика, изоляцию личной очереди, защищённые действия, завершение, проблемную позицию, запрет закрытия, решение проблемы, закрытие, историю, аудит и две PDF-формы:

```powershell
$env:RUN_DB_TESTS='1'
npm --workspace @assembly/api test -- --run test/workflow.integration.test.ts
```

## Следующие фазы

- Android-приложение;
- интеграция 1С.
