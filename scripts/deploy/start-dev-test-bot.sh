#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="deploy/compose.server.yml"
BASE_ENV_FILE="${ROOT_DIR}/.env.server"
OVERRIDE_ENV_FILE="${ROOT_DIR}/.env.server.test-bot.override"
RUNTIME_ENV_FILE="${ROOT_DIR}/.env.server.test-bot.runtime"
# Dev test bot may need several minutes to validate the token and resume polling after image rebuild on VPS.
START_LOG_ATTEMPTS="${START_LOG_ATTEMPTS:-60}"
START_LOG_DELAY_SECONDS="${START_LOG_DELAY_SECONDS:-5}"

if [[ ! -f "${BASE_ENV_FILE}" ]]; then
  echo "Missing ${BASE_ENV_FILE}"
  exit 1
fi

if [[ ! -f "${OVERRIDE_ENV_FILE}" ]]; then
  echo "Missing ${OVERRIDE_ENV_FILE}"
  echo "Copy deploy/.env.server.test-bot.override.example to .env.server.test-bot.override and fill in the Telegram test bot values."
  exit 1
fi

cp "${BASE_ENV_FILE}" "${RUNTIME_ENV_FILE}"

while IFS= read -r line || [[ -n "${line}" ]]; do
  trimmed="${line#"${line%%[![:space:]]*}"}"

  if [[ -z "${trimmed}" || "${trimmed}" == \#* ]]; then
    continue
  fi

  key="${trimmed%%=*}"
  value="${trimmed#*=}"

  if grep -q "^${key}=" "${RUNTIME_ENV_FILE}"; then
    awk -v target_key="${key}" -v target_value="${value}" '
      BEGIN { updated = 0 }
      index($0, target_key "=") == 1 {
        print target_key "=" target_value
        updated = 1
        next
      }
      { print }
      END {
        if (updated == 0) {
          print target_key "=" target_value
        }
      }
    ' "${RUNTIME_ENV_FILE}" > "${RUNTIME_ENV_FILE}.tmp"
    mv "${RUNTIME_ENV_FILE}.tmp" "${RUNTIME_ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${RUNTIME_ENV_FILE}"
  fi
done < "${OVERRIDE_ENV_FILE}"

wait_for_bot_start() {
  local attempts="${1:-24}"
  local delay_seconds="${2:-5}"
  local logs_output=""

  for ((attempt=1; attempt<=attempts; attempt++)); do
    logs_output="$(
      SERVER_ENV_FILE="../.env.server.test-bot.runtime" \
      docker compose --env-file .env.server.test-bot.runtime -f "${COMPOSE_FILE}" logs --since 5m bot 2>&1 || true
    )"

    if grep -Fq "Telegram bot token validated" <<<"${logs_output}" && grep -Fq "Bot polling started" <<<"${logs_output}"; then
      echo "[test-bot] Polling bot started successfully."
      return 0
    fi

    echo "[test-bot] Waiting for polling bot startup logs (${attempt}/${attempts})..."
    sleep "${delay_seconds}"
  done

  echo "[test-bot] Polling bot did not confirm startup in logs."
  SERVER_ENV_FILE="../.env.server.test-bot.runtime" \
  docker compose --env-file .env.server.test-bot.runtime -f "${COMPOSE_FILE}" logs --since 10m bot || true
  return 1
}

echo "[test-bot] Generated ${RUNTIME_ENV_FILE}"
echo "[test-bot] Building bot image from current release..."
docker compose --env-file .env.server.test-bot.runtime -f "${COMPOSE_FILE}" build bot
echo "[test-bot] Starting Telegram test bot in polling mode..."

cd "${ROOT_DIR}"
SERVER_ENV_FILE="../.env.server.test-bot.runtime" \
docker compose --env-file .env.server.test-bot.runtime -f "${COMPOSE_FILE}" up -d bot

wait_for_bot_start "${START_LOG_ATTEMPTS}" "${START_LOG_DELAY_SECONDS}"

echo "[test-bot] Bot service started."
echo "[test-bot] Check: docker compose --env-file .env.server.test-bot.runtime -f ${COMPOSE_FILE} ps bot"
