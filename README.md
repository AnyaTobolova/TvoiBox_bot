# Согласование времени тренировок Твой Бокс

Монорепозиторий Telegram-бота и Telegram mini app для записи на персональные тренировки.

Сейчас проект живёт в двух ветках:

- `main` — production-ветка для рабочего бота;
- `dev` — ветка разработки, в которой развивается mini app и все безопасные доработки перед выкладкой.

## Что уже есть в проекте

- `apps/api` — backend API на `NestJS`;
- `apps/bot` — Telegram-бот на `grammY`;
- `apps/mini-app` — Telegram mini app на `Next.js`;
- общие пакеты `packages/*`;
- серверный деплой, webhook и production autodeploy;
- локальный `preview`-режим mini app для согласования клиентского и тренерского интерфейса.

## Структура

```text
apps/
  api/
  bot/
  mini-app/
packages/
  shared-types/
  shared-config/
  shared-logger/
  shared-constants/
  shared-utils/
infra/
docs/
scripts/
logs/
```

## Быстрый старт mini app preview

Этот режим нужен для локального согласования интерфейса, когда не хочется зависеть от базы, Telegram и живого backend.

1. Установить зависимости:
   `corepack pnpm install`
2. Собрать mini app:
   `corepack pnpm --filter @tvoy-box/mini-app build`
3. Запустить mini app:
   `corepack pnpm --filter @tvoy-box/mini-app start`
4. Открыть нужный режим:
   - клиент: `http://127.0.0.1:3001/?dev=client`
   - тренер: `http://127.0.0.1:3001/?dev=trainer`

Важно:

- `preview`-режим предназначен для интерфейса и сценариев;
- он не считается полной живой проверкой `bot + api + db + Google Calendar + Telegram`;
- календарная синхронизация и Telegram-контур проверяются уже на следующем этапе, после внешнего dev-деплоя.

## Быстрый старт живого локального контура

1. Скопировать `.env.example` в `.env`.
2. Установить зависимости:
   `corepack pnpm install`
3. Поднять PostgreSQL:
   `docker compose up -d postgres`
4. Запустить API:
   `corepack pnpm dev:api`
5. При необходимости запустить mini app в dev-режиме:
   `corepack pnpm --filter @tvoy-box/mini-app dev`
6. При необходимости запустить Telegram-бота:
   `corepack pnpm dev:bot`

## Команды базы данных

- Проверка схемы: `corepack pnpm --filter @tvoy-box/api prisma:validate`
- Генерация Prisma Client: `corepack pnpm --filter @tvoy-box/api prisma:generate`
- Применение схемы в локальную БД: `corepack pnpm --filter @tvoy-box/api prisma:db:push`
- Создание dev-миграции: `corepack pnpm --filter @tvoy-box/api prisma:migrate:dev`
- Живая проверка подключения Prisma к локальной БД: `corepack pnpm db:runtime-check`

## Что важно сейчас

- По умолчанию `BOT_DRY_RUN=true`, поэтому локальный бот не должен конфликтовать с production polling.
- Локальный `preview` mini app нужен именно для интерфейсного согласования; он не заменяет внешнюю проверку в Telegram.
- Для живой проверки mini app вместе с backend, календарём и ботом нужен отдельный dev-контур на VPS.
- Если `corepack pnpm db:runtime-check` сообщает, что `docker` или `psql` не найдены, значит проблема не в коде, а в локальном окружении.

## Где смотреть логи

- API: `logs/api/runtime.jsonl`
- Bot: `logs/bot/runtime.jsonl`
- Временные логи локального preview: `runtime-logs/`

## Ближайший следующий шаг

Следующий безопасный практический шаг после локального согласования UI: поднять mini app на внешнем dev-контуре VPS, открыть его уже внутри Telegram и пройти сквозную проверку вместе с ботом и календарём.
