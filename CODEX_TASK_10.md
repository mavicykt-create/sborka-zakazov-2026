# CODEX_TASK_10 — Production deployment on Amvera

## Цель
Подготовить текущий монорепозиторий «Сборка заказов 2026» к production-развёртыванию на Amvera в максимально простой схеме:

- один Amvera Node.js application: Fastify backend + собранный React/Vite frontend на том же домене;
- один managed PostgreSQL project;
- один HTTPS-домен для главного терминала и сборщиков.

## Почему один application
Не создавать отдельный frontend-проект. Backend должен раздавать собранный apps/admin/dist как SPA. Это убирает CORS и не требует VITE_API_URL в production.

## 1. Production frontend
Изменить клиент так, чтобы:
- в dev API по умолчанию оставался http://localhost:8080;
- в production без VITE_API_URL запросы шли на тот же origin: API base = ''.

Сборка admin должна попадать в apps/admin/dist.

## 2. Fastify раздаёт frontend
Добавить @fastify/static.
После API routes зарегистрировать static serving из apps/admin/dist.
Для SPA-маршрутов, не начинающихся с /api, возвращать index.html.
Маршруты /api/* и /health никогда не должны перехватываться SPA fallback.

Путь до dist вычислять надёжно для запуска из dist API после tsc.

## 3. Production scripts
В root package.json добавить удобные production scripts, например:
- build:prod: prisma generate + build всех workspaces;
- start:prod: запуск compiled API;
- db:deploy: prisma migrate deploy.

Не запускать prisma migrate dev в production.

## 4. Startup migrations
Нужно обеспечить применение `prisma migrate deploy` перед стартом API.
Предпочтительно production start script вида:
`npm --workspace @assembly/api run prisma:deploy && npm --workspace @assembly/api run start`
или эквивалент, который падает при ошибке миграции.

## 5. amvera.yml
Заменить текущую static_web конфигурацию на Node.js server конфигурацию.

Ориентир:

meta:
  environment: node
  toolchain:
    name: npm
    version: "22"

build:
  additionalCommands: npm run build:prod

run:
  command: npm run start:prod
  containerPort: 8080

Если синтаксис Amvera требует scriptName вместо command — использовать актуально поддерживаемый вариант из документации. Итоговый файл должен соответствовать текущей документации Amvera Node.JS Server.

## 6. Runtime env
Приложение должно работать с runtime env:
- DATABASE_URL (SECRET)
- JWT_SECRET (SECRET)
- YANDEX_SPEECHKIT_API_KEY (SECRET)
- YANDEX_SPEECHKIT_VOICE=alena
- PORT=8080
- ADMIN_PUBLIC_URL=https://<production-domain>
- ADMIN_ORIGIN=https://<production-domain>
- NODE_ENV=production

Не добавлять реальные значения секретов в git.

Важно: Amvera variables/secrets недоступны на build phase. Production frontend не должен зависеть от runtime VITE_* переменных.

## 7. PostgreSQL
README должен содержать шаблон DATABASE_URL для managed PostgreSQL Amvera по внутреннему RW hostname.
Пример только с placeholders:
`postgresql://<user>:<urlencoded-password>@amvera-<account>-cnpg-<db-project>-rw:5432/<db-name>?schema=public`

Не хардкодить реальные логины/пароли.

## 8. Healthcheck
`GET /health` должен возвращать 200 после запуска.
Добавить при необходимости DB-ready диагностику отдельно, но обычный /health не должен раскрывать секреты.

## 9. Production safety
- настоящий Yandex API key только runtime secret;
- JWT_SECRET обязателен в production; не позволять production стартовать с `change-me` или пустым значением;
- DATABASE_URL обязателен;
- не логировать секреты;
- не возвращать секреты через /api/settings.

## 10. README: точная инструкция Amvera
Добавить раздел «Развёртывание на Amvera» с шагами:
1. Создать managed PostgreSQL.
2. Узнать внутренний RW hostname.
3. Создать application и привязать GitHub repo/main.
4. Добавить secrets/variables.
5. Активировать HTTPS domain.
6. Собрать/перезапустить.
7. Проверить /health.
8. Открыть приложение.
9. Проверить миграции и XLSX import.
10. Проверить Alena SpeechKit.

## 11. Тесты
Добавить тесты/проверки, что:
- production API base same-origin;
- API routes не ловятся SPA fallback;
- неизвестный frontend route возвращает index.html при наличии build;
- /health работает;
- production config требует JWT_SECRET/DATABASE_URL;
- build проходит.

## Definition of Done
1. `npm test` проходит.
2. `npm run lint` проходит.
3. `npm run build:prod` проходит.
4. Локальный production start раздаёт frontend и API с одного порта 8080.
5. `curl http://localhost:8080/health` -> 200.
6. Открытие http://localhost:8080 показывает React terminal.
7. Реальные секреты не попали в git.
8. README содержит пошаговый Amvera deploy.
9. Создать PR codex/task-10 -> main и не merge до проверки.