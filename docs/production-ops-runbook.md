# Production Ops Runbook

## Когда использовать

Этот регламент нужен после переноса mini app в основной контур `@TvoyBox_bot`.
Он фиксирует короткий порядок действий для проверки, деплоя, отката и разбора типовых сбоев.

## Быстрая проверка production

1. Открыть в Telegram основной бот `@TvoyBox_bot`.
2. Нажать `Старт`.
3. Проверить клиентский вход:
   - появилась кнопка `Открыть mini app`;
   - mini app открывается без VPN;
   - клиент видит главное меню;
   - клиент может открыть запись, свои тренировки и сценарий `Нет подходящего времени`.
4. Проверить тренерский вход:
   - у тренера после `Старт` есть кнопка `Открыть mini app` или `Открыть тренерский экран`;
   - открываются `Заявки`, тренировки, слоты и панель администратора;
   - trainer-only меню в боте показывает только тренерские действия.
5. Проверить публичные health-check:

```bash
curl https://api.anyatobolova.ru/health
curl -I https://app.anyatobolova.ru/
```

Ожидаемо:

- `api.anyatobolova.ru/health` возвращает `status: ok`;
- `app.anyatobolova.ru` возвращает `HTTP 200`;
- в ответах Caddy нет `Alt-Svc: h3=...`, потому что HTTP/3 отключён для стабильности Android Telegram WebView.

## Проверка записи и календаря

1. Клиент создаёт заявку на подходящий слот.
2. Тренер видит заявку в mini app.
3. Тренер подтверждает заявку.
4. Клиент получает Telegram-уведомление и календарный `.ics` файл.
5. Тренер получает запись в Google Calendar через серверную синхронизацию.
6. В событии календаря проверить:
   - понятное название события;
   - имя клиента или тренера в описании;
   - ссылку на Telegram в описании;
   - напоминания `1 день` и `1 час` для `.ics`;
   - для Google Calendar API событие должно уходить с нужными reminders, даже если UI календаря визуально показывает старые дефолтные настройки.

## Проверка уведомлений

Проверить минимум эти сценарии:

- тренер подтвердил заявку: клиент получил сообщение и `.ics`;
- тренер написал комментарий к запросу без слота: клиент получил сообщение в боте;
- тренер закрыл запрос без слота: клиент больше не видит его как активный;
- клиент отменил тренировку: тренер получил уведомление;
- тренер отменил тренировку: клиент получил уведомление;
- тренер предложил перенос: клиент видит предложение;
- клиент принял или отклонил перенос: тренер видит результат.

## Деплой через GitHub

Обычный production deploy:

1. Изменения должны быть в `main`.
2. Выполнить `git push origin main`.
3. Открыть GitHub Actions.
4. Дождаться успешного workflow `Deploy Production`.
5. Проверить:

```bash
curl https://api.anyatobolova.ru/health
curl -I https://app.anyatobolova.ru/
```

После deploy в Telegram нужно нажать `Старт` или `/start`, чтобы получить свежие кнопки mini app. Старые inline-кнопки в чате могут хранить старый URL.

## Ручная проверка VPS

Если нужно проверить сервер напрямую:

```bash
ssh -i ~/.ssh/codex_vps_deploy_ed25519 deploy@62.113.111.4
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
systemctl is-active caddy
curl http://127.0.0.1:3300/health
curl http://127.0.0.1:3312/
```

Production API должен отвечать на `127.0.0.1:3300`.
Production mini app должен отвечать на `127.0.0.1:3302`.
Публичный домен `app.anyatobolova.ru` должен проксироваться на production mini app `127.0.0.1:3302`, а совместимый путь `/mini-api/*` - на production API `127.0.0.1:3300`.

Для Caddy/systemd-правок нужен root-доступ:

```bash
ssh -i ~/.ssh/codex_vps_deploy_ed25519 root@62.113.111.4
```

## Откат production release

Если после deploy сломался production:

1. Зайти на VPS.
2. Посмотреть доступные releases:

```bash
ls -lah /opt/stack/tvoy-box-bot-deploy/releases
readlink -f /opt/stack/tvoy-box-bot-deploy/current
```

3. Переключить `current` на предыдущий стабильный release:

```bash
ln -sfn /opt/stack/tvoy-box-bot-deploy/releases/<previous-sha> /opt/stack/tvoy-box-bot-deploy/current
cd /opt/stack/tvoy-box-bot-deploy/current
bash scripts/deploy/deploy-server.sh
```

4. Проверить health:

```bash
curl https://api.anyatobolova.ru/health
curl -I https://app.anyatobolova.ru/
```

5. Если проблема была только в Caddyfile, вернуть бэкап:

```bash
cp /etc/caddy/Caddyfile.bak-<timestamp> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

## Что делать при типовых сбоях

### Mini app не открывается без VPN

1. Проверить с телефона обычный браузер:
   - `https://app.anyatobolova.ru/`
   - `https://api.anyatobolova.ru/health`
2. Проверить с компьютера:

```bash
curl -I https://app.anyatobolova.ru/
curl -I https://api.anyatobolova.ru/health
```

3. Если снова появляется `Alt-Svc: h3=...`, проверить Caddy global block:

```caddyfile
{
    servers {
        protocols h1 h2
    }
}
```

4. Если домены нестабильны даже без HTTP/3, следующий инфраструктурный шаг: CDN/proxy или перенос публичной точки входа на другой IP.

### Ошибка `initData signature is invalid`

1. Проверить, из какого бота открывается mini app.
2. Проверить, к какому API направлен frontend:
   - production bot должен ходить в `https://api.anyatobolova.ru`;
   - test bot/dev должен ходить в свой согласованный API.
3. Нельзя смешивать production bot token и dev API.
4. После смены кнопок нажать свежий `/start`, старые кнопки в Telegram могут вести по старому URL.

### Нет кнопки mini app у тренера

1. Нажать `Старт` или `/start`.
2. Проверить, что тренерский Telegram ID совпадает с production env.
3. Проверить, что `PUBLIC_APP_DOMAIN` и `PUBLIC_API_DOMAIN` заданы на сервере.
4. Проверить logs bot/API после fresh start.

### Calendar `.ics` скачивается, а не открывает календарь сразу

Это ограничение Telegram Android WebView и обработчиков файлов на телефоне.
Mini app может отдать `.ics` как файл или прямой HTTPS URL, но не может гарантировать системный chooser календарей без промежуточного browser/download-flow.

## Security tasks после стабилизации

1. Перевыпустить production bot token у BotFather, потому что он был отправлен в чат.
2. Обновить серверные секреты production.
3. Перезапустить production deploy.
4. Проверить, что основной бот отвечает и mini app проходит авторизацию.
5. Сменить временный root-пароль VPS, который использовался для server-side правки Caddy.
6. После смены пароля проверить, что SSH-ключевой доступ всё ещё работает для `deploy` и `root`.

## Backlog второй итерации

- Убрать временный query-параметр `apiBaseUrl` из production bot URL, если production frontend стабильно работает с `NEXT_PUBLIC_API_BASE_URL`.
- Если dev-контур когда-нибудь снова понадобится, выделить для него отдельный домен и отдельного test bot; текущий dev/test-контур удалён с VPS, а dev-deploy workflow удалён из репозитория.
- Настроить CDN/proxy для `app` и `api`, если мобильные сети снова покажут нестабильность.
- Улучшить документацию для владельца: короткая инструкция “как проверить после deploy” без технических деталей.
