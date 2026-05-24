#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="deploy/compose.server.yml"
BASE_ENV_FILE="${ROOT_DIR}/.env.server"
OVERRIDE_ENV_FILE="${ROOT_DIR}/.env.server.test-bot.override"
RUNTIME_ENV_FILE="${ROOT_DIR}/.env.server.test-bot.runtime"

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
    python - "${RUNTIME_ENV_FILE}" "${key}" "${value}" <<'PY'
from pathlib import Path
import sys

file_path = Path(sys.argv[1])
target_key = sys.argv[2]
target_value = sys.argv[3]

lines = file_path.read_text(encoding="utf-8").splitlines()
updated = []

for line in lines:
    if line.startswith(f"{target_key}="):
        updated.append(f"{target_key}={target_value}")
    else:
        updated.append(line)

file_path.write_text("\n".join(updated) + "\n", encoding="utf-8")
PY
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${RUNTIME_ENV_FILE}"
  fi
done < "${OVERRIDE_ENV_FILE}"

echo "[test-bot] Generated ${RUNTIME_ENV_FILE}"
echo "[test-bot] Starting Telegram test bot in polling mode..."

cd "${ROOT_DIR}"
SERVER_ENV_FILE="../.env.server.test-bot.runtime" \
docker compose --env-file .env.server.test-bot.runtime -f "${COMPOSE_FILE}" up -d bot

echo "[test-bot] Bot service started."
echo "[test-bot] Check: docker compose --env-file .env.server.test-bot.runtime -f ${COMPOSE_FILE} ps bot"
