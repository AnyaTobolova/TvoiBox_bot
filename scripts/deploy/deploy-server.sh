#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="deploy/compose.server.yml"

cd "$ROOT_DIR"

if [[ ! -f ".env.server" ]]; then
  echo "Missing .env.server. Copy .env.server.example to .env.server and fill in the secrets."
  exit 1
fi

STACK_NAME="$(grep -E '^STACK_NAME=' .env.server | head -n 1 | cut -d '=' -f 2- || true)"
API_PORT_VALUE="$(grep -E '^API_PORT=' .env.server | head -n 1 | cut -d '=' -f 2- || true)"
DEPLOY_WITH_BOT="${DEPLOY_WITH_BOT:-true}"

if [[ -z "${STACK_NAME}" ]]; then
  echo "STACK_NAME is not set in .env.server."
  exit 1
fi

echo "[$STACK_NAME] Starting PostgreSQL..."
docker compose --env-file .env.server -f "$COMPOSE_FILE" up -d postgres

if [[ "${DEPLOY_WITH_BOT}" == "true" ]]; then
  BUILD_SERVICES=(migrate api mini-app bot)
  START_SERVICES=(api mini-app bot)
else
  BUILD_SERVICES=(migrate api mini-app)
  START_SERVICES=(api mini-app)
fi

echo "[$STACK_NAME] Building application images: ${BUILD_SERVICES[*]}..."
docker compose --env-file .env.server -f "$COMPOSE_FILE" build "${BUILD_SERVICES[@]}"

echo "[$STACK_NAME] Applying Prisma schema..."
docker compose --env-file .env.server -f "$COMPOSE_FILE" run --rm migrate

echo "[$STACK_NAME] Starting services: ${START_SERVICES[*]}..."
docker compose --env-file .env.server -f "$COMPOSE_FILE" up -d "${START_SERVICES[@]}"

echo "Stack ${STACK_NAME} is running."
echo "API check: curl http://127.0.0.1:${API_PORT_VALUE:-3300}/health"
MINI_APP_PORT_VALUE="$(grep -E '^MINI_APP_PORT=' .env.server | head -n 1 | cut -d '=' -f 2- || true)"
echo "Mini app check: curl http://127.0.0.1:${MINI_APP_PORT_VALUE:-3302}/"
if [[ "${DEPLOY_WITH_BOT}" == "true" ]]; then
  echo "Bot is enabled for this deploy."
else
  echo "Bot is skipped for this deploy."
fi
