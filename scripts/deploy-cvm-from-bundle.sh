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
ENV_FILE="${RMB_ENV_FILE:-/srv/rmb/shared/app.env}"
BUNDLE="${RMB_DEPLOY_BUNDLE:-}"
DEPLOY_SHA="${RMB_DEPLOY_SHA:-}"
HEALTH_URL="${RMB_HEALTH_URL:-http://127.0.0.1:3000/}"
HEALTH_ATTEMPTS="${RMB_HEALTH_ATTEMPTS:-20}"
HEALTH_SLEEP_SECONDS="${RMB_HEALTH_SLEEP_SECONDS:-2}"
NPM_INSTALL_MODE="${RMB_NPM_INSTALL:-auto}"
SUDO_CMD="${RMB_SUDO:-}"

if [[ -z "$SUDO_CMD" && "$(id -u)" != "0" ]] && command -v sudo >/dev/null 2>&1; then
  SUDO_CMD="sudo"
fi

ensure_checkout_writable() {
  local app_probe git_probe
  app_probe="$APP_DIR/.rmb-deploy-write-check"
  git_probe="$APP_DIR/.git/.rmb-deploy-write-check"
  if touch "$app_probe" "$git_probe" 2>/dev/null; then
    rm -f "$app_probe" "$git_probe"
    return 0
  fi
  rm -f "$app_probe" "$git_probe" 2>/dev/null || true
  [[ -n "$SUDO_CMD" ]] || fail "app checkout is not writable by $(id -un): $APP_DIR"
  log "repairing app checkout ownership for $(id -un):$(id -gn)"
  $SUDO_CMD chown -R "$(id -un):$(id -gn)" "$APP_DIR"
  touch "$app_probe" "$git_probe" 2>/dev/null || fail "app checkout is still not writable after ownership repair: $APP_DIR"
  rm -f "$app_probe" "$git_probe"
}

[[ "$DEPLOY_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "RMB_DEPLOY_SHA must be a full commit SHA"
[[ -n "$BUNDLE" && -f "$BUNDLE" ]] || fail "RMB_DEPLOY_BUNDLE must point to an uploaded git bundle"
[[ -d "$APP_DIR/.git" ]] || fail "RMB_APP_DIR is not a git checkout: $APP_DIR"

cleanup() {
  rm -f "$BUNDLE"
}
trap cleanup EXIT

cd "$APP_DIR"
ensure_checkout_writable

CURRENT_HEAD="$(git rev-parse --verify HEAD 2>/dev/null || true)"
if [[ -n "$CURRENT_HEAD" ]]; then
  git diff --quiet || fail "tracked working tree has unstaged changes"
  git diff --cached --quiet || fail "tracked working tree has staged changes"
else
  log "server checkout has no readable HEAD; bootstrapping from the deployment bundle"
fi

log "verifying uploaded bundle"
git bundle verify "$BUNDLE" >/dev/null
git fetch "$BUNDLE" deploy-target

TARGET_SHA="$(git rev-parse FETCH_HEAD)"
[[ "$TARGET_SHA" == "$DEPLOY_SHA" ]] || fail "bundle target $TARGET_SHA does not match requested $DEPLOY_SHA"

if [[ -n "$CURRENT_HEAD" ]]; then
  git merge-base --is-ancestor "$CURRENT_HEAD" "$TARGET_SHA" || fail "target commit is not a fast-forward from the current server checkout"
  CHANGED_FILES="$(git diff --name-only "$CURRENT_HEAD" "$TARGET_SHA")"
  log "fast-forwarding to $TARGET_SHA"
  git merge --ff-only FETCH_HEAD
else
  CHANGED_FILES=$'package.json\npackage-lock.json'
  log "checking out $TARGET_SHA from a full deployment bundle"
  git checkout --force -B main FETCH_HEAD
fi
git update-ref refs/remotes/origin/main "$TARGET_SHA" || true

if [[ "$NPM_INSTALL_MODE" == "always" ]] \
  || [[ ! -d node_modules ]] \
  || printf '%s\n' "$CHANGED_FILES" | grep -Eq '^(package\.json|package-lock\.json)$'; then
  log "installing dependencies"
  npm ci --prefer-offline --no-audit --fund=false
else
  log "package manifests unchanged; skipping npm ci"
fi

if [[ -f "$ENV_FILE" ]]; then
  [[ -r "$ENV_FILE" ]] || fail "environment file is not readable by the deployment user: $ENV_FILE"
  log "loading build environment from $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  log "build environment file not found; continuing without $ENV_FILE"
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
  health_ok=0
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1)); do
    if curl --fail --silent --show-error --head --max-time 15 "$HEALTH_URL" >/dev/null; then
      health_ok=1
      break
    fi
    log "local health not ready yet; retrying ($attempt/$HEALTH_ATTEMPTS)"
    sleep "$HEALTH_SLEEP_SECONDS"
  done
  [[ "$health_ok" == "1" ]] || fail "local health check failed after $HEALTH_ATTEMPTS attempts: $HEALTH_URL"
fi

log "deployment complete: $TARGET_SHA"
