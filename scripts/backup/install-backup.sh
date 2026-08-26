#!/usr/bin/env bash
# ============================================================================
# Cài backup tự động QuanLY lên host (chạy TRÊN host coolify, cần sudo/root).
#   - Đặt script vào /opt/quanly/
#   - Tạo systemd timer (host KHÔNG có crontab):
#       quanly-backup.timer          → CSDL, hằng ngày 02:00 (+jitter)
#       quanly-backup-objects.timer  → KHO OBJECT, hằng ngày 02:30 (+jitter)
#       quanly-restore-drill.timer   → diễn tập khôi phục đầy đủ, CN 03:00
#       quanly-backup-watchdog.timer → canh độ tươi, mỗi 6h
#   - Chạy một lượt để VERIFY ngay.
#
# Trước khi chạy: điền /etc/quanly-backup.env (in ra MẪU nếu chưa có).
#
# LƯU Ý VỀ ĐỦ BỘ SAO LƯU: từ 2026-08-11, dump CSDL MỘT MÌNH KHÔNG khôi phục được.
# Cần đủ ba: dump + PII_ENC_KEY + bản sao kho object. Xem docs/operations/BACKUP_RESTORE.md.
# ============================================================================
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
install -d /opt/quanly /opt/quanly-backups
install -m 0750 "$SRC/backup-db.sh"        /opt/quanly/backup-db.sh
install -m 0750 "$SRC/backup-objects.sh"   /opt/quanly/backup-objects.sh
install -m 0750 "$SRC/restore-test.sh"     /opt/quanly/restore-test.sh
install -m 0750 "$SRC/restore-drill.sh"    /opt/quanly/restore-drill.sh
install -m 0750 "$SRC/backup-watchdog.sh"  /opt/quanly/backup-watchdog.sh

if [ ! -f /etc/quanly-backup.env ]; then
  cat > /etc/quanly-backup.env <<'ENVMODEL'
# Điền cấu hình backup QuanLY (chmod 600). Off-host + alert là TUỲ CHỌN nhưng KHUYẾN NGHỊ.
BACKUP_DIR=/opt/quanly-backups
KEEP_DAILY=14
KEEP_MANIFESTS=30
PG_CONTAINER=quanly-postgres
APP_CONTAINER=quanly-app

# --- Alert khi lỗi (Telegram) — lấy token từ app .env nếu muốn ---
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_ALERT_CHAT=

# --- Off-host NAS Synology (KHUYẾN NGHỊ — chống mất host) ---
# NAS_SHARE=//192.168.1.100/QuanlyBackup
# NAS_USER=quanly-backup
# NAS_PASS=
# NAS_SUBDIR=.

# --- KHO OBJECT (BẮT BUỘC cho backup-objects.sh) ---
# Ảnh chứng từ thanh toán nằm ở đây, KHÔNG nằm trong dump CSDL. Thiếu phần này thì
# bản sao lưu KHÔNG đầy đủ và diễn tập khôi phục sẽ báo lỗi.
# S3_ENDPOINT=
# S3_ACCESS_KEY=
# S3_SECRET_KEY=
# S3_BUCKET=quanly

# --- KHOÁ MÃ HOÁ PII (BẮT BUỘC cho diễn tập khôi phục) ---
# Diễn tập dùng khoá này để chứng minh bản dump GIẢI MÃ ĐƯỢC. Không có nó thì không
# ai biết khoá đang giữ có mở được bản sao lưu hay không, cho tới đúng lúc cần thật.
# ⚠️ Khoá phải được sao lưu ở nơi KHÁC với bản dump — để chung thì kẻ lấy được dump
#    lấy luôn khoá, mà mất chỗ đó là mất cả hai.
# PII_ENC_KEY=

# --- Ngưỡng canh độ tươi (watchdog) ---
# WATCHDOG_MAX_DB_HOURS=26
# WATCHDOG_MAX_OBJECT_HOURS=26
# WATCHDOG_MAX_DRILL_DAYS=8
ENVMODEL
  chmod 600 /etc/quanly-backup.env
  echo "⚠️ Đã tạo /etc/quanly-backup.env MẪU — điền S3_*, PII_ENC_KEY, NAS_*, TELEGRAM_* rồi chạy lại."
fi

mkunit() { # $1=tên  $2=mô tả  $3=script  $4=OnCalendar
  cat > "/etc/systemd/system/$1.service" <<UNIT
[Unit]
Description=$2
After=docker.service
[Service]
Type=oneshot
ExecStart=/opt/quanly/$3
UNIT
  cat > "/etc/systemd/system/$1.timer" <<UNIT
[Unit]
Description=$2 (lịch)
[Timer]
OnCalendar=$4
RandomizedDelaySec=300
Persistent=true
[Install]
WantedBy=timers.target
UNIT
}

mkunit quanly-backup           "QuanLY backup CSDL (pg_dump → gzip → NAS off-host)" backup-db.sh       "*-*-* 02:00:00"
mkunit quanly-backup-objects   "QuanLY backup KHO OBJECT (chứng từ thanh toán)"     backup-objects.sh  "*-*-* 02:30:00"
mkunit quanly-restore-test     "QuanLY restore-test (nạp dump vào CSDL tạm)"        restore-test.sh    "Sun *-*-* 03:00:00"
mkunit quanly-restore-drill    "QuanLY diễn tập khôi phục ĐẦY ĐỦ (dump+khoá+object)" restore-drill.sh  "Sun *-*-* 03:30:00"
mkunit quanly-backup-watchdog  "QuanLY canh độ tươi bản sao lưu"                     backup-watchdog.sh "*-*-* 00/6:15:00"

systemctl daemon-reload
systemctl enable --now \
  quanly-backup.timer \
  quanly-backup-objects.timer \
  quanly-restore-test.timer \
  quanly-restore-drill.timer \
  quanly-backup-watchdog.timer

echo "▶ Verify: backup CSDL..."
/opt/quanly/backup-db.sh

echo "▶ Verify: backup kho object..."
if grep -q '^S3_ENDPOINT=.\+' /etc/quanly-backup.env; then
  /opt/quanly/backup-objects.sh
else
  echo "  ⚠ BỎ QUA — S3_* chưa điền. BẢN SAO LƯU HIỆN CHƯA ĐẦY ĐỦ:"
  echo "    ảnh chứng từ thanh toán KHÔNG nằm trong dump CSDL. Điền S3_* rồi chạy lại script này."
fi

echo "▶ Verify: diễn tập khôi phục đầy đủ..."
/opt/quanly/restore-drill.sh || echo "  ⚠ Diễn tập có hạng mục chưa đạt — xem log phía trên và sửa TRƯỚC khi tin vào bản sao lưu."

echo "✓ Cài xong. Lịch hiện tại:"
systemctl list-timers 'quanly-*' --no-pager | head -8
