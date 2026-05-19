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

if [[ -z "${STACK_NAME}" ]]; then
  echo "STACK_NAME is not set in .env.server."
  exit 1
fi

echo "[$STACK_NAME] Starting PostgreSQL..."
docker compose --env-file .env.server -f "$COMPOSE_FILE" up -d postgres

echo "[$STACK_NAME] Building application images..."
docker compose --env-file .env.server -f "$COMPOSE_FILE" build migrate api bot

echo "[$STACK_NAME] Applying Prisma schema..."
docker compose --env-file .env.server -f "$COMPOSE_FILE" run --rm migrate

echo "[$STACK_NAME] Starting API and bot..."
docker compose --env-file .env.server -f "$COMPOSE_FILE" up -d api bot

echo "Stack ${STACK_NAME} is running."
echo "API check: curl http://127.0.0.1:${API_PORT_VALUE:-3300}/health"
