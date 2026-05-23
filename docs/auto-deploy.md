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
- health-check: `https://app.anyatobolova.ru/mini-api/health`
- app-check: `https://app.anyatobolova.ru/`
- `BOOTSTRAP_ENV_ROOT=/opt/stack/tvoy-box-miniapp-dev/current`
- `BOOTSTRAP_SECRETS_ROOT=/opt/stack/tvoy-box-bot`

То есть автодеплой ветки `dev` не поднимает production-бота и не вмешивается в production-контур.

### Почему bootstrap для dev разделен

Для dev-контура mini app безопаснее разделять источники первичной инициализации:

- `.env.server` берется из уже работающего dev-контура mini app;
- `google-service-account.json` берется из production-каталога бота, где уже хранится рабочий сервисный аккаунт Google;
- логи при наличии подтягиваются из текущего dev-контура.

Такой подход позволяет не смешивать production `.env.server` с dev-настройками, но при этом не дублировать вручную Google-секрет для календаря.

### Почему для внешних проверок нужны retry

После успешного `remote deploy` внутренние проверки на VPS могут уже проходить, а внешний `https://app.anyatobolova.ru/mini-api/health` еще несколько секунд быть недоступным из-за прогрева reverse proxy, сети или Next.js runtime.

Поэтому в dev-workflow публичные проверки выполняются с повторами, а не одним `curl`.

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
3. Дождаться успешного workflow `Deploy Dev Mini App`.
4. Проверить:

```bash
curl https://app.anyatobolova.ru/mini-api/health
curl -I https://app.anyatobolova.ru/
```

Или открыть:

- `https://app.anyatobolova.ru/?dev=client`
- `https://app.anyatobolova.ru/?dev=trainer`

## Что делать, если workflow упал

1. Открыть вкладку `Actions`.
2. Открыть упавший запуск.
3. Посмотреть, на каком шаге упало:
   - `Configure SSH known_hosts`
   - `Upload release bundle`
   - `Run remote deploy`
   - `Verify public health endpoint`

Самые частые причины:

- неверный `VPS_SSH_PRIVATE_KEY`
- неверный `VPS_KNOWN_HOSTS`
- у `deploy`-пользователя нет доступа к `docker`
- на сервере отсутствует `shared/.env.server` или `shared/.secrets/google-service-account.json`
- для dev-контура не подготовлен `/opt/stack/tvoy-box-miniapp-dev/current/.env.server`, откуда bootstrap-скрипт берет первую копию в `shared`
