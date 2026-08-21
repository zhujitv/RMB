#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[rmb-db-backup-install] %s\n' "$*"
}

fail() {
  printf '[rmb-db-backup-install] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" == "0" ]] || fail "run as root on the CVM server"

BACKUP_USER="${RMB_DB_BACKUP_USER:-rmb-deploy}"
BACKUP_GROUP="${RMB_DB_BACKUP_GROUP:-$BACKUP_USER}"
ENV_FILE="${RMB_ENV_FILE:-/srv/rmb/shared/app.env}"
BACKUP_DIR="${RMB_DB_BACKUP_DIR:-/srv/rmb/shared/db-backups}"
RETENTION_DAYS="${RMB_DB_BACKUP_RETENTION_DAYS:-15}"
BACKUP_SCRIPT="${RMB_DB_BACKUP_SCRIPT:-/usr/local/sbin/rmb-db-backup.sh}"
SERVICE_FILE="/etc/systemd/system/rmb-db-backup.service"
TIMER_FILE="/etc/systemd/system/rmb-db-backup.timer"

[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || RETENTION_DAYS=15
id "$BACKUP_USER" >/dev/null 2>&1 || fail "backup user does not exist: $BACKUP_USER"
getent group "$BACKUP_GROUP" >/dev/null 2>&1 || fail "backup group does not exist: $BACKUP_GROUP"
[[ -f "$ENV_FILE" ]] || fail "environment file not found: $ENV_FILE"

install -d -m 700 -o "$BACKUP_USER" -g "$BACKUP_GROUP" "$BACKUP_DIR"

cat > "$BACKUP_SCRIPT" <<'BACKUP_SCRIPT_EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BACKUP_DIR="${RMB_DB_BACKUP_DIR:-/srv/rmb/shared/db-backups}"
RETENTION_DAYS="${RMB_DB_BACKUP_RETENTION_DAYS:-15}"
PG_DUMP_BIN="$(command -v pg_dump)"

for candidate in /usr/pgsql-18/bin/pg_dump /usr/lib/postgresql/18/bin/pg_dump /usr/pgsql-17/bin/pg_dump /usr/lib/postgresql/17/bin/pg_dump /usr/pgsql-16/bin/pg_dump /usr/lib/postgresql/16/bin/pg_dump /usr/pgsql-15/bin/pg_dump /usr/lib/postgresql/15/bin/pg_dump; do
  if [[ -x "$candidate" ]]; then
    PG_DUMP_BIN="$candidate"
    break
  fi
done

if [[ ! "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  RETENTION_DAYS=15
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[rmb-db-backup] DATABASE_URL is missing" >&2
  exit 1
fi

eval "$(python3 - <<'PYURL'
import os
import shlex
from urllib.parse import parse_qsl, unquote, urlsplit

url = os.environ["DATABASE_URL"]
parts = urlsplit(url)
params = dict(parse_qsl(parts.query, keep_blank_values=True))
values = {
    "PGHOST": parts.hostname or "127.0.0.1",
    "PGPORT": str(parts.port or 5432),
    "PGUSER": unquote(parts.username or ""),
    "PGPASSWORD": unquote(parts.password or ""),
    "PGDATABASE": unquote(parts.path.lstrip("/")),
}
if "sslmode" in params:
    values["PGSSLMODE"] = params["sslmode"]

for key, value in values.items():
    print(f"export {key}={shlex.quote(value)}")
PYURL
)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$BACKUP_DIR/rmb-db-$timestamp.dump"
tmp="$output.tmp"

cleanup() {
  rm -f "$tmp"
}
trap cleanup EXIT

"$PG_DUMP_BIN" --format=custom --no-owner --no-privileges --file="$tmp"
chmod 600 "$tmp"
mv "$tmp" "$output"
trap - EXIT

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'rmb-db-20??????T??????Z.dump' -o -name '*-20??????T??????Z.dump' \) \
  -mtime +"$RETENTION_DAYS" -print -delete | sed 's#^#[rmb-db-backup] pruned #'

echo "[rmb-db-backup] created $output using $PG_DUMP_BIN"
BACKUP_SCRIPT_EOF

chmod 755 "$BACKUP_SCRIPT"

cat > "$SERVICE_FILE" <<SERVICE_EOF
[Unit]
Description=RMB PostgreSQL logical database backup
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=$BACKUP_USER
Group=$BACKUP_GROUP
EnvironmentFile=$ENV_FILE
Environment=RMB_DB_BACKUP_DIR=$BACKUP_DIR
Environment=RMB_DB_BACKUP_RETENTION_DAYS=$RETENTION_DAYS
ExecStart=$BACKUP_SCRIPT
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$BACKUP_DIR
SERVICE_EOF

cat > "$TIMER_FILE" <<'TIMER_EOF'
[Unit]
Description=Run RMB database backup daily

[Timer]
OnCalendar=*-*-* 03:20:00
RandomizedDelaySec=20m
Persistent=true
Unit=rmb-db-backup.service

[Install]
WantedBy=timers.target
TIMER_EOF

chmod 644 "$SERVICE_FILE" "$TIMER_FILE"
systemctl daemon-reload
systemctl enable --now rmb-db-backup.timer

if [[ "${RMB_RUN_BACKUP_NOW:-true}" == "true" ]]; then
  systemctl start rmb-db-backup.service
fi

log "backup directory ready: $(stat -c '%A %U:%G %n' "$BACKUP_DIR")"
log "timer enabled: $(systemctl is-enabled rmb-db-backup.timer)"
log "timer active: $(systemctl is-active rmb-db-backup.timer)"
systemctl list-timers rmb-db-backup.timer --no-pager
