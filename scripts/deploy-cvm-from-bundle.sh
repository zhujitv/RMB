#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[rmb-cvm-deploy] %s\n' "$*"
}

fail() {
  printf '[rmb-cvm-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

APP_DIR="${RMB_APP_DIR:-/srv/rmb/app}"
SERVICE="${RMB_SERVICE:-rmb-app.service}"
BUNDLE="${RMB_DEPLOY_BUNDLE:-}"
DEPLOY_SHA="${RMB_DEPLOY_SHA:-}"
HEALTH_URL="${RMB_HEALTH_URL:-http://127.0.0.1:3000/}"
NPM_INSTALL_MODE="${RMB_NPM_INSTALL:-auto}"
SUDO_CMD="${RMB_SUDO:-}"

if [[ -z "$SUDO_CMD" && "$(id -u)" != "0" ]] && command -v sudo >/dev/null 2>&1; then
  SUDO_CMD="sudo"
fi

[[ "$DEPLOY_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "RMB_DEPLOY_SHA must be a full commit SHA"
[[ -n "$BUNDLE" && -f "$BUNDLE" ]] || fail "RMB_DEPLOY_BUNDLE must point to an uploaded git bundle"
[[ -d "$APP_DIR/.git" ]] || fail "RMB_APP_DIR is not a git checkout: $APP_DIR"

cleanup() {
  rm -f "$BUNDLE"
}
trap cleanup EXIT

cd "$APP_DIR"

git diff --quiet || fail "tracked working tree has unstaged changes"
git diff --cached --quiet || fail "tracked working tree has staged changes"

log "verifying uploaded bundle"
git bundle verify "$BUNDLE" >/dev/null
git fetch "$BUNDLE" deploy-target

TARGET_SHA="$(git rev-parse FETCH_HEAD)"
[[ "$TARGET_SHA" == "$DEPLOY_SHA" ]] || fail "bundle target $TARGET_SHA does not match requested $DEPLOY_SHA"
git merge-base --is-ancestor HEAD "$TARGET_SHA" || fail "target commit is not a fast-forward from the current server checkout"

CHANGED_FILES="$(git diff --name-only HEAD "$TARGET_SHA")"
log "fast-forwarding to $TARGET_SHA"
git merge --ff-only FETCH_HEAD
git update-ref refs/remotes/origin/main "$TARGET_SHA" || true

if [[ "$NPM_INSTALL_MODE" == "always" ]] \
  || [[ ! -d node_modules ]] \
  || printf '%s\n' "$CHANGED_FILES" | grep -Eq '^(package\.json|package-lock\.json)$'; then
  log "installing dependencies"
  npm ci --prefer-offline --no-audit --fund=false
else
  log "package manifests unchanged; skipping npm ci"
fi

log "checking migration status without applying migrations"
npx prisma migrate status

log "building application"
npm run build:app

log "restarting $SERVICE"
$SUDO_CMD systemctl restart "$SERVICE"
$SUDO_CMD systemctl is-active --quiet "$SERVICE"
$SUDO_CMD systemctl status "$SERVICE" --no-pager -n 20

if command -v curl >/dev/null 2>&1; then
  log "checking local health: $HEALTH_URL"
  curl --fail --silent --show-error --head --max-time 15 "$HEALTH_URL" >/dev/null
fi

log "deployment complete: $TARGET_SHA"
