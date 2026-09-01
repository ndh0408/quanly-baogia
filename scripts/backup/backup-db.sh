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
# ── BA BƯỚC DƯỚI ĐÂY PHẢI KIỂM MÃ THOÁT BẰNG TAY (§39) ──────────────────────────────────────
# Script này CỐ Ý không có `set -e` (lý do ghi trong CHO_PHEP_KHONG_E của
# scripts/ci/check-shell-strict.mjs: dump hỏng phải ĐI TIẾP tới nhánh cảnh báo và tuyệt đối
# không xoá bản sao lưu cũ). Cái giá của lựa chọn đó là lỗi KHÔNG tự lan ra mã thoát — mỗi bước
# phải tự kiểm.
# Bỏ kiểm thì hình dạng hỏng tệ nhất không phải "báo lỗi", mà là IM LẶNG: `mv` thất bại (đầy đĩa,
# đích khác filesystem, thư mục mất quyền ghi) → không có tệp nào ở đích, nhưng script vẫn chạy
# tới cuối, vẫn ghi `.db-last-success` và vẫn in "✓ backup OK", nên watchdog vẫn thấy "backup còn
# tươi". Mất sao lưu mà không ai biết — chỉ lộ ra đúng lúc cần khôi phục.
if ! mv -f "$TMP" "$FILE"; then
  # KHÔNG xoá "$TMP": bản dump này ĐÃ qua kiểm cỡ và `gzip -t`, tức nó TỐT — chỉ chỗ đến hỏng.
  # Giữ lại để còn cứu tay được. Lượt này thoát ngay nên KHÔNG chạy tới nhánh dọn mồ côi ở dưới;
  # phải một lượt SAU chạy trót lọt mới thu nó, và chỉ khi đã quá 180 phút.
  alert "mv thất bại: không đưa được bản dump về $FILE (còn nguyên ở $TMP) — lượt này KHÔNG có bản sao lưu mới"
  exit 1
fi
# Checksum cạnh file: sau này đối chiếu được bản trên NAS có bằng bản gốc không.
# `pipefail` bật ở đầu tệp nên mã thoát của `sha256sum` không bị `awk` (luôn 0) che mất.
if ! sha256sum "$FILE" | awk '{print $1}' > "$FILE.sha256"; then
  # Chuyển hướng `>` đã kịp tạo tệp rỗng/dở TRƯỚC khi sha256sum hỏng. Xoá đi: một checksum SAI
  # tệ hơn không có checksum — nó làm bước đối chiếu báo lệch trên một bản dump lành lặn, và
  # người trực sẽ vứt bản tốt đi.
  rm -f "$FILE.sha256"
  alert "sha256sum thất bại cho $FILE — bản dump vẫn còn nhưng KHÔNG có checksum để đối chiếu với bản NAS"
  exit 1
fi
# Siết lại tường minh: umask ở trên chỉ áp cho tiến trình NÀY. Ai chạy tay script với umask khác
# (hoặc thừa kế từ một shell đã đổi) vẫn phải ra 0600 — đây là dữ liệu nhân sự thô.
if ! chmod 600 "$FILE" "$FILE.sha256"; then
  # KHÔNG xoá bản dump: §54 xếp "không mất dữ liệu" TRÊN "không hở bảo mật". Báo thật to để người
  # trực siết tay, chứ đừng đánh đổi một bản sao lưu tốt lấy một lỗi phân quyền.
  alert "chmod 600 thất bại cho $FILE — dữ liệu nhân sự thô có thể đang ở chế độ ai-cũng-đọc, siết tay NGAY"
  exit 1
fi

# 2) Off-host → NAS (tuỳ chọn). Dùng docker smbclient để KHÔNG cần cài gì lên host.
if [ -n "${NAS_SHARE:-}" ] && [ -n "${NAS_USER:-}" ]; then
  B="$(basename "$FILE")"
  # Mật khẩu KHÔNG đi qua argv và cũng KHÔNG đi qua `-e NAS_PASS`. Hai đường lộ KHÁC NHAU:
  #   • argv — chuỗi lệnh hiện nguyên văn ở `ps aux` trên host và /proc/<pid>/cmdline.
  #   • `-e NAS_PASS` (cờ TRẦN, không kèm giá trị) — docker CLI đọc giá trị từ môi trường của chính
  #     nó rồi NẠP vào `Config.Env` của container, nên `docker inspect quanly-…` và
  #     /proc/<pid>/environ BÊN TRONG container vẫn trả về mật khẩu suốt cửa sổ chạy. Bản trước bịt
  #     đường thứ nhất và chú thích ghi là đã bịt cả `docker inspect` — điều đó KHÔNG đúng.
  # Cách còn lại: đẩy nguyên nội dung file credentials qua STDIN (`docker run -i`). Ống stdin không
  # nằm trong argv lẫn Config.Env. `cat > /tmp/cred` chạy TRƯỚC `apk add` để không có lệnh nào khác
  # kịp nuốt mất stdin; `umask 077` cho file 0600 ngay lúc tạo.
  if ! printf 'username=%s\npassword=%s\n' "$NAS_USER" "${NAS_PASS:-}" |
      NAS_SHARE="$NAS_SHARE" NAS_SUBDIR="${NAS_SUBDIR:-.}" B="$B" \
      docker run --rm -i -e NAS_SHARE -e NAS_SUBDIR -e B \
      -v "$BACKUP_DIR":/data:ro alpine sh -c \
      'umask 077; cat > /tmp/cred
       apk add --no-cache samba-client >/dev/null 2>&1 || exit 1
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
