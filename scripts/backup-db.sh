#!/usr/bin/env bash
# ============================================================================
# QuanLY — backup DB hằng ngày (chạy trên host coolify qua systemd timer).
#   pg_dump (read-only, KHÔNG đụng app đang chạy) → gzip → giữ GFS local
#   + (tuỳ chọn) đẩy OFF-HOST lên NAS qua docker smbclient.
#   Alert Telegram khi LỖI. Dump rỗng/quá nhỏ cũng coi là lỗi.
#
# Cấu hình qua /etc/quanly-backup.env (KHÔNG hardcode secret):
#   BACKUP_DIR (mặc định /opt/quanly-backups)  KEEP_DAILY (14)  PG_CONTAINER (quanly-postgres)
#   TELEGRAM_BOT_TOKEN, TELEGRAM_ALERT_CHAT     (alert — tuỳ chọn)
#   NAS_SHARE (vd //192.168.1.100/QuanlyBackup), NAS_USER, NAS_PASS, NAS_SUBDIR  (off-host — tuỳ chọn)
# ============================================================================
set -uo pipefail
[ -f /etc/quanly-backup.env ] && set -a && . /etc/quanly-backup.env && set +a

BACKUP_DIR="${BACKUP_DIR:-/opt/quanly-backups}"
KEEP_DAILY="${KEEP_DAILY:-14}"
PG_CONTAINER="${PG_CONTAINER:-quanly-postgres}"
TS="$(date +%F-%H%M%S)"
FILE="$BACKUP_DIR/quanly-$TS.sql.gz"

alert() { # gửi Telegram nếu có cấu hình; không bao giờ làm script fail vì alert
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_ALERT_CHAT:-}" ]; then
    curl -sf --max-time 15 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TELEGRAM_ALERT_CHAT}" -d text="🔴 QuanLY BACKUP LỖI: $1" >/dev/null 2>&1 || true
  fi
  echo "ERROR: $1" >&2
}

mkdir -p "$BACKUP_DIR"
PGUSER="$(docker exec "$PG_CONTAINER" printenv POSTGRES_USER 2>/dev/null)" || { alert "không đọc được POSTGRES_USER ($PG_CONTAINER)"; exit 1; }
PGDB="$(docker exec "$PG_CONTAINER" printenv POSTGRES_DB 2>/dev/null)"

# 1) Dump — pipefail bắt lỗi pg_dump kể cả khi gzip exit 0
if ! docker exec "$PG_CONTAINER" pg_dump -U "$PGUSER" -d "$PGDB" --no-owner --clean --if-exists | gzip > "$FILE"; then
  alert "pg_dump thất bại lúc $TS"; rm -f "$FILE"; exit 1
fi
SZ="$(stat -c%s "$FILE" 2>/dev/null || echo 0)"
if [ "$SZ" -lt 1000 ]; then alert "dump quá nhỏ ($SZ bytes) — nghi hỏng: $FILE"; exit 1; fi

# 2) Off-host → NAS (tuỳ chọn). Dùng docker smbclient để KHÔNG cần cài gì lên host.
if [ -n "${NAS_SHARE:-}" ] && [ -n "${NAS_USER:-}" ]; then
  if ! docker run --rm -v "$BACKUP_DIR":/data:ro alpine sh -c \
      "apk add --no-cache samba-client >/dev/null 2>&1 && smbclient '${NAS_SHARE}' -U '${NAS_USER}%${NAS_PASS:-}' -m SMB2 -c 'cd ${NAS_SUBDIR:-.}; put /data/$(basename "$FILE") $(basename "$FILE")'"; then
    alert "đẩy NAS thất bại ($FILE) — bản local vẫn giữ"
  fi
fi

# 3) GFS retention local — giữ KEEP_DAILY bản mới nhất, xoá cũ hơn
ls -1t "$BACKUP_DIR"/quanly-*.sql.gz 2>/dev/null | tail -n +"$((KEEP_DAILY+1))" | xargs -r rm -f

echo "✓ backup OK: $FILE ($(du -h "$FILE" | cut -f1)) — giữ $KEEP_DAILY bản local"
