#!/usr/bin/env bash
# ============================================================================
# Cài backup tự động QuanLY lên host (chạy TRÊN host coolify, cần sudo/root).
#   - Đặt script vào /opt/quanly/  - Tạo systemd timer (host KHÔNG có crontab):
#       quanly-backup.timer       → hằng ngày 02:00 (+jitter)
#       quanly-restore-test.timer → hằng tuần (CN 03:00)
#   - Chạy backup 1 lần để VERIFY ngay.
# Trước khi chạy: điền /etc/quanly-backup.env (xem MẪU bên dưới in ra nếu thiếu).
# ============================================================================
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
install -d /opt/quanly /opt/quanly-backups
install -m 0750 "$SRC/backup-db.sh" /opt/quanly/backup-db.sh
install -m 0750 "$SRC/restore-test.sh" /opt/quanly/restore-test.sh

if [ ! -f /etc/quanly-backup.env ]; then
  cat > /etc/quanly-backup.env <<'ENVMODEL'
# Điền cấu hình backup QuanLY (chmod 600). Off-host + alert là TUỲ CHỌN nhưng KHUYẾN NGHỊ.
BACKUP_DIR=/opt/quanly-backups
KEEP_DAILY=14
PG_CONTAINER=quanly-postgres
# --- Alert khi lỗi (Telegram) — lấy token từ app .env nếu muốn ---
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_ALERT_CHAT=
# --- Off-host NAS Synology (KHUYẾN NGHỊ — chống mất host) ---
# NAS_SHARE=//192.168.1.100/QuanlyBackup
# NAS_USER=quanly-backup
# NAS_PASS=
# NAS_SUBDIR=.
ENVMODEL
  chmod 600 /etc/quanly-backup.env
  echo "⚠️ Đã tạo /etc/quanly-backup.env MẪU — hãy điền NAS_*/TELEGRAM_* rồi chạy lại để bật off-host+alert."
fi

cat > /etc/systemd/system/quanly-backup.service <<'UNIT'
[Unit]
Description=QuanLY DB backup (pg_dump → gzip → NAS off-host)
After=docker.service
[Service]
Type=oneshot
ExecStart=/opt/quanly/backup-db.sh
UNIT

cat > /etc/systemd/system/quanly-backup.timer <<'UNIT'
[Unit]
Description=QuanLY DB backup hằng ngày 02:00
[Timer]
OnCalendar=*-*-* 02:00:00
RandomizedDelaySec=300
Persistent=true
[Install]
WantedBy=timers.target
UNIT

cat > /etc/systemd/system/quanly-restore-test.service <<'UNIT'
[Unit]
Description=QuanLY restore-test (nạp dump mới nhất vào DB tạm)
After=docker.service
[Service]
Type=oneshot
ExecStart=/opt/quanly/restore-test.sh
UNIT

cat > /etc/systemd/system/quanly-restore-test.timer <<'UNIT'
[Unit]
Description=QuanLY restore-test hằng tuần (CN 03:00)
[Timer]
OnCalendar=Sun *-*-* 03:00:00
RandomizedDelaySec=300
Persistent=true
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now quanly-backup.timer quanly-restore-test.timer

echo "▶ Verify: chạy backup 1 lần ngay..."
/opt/quanly/backup-db.sh
echo "▶ Verify: restore-test..."
/opt/quanly/restore-test.sh
echo "✓ Cài xong. Lịch: $(systemctl list-timers quanly-* --no-pager | grep quanly | head -2)"
