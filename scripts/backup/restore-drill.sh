#!/usr/bin/env bash
# ============================================================================
# QuanLY — DIỄN TẬP KHÔI PHỤC ĐẦY ĐỦ (chạy hằng tuần qua systemd timer).
#
# ── KHÁC GÌ restore-test.sh ─────────────────────────────────────────────────
# restore-test.sh chỉ chứng minh bản dump NẠP ĐƯỢC và có > 0 user. Từ 2026-08-11
# điều đó KHÔNG còn đồng nghĩa với "khôi phục được": ba trường PII đã mã hoá bằng
# PII_ENC_KEY, và ảnh chứng từ thanh toán đã rời sang kho object. Một bản dump nạp
# sạch sẽ vẫn có thể để lại CCCD/số tài khoản/lương hoá đá vĩnh viễn (sai khoá) và
# mọi hàng chứng từ trỏ vào object không tồn tại — mà bài test cũ vẫn báo PASS.
#
# Diễn tập này kiểm ĐỦ BA THỨ mà docs/DR-runbook.md nói là điều kiện cần:
#     bản dump CSDL   +   PII_ENC_KEY   +   bản sao kho object
#
# Bước 3 và 4 là phần mà bài test cũ không có; chúng chính là chỗ hỏng âm thầm.
#
# Cấu hình qua /etc/quanly-backup.env:
#   BACKUP_DIR, PG_CONTAINER, APP_DIR (/opt/stacks/quanly/quanly)
#   PII_ENC_KEY                       ← BẮT BUỘC để kiểm giải mã được
#   S3_*                              ← BẮT BUỘC để kiểm toàn vẹn chứng từ
#   TELEGRAM_BOT_TOKEN / TELEGRAM_ALERT_CHAT (alert — tuỳ chọn)
#
# KHÔNG đụng CSDL thật: chỉ tạo/xoá CSDL tạm riêng.
# ============================================================================
set -uo pipefail
[ -f /etc/quanly-backup.env ] && set -a && . /etc/quanly-backup.env && set +a

BACKUP_DIR="${BACKUP_DIR:-/opt/quanly-backups}"
PG_CONTAINER="${PG_CONTAINER:-quanly-postgres}"
APP_DIR="${APP_DIR:-/opt/stacks/quanly/quanly}"
APP_CONTAINER="${APP_CONTAINER:-quanly-app}"
TESTDB="quanly_restore_drill"
FAILED=""

alert() {
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_ALERT_CHAT:-}" ]; then
    curl -sf --max-time 15 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TELEGRAM_ALERT_CHAT}" -d text="🔴 QuanLY DIỄN TẬP KHÔI PHỤC LỖI: $1" >/dev/null 2>&1 || true
  fi
  echo "ERROR: $1" >&2
  FAILED="yes"
}

PGUSER="$(docker exec "$PG_CONTAINER" printenv POSTGRES_USER 2>/dev/null)" \
  || { alert "không đọc được POSTGRES_USER ($PG_CONTAINER)"; exit 1; }
NET="$(docker inspect "$PG_CONTAINER" -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null)"

cleanup() {
  docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d postgres \
    -c "DROP DATABASE IF EXISTS $TESTDB;" >/dev/null 2>&1 || true
  rm -f "${ENVFILE:-}" 2>/dev/null || true
}
trap cleanup EXIT

# ── 1) Bản dump mới nhất, có đối chiếu checksum ─────────────────────────────
echo "▶ [1/5] Chọn bản dump mới nhất"
LATEST="$(ls -1t "$BACKUP_DIR"/quanly-*.sql.gz 2>/dev/null | head -1)"
[ -z "$LATEST" ] && { alert "không có file backup nào trong $BACKUP_DIR"; exit 1; }
AGE_H=$(( ( $(date +%s) - $(stat -c%Y "$LATEST") ) / 3600 ))
echo "   $(basename "$LATEST") — ${AGE_H}h tuổi"
# RPO đã công bố là 24h; quá 26h nghĩa là lịch backup đã hỏng dù file vẫn còn đó.
[ "$AGE_H" -gt 26 ] && alert "bản dump mới nhất đã ${AGE_H}h tuổi — vượt RPO 24h công bố"
if [ -f "$LATEST.sha256" ]; then
  if [ "$(sha256sum "$LATEST" | awk '{print $1}')" != "$(cat "$LATEST.sha256")" ]; then
    alert "checksum bản dump KHÔNG khớp — file đã hỏng/bị sửa: $LATEST"; exit 1
  fi
  echo "   checksum khớp"
fi

# ── 2) Nạp vào CSDL TẠM ─────────────────────────────────────────────────────
echo "▶ [2/5] Nạp vào CSDL tạm ($TESTDB)"
docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS $TESTDB;" >/dev/null 2>&1
docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d postgres -c "CREATE DATABASE $TESTDB;" >/dev/null 2>&1 \
  || { alert "không tạo được CSDL tạm"; exit 1; }
if ! gunzip -c "$LATEST" | docker exec -i "$PG_CONTAINER" psql -U "$PGUSER" -d "$TESTDB" -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
  alert "nạp dump $LATEST vào CSDL tạm THẤT BẠI"; exit 1
fi
USERS="$(docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d "$TESTDB" -tAc 'SELECT count(*) FROM "User";' 2>/dev/null || echo 0)"
QUOTES="$(docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d "$TESTDB" -tAc 'SELECT count(*) FROM "Quote";' 2>/dev/null || echo 0)"
[ "${USERS:-0}" -lt 1 ] && { alert "restore xong nhưng 0 user (dump nghi hỏng): $LATEST"; exit 1; }
echo "   $USERS user · $QUOTES báo giá"

PGPASS="$(docker exec "$PG_CONTAINER" printenv POSTGRES_PASSWORD 2>/dev/null)"
ENVFILE="$(mktemp)"; chmod 600 "$ENVFILE"
{
  printf 'DATABASE_URL=postgresql://%s:%s@%s:5432/%s?schema=public\n' "$PGUSER" "$PGPASS" "$PG_CONTAINER" "$TESTDB"
  printf 'NODE_ENV=production\n'
  printf 'SESSION_SECRET=drill-only-session-secret-not-used-for-anything\n'
  printf 'JWT_SECRET=drill-only-jwt-secret-not-used-for-anything-here\n'
  printf 'MFA_ENC_KEY=drill-only-mfa-key\n'
  printf 'APP_BASE_URL=http://localhost:3000\n'
  [ -n "${PII_ENC_KEY:-}" ]   && printf 'PII_ENC_KEY=%s\n'   "$PII_ENC_KEY"
  [ -n "${S3_ENDPOINT:-}" ]   && printf 'S3_ENDPOINT=%s\n'   "$S3_ENDPOINT"
  [ -n "${S3_ACCESS_KEY:-}" ] && printf 'S3_ACCESS_KEY=%s\n' "$S3_ACCESS_KEY"
  [ -n "${S3_SECRET_KEY:-}" ] && printf 'S3_SECRET_KEY=%s\n' "$S3_SECRET_KEY"
  [ -n "${S3_BUCKET:-}" ]     && printf 'S3_BUCKET=%s\n'     "$S3_BUCKET"
} > "$ENVFILE"

# Chạy script kiểm tra bằng CHÍNH image production (có đủ mã + node_modules + prisma client).
in_app() {
  docker run --rm --network "$NET" --env-file "$ENVFILE" \
    --entrypoint sh "$(docker inspect "$APP_CONTAINER" -f '{{.Config.Image}}')" -c "$1"
}

# ── 3) Khoá mã hoá PII có giải mã được bản dump này không ───────────────────
echo "▶ [3/5] PII: khoá hiện hành có giải mã được dữ liệu trong bản dump không"
if [ -z "${PII_ENC_KEY:-}" ]; then
  echo "   ⚠ PII_ENC_KEY chưa đặt trong /etc/quanly-backup.env — BỎ QUA bước quan trọng nhất."
  echo "     Không có bước này thì không ai biết khoá đang giữ có mở được bản sao lưu hay không,"
  echo "     cho tới đúng lúc cần khôi phục thật."
  alert "PII_ENC_KEY chưa cấu hình cho diễn tập — khả năng giải mã bản sao lưu KHÔNG được kiểm chứng"
else
  if in_app 'npm run --silent pii:verify' 2>&1 | tee /tmp/drill-pii.log | tail -5; then
    echo "   PII giải mã lại OK"
  else
    alert "pii:verify THẤT BẠI — khoá không mở được dữ liệu trong bản dump (xem /tmp/drill-pii.log)"
  fi
fi

# ── 4) Chứng từ thanh toán: object còn đủ và đúng hash không ────────────────
echo "▶ [4/5] Chứng từ: object trong kho có khớp SHA-256 lưu trong CSDL không"
if [ -z "${S3_ENDPOINT:-}" ]; then
  echo "   ⚠ S3_* chưa đặt — BỎ QUA. Hàng chứng từ có thể đang trỏ vào object không tồn tại."
  alert "S3_* chưa cấu hình cho diễn tập — tính toàn vẹn chứng từ KHÔNG được kiểm chứng"
else
  if in_app 'npm run --silent proof:verify' 2>&1 | tee /tmp/drill-proof.log | tail -5; then
    echo "   Chứng từ toàn vẹn OK"
  else
    alert "proof:verify THẤT BẠI — object thiếu hoặc sai hash (xem /tmp/drill-proof.log)"
  fi
fi

# ── 5) Bản sao kho object có tồn tại và còn tươi không ──────────────────────
echo "▶ [5/5] Bản sao kho object"
MIRROR_DIR="$BACKUP_DIR/objects"
if [ ! -d "$MIRROR_DIR" ]; then
  alert "CHƯA CÓ bản sao kho object ($MIRROR_DIR) — mất bucket là mất chứng từ tài chính vĩnh viễn"
else
  OBJ_N="$(find "$MIRROR_DIR" -type f | wc -l)"
  LAST="$(cat "$BACKUP_DIR/.objects-last-success" 2>/dev/null || echo 0)"
  OBJ_AGE_H=$(( ( $(date +%s) - LAST ) / 3600 ))
  echo "   $OBJ_N object trong bản gương — lần sao lưu thành công gần nhất: ${OBJ_AGE_H}h trước"
  [ "$LAST" = "0" ] && alert "chưa từng có lượt sao lưu kho object thành công nào"
  [ "$LAST" != "0" ] && [ "$OBJ_AGE_H" -gt 26 ] && alert "bản sao kho object đã ${OBJ_AGE_H}h tuổi — lịch sao lưu object có vẻ đã hỏng"

  # Đối chiếu ngẫu nhiên: bản gương có ĐÚNG nội dung không, chứ không chỉ có ĐÚNG số file.
  MANIFEST="$(ls -1t "$BACKUP_DIR"/objects-manifest-*.tsv 2>/dev/null | head -1)"
  if [ -n "$MANIFEST" ] && [ "$OBJ_N" -gt 0 ]; then
    BAD=0; CHECKED=0
    while IFS=$'\t' read -r key size want; do
      [ -f "$MIRROR_DIR/$key" ] || { BAD=$((BAD+1)); continue; }
      got="$(sha256sum "$MIRROR_DIR/$key" | cut -d' ' -f1)"
      [ "$got" = "$want" ] || BAD=$((BAD+1))
      CHECKED=$((CHECKED+1))
    done < <(shuf -n 20 "$MANIFEST" 2>/dev/null || head -20 "$MANIFEST")
    if [ "$BAD" -gt 0 ]; then
      alert "bản gương kho object HỎNG: $BAD/$CHECKED mẫu sai hash hoặc thiếu file"
    else
      echo "   đối chiếu $CHECKED mẫu ngẫu nhiên: khớp hash"
    fi
  fi
fi

if [ -n "$FAILED" ]; then
  echo "✖ DIỄN TẬP KHÔI PHỤC CÓ HẠNG MỤC THẤT BẠI — xem log phía trên"
  exit 1
fi
date +%s > "$BACKUP_DIR/.drill-last-success"
echo "✓ DIỄN TẬP KHÔI PHỤC ĐẦY ĐỦ PASS: dump + khoá PII + kho object đều khôi phục được"
