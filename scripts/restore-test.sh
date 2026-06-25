#!/usr/bin/env bash
# ============================================================================
# QuanLY — restore-test (chạy hằng tuần qua systemd timer).
#   Nạp dump MỚI NHẤT vào DB TẠM (quanly_restore_test) → đếm User/Quote → DROP.
#   Chứng minh backup THỰC SỰ khôi phục được. Alert Telegram nếu thất bại.
#   KHÔNG đụng DB thật (chỉ tạo/xoá DB tạm riêng).
# ============================================================================
set -uo pipefail
[ -f /etc/quanly-backup.env ] && set -a && . /etc/quanly-backup.env && set +a
BACKUP_DIR="${BACKUP_DIR:-/opt/quanly-backups}"
PG_CONTAINER="${PG_CONTAINER:-quanly-postgres}"
TESTDB="quanly_restore_test"

alert() {
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_ALERT_CHAT:-}" ]; then
    curl -sf --max-time 15 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TELEGRAM_ALERT_CHAT}" -d text="🔴 QuanLY RESTORE-TEST LỖI: $1" >/dev/null 2>&1 || true
  fi
  echo "ERROR: $1" >&2
}

LATEST="$(ls -1t "$BACKUP_DIR"/quanly-*.sql.gz 2>/dev/null | head -1)"
[ -z "$LATEST" ] && { alert "không có file backup nào trong $BACKUP_DIR"; exit 1; }
PGUSER="$(docker exec "$PG_CONTAINER" printenv POSTGRES_USER 2>/dev/null)" || { alert "không đọc được POSTGRES_USER"; exit 1; }

cleanup() { docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS $TESTDB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS $TESTDB;" >/dev/null 2>&1
docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d postgres -c "CREATE DATABASE $TESTDB;" >/dev/null 2>&1 || { alert "không tạo được DB tạm"; exit 1; }

if ! gunzip -c "$LATEST" | docker exec -i "$PG_CONTAINER" psql -U "$PGUSER" -d "$TESTDB" -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
  alert "nạp dump $LATEST vào DB tạm THẤT BẠI"; exit 1
fi

USERS="$(docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d "$TESTDB" -tAc 'SELECT count(*) FROM "User";' 2>/dev/null || echo 0)"
QUOTES="$(docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d "$TESTDB" -tAc 'SELECT count(*) FROM "Quote";' 2>/dev/null || echo 0)"
if [ "${USERS:-0}" -lt 1 ]; then alert "restore xong nhưng 0 user (dump nghi hỏng): $LATEST"; exit 1; fi

echo "✓ restore-test OK: $(basename "$LATEST") → $USERS users, $QUOTES quotes (DB tạm đã dọn)"
