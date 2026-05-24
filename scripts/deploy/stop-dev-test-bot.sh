#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="deploy/compose.server.yml"
RUNTIME_ENV_FILE="${ROOT_DIR}/.env.server.test-bot.runtime"

if [[ ! -f "${RUNTIME_ENV_FILE}" ]]; then
  echo "Missing ${RUNTIME_ENV_FILE}"
  exit 1
fi

cd "${ROOT_DIR}"
SERVER_ENV_FILE="../.env.server.test-bot.runtime" \
docker compose --env-file .env.server.test-bot.runtime -f "${COMPOSE_FILE}" stop bot

echo "[test-bot] Bot service stopped."
