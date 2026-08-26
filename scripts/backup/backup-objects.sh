#!/usr/bin/env bash
# ============================================================================
# QuanLY — sao lưu KHO OBJECT (ảnh chứng từ thanh toán, tệp đính kèm, bản xuất).
#
# ── VÌ SAO CÓ FILE NÀY ──────────────────────────────────────────────────────
# Bản dump Postgres KHÔNG còn chứa đủ dữ liệu để khôi phục. Từ 2026-08-11 ảnh
# chứng từ thanh toán đã rời CSDL sang kho object; CSDL chỉ giữ khoá + SHA-256.
# docs/operations/DISASTER_RECOVERY.md đã ghi nhận đúng khoảng trống này ("kho object production
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
# Bản gương chứa ẢNH CHỨNG TỪ THANH TOÁN. umask kế thừa của systemd (0022) cho ra 0644/0755,
# tức mọi tài khoản trên host đọc được chứng từ tài chính. Đặt ở đầu để bao cả manifest và tarball.
umask 077
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
  # `-e "MC_HOST_q=<url có access key + secret key>"` đặt cả cặp khoá kho object vào ARGV của
  # `docker run` — hiện ở `ps aux` trên host trong suốt thời gian mirror (có thể vài phút). Truyền
  # bằng BIẾN MÔI TRƯỜNG (`-e TÊN`, không kèm giá trị) thì docker đọc từ môi trường tiến trình cha,
  # không có gì lọt ra dòng lệnh.
  MC_HOST_q="${S3_ENDPOINT/:\/\//://${S3_ACCESS_KEY}:${S3_SECRET_KEY}@}" \
  docker run --rm --network host \
    -e MC_HOST_q \
    -v "$MIRROR_DIR":/mirror \
    "$MC_IMAGE" "$@"
}

echo "▶ [1/5] Gương bucket q/$BUCKET → $MIRROR_DIR (cộng dồn, KHÔNG lan truyền xoá)"
if ! mc mirror --quiet --overwrite "q/$BUCKET" /mirror; then
  alert "mc mirror thất bại (bucket $BUCKET @ $S3_ENDPOINT)"; exit 1
fi

echo "▶ [2/5] Đối chiếu số lượng object bucket ↔ bản gương"
# CỔNG NÀY TỪNG TỰ VÔ HIỆU. Bản cũ là:
#     REMOTE_N="$(mc ls --recursive "q/$BUCKET" 2>/dev/null | grep -c . || echo 0)"
# `grep -c .` khi không khớp dòng nào IN RA "0" RỒI THOÁT VỚI MÃ 1, nên `|| echo 0` chạy THÊM và
# REMOTE_N thành chuỗi hai dòng "0\n0". `[ "$REMOTE_N" -gt 0 ]` gặp chuỗi đó thì in
# "integer expression expected" và trả mã 2 — điều kiện SAI, nhánh cảnh báo không chạy, và script
# (không có `set -e`) đi tiếp in "✓ backup object OK". Cộng thêm `2>/dev/null` nuốt lỗi của mc:
# `mc ls` hỏng cũng rơi đúng vào tình huống ấy. Nghĩa là cổng kiểm tính đầy đủ của bản sao lưu
# CHỨNG TỪ TÀI CHÍNH tắt đúng lúc cần nhất. (Đã đo lại trong tests/hq3-backup-object-count.test.js.)
#
# Sửa theo ba điểm: tách LIỆT KÊ khỏi ĐẾM để kiểm được mã thoát của mc; giữ stderr của mc để đưa vào
# cảnh báo thay vì vứt đi; và đếm bằng awk — luôn in ra một số, kể cả khi danh sách rỗng hoặc thiếu
# ký tự xuống dòng ở dòng cuối.
REMOTE_LIST="$(mktemp)"
if ! mc ls --recursive "q/$BUCKET" > "$REMOTE_LIST" 2>"$REMOTE_LIST.err"; then
  alert "mc ls thất bại — KHÔNG đối chiếu được bản gương: $(head -c 300 "$REMOTE_LIST.err" | tr '\n' ' ')"
  rm -f "$REMOTE_LIST" "$REMOTE_LIST.err"; exit 1
fi
REMOTE_N="$(awk 'NF{n++} END{print n+0}' "$REMOTE_LIST")"
rm -f "$REMOTE_LIST" "$REMOTE_LIST.err"
LOCAL_N="$(find "$MIRROR_DIR" -type f | wc -l)"
if [ "$LOCAL_N" -lt "$REMOTE_N" ]; then
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
# Bản gương do `mc` trong container tạo ra nên KHÔNG chịu umask của script này — mc chạy bằng root
# với umask riêng của nó. Siết lại sau mỗi lượt: chứng từ tài chính không để ai-cũng-đọc.
chmod 600 "$MANIFEST" "$MANIFEST.sha256"
chmod -R go-rwx "$MIRROR_DIR"

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
  # Mật khẩu NAS đi qua biến môi trường, KHÔNG nội suy vào chuỗi lệnh: chuỗi lệnh nằm trong argv nên
  # hiện ở `ps aux` trên host và trong `docker inspect` container tạm. Bên trong thì ghi credentials
  # ra file (umask 077) rồi `smbclient -A`.
  if ! NAS_SHARE="$NAS_SHARE" NAS_USER="$NAS_USER" NAS_PASS="${NAS_PASS:-}" NAS_CMDS="$CMDS" \
      docker run --rm -e NAS_SHARE -e NAS_USER -e NAS_PASS -e NAS_CMDS \
      -v "$BACKUP_DIR":/data:ro alpine sh -c \
      'apk add --no-cache samba-client >/dev/null 2>&1 || exit 1
       umask 077; printf "username=%s\npassword=%s\n" "$NAS_USER" "$NAS_PASS" > /tmp/cred
       smbclient "$NAS_SHARE" -A /tmp/cred -m SMB2 -c "$NAS_CMDS"'; then
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
