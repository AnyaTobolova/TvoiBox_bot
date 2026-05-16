# Согласование времени тренировок Твой Бокс

Монорепозиторий MVP Telegram-бота для записи на персональные тренировки.

## Что уже подготовлено на этапе 2

- каркас `pnpm monorepo`;
- приложение `apps/api` на `NestJS`;
- приложение `apps/bot` на `grammY` в безопасном `dry-run` режиме;
- заготовка `apps/mini-app` на `Next.js`;
- общие пакеты `packages/*`;
- базовые логи в `logs/api` и `logs/bot`;
- `docker-compose.yml` для локального PostgreSQL.

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

## Быстрый старт

1. Скопировать `.env.example` в `.env`.
2. Установить зависимости:
   `corepack pnpm install`
3. Поднять PostgreSQL:
   `docker compose up -d postgres`
4. Запустить API:
   `corepack pnpm dev:api`
5. При необходимости запустить Telegram-бота:
   `corepack pnpm dev:bot`

## Команды базы данных

- Проверка схемы: `corepack pnpm --filter @tvoy-box/api prisma:validate`
- Генерация Prisma Client: `corepack pnpm --filter @tvoy-box/api prisma:generate`
- Применение схемы в локальную БД: `corepack pnpm --filter @tvoy-box/api prisma:db:push`
- Создание dev-миграции: `corepack pnpm --filter @tvoy-box/api prisma:migrate:dev`
- Живая проверка подключения Prisma к локальной БД: `corepack pnpm db:runtime-check`

## Что важно сейчас

- По умолчанию `BOT_DRY_RUN=true`, поэтому бот не делает сетевые вызовы в Telegram и нужен для безопасной локальной проверки каркаса и конфигурации.
- Этап 3 по коду подготовлен: Prisma-схема, health-check и seed/read уже есть, а для живой проверки подключения добавлен `corepack pnpm db:runtime-check`.
- Если `corepack pnpm db:runtime-check` сообщает, что `docker` или `psql` не найдены, значит проблема не в коде, а в локальном окружении.

## Где смотреть логи

- API: `logs/api/runtime.jsonl`
- Bot: `logs/bot/runtime.jsonl`

## Следующий практический шаг

Следующий обязательный шаг: поднять локальный `PostgreSQL`, выполнить `corepack pnpm db:runtime-check` и закрыть этап 3 по живому подключению.
