#!/usr/bin/env bash
# ============================================================================
# Cài backup tự động QuanLY lên host (chạy TRÊN host coolify, cần sudo/root).
#   - Đặt script vào /opt/quanly/
#   - Tạo systemd timer (host KHÔNG có crontab):
#       quanly-backup.timer          → CSDL, hằng ngày 02:00 (+jitter)
#       quanly-backup-objects.timer  → KHO OBJECT, hằng ngày 02:30 (+jitter)
#       quanly-restore-drill.timer   → diễn tập khôi phục đầy đủ, CN 03:00
#       quanly-backup-watchdog.timer → canh độ tươi, mỗi 6h
#   - Chạy một lượt để VERIFY ngay. Lượt diễn tập khôi phục dựng container + bucket TẠM trên chính
#     máy này — chạy ngoài giờ làm việc, hoặc đặt INSTALL_SKIP_DRILL=1 để hoãn tới lịch CN 03:30.
#
# TRƯỚC KHI CÀI LÊN PRODUCTION (audit 2026-09-22, INFRA-06): bản /opt/quanly/backup-db.sh đang chạy
# trên prod KHÁC md5 với repo. Chạy `diff /opt/quanly/backup-db.sh scripts/backup/backup-db.sh` và
# đưa mọi bản vá chỉ có trên máy về repo TRƯỚC, nếu không cài đè là mất bản vá đó.
#
# Trước khi chạy: điền /etc/quanly-backup.env (in ra MẪU nếu chưa có).
#
# LƯU Ý VỀ ĐỦ BỘ SAO LƯU: từ 2026-08-11, dump CSDL MỘT MÌNH KHÔNG khôi phục được.
# Cần đủ ba: dump + PII_ENC_KEY + bản sao kho object. Xem docs/operations/BACKUP_RESTORE.md.
# ============================================================================
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
# 0700 chứ KHÔNG để mặc định 0755: /opt/quanly-backups chứa dump CSDL với CCCD / số tài khoản /
# lương ở dạng thô và bản gương chứng từ thanh toán. Thư mục ai-cũng-liệt-kê-được là bước đầu
# tiên của mọi lần rò rỉ.
install -d -m 0700 /opt/quanly /opt/quanly-backups
install -m 0750 "$SRC/backup-db.sh"        /opt/quanly/backup-db.sh
install -m 0750 "$SRC/backup-objects.sh"   /opt/quanly/backup-objects.sh
install -m 0750 "$SRC/restore-test.sh"     /opt/quanly/restore-test.sh
install -m 0750 "$SRC/restore-drill.sh"    /opt/quanly/restore-drill.sh
install -m 0750 "$SRC/backup-watchdog.sh"  /opt/quanly/backup-watchdog.sh
install -m 0640 "$SRC/offhost-lib.sh"      /opt/quanly/offhost-lib.sh
# Tệp trạng thái (chỉ dấu thời gian, không dữ liệu): 0755 để container app — chạy bằng user không
# phải root — đọc được qua bind mount (BACKUP_STATUS_FILE trong docker-compose.prod.yml).
install -d -m 0755 /var/lib/quanly-backup

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

# --- OFF-HOST (KHUYẾN NGHỊ MẠNH — chưa cấu hình thì MỌI bản sao nằm trên cùng máy) ---
# Chưa cấu hình: backup vẫn chạy và exit 0, nhưng log in OFFHOST-CHUA-CAU-HINH và
# metric backup_offhost_configured = 0. Xem docs/operations/BACKUP_RESTORE.md, mục Off-host.
#
# (a) NAS trong LAN — bản KHÔNG mã hoá, và vẫn cùng toà nhà (off-host, chưa phải off-site):
# NAS_SHARE=//<nas-host>/<share>
# NAS_USER=quanly-backup
# NAS_PASS=
# NAS_SUBDIR=.
#
# (b) rclone remote kiểu CRYPT (R2/B2/S3… ngoài toà nhà, mã hoá trước khi rời máy):
# OFFHOST_RCLONE_REMOTE=quanly-offsite:
# OFFHOST_RCLONE_CONFIG=/etc/quanly-rclone.conf
# OFFHOST_KEEP_DAYS=0      # 0 = không xoá từ máy này; đặt vòng đời ở phía bucket
# ⚠️ Mật khẩu crypt (password/password2 trong tệp rclone) PHẢI được ký gửi ở nơi KHÁC máy này,
#    cùng PII_ENC_KEY. Mất máy mà không còn mật khẩu thì bản off-host là khối mã không mở được.

# --- KHO OBJECT (backup-objects.sh) ---
# Ảnh chứng từ thanh toán nằm ở đây, KHÔNG nằm trong dump CSDL. Để TRỐNG thì script tự đọc
# S3_* từ container quanly-app (bộ khoá app đang dùng). Đặt ở đây nếu có khoá riêng chỉ-đọc cho backup.
# S3_ENDPOINT=http://minio:9000
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
  echo "⚠️ Đã tạo /etc/quanly-backup.env MẪU — điền PII_ENC_KEY, TELEGRAM_*, và đích off-host (NAS_* hoặc OFFHOST_RCLONE_*) rồi chạy lại."
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

mkunit quanly-backup           "QuanLY backup CSDL (pg_dump → gzip → off-host nếu cấu hình)" backup-db.sh "*-*-* 02:00:00"
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

# Mốc cài đặt cho ân hạn của watchdog (soát chéo ops#2): trong WATCHDOG_MAX_DRILL_DAYS ngày đầu,
# "diễn tập chưa từng đạt" KHÔNG gửi Telegram. Chỉ ghi MỘT lần — cài lại không được kéo dài ân hạn mãi.
BK_DIR="$(set -a; . /etc/quanly-backup.env >/dev/null 2>&1; printf '%s' "${BACKUP_DIR:-/opt/quanly-backups}")"
install -d -m 0700 "$BK_DIR"
[ -f "$BK_DIR/.installed-at" ] || date +%s > "$BK_DIR/.installed-at" || true

echo "▶ Verify: backup CSDL..."
/opt/quanly/backup-db.sh

echo "▶ Verify: backup kho object..."
# Không còn bỏ qua khi thiếu S3_* trong tệp env: script tự đọc khoá từ container app. Hỏng thì in
# lỗi rõ ràng — cài xong mà kho chứng từ vẫn không có bản sao nào là đúng thứ audit 2026-09-22 bắt.
/opt/quanly/backup-objects.sh || echo "  ⚠ Backup kho object HỎNG — xem lỗi phía trên. Ảnh chứng từ KHÔNG nằm trong dump CSDL."

if [ "${INSTALL_SKIP_DRILL:-0}" = "1" ]; then
  echo "▶ Diễn tập khôi phục: HOÃN (INSTALL_SKIP_DRILL=1) — timer quanly-restore-drill chạy CN 03:30."
else
  echo "▶ Verify: diễn tập khôi phục đầy đủ..."
  /opt/quanly/restore-drill.sh || echo "  ⚠ Diễn tập có hạng mục chưa đạt — xem log phía trên và sửa TRƯỚC khi tin vào bản sao lưu."
fi

echo "▶ Watchdog (một lượt, đồng thời ghi tệp trạng thái /var/lib/quanly-backup/quanly_backup.prom)..."
/opt/quanly/backup-watchdog.sh || echo "  ⚠ Watchdog báo hạng mục chưa đạt — xem phía trên."

echo "✓ Cài xong. Lịch hiện tại:"
systemctl list-timers 'quanly-*' --no-pager | head -8
