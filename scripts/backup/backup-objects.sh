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
#   S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET
#                        Thiếu trong tệp env thì ĐỌC TỪ container app ($APP_CONTAINER, mặc định
#                        quanly-app) — đúng bộ khoá app đang dùng. Lý do: production đo 2026-09-22
#                        KHÔNG có timer này và /etc/quanly-backup.env chưa có S3_*, tức kho chứng từ
#                        chưa từng được sao lưu; bắt chủ repo chép tay thêm một bộ khoá nữa là thêm
#                        một bước để bị bỏ quên. Khoá riêng cho backup (quyền chỉ-đọc) vẫn tốt hơn —
#                        đặt S3_* trong tệp env là nó thắng.
#   OBJ_TARBALL=1        (tuỳ chọn) đóng gói .tar.gz để đẩy off-host
#   OBJ_TARBALL_MAX_MB   (2048) — vượt ngưỡng thì bỏ đóng gói, chỉ đẩy manifest
#   OBJ_VERSIONING=1     (tuỳ chọn, MẶC ĐỊNH TẮT) bật versioning trên bucket nguồn nếu provider
#                        hỗ trợ — xem bước [0/5] và DISASTER_RECOVERY.md để biết vì sao mặc định tắt
#   OBJ_VERSIONING_KEEP_DAYS (30) số ngày giữ phiên bản cũ khi OBJ_VERSIONING=1
#   NAS_SHARE/NAS_USER/NAS_PASS/NAS_SUBDIR                 (off-host NAS)
#   OFFHOST_RCLONE_REMOTE/OFFHOST_RCLONE_CONFIG            (off-host rclone crypt — offhost-lib.sh)
#   TELEGRAM_BOT_TOKEN, TELEGRAM_ALERT_CHAT                (alert — tuỳ chọn)
#   MC_IMAGE (quay.io/minio/mc:RELEASE.2024-11-21T17-21-54Z@sha256:…)
#
# Off-host CHƯA cấu hình → vẫn exit 0 (bản gương local vẫn là bản sao lưu), in cảnh báo
# OFFHOST-CHUA-CAU-HINH và ghi tệp trạng thái; KHÔNG gửi Telegram mỗi đêm (chủ repo chốt 2026-09-23).
# ============================================================================
set -uo pipefail
# Bản gương chứa ẢNH CHỨNG TỪ THANH TOÁN. umask kế thừa của systemd (0022) cho ra 0644/0755,
# tức mọi tài khoản trên host đọc được chứng từ tài chính. Đặt ở đầu để bao cả manifest và tarball.
umask 077
[ -f /etc/quanly-backup.env ] && set -a && . /etc/quanly-backup.env && set +a

BACKUP_DIR="${BACKUP_DIR:-/opt/quanly-backups}"
MIRROR_DIR="$BACKUP_DIR/objects"
KEEP_MANIFESTS="${KEEP_MANIFESTS:-30}"
# Docker Hub đã GỠ minio/mc (đo 2026-09-23: hub.docker.com/v2/repositories/minio/mc → 404), nên tên
# cũ không kéo được trên máy mới. quay.io vẫn phát hành đúng bản đó, cùng digest — ghim theo digest
# để "cùng tên" không thể thành "khác nội dung". Đã `docker pull` thử theo digest ngày 2026-09-23.
MC_IMAGE="${MC_IMAGE:-quay.io/minio/mc:RELEASE.2024-11-21T17-21-54Z@sha256:993e8c454a7ec632923f7e3e61adf1d473261da6354cefd641aedd33a2cfe112}"
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

LIB="$(cd "$(dirname "$0")" && pwd)/offhost-lib.sh"
CO_LIB=0
# shellcheck source=offhost-lib.sh
[ -f "$LIB" ] && . "$LIB" && CO_LIB=1
OFFHOST_LOI=0

# Khoá kho object: tệp env thắng; thiếu thì lấy của app (xem chú thích đầu tệp). Đọc bằng
# `docker exec printenv` vào biến của shell này — không đi qua argv của tiến trình nào khác.
APP_CONTAINER="${APP_CONTAINER:-quanly-app}"
for v in S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY S3_BUCKET; do
  if [ -z "${!v:-}" ]; then
    val="$(docker exec "$APP_CONTAINER" printenv "$v" 2>/dev/null)" || val=""
    [ -n "$val" ] && printf -v "$v" '%s' "$val"
  fi
done
unset val
for v in S3_ENDPOINT S3_ACCESS_KEY S3_SECRET_KEY; do
  [ -n "${!v:-}" ] || { alert "thiếu $v (không có trong /etc/quanly-backup.env, cũng không đọc được từ $APP_CONTAINER) — không biết sao lưu kho nào"; exit 1; }
done
BUCKET="${S3_BUCKET:-quanly}"

mkdir -p "$MIRROR_DIR"

# Chỗ trống đĩa: sao lưu mà làm đầy đĩa thì kéo sập luôn Postgres đang chạy cùng host.
AVAIL_MB="$(df -Pm "$BACKUP_DIR" | awk 'NR==2{print $4}')"
if [ "${AVAIL_MB:-0}" -lt 500 ]; then
  alert "đĩa chứa backup chỉ còn ${AVAIL_MB}MB — dừng trước khi làm đầy đĩa"; exit 1
fi

# `mc` chạy trong container để host không phải cài gì. --quiet để log không ngập tên từng object.
#
# ── MẠNG (ultracode audit 2026-09-09, finding H5) ────────────────────────────────────────────────
# TRƯỚC bản vá: `--network host` đặt container `mc` vào network namespace của HOST, bỏ qua hẳn DNS
# nội bộ (127.0.0.11) mà chỉ thành viên network bridge của compose mới có. MinIO (docker-compose.
# prod.yml, service `minio`) CHỈ publish `127.0.0.1:9001` (console) ra host — cổng S3 API 9000 CHƯA
# BAO GIỜ mở ra ngoài network `internal` (đúng ý đồ, xem chú thích trong compose). Nghĩa là với
# `--network host`, KHÔNG có `S3_ENDPOINT` nào (kể cả `http://minio:9000` lẫn `http://127.0.0.1:9000`)
# mà `mc` trong container đó với tới được — toàn bộ chuỗi backup/restore-drill kho object CHƯA BAO
# GIỜ hoạt động kể từ khi MinIO lên production (fc053c2), dù không lỗi nào từng hiện ra vì
# `/etc/quanly-backup.env` cũng chưa được điền S3_* (script thoát sớm ở nhánh kiểm biến môi trường).
#
# CÁCH VÁ: gắn container `mc` vào ĐÚNG network mà `quanly-minio` đang tham gia — dò bằng
# `docker inspect` thay vì hardcode tên network (`docker compose` đặt tên theo project, đổi tên thư
# mục/`-p` là tên network đổi theo — dò động không phụ thuộc quy ước đặt tên đó). Trong network đó,
# tên service `minio` là DNS hợp lệ (docker-compose tự alias) — `S3_ENDPOINT=http://minio:9000`
# trong /etc/quanly-backup.env giờ mới thật sự resolve được.
mc() {
  local net
  net="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' quanly-minio 2>/dev/null)"
  if [ -z "$net" ]; then
    alert "không xác định được network docker của quanly-minio (container có đang chạy không?) — không gọi được mc"
    return 1
  fi
  # `-e "MC_HOST_q=<url có access key + secret key>"` đặt cả cặp khoá kho object vào ARGV của
  # `docker run` — hiện ở `ps aux` trên host trong suốt thời gian mirror (có thể vài phút). Truyền
  # bằng BIẾN MÔI TRƯỜNG (`-e TÊN`, không kèm giá trị) thì docker đọc từ môi trường tiến trình cha,
  # không có gì lọt ra dòng lệnh.
  #
  # CHƯA ĐÓNG HẾT — nói cho đúng: cờ `-e` trần vẫn khiến docker NẠP giá trị vào `Config.Env` của
  # container, nên `docker inspect` (và /proc/<pid>/environ bên trong container) đọc được cặp khoá
  # suốt thời gian mirror. Khối NAS bên dưới bịt được đường này bằng cách đẩy credentials qua STDIN,
  # nhưng `mc` KHÔNG nhận alias qua stdin: phải hoặc ghi file config rồi mount, hoặc ghi đè entrypoint
  # của ảnh `minio/mc`. Cả hai đều phải diễn tập bằng docker thật trước — chưa đo được, nên để nguyên
  # thay vì đổi mù một đường đang chạy thật. Đây là đường lộ CỤC BỘ TRÊN HOST (cần đã vào được host).
  MC_HOST_q="${S3_ENDPOINT/:\/\//://${S3_ACCESS_KEY}:${S3_SECRET_KEY}@}" \
  docker run --rm --network "$net" \
    -e MC_HOST_q \
    -v "$MIRROR_DIR":/mirror \
    "$MC_IMAGE" "$@"
}

# ── [0/5] VERSIONING CỦA BUCKET NGUỒN ───────────────────────────────────────
# Bước này KHÔNG sao lưu gì. Nó ĐO một quyết định kiến trúc và ghi lại kết quả đo, vì cho tới
# 2026-08-27 không dòng nào trong scripts/, docs/operations/ hay infra/ nói bucket production có bật
# versioning hay không — tức "có/không" là chuyện phỏng đoán, và phỏng đoán về lớp chống-ghi-đè là
# đúng thứ không được phép phỏng đoán.
#
# QUYẾT ĐỊNH HIỆN TẠI: KHÔNG bật mặc định; lớp chống-xoá-nhầm là BẢN GƯƠNG CỘNG DỒN + off-host.
# Lập luận đầy đủ (kèm điều kiện để đổi quyết định) ở docs/operations/DISASTER_RECOVERY.md,
# mục "Versioning kho object". Ba ý đo được, tóm tắt:
#   1. Kho DEV chạy MinIO SINGLE-NODE SINGLE-DRIVE (docker-compose.yml: `server /data`, một volume).
#      MinIO ghi rõ chế độ này KHÔNG hỗ trợ versioning/object-lock/replication → không có gì để bật.
#   2. Production CŨNG chạy MinIO một-node-một-ổ (docker-compose.prod.yml, service `minio` — chú
#      thích cũ ở đây ghi "không có service ấy" đã lỗi thời từ fc053c2). Nhưng provider vẫn do
#      S3_ENDPOINT quyết định lúc chạy, nên vẫn ĐO chứ không giả định — đó là lý do bước này tồn tại.
#   3. Version nằm CÙNG bucket. Mất bucket / mất host / xoá cả bucket thì mọi version đi theo. Nó
#      chỉ bù được vế "ghi đè hoặc xoá nhầm MỘT object", mà vế đó bản gương cộng dồn đã phủ.
# Bật thì đặt OBJ_VERSIONING=1 (kèm OBJ_VERSIONING_KEEP_DAYS, mặc định 30) — script sẽ bật versioning
# VÀ đặt quy tắc hết hạn phiên bản cũ. Bật mà không có quy tắc hết hạn thì dung lượng tăng không
# trần, đúng vào cái rủi ro mà cổng "còn < 500MB thì dừng" bên trên đang canh.
echo "▶ [0/5] Versioning bucket q/$BUCKET"
VER_OUT="$(mc version info "q/$BUCKET" 2>&1)"; VER_RC=$?
# THỨ TỰ QUAN TRỌNG: xét mã thoát TRƯỚC rồi mới đọc chữ. Đọc chữ trước thì một thông báo lỗi có
# chứa chữ "enabled" (vd "versioning is not enabled on this deployment") bị phân loại thành ĐANG BẬT
# — tức đúng chốt này báo an toàn giả ở đúng lúc nó cần báo động.
if [ "$VER_RC" -ne 0 ]; then
  # Provider không hỗ trợ (MinIO một-node-một-ổ trả lỗi ở đây) hoặc khoá thiếu quyền đọc cấu hình bucket.
  VER_STATE="unsupported"
  echo "   KHÔNG hỏi được trạng thái versioning: $(printf '%s' "$VER_OUT" | head -c 200 | tr '\n' ' ')"
  echo "   → provider không hỗ trợ, hoặc khoá thiếu quyền đọc cấu hình bucket. Bản gương cộng dồn vẫn là lớp chống xoá nhầm."
elif printf '%s' "$VER_OUT" | grep -qi 'suspended'; then
  VER_STATE="suspended"
elif printf '%s' "$VER_OUT" | grep -qi 'enabled'; then
  VER_STATE="enabled"
  echo "   ĐANG BẬT — kho tự giữ phiên bản cũ; bản gương là lớp thứ hai (khác host)."
else
  VER_STATE="off"
fi

if [ "$VER_STATE" = "off" ] || [ "$VER_STATE" = "suspended" ]; then
  if [ "${OBJ_VERSIONING:-0}" = "1" ]; then
    if mc version enable "q/$BUCKET" >/dev/null 2>&1; then
      VER_STATE="enabled"
      echo "   đã BẬT versioning theo OBJ_VERSIONING=1"
      # Quy tắc hết hạn phiên bản cũ. Hỏng thì CẢNH BÁO chứ không im: versioning đã bật rồi mà không
      # có trần thời gian là một cái đĩa đầy dần, và nó đầy vào đúng volume của kho object production.
      if ! mc ilm rule add --noncurrent-expire-days "${OBJ_VERSIONING_KEEP_DAYS:-30}" "q/$BUCKET" >/dev/null 2>&1; then
        alert "đã bật versioning nhưng KHÔNG đặt được quy tắc hết hạn phiên bản cũ cho $BUCKET — dung lượng sẽ tăng không trần. Đặt tay: mc ilm rule add --noncurrent-expire-days ${OBJ_VERSIONING_KEEP_DAYS:-30} <alias>/$BUCKET"
      fi
    else
      alert "OBJ_VERSIONING=1 nhưng KHÔNG bật được versioning cho $BUCKET — provider không hỗ trợ (MinIO một-node-một-ổ) hoặc khoá thiếu quyền PutBucketVersioning"
    fi
  else
    echo "   TẮT (quyết định có chủ ý — xem DISASTER_RECOVERY.md mục 'Versioning kho object'; bật bằng OBJ_VERSIONING=1)"
  fi
fi
# Ghi lại KẾT QUẢ ĐO để người trực đọc được mà không phải lục log systemd của lượt chạy đêm qua.
printf '%s\t%s\n' "$(date +%s)" "$VER_STATE" > "$BACKUP_DIR/.objects-versioning" 2>/dev/null || true

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
# ── VÀ LẦN THỨ HAI: SO SỐ ĐẾM LÀ SAI HẲN VỀ NGUYÊN TẮC ──────────────────────────────────────
# Bản vá trước dựng lại cổng bằng `[ "$LOCAL_N" -lt "$REMOTE_N" ]`. Cổng đó CŨNG tự vô hiệu, chỉ là
# chậm hơn: bước [1/5] gương CỘNG DỒN (`mc mirror` KHÔNG có `--remove`, cố ý — xoá nhầm trên bucket
# không được phép lan sang bản sao lưu). Nên `LOCAL_N` chỉ có tăng. Ngay khi retention bắt đầu xoá
# object khỏi bucket — `RETAIN_EXPORT_DAYS` trong src/retention.ts, đúng thứ đang chờ được bật —
# thì `LOCAL_N > REMOTE_N` VĨNH VIỄN, và điều kiện `-lt` không bao giờ đúng nữa. Bản gương có thể
# thiếu bao nhiêu object cũng được, cổng vẫn báo OK.
#
# So SỐ ĐẾM không trả lời được câu hỏi cần trả lời. Câu hỏi là: "mọi object ĐANG CÓ trong bucket có
# mặt trong bản gương không?" — tức so THÀNH VIÊN. Phép so thành viên đúng với cả gương cộng dồn,
# và vẫn đúng sau khi retention chạy.
#
# Dùng `--json` để lấy khoá: dạng bảng của `mc ls` đặt khoá ở cột cuối, mà khoá có thể chứa dấu
# cách nên cắt theo cột là hỏng. Khoá ở đây do hệ sinh (uploads/… exports/… payment-proofs/…) nên
# không chứa dấu ngoặc kép — phép cắt bằng sed dưới đây an toàn với chính tập dữ liệu này.
# CỐ Ý KHÔNG dùng jq/node/python: ảnh `minio/mc` dựng trên UBI-micro, không có sẵn thứ nào trong đó.
REMOTE_LIST="$(mktemp)"
if ! mc ls --recursive --json "q/$BUCKET" > "$REMOTE_LIST" 2>"$REMOTE_LIST.err"; then
  alert "mc ls thất bại — KHÔNG đối chiếu được bản gương: $(head -c 300 "$REMOTE_LIST.err" | tr '\n' ' ')"
  rm -f "$REMOTE_LIST" "$REMOTE_LIST.err"; exit 1
fi
REMOTE_KEYS="$(mktemp)"
sed -n 's/.*"key":"\([^"]*\)".*/\1/p' "$REMOTE_LIST" > "$REMOTE_KEYS"
REMOTE_N="$(awk 'NF{n++} END{print n+0}' "$REMOTE_KEYS")"
LOCAL_N="$(find "$MIRROR_DIR" -type f | wc -l)"

# Liệt kê object CÓ trong bucket mà KHÔNG có trong gương. Trần 20 dòng cho cảnh báo: một sự cố
# mirror hỏng có thể để thiếu hàng nghìn object, và một cảnh báo dài hàng nghìn dòng thì không ai đọc.
THIEU="$(mktemp)"
while IFS= read -r k; do
  [ -n "$k" ] || continue
  [ -f "$MIRROR_DIR/$k" ] || printf '%s\n' "$k" >> "$THIEU"
done < "$REMOTE_KEYS"
THIEU_N="$(awk 'NF{n++} END{print n+0}' "$THIEU")"
rm -f "$REMOTE_LIST" "$REMOTE_LIST.err" "$REMOTE_KEYS"
if [ "$THIEU_N" -gt 0 ]; then
  alert "bản gương THIẾU $THIEU_N/$REMOTE_N object (gương đang có $LOCAL_N tệp). Ví dụ: $(head -20 "$THIEU" | tr '\n' ' ')"
  rm -f "$THIEU"; exit 1
fi
rm -f "$THIEU"

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

echo "▶ [4/5] Off-host"
# Hai đích độc lập (xem offhost-lib.sh). Dấu .offhost-objects-last-success chỉ ghi khi MỌI đích đã
# cấu hình đều đẩy xong.
if [ "$CO_LIB" != 1 ]; then
  alert "thiếu $LIB — KHÔNG đẩy được off-host. Cài lại bằng scripts/backup/install-backup.sh (bản gương local vẫn giữ)"
  OFFHOST_LOI=1
fi
if [ "$CO_LIB" = 1 ] && offhost_nas_configured; then
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
  # Mật khẩu NAS không đi qua argv VÀ không đi qua `-e NAS_PASS`: cờ `-e` trần khiến docker CLI đọc
  # giá trị từ môi trường của nó rồi nạp vào `Config.Env` của container, tức `docker inspect` và
  # /proc/<pid>/environ trong container vẫn đọc được. Đẩy qua STDIN (`docker run -i`) thì không
  # đường nào trong hai đường đó thấy. `cat > /tmp/cred` đứng TRƯỚC `apk add` để stdin không bị nuốt.
  # (Xem chú thích cùng nội dung ở scripts/backup/backup-db.sh.)
  if ! printf 'username=%s\npassword=%s\n' "$NAS_USER" "${NAS_PASS:-}" |
      NAS_SHARE="$NAS_SHARE" NAS_CMDS="$CMDS" \
      docker run --rm -i -e NAS_SHARE -e NAS_CMDS \
      -v "$BACKUP_DIR":/data:ro alpine sh -c \
      'umask 077; cat > /tmp/cred
       apk add --no-cache samba-client >/dev/null 2>&1 || exit 1
       smbclient "$NAS_SHARE" -A /tmp/cred -m SMB2 -c "$NAS_CMDS"'; then
    alert "đẩy kho object lên NAS thất bại — bản gương local vẫn giữ"
    OFFHOST_LOI=1
  fi
  # tarball chỉ là phương tiện vận chuyển off-host; bản gương mới là bản sao lưu chính.
  [ -n "$TARBALL" ] && rm -f "$TARBALL"
fi
if [ "$CO_LIB" = 1 ] && offhost_rclone_configured; then
  # Bản gương (cộng dồn, chỉ gửi tệp mới) + manifest của lượt này. Mã hoá do remote crypt đảm nhận.
  if ! LY="$(offhost_rclone_day_thu_muc objects objects)"; then
    alert "đẩy kho object off-host (rclone) thất bại: $LY — bản gương local vẫn giữ"; OFFHOST_LOI=1
  elif ! LY="$(offhost_rclone_day_tep objects-manifests "$(basename "$MANIFEST")" "$(basename "$MANIFEST").sha256")"; then
    alert "đẩy manifest kho object off-host (rclone) thất bại: $LY"; OFFHOST_LOI=1
  fi
fi
if [ "$CO_LIB" = 1 ]; then
  if ! offhost_configured; then
    offhost_canh_bao_chua_cau_hinh "Kho object (ảnh chứng từ thanh toán)"
  elif [ "$OFFHOST_LOI" = 0 ]; then
    date +%s > "$BACKUP_DIR/.offhost-objects-last-success"
  fi
fi

echo "▶ [5/5] Retention manifest (giữ $KEEP_MANIFESTS bản)"
# CHỈ dọn manifest. Bản gương KHÔNG bao giờ bị script này xoá — đó là toàn bộ bản sao lưu.
ls -1t "$BACKUP_DIR"/objects-manifest-*.tsv 2>/dev/null | tail -n +"$((KEEP_MANIFESTS+1))" | while IFS= read -r f; do
  rm -f "$f" "$f.sha256"
done

# Dấu vết cho watchdog kiểm "backup có còn tươi không".
date +%s > "$BACKUP_DIR/.objects-last-success"
[ "$CO_LIB" = 1 ] && backup_ghi_trang_thai

echo "✓ backup object OK: $LOCAL_N object (${MIRROR_MB}MB) → $MIRROR_DIR"
if [ "$OFFHOST_LOI" != 0 ]; then
  echo "✖ off-host THẤT BẠI ở lượt này — xem cảnh báo phía trên" >&2
  exit 1
fi
