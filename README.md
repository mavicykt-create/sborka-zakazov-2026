# Сборка заказов 2026

Монорепозиторий для складского сервиса голосовой сборки заказов.

## Первая рабочая цель (v0.1)

1. Принять XLSX товарного чека.
2. Вытащить номер/дату/склад и товарные строки.
3. Для каждой строки сохранить штрихкод, название, количество упаковок, количество штук.
4. Определить тип отбора: `PACKAGE` или `PIECE`.
5. Сгруппировать позиции по первому слову названия и отсортировать.
6. Создать заказ в PostgreSQL.
7. Показать заказ в веб-терминале.

В `test-data/sample-order-12293.xlsx` лежит реальный тестовый документ на 48 позиций.

## Запуск

```bash
cp .env.example .env
docker compose up -d
npm install
npm --workspace @assembly/api run prisma:generate
npm --workspace @assembly/api run prisma:migrate
npm run dev:api
npm run dev:admin
```

API: `http://localhost:8080`  
Admin: `http://localhost:5173`

## Импорт XLSX

`POST /api/orders/import-xlsx` (multipart/form-data, поле `file`).

После импорта заказ доступен через `GET /api/orders` и `GET /api/orders/:id`.

## Следующие фазы

- пользователи-сборщики и смены;
- автоматическое распределение позиций;
- Android-приложение;
- голосовые команды и звуковые сигналы;
- Gmail-импорт;
- печатный лист сборки / PDF;
- журнал действий и аналитика.
