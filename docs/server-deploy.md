# Деплой на VPS в Docker без конфликтов между проектами

## Принцип изоляции

Каждый проект запускается как отдельный Docker Compose stack.
Изоляция достигается за счет четырех правил:

1. У каждого проекта свой `STACK_NAME`.
2. В compose нет `container_name`, поэтому Docker сам префиксует имена контейнеров по stack name.
3. У каждого проекта свои volume и network:
   - `${STACK_NAME}_postgres_data`
   - `${STACK_NAME}_internal`
4. API публикуется только на `127.0.0.1` VPS и на отдельном порту.

Это значит, что на одном VPS могут одновременно жить:

- `tvoy-box-bot`
- `crm-bot`
- `fitness-admin`

И они не будут делить контейнеры, тома, сеть или PostgreSQL.

## Что лежит в репозитории

- `deploy/compose.server.yml` - production stack
- `.env.server.example` - пример серверных переменных
- `infra/docker/Dockerfile.api` - образ для API
- `infra/docker/Dockerfile.bot` - образ для бота
- `scripts/deploy/server-bootstrap.sh` - базовая подготовка VPS
- `scripts/deploy/deploy-server.sh` - запуск stack на сервере
- `scripts/qa/google-calendar-credentials-check.mjs` - локальная проверка service-account credentials

## HTTPS и webhook

В текущем production-окружении внешний HTTPS завершается не в Docker, а в уже установленном на VPS системном `Caddy`.

Это значит:

1. `api.anyatobolova.ru` проксируется на локальный API `127.0.0.1:3300`.
2. Telegram webhook проксируется на локальный bot listener `127.0.0.1:3301`.
3. `app.anyatobolova.ru` зарезервирован под будущий mini app.

Docker stack проекта не публикует `80/443` наружу и не поднимает свой отдельный reverse proxy, чтобы не конфликтовать с другими сайтами на том же VPS.

Для production в `.env.server` должны быть заполнены:

- `PUBLIC_API_DOMAIN`
- `PUBLIC_APP_DOMAIN`
- `BOT_DELIVERY_MODE=webhook`
- `BOT_BIND_IP=127.0.0.1`
- `BOT_PORT=3301`
- `BOT_WEBHOOK_HOST=0.0.0.0`
- `BOT_WEBHOOK_PORT=8081`
- `BOT_WEBHOOK_PATH`
- `BOT_WEBHOOK_PUBLIC_URL`
- `BOT_WEBHOOK_SECRET_TOKEN`

Пример:

```env
PUBLIC_API_DOMAIN=api.example.ru
PUBLIC_APP_DOMAIN=app.example.ru
BOT_DELIVERY_MODE=webhook
BOT_BIND_IP=127.0.0.1
BOT_PORT=3301
BOT_WEBHOOK_HOST=0.0.0.0
BOT_WEBHOOK_PORT=8081
BOT_WEBHOOK_PATH=/telegram/webhook/long-random-path
BOT_WEBHOOK_PUBLIC_URL=https://api.example.ru/telegram/webhook/long-random-path
BOT_WEBHOOK_SECRET_TOKEN=CHANGE_ME_TO_A_LONG_RANDOM_WEBHOOK_SECRET
```

Проверка после деплоя:

```bash
curl -I https://api.example.ru/health
curl -I https://app.example.ru/
curl https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo
```

Ожидаемый результат:

- `api.example.ru/health` отвечает `HTTP 200`
- `app.example.ru` отвечает `HTTP 200`
- `getWebhookInfo` показывает реальный `https://...` webhook URL

## Первый запуск на сервере

```bash
mkdir -p /opt/stacks
git clone <REPO_URL> /opt/stacks/tvoy-box-bot
cd /opt/stacks/tvoy-box-bot
cp .env.server.example .env.server
```

После этого в `.env.server` обязательно заполнить:

- `STACK_NAME`
- `API_PORT`
- `TELEGRAM_BOT_TOKEN`
- `ADMIN_TELEGRAM_ID`
- `TRAINER_TELEGRAM_ID`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- Google Calendar переменные, если используется синхронизация

Запуск:

```bash
bash scripts/deploy/deploy-server.sh
```

Проверка:

```bash
docker compose --env-file .env.server -f deploy/compose.server.yml ps
curl http://127.0.0.1:3300/health
```

## Как добавить на тот же VPS следующий проект

Для нового проекта нужен новый каталог и другой `STACK_NAME`.

Пример:

```bash
git clone <ANOTHER_REPO_URL> /opt/stacks/crm-bot
cd /opt/stacks/crm-bot
cp .env.server.example .env.server
```

Минимум, что должно отличаться от первого проекта:

- `STACK_NAME=crm-bot`
- `API_PORT=3310`
- `POSTGRES_DB=crm_bot`
- `POSTGRES_USER=crm_bot`
- `POSTGRES_PASSWORD=<другой пароль>`
- `DATABASE_URL=postgresql://crm_bot:<пароль>@postgres:5432/crm_bot`

Дальше запуск тот же:

```bash
bash scripts/deploy/deploy-server.sh
```

## Как заменить GOOGLE_PRIVATE_KEY

Если подтверждение записи проходит, но календарь не синхронизируется, первым делом нужно проверить service-account key.

1. В Google Cloud открой service account `tvoybox-bot@tvoybox-bot.iam.gserviceaccount.com`.
2. Создай новый JSON key для этого service account.
3. Открой JSON и возьми поля:
   - `client_email`
   - `private_key`
4. В корне проекта на сервере создай файл `.secrets/google-service-account.json` и вставь в него весь скачанный JSON как есть.
5. В `.env.server` обнови:
   - `GOOGLE_SERVICE_ACCOUNT_JSON_SOURCE=../.secrets/google-service-account.json`
   - `GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/run/secrets/google-service-account.json`
   - при желании оставь `GOOGLE_SERVICE_ACCOUNT_EMAIL` и `GOOGLE_PRIVATE_KEY` как fallback, но в production теперь используется JSON-файл

Пример:

```env
GOOGLE_SERVICE_ACCOUNT_JSON_SOURCE=../.secrets/google-service-account.json
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=/run/secrets/google-service-account.json
GOOGLE_SERVICE_ACCOUNT_EMAIL=tvoybox-bot@tvoybox-bot.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
```

После замены проверь ключ локально:

```bash
corepack pnpm qa:google-calendar-creds .env.server
```

Ожидаемый результат:

```text
Ключ успешно распознан и может подписывать JWT.
```

Если проверка падает с ASN.1 / `ERR_OSSL_UNSUPPORTED`, значит в `.env.server` попал поврежденный `private_key`.

После успешной проверки пересобери production stack:

```bash
bash scripts/deploy/deploy-server.sh
```

## Чего не делать

- Не задавать одинаковый `STACK_NAME` разным проектам.
- Не прописывать `container_name`.
- Не публиковать PostgreSQL наружу через `ports`.
- Не использовать один и тот же `API_PORT` у двух проектов.
- Не вставлять в `GOOGLE_PRIVATE_KEY` многострочный PEM как есть без замены переводов строк на `\n`.

## Если на VPS уже есть другой Docker-проект

Это не мешает, если:

- у нового проекта свой каталог;
- у нового проекта свой `STACK_NAME`;
- новый проект не занимает уже занятый host port.

Проверить занятые контейнеры и порты можно так:

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```
