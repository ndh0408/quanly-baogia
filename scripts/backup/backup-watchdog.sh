#!/usr/bin/env bash
# ============================================================================
# QuanLY — CANH CHỪNG ĐỘ TƯƠI CỦA BẢN SAO LƯU.
#
# ── VÌ SAO CẦN MỘT TIẾN TRÌNH RIÊNG ─────────────────────────────────────────
# Mọi script backup đều alert KHI CHÚNG CHẠY VÀ HỎNG. Không cái nào alert được
# khi chúng KHÔNG CHẠY: timer bị disable sau một lần cập nhật hệ thống, host mất
# điện đúng khung 02:00, docker daemon chết, đĩa hỏng, ai đó `systemctl stop`.
# Chế độ hỏng nguy hiểm nhất của backup là im lặng — mọi thứ trông bình thường
# cho tới hôm cần khôi phục thì bản mới nhất đã sáu tuần tuổi.
#
# Watchdog này soi DẤU THỜI GIAN THÀNH CÔNG chứ không soi tiến trình, nên nó bắt
# được cả những kiểu chết mà bản thân script backup không bao giờ báo được.
#
# Ngưỡng bám theo SLO trong docs/operations/SLO.md:
#   - backup CSDL thành công gần nhất   < 26h
#   - sao lưu kho object gần nhất       < 26h
#   - diễn tập khôi phục gần nhất       < 8 ngày
# ============================================================================
set -uo pipefail
[ -f /etc/quanly-backup.env ] && set -a && . /etc/quanly-backup.env && set +a

BACKUP_DIR="${BACKUP_DIR:-/opt/quanly-backups}"
MAX_DB_H="${WATCHDOG_MAX_DB_HOURS:-26}"
MAX_OBJ_H="${WATCHDOG_MAX_OBJECT_HOURS:-26}"
MAX_DRILL_D="${WATCHDOG_MAX_DRILL_DAYS:-8}"
PROBLEMS=()

alert_all() {
  local msg="$1"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_ALERT_CHAT:-}" ]; then
    curl -sf --max-time 15 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TELEGRAM_ALERT_CHAT}" -d text="🔴 QuanLY SAO LƯU QUÁ HẠN:
$msg" >/dev/null 2>&1 || true
  fi
  echo "ERROR: $msg" >&2
}

age_hours() { # $1 = file chứa epoch giây; in ra số giờ, hoặc "never"
  [ -f "$1" ] || { echo never; return; }
  local t; t="$(cat "$1" 2>/dev/null)"
  case "$t" in ''|*[!0-9]*) echo never; return ;; esac
  echo $(( ( $(date +%s) - t ) / 3600 ))
}

DB_AGE="$(age_hours "$BACKUP_DIR/.db-last-success")"
OBJ_AGE="$(age_hours "$BACKUP_DIR/.objects-last-success")"
DRILL_AGE="$(age_hours "$BACKUP_DIR/.drill-last-success")"

if [ "$DB_AGE" = never ]; then
  PROBLEMS+=("• CSDL: CHƯA TỪNG có lượt sao lưu thành công nào được ghi nhận")
elif [ "$DB_AGE" -gt "$MAX_DB_H" ]; then
  PROBLEMS+=("• CSDL: lần thành công gần nhất ${DB_AGE}h trước (ngưỡng ${MAX_DB_H}h)")
fi

if [ "$OBJ_AGE" = never ]; then
  PROBLEMS+=("• KHO OBJECT: CHƯA TỪNG sao lưu — mất bucket là mất chứng từ tài chính vĩnh viễn")
elif [ "$OBJ_AGE" -gt "$MAX_OBJ_H" ]; then
  PROBLEMS+=("• KHO OBJECT: lần thành công gần nhất ${OBJ_AGE}h trước (ngưỡng ${MAX_OBJ_H}h)")
fi

if [ "$DRILL_AGE" = never ]; then
  PROBLEMS+=("• DIỄN TẬP KHÔI PHỤC: CHƯA TỪNG chạy thành công — bản sao lưu chưa được chứng minh là dùng được")
elif [ "$DRILL_AGE" -gt $(( MAX_DRILL_D * 24 )) ]; then
  PROBLEMS+=("• DIỄN TẬP KHÔI PHỤC: lần thành công gần nhất $(( DRILL_AGE / 24 )) ngày trước (ngưỡng ${MAX_DRILL_D} ngày)")
fi

# Timer có còn được bật không — bắt kiểu chết "ai đó disable rồi quên".
for t in quanly-backup.timer quanly-backup-objects.timer quanly-restore-drill.timer; do
  if systemctl list-unit-files "$t" >/dev/null 2>&1 && ! systemctl is-enabled --quiet "$t" 2>/dev/null; then
    PROBLEMS+=("• $t đang TẮT")
  fi
done

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  alert_all "$(printf '%s\n' "${PROBLEMS[@]}")"
  exit 1
fi

echo "✓ sao lưu còn tươi: CSDL ${DB_AGE}h · kho object ${OBJ_AGE}h · diễn tập $(( DRILL_AGE / 24 )) ngày"
