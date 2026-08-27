#!/usr/bin/env bash
# Đặt NGAY dưới shebang có chủ ý: scripts/ci/check-shell-strict.mjs chỉ soi 40 dòng ĐẦU
# (`slice(0, 40)`), nên một khối chú thích dài đẩy dòng này xuống dưới là làm ĐỎ cổng [9/13]
# của `npm run verify` — dù hành vi lúc chạy vẫn đúng. Đừng nới cửa sổ 40 dòng của checker.
set -uo pipefail
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
# Diễn tập này kiểm ĐỦ BA THỨ mà docs/operations/DISASTER_RECOVERY.md nói là điều kiện cần:
#     bản dump CSDL   +   PII_ENC_KEY   +   bản sao kho object
#
# Bước 3 và 4 là phần mà bài test cũ không có; chúng chính là chỗ hỏng âm thầm.
#
# ── VÌ SAO CÓ BƯỚC 6 VÀ 7 (thêm 2026-08-27) ─────────────────────────────────
# Đến bản trước, diễn tập dừng ở chỗ ĐỌC: bước 5 chỉ so hash bản gương với manifest. Nó chứng minh
# "bản sao lưu chưa mục", KHÔNG chứng minh "khôi phục được". Hai thứ đó khác nhau, và chỗ khác nhau
# là chỗ hỏng lúc 2 giờ sáng:
#   · chưa lần nào ĐẨY NGƯỢC object từ bản gương vào một bucket. Đường khôi phục object hoàn toàn
#     chưa từng chạy — quyền của khoá S3 có đủ để `mb`/`put` không, tên khoá có sống sót qua vòng
#     bucket→đĩa→bucket không (tiền tố, ký tự lạ, khoá rỗng), mc có đọc lại đúng byte không. Tệ hơn:
#     docs/operations/DISASTER_RECOVERY.md ghi hẳn một bước "3. Khôi phục kho object" mà KHÔNG kèm
#     một lệnh nào và repo cũng không có script nào làm việc đó — tài liệu hứa một bước không tồn tại.
#   · chưa lần nào KHỞI ĐỘNG ỨNG DỤNG trên bản đã khôi phục. `verifyIntegrity.js` chạy bằng Prisma
#     nên bắt được lệch schema ở các bảng nó chạm, nhưng không bắt được: migration thiếu ở bảng khác,
#     app không kết nối nổi, route chết ngay lần chạm CSDL đầu. Khôi phục xong mà app không lên thì
#     RTO công bố là số ảo.
# Bước 6 đẩy một MẪU object vào BUCKET TẠM rồi đọc lại so SHA-256 (round-trip thật, không phải so
# hash trên đĩa). Bước 7 dựng chính IMAGE PRODUCTION trên CSDL tạm + bucket tạm rồi bắn 3 probe.
#
# Cấu hình qua /etc/quanly-backup.env:
#   BACKUP_DIR, PG_CONTAINER, APP_DIR (/opt/stacks/quanly/quanly)
#   PII_ENC_KEY                       ← BẮT BUỘC để kiểm giải mã được
#   S3_*                              ← BẮT BUỘC để kiểm toàn vẹn chứng từ + diễn tập khôi phục object
#   TELEGRAM_BOT_TOKEN / TELEGRAM_ALERT_CHAT (alert — tuỳ chọn)
#   DRILL_RESTORE_BUCKET  (mặc định "<S3_BUCKET>-restore-drill") — bucket TẠM để đẩy ngược
#   DRILL_RESTORE_N       (20)   số object lấy mẫu đẩy ngược; DRILL_RESTORE_ALL=1 để đẩy tất
#   DRILL_RESTORE_MAX_MB  (256)  trần tổng dung lượng một lượt đẩy ngược
#   DRILL_MAX_OBJ_MB      (64)   bỏ qua object đơn lẻ lớn hơn ngưỡng này khi lấy mẫu
#   DRILL_SMOKE_WAIT_S    (60)   trần chờ app lên ở bước 7
#   MC_IMAGE              (minio/mc:RELEASE.2024-11-21T17-21-54Z)
#
# ⛔ KHÔNG đụng PRODUCTION. Ba lớp cách ly, và cả ba đều có trap dọn dẹp ở EXIT:
#     CSDL   → CSDL TẠM riêng ($TESTDB), DROP khi thoát.
#     BUCKET → BUCKET TẠM riêng ($DRILL_BUCKET ≠ $S3_BUCKET, có chốt khẳng định), `mc rb` khi thoát.
#     APP    → container dùng-một-lần, KHÔNG publish cổng, `docker rm -f` khi thoát.
#   Bước 4 là bước DUY NHẤT chạm bucket thật, và chỉ ĐỌC (GetObject để so hash).
# ============================================================================
umask 077
[ -f /etc/quanly-backup.env ] && set -a && . /etc/quanly-backup.env && set +a

BACKUP_DIR="${BACKUP_DIR:-/opt/quanly-backups}"
PG_CONTAINER="${PG_CONTAINER:-quanly-postgres}"
APP_DIR="${APP_DIR:-/opt/stacks/quanly/quanly}"
APP_CONTAINER="${APP_CONTAINER:-quanly-app}"
TESTDB="quanly_restore_drill"
MIRROR_DIR="$BACKUP_DIR/objects"
MC_IMAGE="${MC_IMAGE:-minio/mc:RELEASE.2024-11-21T17-21-54Z}"
BUCKET="${S3_BUCKET:-quanly}"
DRILL_BUCKET="${DRILL_RESTORE_BUCKET:-$BUCKET-restore-drill}"
DRILL_RESTORE_N="${DRILL_RESTORE_N:-20}"
DRILL_RESTORE_MAX_MB="${DRILL_RESTORE_MAX_MB:-256}"
DRILL_MAX_OBJ_MB="${DRILL_MAX_OBJ_MB:-64}"
DRILL_SMOKE_WAIT_S="${DRILL_SMOKE_WAIT_S:-60}"
SMOKE_CID=""
FAILED=""
# ĐỒNG HỒ. docs/operations/DISASTER_RECOVERY.md công bố RTO "~30 phút" nhưng con số đó đo trên DEV
# với bản dump 615 KB — nó không nói gì về production. Đo ở đây thì mỗi Chủ nhật có thêm một điểm dữ
# liệu THẬT ở đúng CỠ DỮ LIỆU PRODUCTION cho phần đắt nhất và khó đoán nhất của RTO: nạp lại dump +
# xác minh + app lên. KHÔNG PHẢI RTO: lượt này chạy trên host còn sống, hạ tầng đã dựng, không kéo
# bản sao từ NAS về, không dựng lại VM. Nó là CẬN DƯỚI của RTO, và cận dưới đo được vẫn hơn số ước.
T0="$(date +%s)"

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

# `mc` chạy trong container để host không phải cài gì — CÙNG khuôn với backup-objects.sh, kể cả
# đường lộ credentials đã ghi nhận ở đó (`-e MC_HOST_q` nạp cặp khoá vào Config.Env của container,
# `docker inspect` đọc được suốt thời gian lệnh chạy; là đường lộ CỤC BỘ trên host).
# KHÁC một điểm CÓ CHỦ Ý: bản gương mount READ-ONLY. Diễn tập chỉ được ĐỌC bản sao lưu — một lệnh
# gõ nhầm chiều (`mc mirror q/bucket /mirror` thay vì ngược lại) mà bản gương ghi được thì diễn tập
# tự tay ghi đè chính bản sao lưu nó đang đi kiểm.
mc() {
  MC_HOST_q="${S3_ENDPOINT/:\/\//://${S3_ACCESS_KEY}:${S3_SECRET_KEY}@}" \
  docker run --rm --network host \
    -e MC_HOST_q \
    -v "$MIRROR_DIR":/mirror:ro \
    "$MC_IMAGE" "$@"
}

cleanup() {
  docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d postgres \
    -c "DROP DATABASE IF EXISTS $TESTDB;" >/dev/null 2>&1 || true
  [ -n "$SMOKE_CID" ] && docker rm -f "$SMOKE_CID" >/dev/null 2>&1
  # Bucket tạm: chỉ xoá khi nó THẬT SỰ khác bucket production. Chốt này thừa theo cách đặt tên hiện
  # tại (luôn có hậu tố), và nó thừa một cách CỐ Ý: `mc rb --force` xoá sạch bucket kèm nội dung, nên
  # đây là dòng nguy hiểm nhất trong file. Một lần ai đó đặt DRILL_RESTORE_BUCKET=$S3_BUCKET cho
  # "tiện" là mất toàn bộ chứng từ tài chính — chốt phải nằm ở ĐÂY, sát chỗ xoá, chứ không chỉ ở chỗ tạo.
  # `-d "$MIRROR_DIR"`: mc() mount thư mục đó vào container, mà `docker run -v` TỰ TẠO đường dẫn
  # thiếu bằng root:root 0755 — tức chỉ dọn dẹp thôi cũng đủ đẻ ra một thư mục ai-cũng-đọc trong
  # /opt/quanly-backups trên host chưa từng chạy backup object.
  if [ -n "${S3_ENDPOINT:-}" ] && [ -d "$MIRROR_DIR" ] && [ -n "$DRILL_BUCKET" ] && [ "$DRILL_BUCKET" != "$BUCKET" ]; then
    mc rb --force "q/$DRILL_BUCKET" >/dev/null 2>&1 || true
  fi
  rm -f "${ENVFILE:-}" "${SAMPLE:-}" 2>/dev/null || true
}
trap cleanup EXIT

# ── 1) Bản dump mới nhất, có đối chiếu checksum ─────────────────────────────
echo "▶ [1/7] Chọn bản dump mới nhất"
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
echo "▶ [2/7] Nạp vào CSDL tạm ($TESTDB)"
# Chỗ trống đĩa TRƯỚC khi nạp. CSDL tạm nằm trong CÙNG volume với Postgres production
# (quanly-pgdata), nên một lượt diễn tập nhân đôi dung lượng: đầy volume = production NGỪNG GHI,
# đúng 3h sáng Chủ nhật, do chính bộ máy sinh ra để bảo vệ nó. backup-db.sh đã kiểm điều này ở
# bước 0) cho đĩa host; ở đây phải kiểm cho volume của Postgres.
# Ba phép đo dưới đây phải FAIL-CLOSED. Bản trước nuốt lỗi bằng `2>/dev/null` mà không kiểm kết
# quả: PGDB rỗng (container đổi tên/chưa lên), psql sai quyền, df lỗi — tất cả đều cho DB_MB rỗng,
# rồi `${DB_MB:-0} * 2` = 0 kéo ngưỡng xuống đúng sàn 500MB, KHÔNG cảnh báo. Với CSDL 50GB và
# volume còn 600MB thì điều kiện vẫn qua và bản dump vẫn được nạp — đúng sự cố mà chốt này sinh ra
# để chặn. Không đo được điều kiện an toàn thì BỎ một lượt diễn tập, chứ không đoán.
PGDB="$(docker exec "$PG_CONTAINER" printenv POSTGRES_DB 2>/dev/null)"
[ -n "$PGDB" ] || { alert "không đọc được POSTGRES_DB ($PG_CONTAINER) — không đo được cỡ CSDL, DỪNG diễn tập"; exit 1; }
DB_MB="$(docker exec "$PG_CONTAINER" psql -U "$PGUSER" -d postgres -tAc "SELECT pg_database_size('$PGDB')/1048576;" 2>/dev/null | tr -cd '0-9')"
[ -n "$DB_MB" ] || { alert "không đo được cỡ CSDL '$PGDB' — DỪNG (sàn 500MB sẽ cho qua cả CSDL 50GB)"; exit 1; }
AVAIL_MB="$(docker exec "$PG_CONTAINER" df -Pm /var/lib/postgresql/data 2>/dev/null | awk 'NR==2{print $4}' | tr -cd '0-9')"
[ -n "$AVAIL_MB" ] || { alert "không đọc được chỗ trống volume Postgres — DỪNG"; exit 1; }
NEED_MB=$(( DB_MB * 2 )); [ "$NEED_MB" -lt 500 ] && NEED_MB=500
if [ "$AVAIL_MB" -lt "$NEED_MB" ]; then
  alert "volume Postgres còn ${AVAIL_MB}MB, bản sao tạm cần ~${NEED_MB}MB — DỪNG, không làm đầy volume production"
  exit 1
fi
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

# Chạy kiểm tra bằng CHÍNH image production.
#
# CỐ Ý gọi `node dist/tools/verifyIntegrity.js`, KHÔNG gọi `npm run pii:verify` / `proof:verify`.
# Hai script npm ấy nằm ở scripts/migration/*.mjs, import mã nguồn TypeScript và cần tsx — mà image
# production CHỈ chứa dist/, không có scripts/, không có src/, không có tsx. Gọi chúng ở đây sẽ
# MODULE_NOT_FOUND mỗi tối Chủ nhật: hai bước quan trọng nhất luôn báo thất bại, .drill-last-success
# không bao giờ được ghi, và watchdog bắn cảnh báo "CHƯA TỪNG chạy thành công" mỗi 6 giờ, mãi mãi.
in_app() {
  docker run --rm --network "$NET" --env-file "$ENVFILE" \
    --entrypoint sh "$(docker inspect "$APP_CONTAINER" -f '{{.Config.Image}}')" -c "$1"
}

# ── 3) Khoá mã hoá PII có giải mã được bản dump này không ───────────────────
echo "▶ [3/7] PII: khoá hiện hành có giải mã được dữ liệu trong bản dump không"
if [ -z "${PII_ENC_KEY:-}" ]; then
  echo "   ⚠ PII_ENC_KEY chưa đặt trong /etc/quanly-backup.env — BỎ QUA bước quan trọng nhất."
  echo "     Không có bước này thì không ai biết khoá đang giữ có mở được bản sao lưu hay không,"
  echo "     cho tới đúng lúc cần khôi phục thật."
  alert "PII_ENC_KEY chưa cấu hình cho diễn tập — khả năng giải mã bản sao lưu KHÔNG được kiểm chứng"
else
  if in_app 'node dist/tools/verifyIntegrity.js --pii' 2>&1 | tee /tmp/drill-pii.log | tail -5; then
    echo "   PII giải mã lại OK"
  else
    alert "pii:verify THẤT BẠI — khoá không mở được dữ liệu trong bản dump (xem /tmp/drill-pii.log)"
  fi
fi

# ── 4) Chứng từ thanh toán: object còn đủ và đúng hash không ────────────────
echo "▶ [4/7] Chứng từ: object trong kho có khớp SHA-256 lưu trong CSDL không"
if [ -z "${S3_ENDPOINT:-}" ]; then
  echo "   ⚠ S3_* chưa đặt — BỎ QUA. Hàng chứng từ có thể đang trỏ vào object không tồn tại."
  alert "S3_* chưa cấu hình cho diễn tập — tính toàn vẹn chứng từ KHÔNG được kiểm chứng"
else
  if in_app 'node dist/tools/verifyIntegrity.js --proof' 2>&1 | tee /tmp/drill-proof.log | tail -5; then
    echo "   Chứng từ toàn vẹn OK"
  else
    alert "proof:verify THẤT BẠI — object thiếu hoặc sai hash (xem /tmp/drill-proof.log)"
  fi
fi

# ── 5) Bản sao kho object có tồn tại và còn tươi không ──────────────────────
echo "▶ [5/7] Bản sao kho object"
# (MIRROR_DIR đặt ở đầu file — bước 6 và cleanup cũng dùng.)
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

# ── 6) KHÔI PHỤC THẬT kho object: đẩy ngược vào BUCKET TẠM rồi đọc lại ──────
# Bước 5 chỉ đọc bản gương TRÊN ĐĨA. Bước này đi hết vòng: đĩa → PUT vào bucket → GET ra → so
# SHA-256 với manifest. Nó là bước duy nhất chứng minh được rằng cái ghi trong runbook
# ("3. Khôi phục kho object") có thật sự chạy được bằng đúng khoá và đúng công cụ đang có.
echo "▶ [6/7] Khôi phục kho object: bản gương → bucket TẠM → đọc lại so SHA-256"
RESTORED_N=0
if [ -z "${S3_ENDPOINT:-}" ]; then
  alert "S3_* chưa cấu hình — đường KHÔI PHỤC kho object CHƯA TỪNG được chạy thử lần nào"
elif [ ! -d "$MIRROR_DIR" ]; then
  echo "   bỏ qua: không có bản gương để khôi phục (đã báo ở bước 5)"
elif [ "$DRILL_BUCKET" = "$BUCKET" ]; then
  # KHÔNG BAO GIỜ được đẩy vào bucket thật: bản gương là CỘNG DỒN (backup-objects.sh cố ý không
  # dùng --remove), nên nó còn giữ cả object mà retention đã xoá hợp lệ. Đẩy nguyên bản gương vào
  # bucket production là HỒI SINH dữ liệu đã được xoá đúng quy trình — vi phạm chính sách lưu trữ,
  # và với dữ liệu người dùng đã yêu cầu xoá thì là vi phạm cam kết.
  alert "DRILL_RESTORE_BUCKET trùng bucket production ($BUCKET) — TỪ CHỐI đẩy ngược. Đặt tên khác."
elif [ "${#DRILL_BUCKET}" -lt 3 ] || [ "${#DRILL_BUCKET}" -gt 63 ]; then
  alert "tên bucket tạm '$DRILL_BUCKET' dài ${#DRILL_BUCKET} ký tự — ngoài khoảng 3..63 mà S3 cho phép"
else
  MANIFEST6="$(ls -1t "$BACKUP_DIR"/objects-manifest-*.tsv 2>/dev/null | head -1)"
  MAN_N=0
  [ -n "$MANIFEST6" ] && MAN_N="$(awk 'NF{n++} END{print n+0}' "$MANIFEST6")"
  if [ -z "$MANIFEST6" ]; then
    alert "không có manifest — không biết object nào cần khôi phục và hash đúng của nó là gì"
  elif [ "$MAN_N" -eq 0 ]; then
    echo "   manifest rỗng: kho object chưa có object nào — không có gì để khôi phục"
  else
    # Tàn dư của một lượt bị cắt giữa chừng (máy reboot đúng lúc diễn tập) sẽ làm lượt này đo nhầm.
    mc rb --force "q/$DRILL_BUCKET" >/dev/null 2>&1 || true
    if ! mc mb -p "q/$DRILL_BUCKET" >/tmp/drill-restore.log 2>&1; then
      alert "không tạo được bucket tạm '$DRILL_BUCKET' — khoá S3 có thể thiếu quyền CreateBucket (xem /tmp/drill-restore.log). Cách khác: tạo sẵn một bucket RỖNG rồi đặt DRILL_RESTORE_BUCKET=<tên> trong /etc/quanly-backup.env"
    else
      SAMPLE="$(mktemp)"
      if [ "${DRILL_RESTORE_ALL:-0}" = "1" ]; then
        cat "$MANIFEST6" > "$SAMPLE"
      else
        # MẪU, KHÔNG PHẢI TOÀN BỘ — nói thẳng giới hạn của bước này. Đẩy lại toàn kho mỗi Chủ nhật
        # là nhân đôi dung lượng kho object hằng tuần và kéo dài diễn tập vô hạn theo cỡ dữ liệu.
        # Mẫu chứng minh ĐƯỜNG khôi phục chạy được (quyền, tên khoá, byte về nguyên vẹn); nó KHÔNG
        # chứng minh cả 100% object khôi phục được. Muốn kiểm toàn bộ: DRILL_RESTORE_ALL=1, và nên
        # chạy tay ở một lượt diễn tập có người ngồi canh chứ không để trong lịch hằng tuần.
        shuf -n "$DRILL_RESTORE_N" "$MANIFEST6" 2>/dev/null > "$SAMPLE" \
          || head -n "$DRILL_RESTORE_N" "$MANIFEST6" > "$SAMPLE"
      fi
      BUDGET_KB=$(( DRILL_RESTORE_MAX_MB * 1024 )); MAXOBJ_KB=$(( DRILL_MAX_OBJ_MB * 1024 ))
      USED_KB=0; R_OK=0; R_BAD=0; R_SKIP=0
      while IFS=$'\t' read -r key size want; do
        [ -n "$key" ] || continue
        # File thiếu trong bản gương đã được bước 5 tính là hỏng rồi — ở đây bỏ qua, không tính hai lần.
        [ -f "$MIRROR_DIR/$key" ] || { R_SKIP=$((R_SKIP+1)); continue; }
        SZ="$(printf '%s' "${size:-0}" | tr -cd '0-9')"; [ -n "$SZ" ] || SZ=0
        KB=$(( (SZ + 1023) / 1024 ))
        [ "$KB" -gt "$MAXOBJ_KB" ] && { R_SKIP=$((R_SKIP+1)); continue; }
        [ $(( USED_KB + KB )) -gt "$BUDGET_KB" ] && break
        USED_KB=$(( USED_KB + KB ))
        if ! mc cp --quiet "/mirror/$key" "q/$DRILL_BUCKET/$key" >>/tmp/drill-restore.log 2>&1; then
          R_BAD=$((R_BAD+1)); continue
        fi
        # ĐỌC LẠI TỪ BUCKET, không đọc lại từ đĩa. Đọc lại từ đĩa thì chỉ lặp lại bước 5 và luôn khớp
        # kể cả khi PUT lên bucket đã cắt cụt/đổi nội dung. Ống hỏng ở giữa cũng cho hash rỗng ≠ want.
        got="$(mc cat "q/$DRILL_BUCKET/$key" 2>>/tmp/drill-restore.log | sha256sum | cut -d' ' -f1)"
        if [ "$got" = "$want" ]; then R_OK=$((R_OK+1)); else R_BAD=$((R_BAD+1)); fi
      done < "$SAMPLE"
      RESTORED_N="$R_OK"
      if [ "$R_BAD" -gt 0 ]; then
        alert "KHÔI PHỤC OBJECT HỎNG: $R_BAD/$((R_OK+R_BAD)) object đẩy ngược rồi đọc lại KHÔNG khớp SHA-256 (xem /tmp/drill-restore.log)"
      elif [ "$R_OK" -lt 1 ]; then
        alert "không khôi phục được object nào trong $MAN_N object của manifest (bỏ qua $R_SKIP — thiếu file, hoặc mọi object đều vượt trần ${DRILL_MAX_OBJ_MB}MB/object)"
      else
        echo "   $R_OK object đẩy ngược + đọc lại khớp hash (~$(( USED_KB / 1024 ))MB; bỏ qua $R_SKIP; kho có $MAN_N)"
      fi
    fi
  fi
fi

# ── 7) SMOKE TEST: image production có LÊN được trên bản vừa khôi phục không ─
# Ba bước trên chứng minh DỮ LIỆU đọc được. Bước này chứng minh ỨNG DỤNG chạy được trên nó —
# hai chuyện khác nhau: dump nạp sạch vẫn có thể lệch schema so với image đang chạy (migration
# thêm cột sau ngày dump, hoặc dump lấy từ nhánh khác), và `verifyIntegrity.js` chỉ chạm những
# bảng nó cần nên không thấy. Khôi phục xong mà app không lên thì RTO công bố là số ảo.
echo "▶ [7/7] Smoke test: khởi động image production trên CSDL vừa khôi phục"
IMAGE="$(docker inspect "$APP_CONTAINER" -f '{{.Config.Image}}' 2>/dev/null)"
if [ -z "$IMAGE" ]; then
  alert "không đọc được image của $APP_CONTAINER — KHÔNG chạy được smoke test sau khôi phục"
else
  # KHÔNG `-p`: container này không được lộ ra ngoài host. Mọi probe đi qua `docker exec` bên trong.
  # `-e S3_BUCKET` trỏ app vào BUCKET TẠM vừa khôi phục, KHÔNG phải bucket thật — app gọi
  # ensureBucket() lúc khởi động, và một lượt diễn tập không được chạm kho production.
  SMOKE_CID="$(docker run -d --network "$NET" --env-file "$ENVFILE" \
    -e "S3_BUCKET=$DRILL_BUCKET" "$IMAGE" 2>/tmp/drill-smoke.log)"
  if [ -z "$SMOKE_CID" ]; then
    alert "không khởi động được container smoke: $(head -c 300 /tmp/drill-smoke.log | tr '\n' ' ')"
  else
    UP=""; WAITED=0
    while [ "$WAITED" -lt "$DRILL_SMOKE_WAIT_S" ]; do
      if docker exec "$SMOKE_CID" wget -q -O /dev/null http://127.0.0.1:3000/livez 2>/dev/null; then
        UP="yes"; break
      fi
      # App chết hẳn (config sai, Prisma không nối được) thì đừng ngồi chờ hết trần — thoát ngay để
      # log lỗi thật nằm ở đầu cảnh báo thay vì một dòng "quá hạn 60s" không nói gì.
      [ "$(docker inspect -f '{{.State.Running}}' "$SMOKE_CID" 2>/dev/null)" = "true" ] || break
      sleep 2; WAITED=$((WAITED+2))
    done
    if [ -z "$UP" ]; then
      docker logs --tail 40 "$SMOKE_CID" > /tmp/drill-smoke.log 2>&1 || true
      alert "app KHÔNG lên được trên bản vừa khôi phục (/livez im lặng sau ${WAITED}s) — xem /tmp/drill-smoke.log"
    else
      echo "   /livez OK sau ${WAITED}s"
      # /readyz chạm CSDL thật qua Prisma (SELECT 1). 503 = app không dùng được CSDL vừa nạp.
      if docker exec "$SMOKE_CID" wget -q -O /dev/null http://127.0.0.1:3000/readyz 2>/dev/null; then
        echo "   /readyz OK — app kết nối được CSDL vừa khôi phục"
      else
        alert "/readyz trả lỗi trên CSDL vừa khôi phục — app không dùng được bản sao lưu này"
      fi
      # ĐƯỜNG DỮ LIỆU THẬT, không chỉ SELECT 1: đăng nhập bằng một tài khoản CHẮC CHẮN không tồn tại.
      # Nó buộc Prisma đọc bảng "User" của bản dump bằng client đã biên dịch trong image → lệch
      # schema sẽ ra 500. Mong đợi 401 (sai thông tin) hoặc 423 (khoá tạm) — cả hai đều là câu trả
      # lời nghiệp vụ, nghĩa là đường đọc dữ liệu còn nguyên. KHÔNG dùng tài khoản thật: mật khẩu sai
      # nhiều lần sẽ khoá đúng tài khoản đó trong CSDL tạm và làm nhiễu số liệu lockout.
      # (curl không có trong image; busybox wget không trả về mã HTTP — nên dùng fetch của node 22.)
      if docker exec "$SMOKE_CID" node -e 'const b=JSON.stringify({username:"drill-tai-khoan-khong-ton-tai",password:"x"});fetch("http://127.0.0.1:3000/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:b}).then(r=>{console.log("status",r.status);process.exit(r.status===401||r.status===423?0:1);}).catch(e=>{console.log("ERR",e.message);process.exit(1);});' >/tmp/drill-smoke-login.log 2>&1; then
        echo "   POST /api/auth/login → $(cat /tmp/drill-smoke-login.log) (đúng: đọc được bảng User)"
      else
        alert "đường đọc dữ liệu HỎNG sau khôi phục: POST /api/auth/login trả $(head -c 200 /tmp/drill-smoke-login.log | tr '\n' ' ') thay vì 401 — nghi lệch schema giữa bản dump và image"
      fi
    fi
  fi
fi

ELAPSED=$(( $(date +%s) - T0 ))
if [ -n "$FAILED" ]; then
  echo "✖ DIỄN TẬP KHÔI PHỤC CÓ HẠNG MỤC THẤT BẠI sau ${ELAPSED}s — xem log phía trên"
  exit 1
fi
# Chỉ ghi thời lượng của lượt ĐẠT: thời lượng của một lượt hỏng giữa chừng không đo được cái gì cả.
printf '%s\t%s\n' "$(date +%s)" "$ELAPSED" > "$BACKUP_DIR/.drill-last-duration" 2>/dev/null || true
echo "   thời lượng lượt này: ${ELAPSED}s (cận dưới của RTO — host còn sống, hạ tầng đã dựng)"
date +%s > "$BACKUP_DIR/.drill-last-success"
echo "✓ DIỄN TẬP KHÔI PHỤC ĐẦY ĐỦ PASS: dump nạp được, khoá PII mở được, chứng từ toàn vẹn,"
echo "  object đẩy ngược được vào bucket ($RESTORED_N mẫu khớp hash), và app production LÊN được trên bản đó."
