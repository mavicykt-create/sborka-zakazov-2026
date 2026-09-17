# Сборка заказов 2026

Монорепозиторий для складского сервиса сборки заказов. Текущая версия принимает товарный чек XLSX, распределяет его между сборщиками и сопровождает складской процесс в главном веб-терминале.

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

Для production-окружения применяйте уже созданные миграции без интерактивного режима:

```bash
npm --workspace @assembly/api run prisma:deploy
```

Основные маршруты workflow:

- `GET /api/workers`, `POST /api/workers`, `PATCH /api/workers/:id`;
- `POST /api/orders/:id/assign`, `POST /api/orders/:id/reassign`;
- `PATCH /api/order-items/:id/status`, `POST /api/order-items/:id/undo`;
- `GET /api/orders/:id/events`.

Для назначения передайте `{ "workerIds": ["..."] }`. Позиции распределяются детерминированно и максимально равномерно: 48 строк между тремя сборщиками дают `16/16/16`.

## Проверки

```bash
npm test
npm run lint
npm run build
```

Тест парсера проверяет документ №12293 от 10.09.2026, склад «Основной склад», ровно 48 позиций, первую товарную строку, группировку и сортировку. Unit-тесты дополнительно проверяют распределение, переходы статусов и хэширование пароля.

Интеграционный тест использует PostgreSQL, временно создаёт и удаляет тестовый заказ №12293 и тестовых сборщиков:

```powershell
$env:RUN_DB_TESTS='1'
npm --workspace @assembly/api test -- --run test/workflow.integration.test.ts
```

## Следующие фазы

- Android-приложение;
- голосовые команды и звуковые сигналы;
- Gmail-импорт;
- печатный лист сборки / PDF;
- расширенная аналитика.
