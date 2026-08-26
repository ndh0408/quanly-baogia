#!/usr/bin/env bash
# ============================================================================
# QuanLY — sao lưu KHO OBJECT (ảnh chứng từ thanh toán, tệp đính kèm, bản xuất).
#
# ── VÌ SAO CÓ FILE NÀY ──────────────────────────────────────────────────────
# Bản dump Postgres KHÔNG còn chứa đủ dữ liệu để khôi phục. Từ 2026-08-11 ảnh
# chứng từ thanh toán đã rời CSDL sang kho object; CSDL chỉ giữ khoá + SHA-256.
# docs/DR-runbook.md đã ghi nhận đúng khoảng trống này ("kho object production
# chưa có lịch sao lưu") nhưng chưa có gì thực hiện. Mất bucket = mất CHỨNG TỪ
# TÀI CHÍNH, trong khi mọi hàng trong CSDL vẫn còn và trỏ vào hư không.
#
# ── CƠ CHẾ ──────────────────────────────────────────────────────────────────
# `mc mirror` CỘNG DỒN (KHÔNG dùng --remove) từ bucket xuống thư mục gương local,
# rồi sinh manifest có SHA-256 từng object. Cố ý KHÔNG lan truyền xoá: nếu bucket
# bị xoá nhầm (hoặc bị mã hoá tống tiền) thì bản sao lưu phải GIỮ LẠI vật, chứ
# không đồng bộ luôn cái xoá đó — đó là khác biệt giữa "bản sao lưu" và "bản chép".
#
# Cấu hình qua /etc/quanly-backup.env (KHÔNG hardcode secret):
#   BACKUP_DIR (/opt/quanly-backups)   KEEP_MANIFESTS (30)
#   S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET   ← BẮT BUỘC
#   OBJ_TARBALL=1        (tuỳ chọn) đóng gói .tar.gz để đẩy off-host
#   OBJ_TARBALL_MAX_MB   (2048) — vượt ngưỡng thì bỏ đóng gói, chỉ đẩy manifest
#   NAS_SHARE/NAS_USER/NAS_PASS/NAS_SUBDIR                 (off-host — tuỳ chọn)
#   TELEGRAM_BOT_TOKEN, TELEGRAM_ALERT_CHAT                (alert — tuỳ chọn)
#   MC_IMAGE (minio/mc:RELEASE.2024-11-21T17-21-54Z)
# ============================================================================
set -uo pipefail
[ -f /etc/quanly-backup.env ] && set -a && . /etc/quanly-backup.env && set +a

BACKUP_DIR="${BACKUP_DIR:-/opt/quanly-backups}"
MIRROR_DIR="$BACKUP_DIR/objects"
KEEP_MANIFESTS="${KEEP_MANIFESTS:-30}"
MC_IMAGE="${MC_IMAGE:-minio/mc:RELEASE.2024-11-21T17-21-54Z}"
OBJ_TARBALL_MAX_MB="${OBJ_TARBALL_MAX_MB:-2048}"
TS="$(date +%F-%H%M%S)"
MANIFEST="$BACKUP_DIR/objects-manifest-$TS.tsv"

alert() {
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_ALERT_CHAT:-}" ]; then
    curl -sf --max-time 15 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TELEGRAM_ALERT_CHAT}" -d text="🔴 QuanLY BACKUP OBJECT LỖI: $1" >/dev/null 2>&1 || true
  fi
  echo "ERROR: $1" >&2
}

for v in S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY; do
  [ -n "${!v:-}" ] || { alert "thiếu $v trong /etc/quanly-backup.env — không biết sao lưu kho nào"; exit 1; }
done
BUCKET="${S3_BUCKET:-quanly}"

mkdir -p "$MIRROR_DIR"

# Chỗ trống đĩa: sao lưu mà làm đầy đĩa thì kéo sập luôn Postgres đang chạy cùng host.
AVAIL_MB="$(df -Pm "$BACKUP_DIR" | awk 'NR==2{print $4}')"
if [ "${AVAIL_MB:-0}" -lt 500 ]; then
  alert "đĩa chứa backup chỉ còn ${AVAIL_MB}MB — dừng trước khi làm đầy đĩa"; exit 1
fi

# `mc` chạy trong container để host không phải cài gì. --quiet để log không ngập tên từng object.
mc() {
  docker run --rm --network host \
    -e "MC_HOST_q=${S3_ENDPOINT/:\/\//://${S3_ACCESS_KEY}:${S3_SECRET_KEY}@}" \
    -v "$MIRROR_DIR":/mirror \
    "$MC_IMAGE" "$@"
}

echo "▶ [1/5] Gương bucket q/$BUCKET → $MIRROR_DIR (cộng dồn, KHÔNG lan truyền xoá)"
if ! mc mirror --quiet --overwrite "q/$BUCKET" /mirror; then
  alert "mc mirror thất bại (bucket $BUCKET @ $S3_ENDPOINT)"; exit 1
fi

echo "▶ [2/5] Đối chiếu số lượng object bucket ↔ bản gương"
REMOTE_N="$(mc ls --recursive "q/$BUCKET" 2>/dev/null | grep -c . || echo 0)"
LOCAL_N="$(find "$MIRROR_DIR" -type f | wc -l)"
if [ "$REMOTE_N" -gt 0 ] && [ "$LOCAL_N" -lt "$REMOTE_N" ]; then
  alert "bản gương THIẾU object: bucket có $REMOTE_N, gương chỉ có $LOCAL_N"; exit 1
fi

echo "▶ [3/5] Sinh manifest SHA-256 ($LOCAL_N object)"
# Ghi ra file tạm rồi mới đổi tên: tiến trình chết giữa chừng KHÔNG được để lại một manifest cụt
# trông như manifest hợp lệ (bước diễn tập khôi phục sẽ tin nó và báo PASS sai).
TMP_MANIFEST="$MANIFEST.partial"
if ! (cd "$MIRROR_DIR" && find . -type f -printf '%P\n' | sort | while IFS= read -r k; do
        printf '%s\t%s\t%s\n' "$k" "$(stat -c%s "$k")" "$(sha256sum "$k" | cut -d' ' -f1)"
      done) > "$TMP_MANIFEST"; then
  alert "sinh manifest thất bại"; rm -f "$TMP_MANIFEST"; exit 1
fi
mv -f "$TMP_MANIFEST" "$MANIFEST"
sha256sum "$MANIFEST" | cut -d' ' -f1 > "$MANIFEST.sha256"

MIRROR_MB="$(du -sm "$MIRROR_DIR" | cut -f1)"
echo "   $LOCAL_N object · ${MIRROR_MB}MB · manifest: $(basename "$MANIFEST")"

echo "▶ [4/5] Off-host (tuỳ chọn)"
if [ -n "${NAS_SHARE:-}" ] && [ -n "${NAS_USER:-}" ]; then
  PUSH_FILES=("$(basename "$MANIFEST")" "$(basename "$MANIFEST").sha256")
  TARBALL=""
  if [ "${OBJ_TARBALL:-1}" = "1" ]; then
    if [ "$MIRROR_MB" -le "$OBJ_TARBALL_MAX_MB" ]; then
      TARBALL="$BACKUP_DIR/objects-$TS.tar.gz"
      if tar czf "$TARBALL.partial" -C "$MIRROR_DIR" . && mv -f "$TARBALL.partial" "$TARBALL"; then
        PUSH_FILES+=("$(basename "$TARBALL")")
      else
        rm -f "$TARBALL.partial"; alert "đóng gói tarball object thất bại — vẫn đẩy manifest"
      fi
    else
      echo "   bỏ tarball: bản gương ${MIRROR_MB}MB > ngưỡng ${OBJ_TARBALL_MAX_MB}MB (chỉ đẩy manifest)"
    fi
  fi
  CMDS="cd ${NAS_SUBDIR:-.};"
  for f in "${PUSH_FILES[@]}"; do CMDS="$CMDS put /data/$f $f;"; done
  if ! docker run --rm -v "$BACKUP_DIR":/data:ro alpine sh -c \
      "apk add --no-cache samba-client >/dev/null 2>&1 && smbclient '${NAS_SHARE}' -U '${NAS_USER}%${NAS_PASS:-}' -m SMB2 -c '$CMDS'"; then
    alert "đẩy kho object lên NAS thất bại — bản gương local vẫn giữ"
  fi
  # tarball chỉ là phương tiện vận chuyển off-host; bản gương mới là bản sao lưu chính.
  [ -n "$TARBALL" ] && rm -f "$TARBALL"
else
  echo "   NAS_* chưa cấu hình → CHỈ có bản sao trên CÙNG HOST. Mất host là mất luôn chứng từ."
fi

echo "▶ [5/5] Retention manifest (giữ $KEEP_MANIFESTS bản)"
# CHỈ dọn manifest. Bản gương KHÔNG bao giờ bị script này xoá — đó là toàn bộ bản sao lưu.
ls -1t "$BACKUP_DIR"/objects-manifest-*.tsv 2>/dev/null | tail -n +"$((KEEP_MANIFESTS+1))" | while IFS= read -r f; do
  rm -f "$f" "$f.sha256"
done

# Dấu vết cho watchdog kiểm "backup có còn tươi không".
date +%s > "$BACKUP_DIR/.objects-last-success"

echo "✓ backup object OK: $LOCAL_N object (${MIRROR_MB}MB) → $MIRROR_DIR"
