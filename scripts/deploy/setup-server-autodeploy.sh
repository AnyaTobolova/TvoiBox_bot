#!/usr/bin/env bash
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_GROUP="${DEPLOY_GROUP:-${DEPLOY_USER}}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/stack/tvoy-box-bot-deploy}"
LEGACY_ROOT="${LEGACY_ROOT:-/opt/stack/tvoy-box-bot}"
DEPLOY_PUBLIC_KEY="${DEPLOY_PUBLIC_KEY:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${DEPLOY_USER}"
fi

usermod -aG docker "${DEPLOY_USER}"

install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_GROUP}" "/home/${DEPLOY_USER}/.ssh"
touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chown "${DEPLOY_USER}:${DEPLOY_GROUP}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"

if [[ -n "${DEPLOY_PUBLIC_KEY}" ]]; then
  if ! grep -qxF "${DEPLOY_PUBLIC_KEY}" "/home/${DEPLOY_USER}/.ssh/authorized_keys"; then
    echo "${DEPLOY_PUBLIC_KEY}" >>"/home/${DEPLOY_USER}/.ssh/authorized_keys"
  fi
fi

install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_GROUP}" "${DEPLOY_ROOT}"
install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_GROUP}" "${DEPLOY_ROOT}/releases"
install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_GROUP}" "${DEPLOY_ROOT}/shared"
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_GROUP}" "${DEPLOY_ROOT}/shared/.secrets"
install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_GROUP}" "${DEPLOY_ROOT}/shared/logs"

if [[ ! -f "${DEPLOY_ROOT}/shared/.env.server" && -f "${LEGACY_ROOT}/.env.server" ]]; then
  cp "${LEGACY_ROOT}/.env.server" "${DEPLOY_ROOT}/shared/.env.server"
  chown "${DEPLOY_USER}:${DEPLOY_GROUP}" "${DEPLOY_ROOT}/shared/.env.server"
  chmod 600 "${DEPLOY_ROOT}/shared/.env.server"
fi

if [[ ! -f "${DEPLOY_ROOT}/shared/.secrets/google-service-account.json" && -f "${LEGACY_ROOT}/.secrets/google-service-account.json" ]]; then
  cp "${LEGACY_ROOT}/.secrets/google-service-account.json" "${DEPLOY_ROOT}/shared/.secrets/google-service-account.json"
  chown "${DEPLOY_USER}:${DEPLOY_GROUP}" "${DEPLOY_ROOT}/shared/.secrets/google-service-account.json"
  chmod 600 "${DEPLOY_ROOT}/shared/.secrets/google-service-account.json"
fi

if [[ -d "${LEGACY_ROOT}/logs" ]]; then
  cp -a "${LEGACY_ROOT}/logs/." "${DEPLOY_ROOT}/shared/logs/" || true
  chown -R "${DEPLOY_USER}:${DEPLOY_GROUP}" "${DEPLOY_ROOT}/shared/logs"
fi

echo "Auto-deploy server bootstrap completed."
echo "Deploy user: ${DEPLOY_USER}"
echo "Deploy root: ${DEPLOY_ROOT}"
