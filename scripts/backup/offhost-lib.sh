#!/usr/bin/env bash
# ============================================================================
# QuanLY — thư viện DÙNG CHUNG cho bước OFF-HOST và tệp TRẠNG THÁI sao lưu.
# Được `source` bởi backup-db.sh, backup-objects.sh và backup-watchdog.sh — KHÔNG chạy riêng.
#
# ── VÌ SAO CÓ TỆP NÀY (audit 2026-09-22, INFRA-01 / DOC-01) ─────────────────
# Đo trên production: /etc/quanly-backup.env KHÔNG có NAS_*, nên khối off-host của backup-db.sh
# bị bỏ qua mà KHÔNG in một chữ nào. Mọi bản dump và toàn bộ kho chứng từ nằm trên cùng một đĩa
# của máy "coolify". Hai lỗi, hai cách vá:
#   1. IM LẶNG → mỗi lượt in cảnh báo vào log, ghi tệp trạng thái (Prometheus đọc được qua app,
#      xem BACKUP_STATUS_FILE), và watchdog hiển thị. Chủ repo đã chốt (2026-09-23): khi CHƯA cấu
#      hình đích ngoài thì job vẫn exit 0 và KHÔNG gửi Telegram mỗi đêm — chỉ log + metric. Đã cấu
#      hình mà đẩy HỎNG thì mới là lỗi thật: Telegram + mã thoát ≠ 0.
#   2. CHỈ CÓ NAS (LAN, cùng toà nhà, bản THÔ) → thêm đích rclone. Đích rclone BẮT BUỘC là remote
#      kiểu `crypt` (mã hoá phía máy, NaCl secretbox): kho ngoài chỉ thấy khối mã. Remote không phải
#      crypt thì TỪ CHỐI đẩy — dump chứa CCCD/số tài khoản/lương, không được rời máy ở dạng thô.
#
# Cấu hình (trong /etc/quanly-backup.env):
#   NAS_SHARE, NAS_USER, NAS_PASS, NAS_SUBDIR   đích NAS cũ (giữ nguyên hành vi, bản KHÔNG mã hoá)
#   OFFHOST_RCLONE_REMOTE   tên remote CRYPT trong tệp cấu hình rclone, vd `quanly-offsite:`
#   OFFHOST_RCLONE_CONFIG   tệp cấu hình rclone (mặc định /etc/quanly-rclone.conf, chmod 600)
#   OFFHOST_KEEP_DAYS       xoá bản dump off-host cũ hơn N ngày; 0 (MẶC ĐỊNH) = KHÔNG xoá từ máy
#                           này. Để 0 và đặt vòng đời ở phía bucket là cách chống ransomware: khoá
#                           trên máy chỉ cần quyền GHI, kẻ chiếm máy không xoá được bản ngoài.
#   RCLONE_IMAGE            ảnh rclone, ghim digest (mặc định bên dưới)
#   BACKUP_STATUS_DIR       thư mục tệp trạng thái (mặc định /var/lib/quanly-backup, 0755)
# Hướng dẫn cài: docs/operations/BACKUP_RESTORE.md, mục "Off-host".
# ============================================================================
# Thư viện được `source`: CỐ Ý không `set -e` (nó sẽ lan sang backup-db.sh — script cố ý không có
# `-e`, xem CHO_PHEP_KHONG_E trong scripts/ci/check-shell-strict.mjs). -u và pipefail thì script gọi
# đã bật sẵn; khai lại ở đây để cổng kiểm thấy.
set -uo pipefail

# rclone 1.75.1 — kéo được từ Docker Hub, đã thử `docker pull` theo digest ngày 2026-09-23.
RCLONE_IMAGE="${RCLONE_IMAGE:-rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5}"
OFFHOST_RCLONE_REMOTE="${OFFHOST_RCLONE_REMOTE:-}"
OFFHOST_RCLONE_CONFIG="${OFFHOST_RCLONE_CONFIG:-/etc/quanly-rclone.conf}"
OFFHOST_KEEP_DAYS="${OFFHOST_KEEP_DAYS:-0}"
BACKUP_STATUS_DIR="${BACKUP_STATUS_DIR:-/var/lib/quanly-backup}"

offhost_nas_configured()    { [ -n "${NAS_SHARE:-}" ] && [ -n "${NAS_USER:-}" ]; }
offhost_rclone_configured() { [ -n "$OFFHOST_RCLONE_REMOTE" ]; }
offhost_configured()        { offhost_nas_configured || offhost_rclone_configured; }

# Chuỗi cảnh báo DUY NHẤT cho trường hợp chưa cấu hình — cùng một câu ở mọi script để grep log
# (`journalctl -u 'quanly-*' | grep OFFHOST-CHUA-CAU-HINH`) ra đủ.
offhost_canh_bao_chua_cau_hinh() { # $1 = mô tả thứ đang nằm một chỗ
  echo "⚠️  OFFHOST-CHUA-CAU-HINH: $1 CHỈ nằm trên CÙNG HOST. Mất máy/đĩa là mất hết." >&2
  echo "   Cấu hình NAS_* hoặc OFFHOST_RCLONE_REMOTE trong /etc/quanly-backup.env (docs/operations/BACKUP_RESTORE.md, mục Off-host)." >&2
}

# rclone chạy trong container để host không phải cài gì. Tệp cấu hình mount READ-ONLY bằng đường
# dẫn: bí mật của remote không đi qua argv, cũng không qua `-e` (cờ `-e` nạp giá trị vào
# Config.Env, `docker inspect` đọc được — cùng lý do khối NAS đẩy mật khẩu qua stdin).
# $BACKUP_DIR mount read-only: bước off-host không bao giờ được sửa bản sao lưu local.
offhost_rclone() {
  docker run --rm \
    -v "$OFFHOST_RCLONE_CONFIG":/cfg/rclone.conf:ro \
    -v "$BACKUP_DIR":/data:ro \
    "$RCLONE_IMAGE" --config /cfg/rclone.conf "$@"
}

# Remote PHẢI là kiểu crypt. `listremotes --long` in "tên: kiểu" — đọc kiểu của đúng remote đã khai.
# Trả 0 khi là crypt; in lý do và trả 1 khi không (kể cả khi đọc cấu hình hỏng).
offhost_rclone_la_crypt() {
  local ten out
  ten="${OFFHOST_RCLONE_REMOTE%%:*}"
  if [ ! -r "$OFFHOST_RCLONE_CONFIG" ]; then
    echo "không đọc được $OFFHOST_RCLONE_CONFIG"; return 1
  fi
  if ! out="$(offhost_rclone listremotes --long 2>&1)"; then
    echo "rclone listremotes hỏng: $(printf '%s' "$out" | head -c 200 | tr '\n' ' ')"; return 1
  fi
  if printf '%s\n' "$out" | awk -v t="$ten:" '$1 == t && $2 == "crypt" { ok = 1 } END { exit ok ? 0 : 1 }'; then
    return 0
  fi
  echo "remote '$ten' không phải kiểu crypt (hoặc không có trong $OFFHOST_RCLONE_CONFIG) — TỪ CHỐI đẩy bản thô ra ngoài"
  return 1
}

# Đẩy các tệp (tên tương đối trong $BACKUP_DIR) lên "$OFFHOST_RCLONE_REMOTE$1/" rồi ĐỐI CHIẾU lại
# bằng `cryptcheck` (so băm của bản gốc với bản đã mã hoá trên kho ngoài — không cần tải về).
# $1 = thư mục con trên remote, các tham số sau = tên tệp.
offhost_rclone_day_tep() {
  local sub="$1"; shift
  local ly f
  if ! ly="$(offhost_rclone_la_crypt)"; then echo "$ly"; return 1; fi
  for f in "$@"; do
    if ! offhost_rclone copyto "/data/$f" "$OFFHOST_RCLONE_REMOTE$sub/$f" >/dev/null 2>&1; then
      echo "rclone copyto $f thất bại"; return 1
    fi
    if ! offhost_rclone cryptcheck /data "$OFFHOST_RCLONE_REMOTE$sub" --include "/$f" --one-way >/dev/null 2>&1; then
      echo "cryptcheck $f KHÔNG khớp sau khi đẩy — bản ngoài không đáng tin"; return 1
    fi
  done
  if [ "$OFFHOST_KEEP_DAYS" -gt 0 ] 2>/dev/null; then
    # Dọn hỏng KHÔNG làm cả bước đỏ: bản mới đã lên và đã đối chiếu xong.
    offhost_rclone delete --min-age "${OFFHOST_KEEP_DAYS}d" "$OFFHOST_RCLONE_REMOTE$sub" >/dev/null 2>&1 \
      || echo "   ⚠ không dọn được bản off-host cũ hơn ${OFFHOST_KEEP_DAYS} ngày (bản mới vẫn đã lên)" >&2
  fi
  return 0
}

# Đẩy CẢ MỘT THƯ MỤC (tương đối trong $BACKUP_DIR) — dùng cho bản gương kho object. `copy`, KHÔNG
# `sync`: cùng nguyên tắc cộng dồn của bản gương (xoá nhầm/mã hoá tống tiền trên bucket không được
# lan sang bản ngoài). rclone chỉ gửi tệp mới/đổi, nên lượt hằng đêm nhẹ.
offhost_rclone_day_thu_muc() { # $1 = thư mục local tương đối, $2 = thư mục con trên remote
  local ly
  if ! ly="$(offhost_rclone_la_crypt)"; then echo "$ly"; return 1; fi
  if ! offhost_rclone copy "/data/$1" "$OFFHOST_RCLONE_REMOTE$2" >/dev/null 2>&1; then
    echo "rclone copy $1 thất bại"; return 1
  fi
  if ! offhost_rclone cryptcheck "/data/$1" "$OFFHOST_RCLONE_REMOTE$2" --one-way >/dev/null 2>&1; then
    echo "cryptcheck $1 KHÔNG khớp — có tệp chưa lên hoặc lên sai"; return 1
  fi
  return 0
}

# ── TỆP TRẠNG THÁI (định dạng textfile của Prometheus) ─────────────────────
# Dựng lại TOÀN BỘ tệp từ các dấu `.…-last-success` mỗi lần gọi — không sửa từng dòng, nên không có
# trạng thái nửa vời. Ghi tệp tạm rồi `mv` (nguyên tử). Tệp chỉ chứa DẤU THỜI GIAN, không có dữ liệu
# nào — nên 0644 trong thư mục 0755 là cố ý: app (user không phải root) cần đọc được để phơi ra
# /metrics (BACKUP_STATUS_FILE trong docker-compose.prod.yml).
# Giá trị 0 = chưa từng thành công. Không bao giờ làm script gọi hỏng.
backup_ghi_trang_thai() {
  local tep="$BACKUP_STATUS_DIR/quanly_backup.prom" tam k v cfg
  mkdir -p "$BACKUP_STATUS_DIR" 2>/dev/null && chmod 0755 "$BACKUP_STATUS_DIR" 2>/dev/null || return 0
  tam="$tep.$$"
  cfg=0; offhost_configured && cfg=1
  {
    echo "# HELP backup_last_success_timestamp_seconds Lần sao lưu thành công gần nhất (epoch giây, 0 = chưa từng)."
    echo "# TYPE backup_last_success_timestamp_seconds gauge"
    for k in db objects offhost_db offhost_objects drill; do
      v="$(cat "$BACKUP_DIR/.${k//_/-}-last-success" 2>/dev/null)"
      case "$v" in ''|*[!0-9]*) v=0 ;; esac
      echo "backup_last_success_timestamp_seconds{kind=\"$k\"} $v"
    done
    echo "# HELP backup_offhost_configured 1 nếu đã cấu hình đích off-host (NAS hoặc rclone crypt)."
    echo "# TYPE backup_offhost_configured gauge"
    echo "backup_offhost_configured{scope=\"host\"} $cfg"
  } > "$tam" 2>/dev/null && chmod 0644 "$tam" 2>/dev/null && mv -f "$tam" "$tep" 2>/dev/null || rm -f "$tam" 2>/dev/null
  return 0
}
