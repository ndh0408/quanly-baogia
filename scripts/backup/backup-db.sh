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
# Bản dump chứa CCCD / số tài khoản / lương ở dạng THÔ. umask kế thừa của systemd là 0022 →
# mọi file sinh ra ở đây là 0644, tức bất kỳ tài khoản nào trên host cũng đọc được toàn bộ hồ sơ
# nhân sự. Đặt umask ở ĐẦU script để bao luôn cả file tạm, checksum và dấu vết watchdog.
umask 077
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

# 0) Chỗ trống đĩa. Backup mà làm đầy đĩa thì kéo sập chính Postgres đang chạy cùng host — sự cố
#    lớn hơn nhiều so với việc bỏ một lượt backup. Cần gấp đôi cỡ bản dump gần nhất, tối thiểu 500MB.
LAST_SZ_MB="$(ls -1t "$BACKUP_DIR"/quanly-*.sql.gz 2>/dev/null | head -1 | xargs -r stat -c%s 2>/dev/null | awk '{print int($1/1048576)}')"
NEED_MB=$(( ${LAST_SZ_MB:-0} * 2 )); [ "$NEED_MB" -lt 500 ] && NEED_MB=500
AVAIL_MB="$(df -Pm "$BACKUP_DIR" | awk 'NR==2{print $4}')"
if [ "${AVAIL_MB:-0}" -lt "$NEED_MB" ]; then
  alert "đĩa chứa backup còn ${AVAIL_MB}MB, cần ~${NEED_MB}MB — dừng trước khi làm đầy đĩa"; exit 1
fi

# 1) Dump ra file TẠM rồi mới đổi tên.
#    Ghi thẳng vào tên cuối cùng là sai: tiến trình bị giết / host mất điện giữa chừng để lại một
#    .sql.gz CỤT nhưng đủ lớn để qua kiểm cỡ, `ls -1t` coi nó là "bản mới nhất", và bước retention
#    có thể xoá mất bản TỐT cũ hơn. Đổi tên trên cùng filesystem là thao tác nguyên tử: hoặc có file
#    hoàn chỉnh, hoặc không có gì.
#    pipefail bắt lỗi pg_dump kể cả khi gzip exit 0.
TMP="$FILE.partial"
if ! docker exec "$PG_CONTAINER" pg_dump -U "$PGUSER" -d "$PGDB" --no-owner --clean --if-exists | gzip > "$TMP"; then
  alert "pg_dump thất bại lúc $TS"; rm -f "$TMP"; exit 1
fi
SZ="$(stat -c%s "$TMP" 2>/dev/null || echo 0)"
if [ "$SZ" -lt 1000 ]; then alert "dump quá nhỏ ($SZ bytes) — nghi hỏng"; rm -f "$TMP"; exit 1; fi
# gzip -t đọc hết luồng nén: bắt được file cụt mà kiểm cỡ bỏ lọt (dump 500MB đứt ở 300MB).
if ! gzip -t "$TMP" 2>/dev/null; then
  alert "dump gzip hỏng/cụt — không giữ lại"; rm -f "$TMP"; exit 1
fi
mv -f "$TMP" "$FILE"
# Checksum cạnh file: sau này đối chiếu được bản trên NAS có bằng bản gốc không.
sha256sum "$FILE" | awk '{print $1}' > "$FILE.sha256"
# Siết lại tường minh: umask ở trên chỉ áp cho tiến trình NÀY. Ai chạy tay script với umask khác
# (hoặc thừa kế từ một shell đã đổi) vẫn phải ra 0600 — đây là dữ liệu nhân sự thô.
chmod 600 "$FILE" "$FILE.sha256"

# 2) Off-host → NAS (tuỳ chọn). Dùng docker smbclient để KHÔNG cần cài gì lên host.
if [ -n "${NAS_SHARE:-}" ] && [ -n "${NAS_USER:-}" ]; then
  B="$(basename "$FILE")"
  # Mật khẩu đi qua BIẾN MÔI TRƯỜNG chứ không nội suy vào chuỗi lệnh: chuỗi lệnh nằm trong argv nên
  # hiện nguyên văn ở `ps aux` trên host, trong `docker inspect` và /proc/<pid>/cmdline của container
  # tạm. Bên trong container thì ghi ra file credentials (umask 077) rồi dùng `smbclient -A`.
  if ! NAS_SHARE="$NAS_SHARE" NAS_USER="$NAS_USER" NAS_PASS="${NAS_PASS:-}" NAS_SUBDIR="${NAS_SUBDIR:-.}" B="$B" \
      docker run --rm -e NAS_SHARE -e NAS_USER -e NAS_PASS -e NAS_SUBDIR -e B \
      -v "$BACKUP_DIR":/data:ro alpine sh -c \
      'apk add --no-cache samba-client >/dev/null 2>&1 || exit 1
       umask 077; printf "username=%s\npassword=%s\n" "$NAS_USER" "$NAS_PASS" > /tmp/cred
       smbclient "$NAS_SHARE" -A /tmp/cred -m SMB2 -c "cd $NAS_SUBDIR; put /data/$B $B; put /data/$B.sha256 $B.sha256"'; then
    alert "đẩy NAS thất bại ($FILE) — bản local vẫn giữ"
  fi
fi

# 3) GFS retention local — giữ KEEP_DAILY bản mới nhất, xoá cũ hơn.
#    Chạy SAU khi bản mới đã hoàn chỉnh và đã đổi tên: không bao giờ xoá bản cũ dựa trên một lượt
#    backup còn chưa chắc thành công.
ls -1t "$BACKUP_DIR"/quanly-*.sql.gz 2>/dev/null | tail -n +"$((KEEP_DAILY+1))" | while IFS= read -r f; do
  rm -f "$f" "$f.sha256"
done
# Dọn file tạm mồ côi của những lượt chết giữa chừng trước đây.
find "$BACKUP_DIR" -name 'quanly-*.sql.gz.partial' -mmin +180 -delete 2>/dev/null || true

# Dấu vết cho watchdog kiểm "backup có còn tươi không" (timer chết im lặng thì không ai biết).
date +%s > "$BACKUP_DIR/.db-last-success"

echo "✓ backup OK: $FILE ($(du -h "$FILE" | cut -f1)) — giữ $KEEP_DAILY bản local"
