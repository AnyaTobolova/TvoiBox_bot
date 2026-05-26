# Автодеплой с GitHub на VPS

## Что делает автодеплой

После каждого `push` в `main` GitHub Actions:

1. Берет текущий коммит репозитория.
2. Собирает release-архив через `git archive`.
3. Подключается к VPS по SSH.
4. Загружает архив на сервер.
5. Распаковывает его в новый каталог `releases/<commit-sha>`.
6. Подключает общие production-секреты из `shared`:
   - `.env.server`
   - `.secrets/google-service-account.json`
   - `logs/`
7. Переключает symlink `current` на новый release.
8. Запускает `bash scripts/deploy/deploy-server.sh`.
9. Проверяет `health`.

## Почему выбран upload release archive, а не git pull

Текущий production-каталог на VPS не является `git clone`, а обычный `git pull` требовал бы хранить GitHub-доступ на сервере.

Схема `GitHub Actions -> SSH -> upload archive -> remote deploy`:

- не требует GitHub токенов на VPS;
- деплоит только закоммиченный код;
- хорошо подходит под будущий mini app;
- позволяет держать secrets вне репозитория.

## Целевая структура на VPS

```text
/opt/stack/tvoy-box-bot-deploy
  /current -> /opt/stack/tvoy-box-bot-deploy/releases/<sha>
  /releases
    /<sha>
  /shared
    .env.server
    /.secrets/google-service-account.json
    /logs
```

Текущий legacy-каталог `/opt/stack/tvoy-box-bot` сохраняется как источник для первичного копирования `.env.server`, `.secrets` и логов.

## Файлы автодеплоя в репозитории

- `.github/workflows/deploy-production.yml` — GitHub Actions workflow
- `.github/workflows/deploy-dev-miniapp.yml` — отдельный dev-workflow для mini app на ветке `dev`
- `scripts/deploy/remote-deploy.sh` — серверный release/deploy сценарий
- `scripts/deploy/setup-server-autodeploy.sh` — одноразовая подготовка VPS под `deploy`-пользователя

## Что уже разведено по контурам

- `main` -> production workflow `Deploy Production`
- `dev` -> dev workflow `Deploy Dev Mini App`

Production и dev не должны деплоиться в один и тот же каталог на VPS:

- production: `/opt/stack/tvoy-box-bot-deploy`
- dev mini app: `/opt/stack/tvoy-box-miniapp-dev`

Для dev mini app в workflow отдельно зафиксировано:

- `DEPLOY_WITH_BOT=false`
- `RESTART_TEST_BOT=true`
- `REQUIRE_TEST_BOT_OVERRIDE=true`
- health-check: `https://app.anyatobolova.ru/mini-api/health`
- app-check: `https://app.anyatobolova.ru/`
- `BOOTSTRAP_ENV_ROOT=/opt/stack/tvoy-box-miniapp-dev/current`
- `BOOTSTRAP_SECRETS_ROOT=/opt/stack/tvoy-box-bot`

То есть автодеплой ветки `dev` не поднимает production-бота и не вмешивается в production-контур.

Если на VPS уже настроен `.env.server.test-bot.override`, dev-workflow дополнительно:

- переносит этот override в `shared` dev-контура;
- после выкладки пересобирает `bot`-образ из свежего release;
- перезапускает отдельный polling `test bot` без затрагивания production-бота.

На текущем этапе это уже не опциональная ветка:

- если `RESTART_TEST_BOT=true`, но `.env.server.test-bot.override` отсутствует, dev-workflow должен завершаться ошибкой;
- это сделано специально, чтобы зелёный `Deploy Dev Mini App` в Этапе 28 означал не только выкладку `api + mini app`, но и реально подготовленный живой Telegram test bot contour.

### Почему bootstrap для dev разделен

Для dev-контура mini app безопаснее разделять источники первичной инициализации:

- `.env.server` берется из уже работающего dev-контура mini app;
- `google-service-account.json` берется из production-каталога бота, где уже хранится рабочий сервисный аккаунт Google;
- логи при наличии подтягиваются из текущего dev-контура.

Такой подход позволяет не смешивать production `.env.server` с dev-настройками, но при этом не дублировать вручную Google-секрет для календаря.

### Почему в dev-workflow есть две группы проверок

После успешного `remote deploy` есть два разных уровня валидации:

- внутренняя проверка на самом VPS;
- внешняя проверка с runner GitHub.

Внутренняя проверка через SSH на VPS является блокирующей:

- `http://127.0.0.1:3310/health`
- `http://127.0.0.1:3312/`
- `https://app.anyatobolova.ru/mini-api/health`
- `https://app.anyatobolova.ru/`

Именно она подтверждает, что dev-контур действительно поднялся на сервере.

Публичные проверки с runner GitHub оставлены как диагностические, потому что после успешной выкладки внешний URL может короткое время быть недоступен из-за прогрева reverse proxy, сети GitHub runner или Next.js runtime. Поэтому runner-проверки:

- выполняются с retry;
- не должны считаться единственным источником истины о факте успешной выкладки.

## Что нужно сделать вручную

### 1. Добавить GitHub Secrets

Открыть репозиторий на GitHub:

`Settings -> Secrets and variables -> Actions`

И создать секреты:

- `VPS_HOST`
- `VPS_PORT`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_KNOWN_HOSTS`

### 2. Значения секретов

- `VPS_HOST` — IP сервера, например `62.113.111.4`
- `VPS_PORT` — SSH-порт, обычно `22`
- `VPS_USER` — пользователь для деплоя, рекомендуемый вариант `deploy`
- `VPS_SSH_PRIVATE_KEY` — приватный ключ для этого пользователя
- `VPS_KNOWN_HOSTS` — строка host key для сервера

## Как проверить production

1. Сделать тестовый `push` в `main`.
2. Открыть `Actions` в GitHub.
3. Дождаться успешного workflow `Deploy Production`.
4. Проверить:

```bash
curl https://api.anyatobolova.ru/health
```

Или просто открыть:

- `https://api.anyatobolova.ru/health`

## Как проверить dev mini app

1. Сделать тестовый `push` в `dev`.
2. Открыть `Actions` в GitHub.
3. Дождаться workflow `Deploy Dev Mini App`.
4. Проверить:

```bash
curl https://app.anyatobolova.ru/mini-api/health
curl -I https://app.anyatobolova.ru/
```

Или открыть:

- `https://app.anyatobolova.ru/?dev=client`
- `https://app.anyatobolova.ru/?dev=trainer`

Считать dev-деплой успешным можно тогда, когда:

- шаг `Run remote deploy` завершился успешно;
- шаг `Verify dev contour from VPS` завершился успешно.

Runner-диагностика внешних URL полезна, но не должна переопределять успешную серверную проверку.

### Почему retry нужен и внутри `remote-deploy.sh`

Даже если `docker compose up -d` завершился успешно, `api` и `mini-app` могут не ответить мгновенно:

- NestJS еще поднимает приложение;
- Next.js runtime еще прогревается;
- внутренний HTTP-сокет уже существует, но первый `curl` может получить `56` или другой временный сетевой сбой.

Поэтому `remote-deploy.sh` теперь сам ждет готовность:

- `API health`
- `Mini app root`

Это делает deploy устойчивым не только в GitHub Actions, но и при ручном серверном запуске.

## Что делать, если workflow упал

1. Открыть вкладку `Actions`.
2. Открыть упавший запуск.
3. Посмотреть, на каком шаге упало:
   - `Configure SSH known_hosts`
   - `Upload release bundle`
   - `Run remote deploy`
   - `Verify dev contour from VPS`
   - `Diagnostic: verify dev API health endpoint from GitHub runner`
   - `Diagnostic: verify dev mini app root from GitHub runner`

Самые частые причины:

- неверный `VPS_SSH_PRIVATE_KEY`
- неверный `VPS_KNOWN_HOSTS`
- у `deploy`-пользователя нет доступа к `docker`
- на сервере отсутствует `shared/.env.server` или `shared/.secrets/google-service-account.json`
- для dev-контура не подготовлен `/opt/stack/tvoy-box-miniapp-dev/current/.env.server`, откуда bootstrap-скрипт берет первую копию в `shared`
- GitHub runner не успел увидеть внешний URL, хотя сам контур на VPS уже поднят
