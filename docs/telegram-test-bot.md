# Telegram test bot для mini app

Этот документ описывает безопасный способ проверить mini app внутри Telegram, не затрагивая production-бота.

## Зачем нужен отдельный test bot

Если подключать dev mini app к production-боту, можно случайно:

- открыть недопроверенный интерфейс живым пользователям;
- смешать dev-сценарии и production-уведомления;
- усложнить rollback.

Поэтому для `Этапа 28` используется отдельный test bot с отдельным токеном.

## Что уже подготовлено в коде

В `apps/bot` добавлен опциональный вход в mini app:

- через `/start`;
- через команду `/miniapp`.

Он включается только если у бота задан `BOT_MINI_APP_URL`.
Если переменная не задана, production-поведение не меняется.

## Какие env нужны для test bot

Минимально:

```env
TELEGRAM_BOT_TOKEN=<TOKEN_TEST_BOT>
BOT_DRY_RUN=false
BOT_DELIVERY_MODE=polling

BOT_MINI_APP_URL=https://app.anyatobolova.ru/
BOT_MINI_APP_LABEL=Открыть mini app
BOT_MINI_APP_TRAINER_URL=https://app.anyatobolova.ru/?dev=trainer
BOT_MINI_APP_TRAINER_LABEL=Открыть тренерский экран
```

Дополнительно:

- `ADMIN_TELEGRAM_ID` — твой Telegram ID;
- `TRAINER_TELEGRAM_ID` — Telegram ID тренера;
- `API_BASE_URL` — API, к которому должен обращаться test bot.

## Почему для первого прогона лучше polling, а не webhook

Для test bot на `Этапе 28` безопаснее и проще использовать `polling`:

- не нужно добавлять новый публичный webhook-route на VPS;
- не нужно трогать production `api.anyatobolova.ru`;
- не возникает риска случайно задеть боевой bot webhook;
- можно поднять и остановить test bot как отдельный сервис поверх уже работающего dev-контура.

Webhook-режим для test bot можно добавить позже, если он действительно понадобится, но для первой Telegram-проверки это не нужно.

## Какой URL давать test bot

Для реальной Telegram Mini App проверки bot должен открывать обычный dev URL:

- `https://app.anyatobolova.ru/`

Важно:

- не использовать `?dev=client`;
- не использовать `?dev=trainer`;
- не использовать preview-ссылки как постоянную точку входа test bot.

Эти query-параметры нужны только для ручного браузерного preview.

## Как создать test bot

1. Создать нового бота через `@BotFather`.
2. Сохранить его токен отдельно от production-токена.
3. При желании задать боту отдельное имя вроде `Твой Бокс Test`.
4. Не публиковать ссылку на этого бота пользователям.

## Что уже подготовлено на серверной стороне

В репозитории добавлены:

- `deploy/.env.server.test-bot.override.example`
- `scripts/deploy/start-dev-test-bot.sh`
- `scripts/deploy/stop-dev-test-bot.sh`

Это позволяет поднять отдельный test bot поверх уже работающего dev-контура mini app без вмешательства в production-бота.

### Как запустить test bot на VPS

1. В каталоге текущего dev-release скопировать шаблон:

```bash
cp deploy/.env.server.test-bot.override.example .env.server.test-bot.override
```

2. Заполнить в `.env.server.test-bot.override`:

- `TELEGRAM_BOT_TOKEN`
- `ADMIN_TELEGRAM_ID`
- `TRAINER_TELEGRAM_ID`

3. Запустить:

```bash
bash scripts/deploy/start-dev-test-bot.sh
```

4. Проверить статус:

```bash
docker compose --env-file .env.server.test-bot.runtime -f deploy/compose.server.yml ps bot
```

Важно:

- после первого успешного запуска `.env.server.test-bot.override` теперь подхватывается в `shared` dev-контура;
- следующие `push` в ветку `dev` могут автоматически пересобирать и перезапускать test bot из свежего release, если override уже настроен на VPS.
- успешным стартом test bot теперь считается не только `docker compose up -d bot`, но и появление в логах строк `Telegram bot token validated` и `Bot polling started`.

### Как остановить test bot

```bash
bash scripts/deploy/stop-dev-test-bot.sh
```

## Как подключить mini app к test bot

Есть два безопасных варианта:

1. Через кодовую кнопку `/start` и `/miniapp`.
   Этот вариант уже подготовлен в репозитории и управляется env-переменной `BOT_MINI_APP_URL`.
   Для отдельной тренерской кнопки можно задать `BOT_MINI_APP_TRAINER_URL`.

2. Через BotFather menu button / Web App.
   Это можно включить дополнительно позже, если понадобится постоянная кнопка открытия mini app внизу чата.

Для первого прогона достаточно варианта `1`.

## Что проверить в Telegram после запуска test bot

### Клиент

1. Открытие mini app из команды `/start`.
2. Открытие mini app из команды `/miniapp`.
3. Авторизация через Telegram Mini App context.
4. Просмотр слотов.
5. Отправка заявки.
6. Просмотр `Мои записи`.
7. `Добавить в календарь`.
8. Удаление записи из списка.

### Тренер

1. Открытие mini app из test bot.
2. Просмотр `Заявки`.
3. Подтверждение заявки.
4. Перенос заявки.
5. Отмена тренировки.
6. Работа со слотами.
7. Проверка `Файл календаря` в `Тренировках`.

### Сквозные сценарии

1. `Клиент -> заявка -> тренер подтверждает -> запись появляется у клиента`.
2. `Клиент -> заявка -> тренер предлагает перенос -> клиент видит новый статус`.
3. `Клиент -> заявка без слота -> тренер обрабатывает запрос`.
4. `Два клиента пытаются взять одно и то же время -> проверка резерва`.

## Что нельзя считать завершением Этапа 28

- только открытие ссылки в браузере;
- только открытие `https://app.anyatobolova.ru/?dev=client`;
- только ручной preview без Telegram Mini App context;
- только проверка `health`.

## Какой следующий практический шаг

1. Завершить `Этап 27` зелёным workflow `Deploy Dev Mini App`.
2. Подготовить отдельный токен test bot.
3. Поднять test bot на тех же `dev`-исходниках.
4. Запустить живую Telegram-проверку по чек-листу выше.
