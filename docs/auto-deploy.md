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
- `scripts/deploy/remote-deploy.sh` — серверный release/deploy сценарий
- `scripts/deploy/setup-server-autodeploy.sh` — одноразовая подготовка VPS под `deploy`-пользователя

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

## Как проверить

1. Сделать тестовый `push` в `main`.
2. Открыть `Actions` в GitHub.
3. Дождаться успешного workflow `Deploy Production`.
4. Проверить:

```bash
curl https://api.anyatobolova.ru/health
```

Или просто открыть:

- `https://api.anyatobolova.ru/health`

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
