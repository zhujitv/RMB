#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export LC_ALL=C

log() { printf '[rmb-cvm-quick] %s\n' "$*"; }
fail() { LAST_ERROR="$*"; printf '[rmb-cvm-quick] ERROR: %s\n' "$*" >&2; exit 1; }

APP_DIR="${RMB_APP_DIR:-/srv/rmb/app}"
SERVICE="${RMB_SERVICE:-rmb-app.service}"
EXPECTED_ENV_FILE="${RMB_EXPECTED_ENV_FILE:-/srv/rmb/shared/app.env}"
TARGET_SHA="${RMB_DEPLOY_SHA:-}"
LOCAL_URL="${RMB_READY_URL:-http://127.0.0.1:3000/api/health}"
PUBLIC_URL="${RMB_PUBLIC_READY_URL:-https://www.nextwood.net/api/health}"
HEALTH_CHECK_ATTEMPTS="${RMB_HEALTH_CHECK_ATTEMPTS:-12}"
LOCK_FILE="$APP_DIR/.rmb-production-deploy.lock"
AUDIT_FILE="${RMB_AUDIT_FILE:-$APP_DIR/.rmb-quick-deploy-audit.jsonl}"
STATE_FILE="${RMB_STATE_FILE:-$APP_DIR/.rmb-quick-deploy-state}"
MEMINFO_FILE="${RMB_MEMINFO_FILE:-/proc/meminfo}"
LOADAVG_FILE="${RMB_LOADAVG_FILE:-/proc/loadavg}"
ACTOR="${RMB_DEPLOY_ACTOR:-unknown}"
RUN_URL="${RMB_DEPLOY_RUN_URL:-unknown}"
LAST_ERROR="unexpected deployment failure"
BASE_SHA=""
CANDIDATE_DIR=""
CHANGED_FILES=""
AUDIT_READY=0
ROLLED_BACK=false
BUILD_HEAP_MB=2048
MIN_AVAILABLE_MB=$((BUILD_HEAP_MB * 3))
EXPECTED_DEPLOY_USER="${RMB_EXPECTED_DEPLOY_USER:-rmb-deploy}"

[[ "$TARGET_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "RMB_DEPLOY_SHA must be a full lowercase commit SHA"
[[ "$APP_DIR" == /* && "$APP_DIR" != "/" ]] || fail "RMB_APP_DIR must be a narrow absolute path"
[[ "$SERVICE" =~ ^[A-Za-z0-9_.@-]+\.service$ ]] || fail "RMB_SERVICE is invalid"
[[ "$LOCAL_URL" =~ ^http://127\.0\.0\.1:[0-9]+/api/health$ ]] || fail "local health URL must be loopback /api/health"
[[ "$PUBLIC_URL" =~ ^https://[^/?#[:space:]@]+/api/health$ ]] || fail "public health URL must be an HTTPS /api/health URL"
[[ "$HEALTH_CHECK_ATTEMPTS" =~ ^[0-9]+$ ]] && (( HEALTH_CHECK_ATTEMPTS >= 1 && HEALTH_CHECK_ATTEMPTS <= 30 )) \
  || fail "RMB_HEALTH_CHECK_ATTEMPTS must be between 1 and 30"
[[ -d "$APP_DIR/.git" ]] || fail "application checkout not found: $APP_DIR"
[[ "$(id -un)" == "$EXPECTED_DEPLOY_USER" ]] \
  || fail "quick deployment must run as $EXPECTED_DEPLOY_USER"
for required in git node curl find flock mountpoint timeout python3; do command -v "$required" >/dev/null || fail "$required is required"; done
if [[ "${RMB_QUICK_DEPLOY_UNDER_TIMEOUT:-0}" != "1" ]]; then
  exec timeout --signal=TERM --kill-after=3m 22m \
    env RMB_QUICK_DEPLOY_UNDER_TIMEOUT=1 "$0" "$@"
fi
mkdir -p "$(dirname "$LOCK_FILE")" "$(dirname "$AUDIT_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || fail "another production deployment is already running"

cd "$APP_DIR"
CURRENT_REF="$(git symbolic-ref -q HEAD || true)"
[[ "$CURRENT_REF" == refs/heads/* ]] || fail "server checkout must be on a local branch"
SYSTEMCTL_BIN="$(command -v systemctl 2>/dev/null || true)"
[[ -n "$SYSTEMCTL_BIN" ]] || fail "systemctl is required"
RESTART_CMD=("$SYSTEMCTL_BIN")
if [[ "$(id -u)" != "0" ]]; then
  SUDO_BIN="$(command -v sudo 2>/dev/null || true)"
  [[ -n "$SUDO_BIN" ]] || fail "sudo is required for service restart"
  RESTART_CMD=("$SUDO_BIN" -n "$SYSTEMCTL_BIN")
  "$SUDO_BIN" -n -l "$SYSTEMCTL_BIN" restart "$SERVICE" >/dev/null 2>&1 \
    || fail "deployment user lacks passwordless permission to restart $SERVICE"
fi

build_sha() { tr -d '\r\n' < "$1/RMB_DEPLOY_SHA" 2>/dev/null || true; }

check_health() {
  local url="$1" expected="$2" label="$3" response
  for ((attempt = 1; attempt <= HEALTH_CHECK_ATTEMPTS; attempt += 1)); do
    if response="$(curl --fail --silent --show-error --max-time 5 "$url")" && \
      HEALTH_RESPONSE="$response" EXPECTED_SHA="$expected" node -e '
        const body = JSON.parse(process.env.HEALTH_RESPONSE || "{}");
        process.exit(body.status === "ok" && body.version === process.env.EXPECTED_SHA ? 0 : 1);
      '; then
      log "$label health check passed"
      return 0
    fi
    sleep 2
  done
  return 1
}

check_auth_route() {
  local url="$1" label="$2" status
  for ((attempt = 1; attempt <= HEALTH_CHECK_ATTEMPTS; attempt += 1)); do
    if status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 5 "$url")" \
      && [[ "$status" == "200" || "$status" == "401" ]]; then
      log "$label auth readiness check passed"
      return 0
    fi
    sleep 2
  done
  return 1
}

write_marker() {
  local sha="$1" tmp="$APP_DIR/.rmb-deployed-sha.tmp-$$"
  printf '%s\n' "$sha" > "$tmp" && mv "$tmp" "$APP_DIR/.rmb-deployed-sha"
}

write_state() {
  local phase="$1" tmp="$STATE_FILE.tmp-$$"
  printf '%s\t%s\t%s\t%s\n' "$phase" "$BASE_SHA" "$TARGET_SHA" "$CANDIDATE_DIR" > "$tmp"
  mv "$tmp" "$STATE_FILE"
}

exchange_builds() {
  python3 - "$1" "$2" <<'PY'
import ctypes, os, sys
left, right = map(os.fsencode, sys.argv[1:])
libc = ctypes.CDLL(None, use_errno=True)
renameat2 = getattr(libc, "renameat2", None)
if renameat2 is None:
    raise OSError("glibc renameat2 is unavailable")
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
if renameat2(-100, left, -100, right, 2) != 0:
    errno = ctypes.get_errno()
    raise OSError(errno, os.strerror(errno))
PY
}

restore_source_to() {
  local desired="$1" active
  active="$(git rev-parse --verify HEAD 2>/dev/null || true)"
  [[ "$active" =~ ^[a-f0-9]{40}$ ]] || return 1
  if [[ "$active" != "$desired" ]]; then
    git merge-base --is-ancestor "$desired" "$active" || return 1
    git update-ref "$CURRENT_REF" "$desired" "$active" || return 1
  fi
  (umask 022; git restore --source="$desired" --staged --worktree -- .)
}

remove_candidate() {
  local candidate="$1"
  [[ "$candidate" == "$APP_DIR"/.rmb-quick-build-* ]] || return 1
  [[ ! -L "$candidate/node_modules" ]] || rm -f -- "$candidate/node_modules"
  git worktree remove --force "$candidate" >/dev/null 2>&1 || true
  git worktree prune >/dev/null 2>&1 || true
}

normalize_build_permissions() {
  local build="$1" unreadable
  [[ "$build" == "$APP_DIR"/.rmb-quick-build-*/.next ]] || return 1
  [[ -d "$build" && ! -L "$build" ]] || return 1
  if mountpoint -q "$build"; then return 1; fi
  RMB_BUILD_ROOT="$build" RMB_CANDIDATE_ROOT="$CANDIDATE_DIR" node -e '
    const fs = require("node:fs"), path = require("node:path");
    const buildInput = path.resolve(process.env.RMB_BUILD_ROOT || "");
    const candidate = fs.realpathSync(process.env.RMB_CANDIDATE_ROOT || "");
    const stat = fs.lstatSync(buildInput);
    if (!stat.isDirectory() || stat.isSymbolicLink()) process.exit(1);
    if (fs.realpathSync(buildInput) !== path.join(candidate, ".next")) process.exit(1);
  ' || return 1
  chmod -R u=rwX,go=rX "$build" || return 1
  unreadable="$(find "$build" -xdev \
    \( -type d ! -perm -0005 -o -type f ! -perm -0004 \) \
    -print -quit)"
  [[ -z "$unreadable" ]]
}

manage_build_dependency_links() {
  local mode="$1" build="$2" future_build="$3" dependency_root="$4"
  [[ "$mode" == "rebase" || "$mode" == "validate" ]] || return 1
  [[ "$dependency_root" == "$APP_DIR/node_modules" ]] || return 1
  if [[ "$mode" == "rebase" ]]; then
    [[ "$build" == "$APP_DIR"/.rmb-quick-build-*/.next ]] || return 1
    [[ "$future_build" == "$APP_DIR/.next" ]] || return 1
  else
    [[ "$build" == "$APP_DIR/.next" && "$future_build" == "$APP_DIR/.next" ]] || return 1
  fi
  node - "$mode" "$build" "$future_build" "$dependency_root" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [mode, buildInput, futureBuildInput, dependencyInput] = process.argv.slice(2);
const buildAbsolute = path.resolve(buildInput);
const buildInputStat = fs.lstatSync(buildAbsolute);
if (!buildInputStat.isDirectory() || buildInputStat.isSymbolicLink()) {
  throw new Error("build root must be a real directory");
}
const buildRoot = fs.realpathSync(buildAbsolute);
const futureBuildRoot = fs.realpathSync(futureBuildInput);
const dependencyRoot = fs.realpathSync(dependencyInput);

function isStrictlyInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function collectLinks(directory, links = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const stat = fs.lstatSync(entryPath);
    if (stat.isSymbolicLink()) links.push(entryPath);
    else if (stat.isDirectory()) collectLinks(entryPath, links);
  }
  return links;
}

const links = collectLinks(buildRoot).sort();
const records = links.map((linkPath) => {
  const relativePath = path.relative(buildRoot, linkPath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`build link escaped its root: ${linkPath}`);
  }
  const resolvedTarget = fs.realpathSync(linkPath);
  if (!isStrictlyInside(dependencyRoot, resolvedTarget)) {
    throw new Error(`build link target is outside the approved dependency tree: ${relativePath}`);
  }
  const futureLink = path.join(futureBuildRoot, relativePath);
  const futureTarget = path.relative(path.dirname(futureLink), resolvedTarget) || ".";
  if (path.isAbsolute(futureTarget)) throw new Error(`cannot create a relative build link: ${relativePath}`);
  return { linkPath, relativePath, resolvedTarget, futureLink, futureTarget };
});

if (mode === "rebase") {
  records.forEach((record, index) => {
    const temporary = path.join(
      path.dirname(record.linkPath),
      `.${path.basename(record.linkPath)}.rmb-link-${process.pid}-${index}`,
    );
    try {
      fs.symlinkSync(record.futureTarget, temporary);
      fs.renameSync(temporary, record.linkPath);
    } finally {
      try { fs.unlinkSync(temporary); } catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
      }
    }
    const futureResolved = fs.realpathSync(path.resolve(path.dirname(record.futureLink), record.futureTarget));
    if (futureResolved !== record.resolvedTarget || !isStrictlyInside(dependencyRoot, futureResolved)) {
      throw new Error(`rebased build link does not resolve safely: ${record.relativePath}`);
    }
  });
} else if (mode === "validate") {
  for (const record of records) {
    const liveResolved = fs.realpathSync(record.linkPath);
    if (liveResolved !== record.resolvedTarget || !isStrictlyInside(dependencyRoot, liveResolved)) {
      throw new Error(`live build link does not resolve safely: ${record.relativePath}`);
    }
  }
} else {
  throw new Error(`unsupported build link mode: ${mode}`);
}
NODE
}

rebase_candidate_dependency_links() {
  manage_build_dependency_links rebase "$1" "$APP_DIR/.next" "$APP_DIR/node_modules"
}

validate_live_dependency_links() {
  manage_build_dependency_links validate "$APP_DIR/.next" "$APP_DIR/.next" "$APP_DIR/node_modules"
}

rollback_to() {
  local base="$1" target="$2" candidate="$3" live candidate_build
  live="$(build_sha "$APP_DIR/.next")"
  candidate_build="$(build_sha "$candidate/.next")"
  if [[ "$live" == "$target" ]]; then
    [[ "$candidate_build" == "$base" ]] || return 1
    exchange_builds "$APP_DIR/.next" "$candidate/.next" || return 1
  elif [[ "$live" != "$base" ]]; then
    return 1
  fi
  restore_source_to "$base" || return 1
  write_marker "$base" || return 1
  validate_live_dependency_links || return 1
  "${RESTART_CMD[@]}" restart "$SERVICE" || return 1
  "$SYSTEMCTL_BIN" is-active --quiet "$SERVICE" || return 1
  check_health "$LOCAL_URL" "$base" "rollback" || return 1
  rm -f -- "$STATE_FILE"
  remove_candidate "$candidate"
  ROLLED_BACK=true
}

recover_pending() {
  [[ -f "$STATE_FILE" ]] || return 0
  local phase base target candidate extra deployed live head
  IFS=$'\t' read -r phase base target candidate extra < "$STATE_FILE" || fail "cannot read pending deployment state"
  [[ -z "${extra:-}" && "$phase" =~ ^(PREPARED|EXCHANGED|RESTARTED|SOURCE_SWITCHED)$ ]] \
    || fail "pending deployment state is invalid"
  [[ "$base" =~ ^[a-f0-9]{40}$ && "$target" =~ ^[a-f0-9]{40}$ ]] || fail "pending deployment SHA is invalid"
  [[ "$candidate" == "$APP_DIR"/.rmb-quick-build-* ]] || fail "pending candidate path is invalid"
  deployed="$(tr -d '\r\n' < "$APP_DIR/.rmb-deployed-sha" 2>/dev/null || true)"
  live="$(build_sha "$APP_DIR/.next")"
  head="$(git rev-parse --verify HEAD 2>/dev/null || true)"
  if [[ "$deployed" == "$target" && "$live" == "$target" && "$head" == "$target" ]]; then
    log "finalizing a previously completed quick deployment"
    rm -f -- "$STATE_FILE"
    remove_candidate "$candidate"
    return 0
  fi
  [[ "$deployed" == "$base" ]] || fail "pending deployment marker needs manual recovery"
  log "recovering interrupted quick deployment to $base"
  rollback_to "$base" "$target" "$candidate" || fail "automatic recovery needs manual attention: $candidate"
}

recover_pending
CURRENT_HEAD="$(git rev-parse --verify HEAD 2>/dev/null || true)"
[[ "$CURRENT_HEAD" =~ ^[a-f0-9]{40}$ ]] || fail "server checkout has no readable HEAD"
git diff --quiet || fail "server checkout has unstaged tracked changes"
git diff --cached --quiet || fail "server checkout has staged changes"
[[ -d node_modules && ! -L node_modules && -x node_modules/.bin/prisma && -x node_modules/.bin/next ]] \
  || fail "build dependencies are missing; use the full deployment channel"
[[ -f .next/BUILD_ID ]] || fail "current production build is missing"
[[ ! -L .next ]] || fail "current production build must not be a symlink"
if mountpoint -q .next; then fail "current production build must not be a mount point"; fi
validate_live_dependency_links \
  || fail "current production build contains a missing or unsafe dependency link"
[[ -w "$APP_DIR" && -x "$APP_DIR" && -w "$APP_DIR/.git" && -x "$APP_DIR/.git" ]] \
  || fail "application checkout is not writable by $EXPECTED_DEPLOY_USER"
LIVE_BUILD_OWNER_ISSUE="$(find .next -xdev ! -user "$EXPECTED_DEPLOY_USER" -print -quit)"
[[ -z "$LIVE_BUILD_OWNER_ISSUE" ]] \
  || fail "current production build is not owned by $EXPECTED_DEPLOY_USER; repair its ownership before quick deployment"
LIVE_BUILD_MODE_ISSUE="$(find .next -xdev -type d ! -perm -u+w -print -quit)"
[[ -z "$LIVE_BUILD_MODE_ISSUE" ]] \
  || fail "current production build contains a directory that $EXPECTED_DEPLOY_USER cannot manage"
BASE_SHA="$(tr -d '\r\n' < .rmb-deployed-sha 2>/dev/null || true)"
BUILD_SHA="$(build_sha "$APP_DIR/.next")"
[[ "$BASE_SHA" =~ ^[a-f0-9]{40}$ ]] || fail "deployed SHA marker is missing; use the full deployment channel"
[[ "$CURRENT_HEAD" == "$BASE_SHA" && "$BUILD_SHA" == "$BASE_SHA" ]] \
  || fail "source, build and deployed markers disagree; use the full deployment channel"

log "fetching current main from the configured read-only origin"
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=yes"
ORIGIN_URL="$(git remote get-url --all origin 2>/dev/null || true)"
[[ -n "$ORIGIN_URL" && "$ORIGIN_URL" != *$'\n'* && "$ORIGIN_URL" != *$'\r'* ]] \
  || fail "origin must have exactly one approved fetch URL"
case "$ORIGIN_URL" in
  git@github.com:zhujitv/RMB.git|ssh://git@github.com/zhujitv/RMB.git|ssh://git@ssh.github.com:443/zhujitv/RMB.git|https://github.com/zhujitv/RMB.git|https://github.com/zhujitv/RMB) ;;
  *) fail "origin must be the approved zhujitv/RMB repository" ;;
esac
fetch_failure_is_retryable() {
  local status="$1" output="$2"
  (( status == 124 )) && return 0
  grep -Eiq \
    'Empty reply from server|Could not resolve (host|hostname)|Connection timed out|Operation timed out|Failed to connect|Connection reset by peer|remote end hung up unexpectedly|early EOF|HTTP[^0-9]*(408|429|5[0-9]{2})|The requested URL returned error: (408|429|5[0-9]{2})|TLS connection was non-properly terminated' \
    <<< "$output"
}
fetch_origin_main() {
  local attempt status output delay
  for attempt in {1..3}; do
    if output="$(timeout --signal=TERM --kill-after=10s 90s \
      git fetch --no-tags --force "$ORIGIN_URL" main:refs/remotes/origin/main 2>&1)"; then
      [[ -z "$output" ]] || printf '%s\n' "$output"
      return 0
    else
      status=$?
    fi
    [[ -z "$output" ]] || printf '%s\n' "$output" >&2
    fetch_failure_is_retryable "$status" "$output" \
      || fail "cannot refresh origin/main: non-transient fetch failure on attempt $attempt/3 (exit $status)"
    if (( attempt == 3 )); then
      fail "cannot refresh origin/main after 3 transient network attempts (last exit $status)"
    fi
    if (( attempt == 1 )); then delay=5; else delay=15; fi
    log "origin/main fetch attempt $attempt/3 failed with a transient network error; retrying in ${delay}s"
    sleep "$delay"
  done
}
fetch_origin_main
[[ "$(git rev-parse refs/remotes/origin/main)" == "$TARGET_SHA" ]] || fail "quick deployment only accepts the latest main HEAD"
git cat-file -e "$TARGET_SHA^{commit}" 2>/dev/null || fail "current main target is unavailable after fetch"
git merge-base --is-ancestor "$BASE_SHA" "$TARGET_SHA" || fail "target is not a fast-forward from the online SHA"
if [[ "$BASE_SHA" == "$TARGET_SHA" ]]; then log "CVM already runs the current main SHA; nothing to deploy"; exit 0; fi

CHANGED_FILES="$(mktemp "$APP_DIR/.rmb-quick-files.XXXXXX")"
BOOTSTRAP_MODE=0
if ! git cat-file -e "$BASE_SHA:scripts/deploy-cvm-quick.sh" 2>/dev/null \
  && ! git cat-file -e "$BASE_SHA:.github/workflows/deploy-cvm-quick.yml" 2>/dev/null \
  && git cat-file -e "$TARGET_SHA:scripts/deploy-cvm-quick.sh" 2>/dev/null \
  && git cat-file -e "$TARGET_SHA:.github/workflows/deploy-cvm-quick.yml" 2>/dev/null; then
  BOOTSTRAP_MODE=1
fi
is_blocked_path() {
  local path="$1" status="$2" lower="${1,,}"
  if [[ "$path" == ".github/workflows/deploy-cvm-quick.yml" || "$path" == "scripts/deploy-cvm-quick.sh" ]]; then
    [[ "$BOOTSTRAP_MODE" == "1" && "$status" == "A" ]] && return 1
    return 0
  fi
  if [[ "$path" == "scripts/deploy-cvm-from-bundle.sh" && "$BOOTSTRAP_MODE" == "1" && "$status" == "M" ]]; then
    return 1
  fi
  case "$lower" in
    docs/*|tests/*) return 1 ;;
    public/*|data/*) return 0 ;;
    .github/*|.circleci/*|.gitlab-ci*|scripts/*|prisma/*|*/migrations/*|migrations/*|prisma.config.*) return 0 ;;
    package*.json|*/package*.json|package-lock.json|*/package-lock.json|npm-shrinkwrap.json|*/npm-shrinkwrap.json) return 0 ;;
    yarn.lock|*/yarn.lock|pnpm-lock.yaml|*/pnpm-lock.yaml|bun.lock|bun.lockb|*/bun.lock|*/bun.lockb) return 0 ;;
    .env|.env.*|*/.env|*/.env.*|*.env|*/*.env|config/*) return 0 ;;
    next.config.*|next-env.d.ts|tsconfig*.json|postcss.config.*|tailwind.config.*|eslint.config.*) return 0 ;;
    proxy.ts|middleware.ts|instrumentation.ts|instrumentation-client.ts|dockerfile*|docker-compose*|compose*.yml|compose*.yaml) return 0 ;;
    *.service|*.timer|nginx/*|.gitmodules|app/api/health/route.ts|app/api/auth/*|app/api/auth/**|app/api/cron/*|app/api/cron/**) return 0 ;;
    lib/auth*|lib/*auth*|lib/*security*|lib/prisma.ts|lib/platform-db.ts) return 0 ;;
  esac
  return 1
}

changed_count=0
while IFS= read -r -d '' status && IFS= read -r -d '' path; do
  changed_count=$((changed_count + 1))
  [[ "$status" =~ ^(A|M|D)$ ]] || fail "change type $status requires the full deployment channel: $path"
  [[ "$path" != *$'\n'* && "$path" != *$'\r'* && "$path" != *$'\t'* ]] \
    || fail "control characters in changed paths require the full deployment channel"
  is_blocked_path "$path" "$status" && fail "protected path changed; use the full deployment channel: $path"
  for tree_ref in "$BASE_SHA" "$TARGET_SHA"; do
    tree_mode="$(git ls-tree "$tree_ref" -- "$path" | awk 'NR == 1 { print $1 }')"
    [[ "$tree_mode" != "120000" && "$tree_mode" != "160000" ]] \
      || fail "symlink or gitlink changes require the full deployment channel: $path"
  done
  printf '%s\n' "$path" >> "$CHANGED_FILES"
done < <(git diff --no-renames --name-status -z "$BASE_SHA" "$TARGET_SHA")
(( changed_count > 0 && changed_count <= 60 )) || fail "quick deployment requires 1 to 60 changed files"
if (( BOOTSTRAP_MODE == 1 )); then
  bootstrap_base_script="$(git show "$BASE_SHA:scripts/deploy-cvm-from-bundle.sh")"
  bootstrap_full_script="$(git show "$TARGET_SHA:scripts/deploy-cvm-from-bundle.sh")"
  RMB_BOOTSTRAP_BASE_SCRIPT="$bootstrap_base_script" RMB_BOOTSTRAP_FULL_SCRIPT="$bootstrap_full_script" node <<'NODE' \
    || fail "full deployment lock bootstrap differs from the approved patch"
const base = process.env.RMB_BOOTSTRAP_BASE_SCRIPT || "";
const target = process.env.RMB_BOOTSTRAP_FULL_SCRIPT || "";
function replaceOnce(source, anchor, replacement) {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) process.exit(1);
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}
let expected = base;
expected = replaceOnce(
  expected,
  'ROLLBACK_HEALTH_URL="${RMB_ROLLBACK_HEALTH_URL:-http://127.0.0.1:3000/}"\nHEALTH_ATTEMPTS="${RMB_HEALTH_ATTEMPTS:-20}"',
  'ROLLBACK_HEALTH_URL="${RMB_ROLLBACK_HEALTH_URL:-http://127.0.0.1:3000/}"\nLOCK_FILE="$APP_DIR/.rmb-production-deploy.lock"\nHEALTH_ATTEMPTS="${RMB_HEALTH_ATTEMPTS:-20}"',
);
expected = replaceOnce(
  expected,
  '  || fail "full deployment must run as $EXPECTED_DEPLOY_USER; use the protected GitHub deployment channel instead of a root desktop session"\nSYSTEMCTL_BIN="$(command -v systemctl 2>/dev/null || true)"',
  '  || fail "full deployment must run as $EXPECTED_DEPLOY_USER; use the protected GitHub deployment channel instead of a root desktop session"\ncommand -v flock >/dev/null || fail "flock is required"\nSYSTEMCTL_BIN="$(command -v systemctl 2>/dev/null || true)"',
);
expected = replaceOnce(
  expected,
  'cd "$APP_DIR"\nensure_checkout_writable\n\nCURRENT_HEAD="$(git rev-parse --verify HEAD 2>/dev/null || true)"',
  'cd "$APP_DIR"\nensure_checkout_writable\nmkdir -p "$(dirname "$LOCK_FILE")"\nexec 9>"$LOCK_FILE"\nflock -n 9 || fail "another production deployment is already running"\n\nCURRENT_HEAD="$(git rev-parse --verify HEAD 2>/dev/null || true)"',
);
if (target !== expected) process.exit(1);
NODE
fi
line_churn=0
while IFS=$'\t' read -r -d '' added deleted path; do
  [[ "$added" != "-" && "$deleted" != "-" ]] || fail "binary changes require the full deployment channel: $path"
  line_churn=$((line_churn + added + deleted))
done < <(git diff --no-renames --numstat -z "$BASE_SHA" "$TARGET_SHA")
(( line_churn <= 5000 )) || fail "more than 5000 changed lines; use the full deployment channel"
git diff --check "$BASE_SHA" "$TARGET_SHA" || fail "target contains whitespace errors"
node - "$BASE_SHA" "$TARGET_SHA" <<'NODE' || fail "new runtime environment variables require the full deployment channel"
const { execFileSync } = require("node:child_process");
const [base, target] = process.argv.slice(2);
function names(ref) {
  let source = "";
  try { source = execFileSync("git", ["grep", "-h", "-E", "process\\.env", ref, "--", "app", "lib"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }); }
  catch (error) { if (error && error.status !== 1) throw error; }
  const result = new Set(), pattern = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g;
  for (const match of source.matchAll(pattern)) result.add(match[1] || match[2]);
  return result;
}
const before = names(base);
const added = [...names(target)].filter((name) => !before.has(name)).sort();
if (added.length) { console.error(`New runtime environment variable names: ${added.join(", ")}`); process.exit(1); }
NODE

audit_event() {
  local status="$1" message="$2"
  RMB_AUDIT_STATUS="$status" RMB_AUDIT_MESSAGE="$message" RMB_AUDIT_BASE="$BASE_SHA" RMB_AUDIT_TARGET="$TARGET_SHA" \
  RMB_AUDIT_ACTOR="$ACTOR" RMB_AUDIT_RUN_URL="$RUN_URL" RMB_AUDIT_FILES="$CHANGED_FILES" \
  RMB_AUDIT_ROLLED_BACK="$ROLLED_BACK" RMB_AUDIT_FILE="$AUDIT_FILE" node <<'NODE'
const fs = require("node:fs");
const files = fs.readFileSync(process.env.RMB_AUDIT_FILES, "utf8").split("\n").filter(Boolean);
const record = { timestamp: new Date().toISOString(), status: process.env.RMB_AUDIT_STATUS,
  baseSha: process.env.RMB_AUDIT_BASE, targetSha: process.env.RMB_AUDIT_TARGET,
  actor: process.env.RMB_AUDIT_ACTOR, runUrl: process.env.RMB_AUDIT_RUN_URL,
  changedFiles: files, rolledBack: process.env.RMB_AUDIT_ROLLED_BACK === "true",
  node: process.version, message: process.env.RMB_AUDIT_MESSAGE };
fs.appendFileSync(process.env.RMB_AUDIT_FILE, `${JSON.stringify(record)}\n`, { mode: 0o600 });
NODE
}

cleanup() {
  if [[ -n "$CANDIDATE_DIR" && ! -f "$STATE_FILE" ]]; then remove_candidate "$CANDIDATE_DIR" || true; fi
  [[ -z "$CHANGED_FILES" ]] || rm -f -- "$CHANGED_FILES"
}
on_exit() {
  local status=$?
  trap - EXIT ERR HUP INT TERM
  if (( status != 0 )) && [[ -f "$STATE_FILE" ]]; then
    if ! rollback_to "$BASE_SHA" "$TARGET_SHA" "$CANDIDATE_DIR"; then
      LAST_ERROR="$LAST_ERROR; automatic rollback needs manual attention: $CANDIDATE_DIR"
    fi
  fi
  if (( status != 0 && AUDIT_READY == 1 )); then audit_event "FAILED" "$LAST_ERROR" || true; fi
  cleanup
  exit "$status"
}
trap '[[ "$LAST_ERROR" != "unexpected deployment failure" ]] || LAST_ERROR="command failed at line $LINENO"' ERR
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

SERVICE_ENV_FILES="$("$SYSTEMCTL_BIN" show "$SERVICE" --property=EnvironmentFiles --value 2>/dev/null || true)"
printf '%s\n' "$SERVICE_ENV_FILES" | tr ' {};=' '\n' | sed 's/^-//' | grep -Fqx -- "$EXPECTED_ENV_FILE" \
  || fail "systemd does not reference the expected protected environment file"
[[ "$("$SYSTEMCTL_BIN" show "$SERVICE" --property=WorkingDirectory --value)" == "$APP_DIR" ]] \
  || fail "systemd WorkingDirectory does not match the application checkout"
"$SYSTEMCTL_BIN" is-active --quiet "$SERVICE" || fail "service must be active before deployment"

probe_left="$(mktemp -d "$APP_DIR/.rmb-exchange-left.XXXXXX")"
probe_right="$(mktemp -d "$APP_DIR/.rmb-exchange-right.XXXXXX")"
if ! exchange_builds "$probe_left" "$probe_right"; then
  rmdir "$probe_left" "$probe_right" 2>/dev/null || true
  fail "atomic directory exchange is unavailable; use the full deployment channel"
fi
rmdir "$probe_left" "$probe_right"

[[ -r "$MEMINFO_FILE" && -r "$LOADAVG_FILE" ]] || fail "Linux resource telemetry is unavailable; use the full deployment channel"
available_mb="$(awk '/^MemAvailable:/ { printf "%d", $2 / 1024 }' "$MEMINFO_FILE")"
free_disk_mb="$(df -Pm "$APP_DIR" | awk 'END { print $4 }')"
current_build_mb="$(du -sm "$APP_DIR/.next" | awk '{ print $1 }')"
required_disk_mb=$(( current_build_mb * 4 )); (( required_disk_mb >= 2048 )) || required_disk_mb=2048
[[ "$available_mb" =~ ^[0-9]+$ && "$free_disk_mb" =~ ^[0-9]+$ ]] || fail "cannot read server resource availability"
(( available_mb >= MIN_AVAILABLE_MB )) \
  || fail "less than $MIN_AVAILABLE_MB MiB memory is available; use the full deployment channel"
(( free_disk_mb >= required_disk_mb )) || fail "insufficient disk for isolated build and rollback; use the full deployment channel"
cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || printf '1')"
load_one="$(awk '{ print $1 }' "$LOADAVG_FILE")"
CPU_COUNT="$cpu_count" LOAD_ONE="$load_one" node -e '
  const cpu = Number(process.env.CPU_COUNT), load = Number(process.env.LOAD_ONE);
  if (!Number.isFinite(cpu) || !Number.isFinite(load) || load > Math.max(2, cpu * 2)) process.exit(1);
' || fail "server load is too high for a safe local build"

audit_event "STARTED" "quick deployment accepted: $changed_count files, $line_churn changed lines"
AUDIT_READY=1
CANDIDATE_DIR="$APP_DIR/.rmb-quick-build-${TARGET_SHA:0:12}-$$"
(umask 022; git worktree add --detach "$CANDIDATE_DIR" "$TARGET_SHA")
ln -s "$APP_DIR/node_modules" "$CANDIDATE_DIR/node_modules"
public_origin="${PUBLIC_URL%/api/health}"
BUILD_PREFIX=(nice -n 10)
command -v ionice >/dev/null 2>&1 && BUILD_PREFIX=(ionice -c 3 nice -n 10)
(
  umask 022
  cd "$CANDIDATE_DIR"
  build_env=(env RMB_SKIP_LOCAL_ENV_FILES=1 NEXT_TELEMETRY_DISABLED=1 SECURITY_BUILD_MODE=preview \
    CIRCLE_NODE_TOTAL=1 NODE_OPTIONS="--max-old-space-size=$BUILD_HEAP_MB" \
    DATABASE_URL=postgresql://127.0.0.1:5432/rmb_quick_build_only \
    APP_URL="$public_origin" NEXT_PUBLIC_APP_URL="$public_origin")
  "${BUILD_PREFIX[@]}" "${build_env[@]}" node scripts/security-env-check.mjs
  "${BUILD_PREFIX[@]}" "${build_env[@]}" ./node_modules/.bin/prisma generate
  "${BUILD_PREFIX[@]}" "${build_env[@]}" ./node_modules/.bin/next build
  printf '%s\n' "$TARGET_SHA" > .next/RMB_DEPLOY_SHA
)
[[ -f "$CANDIDATE_DIR/.next/BUILD_ID" ]] || fail "candidate build has no BUILD_ID"
normalize_build_permissions "$CANDIDATE_DIR/.next" \
  || fail "candidate build is not readable by the application service"
rebase_candidate_dependency_links "$CANDIDATE_DIR/.next" \
  || fail "candidate build dependency links cannot be safely relocated"
rm -f -- "$CANDIDATE_DIR/node_modules"
write_state PREPARED
exchange_builds "$APP_DIR/.next" "$CANDIDATE_DIR/.next"
write_state EXCHANGED
validate_live_dependency_links \
  || fail "activated build contains a missing or unsafe dependency link"
"${RESTART_CMD[@]}" restart "$SERVICE"
"$SYSTEMCTL_BIN" is-active --quiet "$SERVICE" || fail "service is not active after restart"
write_state RESTARTED
check_health "$LOCAL_URL" "$TARGET_SHA" "local" || fail "local health check failed"
check_auth_route "${LOCAL_URL%/api/health}/api/auth/me?basic=1" "local" || fail "local auth readiness check failed"
check_health "$PUBLIC_URL" "$TARGET_SHA" "public" || fail "public health check failed"
check_auth_route "${PUBLIC_URL%/api/health}/api/auth/me?basic=1" "public" || fail "public auth readiness check failed"
(umask 022; git merge --ff-only "$TARGET_SHA")
[[ "$(git rev-parse HEAD)" == "$TARGET_SHA" ]] || fail "source switch did not reach target SHA"
write_state SOURCE_SWITCHED
write_marker "$TARGET_SHA" || fail "could not record the deployed SHA"
rm -f -- "$STATE_FILE"
audit_event "SUCCESS" "quick deployment completed" || log "warning: success audit could not be written"
LAST_ERROR=""
log "deployment complete: $TARGET_SHA"
