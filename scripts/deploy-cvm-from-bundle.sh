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
EXPECTED_ENV_FILE="${RMB_EXPECTED_ENV_FILE:-/srv/rmb/shared/app.env}"
BUNDLE="${RMB_DEPLOY_BUNDLE:-}"
BUILD_ARCHIVE="${RMB_BUILD_ARCHIVE:-}"
DEPLOY_SHA="${RMB_DEPLOY_SHA:-}"
BASE_DEPLOYED_SHA="${RMB_BASE_DEPLOYED_SHA:-}"
APPLIED_MIGRATION="${RMB_APPLIED_MIGRATION:-}"
READY_URL="${RMB_READY_URL:-http://127.0.0.1:3000/api/health}"
PUBLIC_READY_URL="${RMB_PUBLIC_READY_URL:-https://www.nextwood.net/api/health}"
ROLLBACK_HEALTH_URL="${RMB_ROLLBACK_HEALTH_URL:-http://127.0.0.1:3000/}"
HEALTH_ATTEMPTS="${RMB_HEALTH_ATTEMPTS:-20}"
HEALTH_SLEEP_SECONDS="${RMB_HEALTH_SLEEP_SECONDS:-2}"
CUSTOM_SUDO_BIN="${RMB_SUDO:-}"
DEFAULT_SUDO=0

[[ "$DEPLOY_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "RMB_DEPLOY_SHA must be a full commit SHA"
[[ "$BASE_DEPLOYED_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "RMB_BASE_DEPLOYED_SHA must be a full commit SHA"
[[ -n "$BUNDLE" && -f "$BUNDLE" ]] || fail "RMB_DEPLOY_BUNDLE must point to an uploaded git bundle"
[[ -n "$BUILD_ARCHIVE" && -f "$BUILD_ARCHIVE" ]] || fail "RMB_BUILD_ARCHIVE must point to an uploaded build archive"
[[ -d "$APP_DIR/.git" ]] || fail "RMB_APP_DIR is not a git checkout: $APP_DIR"
[[ "$READY_URL" =~ ^http://127\.0\.0\.1:[0-9]+/api/health$ ]] || fail "RMB_READY_URL must be a loopback /api/health URL"
[[ "$PUBLIC_READY_URL" =~ ^https://[^/?#[:space:]@]+/api/health$ ]] || fail "RMB_PUBLIC_READY_URL must be an HTTPS /api/health URL without credentials"
[[ "$ROLLBACK_HEALTH_URL" =~ ^http://127\.0\.0\.1:[0-9]+/?$ ]] || fail "RMB_ROLLBACK_HEALTH_URL must be a loopback origin"
SYSTEMCTL_BIN="$(command -v systemctl 2>/dev/null || true)"
[[ -n "$SYSTEMCTL_BIN" ]] || fail "systemctl is required"
RESTART_CMD=("$SYSTEMCTL_BIN")
if [[ "$(id -u)" != "0" ]]; then
  if [[ -n "$CUSTOM_SUDO_BIN" ]]; then
    [[ -x "$CUSTOM_SUDO_BIN" ]] || fail "RMB_SUDO must name an executable helper"
    RESTART_CMD=("$CUSTOM_SUDO_BIN" "$SYSTEMCTL_BIN")
  else
    SUDO_BIN="$(command -v sudo 2>/dev/null || true)"
    [[ -n "$SUDO_BIN" ]] || fail "sudo is required for service restart"
    RESTART_CMD=("$SUDO_BIN" -n "$SYSTEMCTL_BIN")
    DEFAULT_SUDO=1
  fi
fi

CANDIDATE_DIR="$APP_DIR/.rmb-next-candidate-$DEPLOY_SHA"
ROLLBACK_DIR="$APP_DIR/.rmb-next-rollback-$DEPLOY_SHA"
DEPLOYED_SHA_FILE="$APP_DIR/.rmb-deployed-sha"
CLEAN_CANDIDATE=0
SWITCH_ACTIVE=0

cleanup() {
  rm -f -- "$BUNDLE" "$BUILD_ARCHIVE"
  if [[ "$CLEAN_CANDIDATE" == "1" && -d "$CANDIDATE_DIR" ]]; then
    rm -rf -- "$CANDIDATE_DIR"
  fi
}
trap cleanup EXIT

ensure_checkout_writable() {
  local app_probe git_probe
  app_probe="$APP_DIR/.rmb-deploy-write-check"
  git_probe="$APP_DIR/.git/.rmb-deploy-write-check"
  if ! touch "$app_probe" "$git_probe" 2>/dev/null; then
    rm -f -- "$app_probe" "$git_probe" 2>/dev/null || true
    fail "app checkout is not writable by $(id -un); refusing to change ownership recursively: $APP_DIR"
  fi
  rm -f -- "$app_probe" "$git_probe"
}

check_dependency_contract() {
  local current_sha="$1"
  local target_sha="$2"
  node - "$current_sha" "$target_sha" <<'NODE'
const { execFileSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");

const [currentSha, targetSha] = process.argv.slice(2);

function readJson(ref, file) {
  return JSON.parse(execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8" }));
}

function normalizedPackage(ref) {
  const value = readJson(ref, "package.json");
  delete value.version;
  return value;
}

function normalizedLock(ref) {
  const value = readJson(ref, "package-lock.json");
  delete value.version;
  if (value.packages && value.packages[""]) delete value.packages[""].version;
  return value;
}

if (
  !isDeepStrictEqual(normalizedPackage(currentSha), normalizedPackage(targetSha))
  || !isDeepStrictEqual(normalizedLock(currentSha), normalizedLock(targetSha))
) {
  console.error("Runtime dependency manifests changed; ordinary in-place deployment is not allowed.");
  process.exit(1);
}
NODE
}

check_health() {
  local url="$1"
  local label="$2"
  local expected_sha="${3:-}"
  local attempt
  local response
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1)); do
    if response="$(curl --fail --silent --show-error --max-time 15 "$url")"; then
      if [[ -z "$expected_sha" ]] || HEALTH_RESPONSE="$response" EXPECTED_SHA="$expected_sha" node -e '
        const body = JSON.parse(process.env.HEALTH_RESPONSE || "{}");
        process.exit(body.status === "ok" && body.version === process.env.EXPECTED_SHA ? 0 : 1);
      '; then
        log "$label health check passed: $url"
        return 0
      fi
    fi
    log "$label health not ready yet; retrying ($attempt/$HEALTH_ATTEMPTS)"
    sleep "$HEALTH_SLEEP_SECONDS"
  done
  return 1
}

restart_service() {
  "${RESTART_CMD[@]}" restart "$SERVICE"
}

cd "$APP_DIR"
ensure_checkout_writable

CURRENT_HEAD="$(git rev-parse --verify HEAD 2>/dev/null || true)"
[[ "$CURRENT_HEAD" =~ ^[a-f0-9]{40}$ ]] || fail "server checkout has no readable HEAD"
CURRENT_REF="$(git symbolic-ref -q HEAD || true)"
[[ "$CURRENT_REF" == refs/heads/* ]] || fail "server checkout must be on a local branch"
git diff --quiet || fail "tracked working tree has unstaged changes"
git diff --cached --quiet || fail "tracked working tree has staged changes"

log "verifying uploaded source bundle"
git bundle verify "$BUNDLE" >/dev/null
git fetch "$BUNDLE" deploy-target
TARGET_SHA="$(git rev-parse FETCH_HEAD)"
[[ "$TARGET_SHA" == "$DEPLOY_SHA" ]] || fail "bundle target $TARGET_SHA does not match requested $DEPLOY_SHA"
git merge-base --is-ancestor "$CURRENT_HEAD" "$TARGET_SHA" \
  || fail "target commit is not a fast-forward from the current server checkout"
git cat-file -e "$BASE_DEPLOYED_SHA^{commit}" 2>/dev/null \
  || fail "base deployed commit is unavailable on the server: $BASE_DEPLOYED_SHA"
git merge-base --is-ancestor "$BASE_DEPLOYED_SHA" "$CURRENT_HEAD" \
  || fail "base deployed commit is not an ancestor of the current server checkout"
git merge-base --is-ancestor "$BASE_DEPLOYED_SHA" "$TARGET_SHA" \
  || fail "base deployed commit is not an ancestor of the target"

if [[ -f "$DEPLOYED_SHA_FILE" ]]; then
  [[ "$(tr -d '\r\n' < "$DEPLOYED_SHA_FILE")" == "$BASE_DEPLOYED_SHA" ]] \
    || fail "server deployed-SHA marker does not match the selected deployment baseline"
else
  log "deployed-SHA marker is absent; using the workflow's successful deployment baseline"
fi
if [[ -f "$APP_DIR/.next/RMB_DEPLOY_SHA" ]]; then
  [[ "$(tr -d '\r\n' < "$APP_DIR/.next/RMB_DEPLOY_SHA")" == "$BASE_DEPLOYED_SHA" ]] \
    || fail "existing build marker does not match the selected deployment baseline"
else
  log "existing build has no version marker; treating it as a legacy build for this transition"
fi

SCHEMA_CHANGES="$(git diff --name-only "$BASE_DEPLOYED_SHA" "$TARGET_SHA" -- prisma/schema.prisma prisma/models prisma/migrations)"
if [[ -n "$SCHEMA_CHANGES" && -z "$APPLIED_MIGRATION" ]]; then
  fail "Prisma schema or migrations changed; run the protected migration workflow before deployment"
fi
if [[ -n "$APPLIED_MIGRATION" ]]; then
  [[ "$APPLIED_MIGRATION" =~ ^[0-9]{14}_[a-z0-9_]+$ ]] || fail "invalid applied migration name"
  while IFS= read -r changed_file; do
    [[ -z "$changed_file" ]] && continue
    if [[ "$changed_file" == "prisma/schema.prisma" || "$changed_file" == "prisma/models/"* || "$changed_file" == "prisma/migrations/$APPLIED_MIGRATION/"* ]]; then
      continue
    fi
    fail "unapproved Prisma change detected: $changed_file"
  done <<< "$SCHEMA_CHANGES"
fi

check_dependency_contract "$BASE_DEPLOYED_SHA" "$TARGET_SHA" \
  || fail "runtime dependencies changed; use a full release deployment"

[[ -d "$APP_DIR/.next" && -f "$APP_DIR/.next/BUILD_ID" ]] \
  || fail "existing production build is missing; refusing a switch without rollback protection"
[[ ! -e "$CANDIDATE_DIR" ]] || fail "candidate directory already exists: $CANDIDATE_DIR"
[[ ! -e "$ROLLBACK_DIR" ]] || fail "rollback directory already exists: $ROLLBACK_DIR"

log "verifying build archive paths"
mkdir "$CANDIDATE_DIR"
CLEAN_CANDIDATE=1
ARCHIVE_LIST="$CANDIDATE_DIR/archive.list"
if ! tar -tzf "$BUILD_ARCHIVE" > "$ARCHIVE_LIST"; then
  fail "build archive is unreadable or corrupt"
fi
while IFS= read -r archive_entry; do
  case "$archive_entry" in
    .next|.next/*) ;;
    *) fail "build archive contains an unexpected path: $archive_entry" ;;
  esac
  [[ "/$archive_entry/" != *"/../"* ]] || fail "build archive contains path traversal"
done < "$ARCHIVE_LIST"

if ! tar -xzf "$BUILD_ARCHIVE" -C "$CANDIDATE_DIR"; then
  fail "build archive extraction failed"
fi
rm -f -- "$ARCHIVE_LIST"
[[ -f "$CANDIDATE_DIR/.next/BUILD_ID" ]] || fail "build archive has no BUILD_ID"
[[ -f "$CANDIDATE_DIR/.next/RMB_DEPLOY_SHA" ]] || fail "build archive has no deployment SHA marker"
[[ "$(tr -d '\r\n' < "$CANDIDATE_DIR/.next/RMB_DEPLOY_SHA")" == "$DEPLOY_SHA" ]] \
  || fail "build archive SHA marker does not match the requested deployment"

SERVICE_ENV_FILES="$("$SYSTEMCTL_BIN" show "$SERVICE" --property=EnvironmentFiles --value 2>/dev/null || true)"
if ! printf '%s\n' "$SERVICE_ENV_FILES" \
  | tr ' {};=' '\n' \
  | sed 's/^-//' \
  | grep -Fqx -- "$EXPECTED_ENV_FILE"; then
  fail "systemd service does not reference the exact expected protected environment file"
fi
SERVICE_WORKING_DIR="$("$SYSTEMCTL_BIN" show "$SERVICE" --property=WorkingDirectory --value 2>/dev/null || true)"
[[ "$SERVICE_WORKING_DIR" == "$APP_DIR" ]] \
  || fail "systemd service WorkingDirectory does not match $APP_DIR"
"$SYSTEMCTL_BIN" is-active --quiet "$SERVICE" \
  || fail "service must be active before deployment: $SERVICE"
if [[ "$DEFAULT_SUDO" == "1" ]]; then
  "$SUDO_BIN" -n -l "$SYSTEMCTL_BIN" restart "$SERVICE" >/dev/null 2>&1 \
    || fail "deployment user lacks passwordless permission to restart $SERVICE"
fi

restore_source() {
  local active_head
  active_head="$(git rev-parse --verify HEAD 2>/dev/null || true)"
  if [[ "$active_head" == "$BASE_DEPLOYED_SHA" ]]; then
    return 0
  fi
  [[ "$active_head" =~ ^[a-f0-9]{40}$ ]] || return 1
  if ! git update-ref "$CURRENT_REF" "$BASE_DEPLOYED_SHA" "$active_head"; then
    return 1
  fi
  git restore --source="$BASE_DEPLOYED_SHA" --staged --worktree -- .
}

rollback_deployment() {
  log "restoring the previous source and application build"
  if [[ -e "$APP_DIR/.next" ]]; then
    [[ ! -e "$CANDIDATE_DIR/.next-failed" ]] || return 1
    mv "$APP_DIR/.next" "$CANDIDATE_DIR/.next-failed" || return 1
  fi
  [[ ! -e "$APP_DIR/.next" ]] || return 1
  [[ -d "$ROLLBACK_DIR/.next" && -f "$ROLLBACK_DIR/.next/BUILD_ID" ]] || return 1
  mv "$ROLLBACK_DIR/.next" "$APP_DIR/.next" || return 1
  restore_source || return 1
  restart_service || return 1
  "$SYSTEMCTL_BIN" is-active --quiet "$SERVICE" || return 1
  check_health "$ROLLBACK_HEALTH_URL" "rollback" || return 1
  rmdir "$ROLLBACK_DIR" || return 1
  CLEAN_CANDIDATE=1
}

fail_after_switch() {
  local message="$1"
  if rollback_deployment; then
    SWITCH_ACTIVE=0
    fail "$message; previous release restored"
  fi
  SWITCH_ACTIVE=0
  fail "$message; automatic rollback needs manual attention; rollback files were preserved at $ROLLBACK_DIR"
}

on_exit() {
  local status="$?"
  trap - EXIT HUP INT TERM
  if [[ "$status" != "0" && "$SWITCH_ACTIVE" == "1" ]]; then
    log "deployment stopped during activation; attempting automatic rollback"
    if [[ -d "$ROLLBACK_DIR/.next" ]]; then
      if rollback_deployment; then
        log "previous release restored after interrupted activation"
      else
        log "automatic rollback after interruption needs manual attention: $ROLLBACK_DIR"
      fi
    elif restore_source; then
      rmdir "$ROLLBACK_DIR" 2>/dev/null || true
      CLEAN_CANDIDATE=1
      log "previous source restored before build activation"
    else
      log "source rollback after interruption needs manual attention"
    fi
  fi
  cleanup
  exit "$status"
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir "$ROLLBACK_DIR"
CLEAN_CANDIDATE=0
SWITCH_ACTIVE=1
if [[ "$CURRENT_HEAD" != "$TARGET_SHA" ]]; then
  log "fast-forwarding source to $TARGET_SHA"
  if ! git merge --ff-only FETCH_HEAD; then
    CLEAN_CANDIDATE=1
    rmdir "$ROLLBACK_DIR" 2>/dev/null || true
    fail "source fast-forward failed before build activation"
  fi
fi
if ! mv "$APP_DIR/.next" "$ROLLBACK_DIR/.next"; then
  if restore_source; then
    SWITCH_ACTIVE=0
    CLEAN_CANDIDATE=1
    rmdir "$ROLLBACK_DIR" 2>/dev/null || true
    fail "could not preserve the previous application build; source restored"
  fi
  fail "could not preserve the previous application build and source rollback needs manual attention"
fi
if ! mv "$CANDIDATE_DIR/.next" "$APP_DIR/.next"; then
  fail_after_switch "could not activate the prepared application build"
fi

log "restarting $SERVICE"
if ! restart_service; then
  fail_after_switch "service restart failed"
fi
if ! "$SYSTEMCTL_BIN" is-active --quiet "$SERVICE"; then
  fail_after_switch "service is not active after restart"
fi

check_health "$READY_URL" "local readiness" "$TARGET_SHA" \
  || fail_after_switch "local readiness check failed"
check_health "$PUBLIC_READY_URL" "public readiness" "$TARGET_SHA" \
  || fail_after_switch "public readiness check failed"

marker_tmp="$DEPLOYED_SHA_FILE.tmp-$DEPLOY_SHA"
if ! printf '%s\n' "$TARGET_SHA" > "$marker_tmp" || ! mv "$marker_tmp" "$DEPLOYED_SHA_FILE"; then
  rm -f -- "$marker_tmp"
  fail_after_switch "could not record the deployed SHA"
fi
git update-ref refs/remotes/origin/main "$TARGET_SHA" || true
"$SYSTEMCTL_BIN" status "$SERVICE" --no-pager -n 20 || true

SWITCH_ACTIVE=0
rm -rf -- "$ROLLBACK_DIR"
CLEAN_CANDIDATE=1
log "deployment complete: $TARGET_SHA"
