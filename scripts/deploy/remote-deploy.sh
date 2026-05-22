#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/stack/tvoy-box-bot-deploy}"
LEGACY_ROOT="${LEGACY_ROOT:-/opt/stack/tvoy-box-bot}"
RELEASE_NAME="${RELEASE_NAME:?RELEASE_NAME is required}"
RELEASE_ARCHIVE="${RELEASE_ARCHIVE:?RELEASE_ARCHIVE is required}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

RELEASES_DIR="${DEPLOY_ROOT}/releases"
SHARED_DIR="${DEPLOY_ROOT}/shared"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_NAME}"
CURRENT_LINK="${DEPLOY_ROOT}/current"

echo "[auto-deploy] DEPLOY_ROOT=${DEPLOY_ROOT}"
echo "[auto-deploy] RELEASE_NAME=${RELEASE_NAME}"

mkdir -p "${RELEASES_DIR}" "${SHARED_DIR}/.secrets" "${SHARED_DIR}/logs"

if [[ ! -f "${SHARED_DIR}/.env.server" && -f "${LEGACY_ROOT}/.env.server" ]]; then
  echo "[auto-deploy] Bootstrapping shared .env.server from legacy root"
  cp "${LEGACY_ROOT}/.env.server" "${SHARED_DIR}/.env.server"
  chmod 600 "${SHARED_DIR}/.env.server"
fi

if [[ ! -f "${SHARED_DIR}/.secrets/google-service-account.json" && -f "${LEGACY_ROOT}/.secrets/google-service-account.json" ]]; then
  echo "[auto-deploy] Bootstrapping Google service account JSON from legacy root"
  cp "${LEGACY_ROOT}/.secrets/google-service-account.json" "${SHARED_DIR}/.secrets/google-service-account.json"
  chmod 600 "${SHARED_DIR}/.secrets/google-service-account.json"
fi

if [[ ! -d "${SHARED_DIR}/logs/api" && -d "${LEGACY_ROOT}/logs" ]]; then
  echo "[auto-deploy] Bootstrapping shared logs directory from legacy root"
  mkdir -p "${SHARED_DIR}/logs"
  cp -a "${LEGACY_ROOT}/logs/." "${SHARED_DIR}/logs/" || true
fi

if [[ ! -f "${SHARED_DIR}/.env.server" ]]; then
  echo "[auto-deploy] Missing ${SHARED_DIR}/.env.server"
  exit 1
fi

if [[ ! -f "${SHARED_DIR}/.secrets/google-service-account.json" ]]; then
  echo "[auto-deploy] Missing ${SHARED_DIR}/.secrets/google-service-account.json"
  exit 1
fi

rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"
tar -xzf "${RELEASE_ARCHIVE}" -C "${RELEASE_DIR}"

ln -sfn "${SHARED_DIR}/.env.server" "${RELEASE_DIR}/.env.server"
ln -sfn "${SHARED_DIR}/.secrets" "${RELEASE_DIR}/.secrets"
ln -sfn "${SHARED_DIR}/logs" "${RELEASE_DIR}/logs"

find "${RELEASE_DIR}/scripts/deploy" -type f -name "*.sh" -exec sed -i 's/\r$//' {} +
chmod +x "${RELEASE_DIR}/scripts/deploy/deploy-server.sh"

ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

cd "${CURRENT_LINK}"
bash scripts/deploy/deploy-server.sh

API_PORT_VALUE="$(grep -E '^API_PORT=' .env.server | head -n 1 | cut -d '=' -f 2- || true)"
curl -fsS "http://127.0.0.1:${API_PORT_VALUE:-3300}/health" >/dev/null
MINI_APP_PORT_VALUE="$(grep -E '^MINI_APP_PORT=' .env.server | head -n 1 | cut -d '=' -f 2- || true)"
curl -fsS "http://127.0.0.1:${MINI_APP_PORT_VALUE:-3302}/" >/dev/null

if [[ -f "${RELEASE_ARCHIVE}" ]]; then
  rm -f "${RELEASE_ARCHIVE}"
fi

mapfile -t OLD_RELEASES < <(find "${RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d | sort)

if (( ${#OLD_RELEASES[@]} > KEEP_RELEASES )); then
  REMOVE_COUNT=$(( ${#OLD_RELEASES[@]} - KEEP_RELEASES ))
  for ((i=0; i<REMOVE_COUNT; i++)); do
    rm -rf "${OLD_RELEASES[$i]}"
  done
fi

echo "[auto-deploy] Release ${RELEASE_NAME} deployed successfully"
