#!/bin/sh
# ── DỰNG CẤU HÌNH ALERTMANAGER TỪ BẢN MẪU, RỒI MỚI CHẠY ────────────────────
#
# Alertmanager KHÔNG nội suy biến môi trường trong cấu hình. ĐÃ ĐO trên chính ảnh v0.28.1: cho
# `smtp_smarthost: ${SMTP_HOST}:${SMTP_PORT}` và đặt biến môi trường đầy đủ, `/api/v2/status` trả
# về NGUYÊN chuỗi `${SMTP_HOST}:${SMTP_PORT}`. Và `amtool check-config` vẫn in "SUCCESS".
# Tức con đường hỏng ở đây là con đường IM LẶNG: mọi thứ xanh, thư không bao giờ tới.
#
# Vì thế script này có hai việc, và việc thứ hai quan trọng hơn việc thứ nhất:
#   1. thay giá trị thật vào bản mẫu
#   2. TỪ CHỐI KHỞI ĐỘNG nếu còn sót một `${` nào, hoặc nếu một biến bắt buộc rỗng
# Thà container không lên (thấy ngay) còn hơn nó lên mà câm (không ai thấy, cho tới lúc cần).
#
# Phép thay dùng awk với index/substr — THAY THEO NGHĨA ĐEN, không qua regex. `sed s|…|…|` sẽ diễn
# giải `&` trong vế phải và vỡ nếu giá trị chứa ký tự phân cách; một địa chỉ email hôm nay chưa
# chứa, nhưng đây là chỗ không đáng đánh cược.
#
# `pipefail`: bước dựng cấu hình ở dưới là một ống `$LOC | bo_khoi | awk` — thiếu pipefail thì mã
# thoát lấy từ `awk` (luôn 0), khâu đầu hỏng vẫn ra một tệp cấu hình cụt mà container vẫn lên.
# /bin/sh của ảnh prom/alertmanager v0.28.1 là busybox ash và CÓ hỗ trợ — đã đo 2026-09-23:
# `set -euo pipefail; false | true` thoát 1 trong chính ảnh đó (audit DEP-02 / DOC-03).
set -euo pipefail

MAU="${AM_TEMPLATE:-/etc/alertmanager/conf/alertmanager.yml.tpl}"
RA="${AM_RENDERED:-/render/alertmanager.yml}"

[ -r "$MAU" ] || { echo "alertmanager-entrypoint: KHÔNG đọc được bản mẫu $MAU" >&2; exit 78; }

# ── 1. BIẾN BẮT BUỘC ──────────────────────────────────────────────────────
# Kiểm TRƯỚC khi thay, để thông điệp nói đúng tên biến còn thiếu thay vì để lại một `${...}` mồ côi
# cho bước 3 bắt.
# SMTP_USER CỐ Ý KHÔNG nằm trong danh sách này: dev dùng MailHog, vốn không xác thực.
thieu=""
for v in SMTP_HOST SMTP_PORT SMTP_FROM ALERT_EMAIL_TO; do
  eval "gt=\${$v:-}"
  [ -n "$gt" ] || thieu="$thieu $v"
done
if [ -n "$thieu" ]; then
  echo "alertmanager-entrypoint: thiếu biến bắt buộc:$thieu" >&2
  echo "  → đặt trong .env của máy chủ. Thiếu chúng thì cảnh báo không tới được ai." >&2
  exit 78
fi

# ── 1b. CÓ XÁC THỰC HAY KHÔNG — VÀ TLS ĐI THEO NÓ ─────────────────────────
# MỘT quyết định, không phải hai. TLS ở đây tồn tại để che MẬT KHẨU trên đường truyền, nên "có mật
# khẩu" và "bắt buộc TLS" phải bật/tắt CÙNG NHAU. Cho chỉnh riêng lẻ là mở đúng cánh cửa dẫn tới
# một production gửi mật khẩu Gmail qua kết nối trần.
KHOA="/run/secrets/smtp_password"
if [ -n "${SMTP_USER:-}" ]; then
  # Có tài khoản → BẮT BUỘC có mật khẩu và BẮT BUỘC TLS.
  # Kiểm mật khẩu NGAY ĐÂY, vì Alertmanager chỉ đọc tệp đó lúc GỬI THƯ ĐẦU TIÊN — không chặn ở đây
  # là để lỗi nổ đúng vào lúc đang có sự cố, tức đúng lúc không ai rảnh để sửa.
  if [ ! -s "$KHOA" ]; then
    echo "alertmanager-entrypoint: SMTP_USER=$SMTP_USER nhưng $KHOA rỗng/không có." >&2
    echo "  → đặt SMTP_PASS trong .env của máy chủ." >&2
    exit 78
  fi
  SMTP_REQUIRE_TLS=true
  XAC_THUC="có ($SMTP_USER), TLS bắt buộc"
else
  # Không tài khoản → GỠ HẲN hai dòng `smtp_auth_*` (xem bước 2). Để lại `smtp_auth_username: ""`
  # thì Alertmanager vẫn thử AUTH và MailHog từ chối.
  SMTP_REQUIRE_TLS=false
  XAC_THUC="KHÔNG (SMTP_USER rỗng) — đúng cho MailHog ở dev, SAI cho Gmail"
fi

# ── 1c. KÊNH THỨ HAI: TELEGRAM (TUỲ CHỌN, MẶC ĐỊNH TẮT) ───────────────────
# Bật khi có ĐỦ CẢ HAI: chat id (biến) và token (tệp secret). Thiếu một trong hai thì GỠ TRỌN khối
# `telegram_configs` khỏi bản mẫu — để lại một khối trỏ vào token rỗng thì Alertmanager vẫn khởi
# động và vẫn THỬ gửi, rồi thất bại ở từng cảnh báo. Tức thêm một đường hỏng im lặng nữa, đúng thứ
# script này sinh ra để chặn.
#
# BẬT MỘT NỬA LÀ LỖI, KHÔNG PHẢI "gần đủ": có token mà quên chat id (hoặc ngược lại) gần như chắc
# chắn là người ta ĐỊNH bật kênh này. Im lặng bỏ qua thì họ tin là đã có hai kênh trong khi chỉ có
# một — tệ hơn hẳn việc biết mình chỉ có một. Nên nửa vời thì THOÁT 78.
# Khe để bài kiểm trỏ sang tệp token giả (cùng kiểu AM_TEMPLATE/AM_RENDERED/AM_BIN). Mặc định
# vẫn là đường secret thật, nên production không đổi.
KHOA_TG="${AM_TELEGRAM_TOKEN_FILE:-/run/secrets/telegram_bot_token}"
co_tg_id=""
[ -n "${TELEGRAM_CHAT_ID:-}" ] && co_tg_id=1
co_tg_token=""
[ -s "$KHOA_TG" ] && co_tg_token=1

if [ -n "$co_tg_id" ] && [ -n "$co_tg_token" ]; then
  TELEGRAM=1
  TG_TRANG_THAI="BẬT (chat_id=$TELEGRAM_CHAT_ID)"
elif [ -z "$co_tg_id" ] && [ -z "$co_tg_token" ]; then
  TELEGRAM=""
  TG_TRANG_THAI="tắt (không TELEGRAM_CHAT_ID, không $KHOA_TG) — cảnh báo chỉ đi bằng email"
else
  echo "alertmanager-entrypoint: Telegram bật NỬA VỜI — phải có ĐỦ CẢ HAI." >&2
  [ -z "$co_tg_id" ]    && echo "  → thiếu TELEGRAM_CHAT_ID trong .env" >&2
  [ -z "$co_tg_token" ] && echo "  → thiếu/rỗng $KHOA_TG (đặt TELEGRAM_BOT_TOKEN trong .env)" >&2
  echo "  Bỏ qua im lặng thì bạn tin mình có hai kênh trong khi chỉ có một." >&2
  exit 78
fi

# ── 1d. NHỊP TIM RA NGOÀI (TUỲ CHỌN) — audit 2026-09-22, OBS-01 ───────────
# Có tệp secret heartbeat_url (HEARTBEAT_URL trong .env) → giữ khối webhook của receiver `nhip-tim`.
# Không có → gỡ khối đó; receiver rỗng nuốt nhịp tim (không bao giờ để nó rơi sang Telegram/email).
KHOA_HB="${AM_HEARTBEAT_URL_FILE:-/run/secrets/heartbeat_url}"
if [ -s "$KHOA_HB" ]; then
  HB_BO=""
  HB_TRANG_THAI="BẬT — nhịp tim đẩy ra URL ngoài mỗi phút"
else
  HB_BO="HEARTBEAT"
  HB_TRANG_THAI="tắt (không có $KHOA_HB) — KHÔNG có giám sát từ bên ngoài: VM/Alertmanager chết thì im lặng"
fi

# ── 2. THAY GIÁ TRỊ ───────────────────────────────────────────────────────
mkdir -p "$(dirname "$RA")"
# Không xác thực → GỠ hai dòng `smtp_auth_*` khỏi bản mẫu TRƯỚC khi thay giá trị, nhờ đó
# `${SMTP_USER}` không còn tồn tại để chốt chặn ở bước 3 phải bắt.
if [ -n "${SMTP_USER:-}" ]; then
  LOC=cat
else
  LOC="grep -v ^[[:space:]]*smtp_auth_"
fi

# ── GỠ KHỐI KÊNH KHÔNG DÙNG ───────────────────────────────────────────────
# Bản mẫu mang CẢ HAI khối, mỗi khối kẹp giữa hai dấu mốc trong chú thích YAML. Đúng MỘT khối bị
# gỡ ở đây, và gỡ theo MỐC chứ không theo tên trường: mỗi khối trải mấy chục dòng, có cả mẫu thư
# nhiều dòng bên trong, nên lọc từng dòng theo tên trường sẽ để lại xác và cho ra YAML hỏng.
#
#   Telegram BẬT  → gỡ khối EMAIL    (cảnh báo hệ thống đi Telegram; email rút về đúng việc của nó
#                                     là thông báo nghiệp vụ cho người dùng, xem src/notifications.ts)
#   Telegram TẮT  → gỡ khối TELEGRAM (hành vi y như trước 2026-09-17)
#
# KHÔNG BAO GIỜ gỡ cả hai: receiver rỗng nghĩa là Alertmanager nhận cảnh báo rồi vứt đi, và nó
# KHÔNG báo lỗi khi làm thế. Nhánh 1c ở trên đã bảo đảm điều đó — Telegram chỉ có hai trạng thái
# đủ-hoặc-không, nửa vời thì thoát 78.
if [ -n "$TELEGRAM" ]; then
  MOC_BO="EMAIL"
else
  MOC_BO="TELEGRAM"
fi
bo_khoi() {
  awk -v moc="$1" '
    $0 ~ ("^[[:space:]]*#[[:space:]]*>>>" moc ">>>") { bo = 1 }
    !bo
    $0 ~ ("^[[:space:]]*#[[:space:]]*<<<" moc "<<<") { bo = 0 }
  '
}

# ── ĐƯA GIÁ TRỊ VÀO AWK QUA MÔI TRƯỜNG, KHÔNG QUA `-v` ────────────────────
# `awk -v ten="$gt"` DIỄN GIẢI CHUỖI THOÁT nằm trong giá trị. ĐÃ ĐO bằng chính awk của máy này:
# truyền một giá trị chứa hai ký tự dấu-chéo-ngược và chữ t, awk trả về một ký tự TAB THẬT.
# Tức tài khoản/địa chỉ nào chứa dấu chéo ngược sẽ bị bóp méo IM LẶNG — và một cặp chéo-ngược-n
# còn chèn được DÒNG MỚI vào giữa YAML, cho ra một cấu hình HỢP LỆ nhưng SAI. Đúng kiểu hỏng mà
# cả script này sinh ra để chặn, trong khi khối chú thích đầu tệp lại khai "thay theo NGHĨA ĐEN".
#
# Mảng `ENVIRON` thì KHÔNG diễn giải gì cả — nó trả đúng byte của biến môi trường.
#
# `${SMTP_USER:-}` chứ không phải `$SMTP_USER`: dưới `set -u`, một biến CHƯA ĐẶT làm script chết
# với "unbound variable" và mã thoát 1, thay vì 78 kèm thông điệp đã soạn sẵn. Compose luôn đặt
# biến này nên đường đó không tới được từ compose — nhưng bộ test gọi THẲNG script này, và người
# vận hành cũng chạy tay nó lúc dò lỗi.
export AM_V_SMTP_HOST="$SMTP_HOST"
export AM_V_SMTP_PORT="$SMTP_PORT"
export AM_V_SMTP_FROM="$SMTP_FROM"
export AM_V_SMTP_USER="${SMTP_USER:-}"
export AM_V_ALERT_EMAIL_TO="$ALERT_EMAIL_TO"
export AM_V_SMTP_REQUIRE_TLS="$SMTP_REQUIRE_TLS"
export AM_V_TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# `bo_khoi ""` (chuỗi rỗng) không khớp mốc nào → giữ nguyên, nên nhịp tim bật thì lượt lọc thứ hai
# là phép đi qua.
$LOC "$MAU" | bo_khoi "$MOC_BO" | bo_khoi "${HB_BO:-KHONG_GO_GI}" | awk '
  function thay(s, tim, the,   p, r) {
    r = ""
    while ((p = index(s, tim)) > 0) {
      r = r substr(s, 1, p - 1) the
      s = substr(s, p + length(tim))
    }
    return r s
  }
  {
    $0 = thay($0, "${SMTP_HOST}",        ENVIRON["AM_V_SMTP_HOST"])
    $0 = thay($0, "${SMTP_PORT}",        ENVIRON["AM_V_SMTP_PORT"])
    $0 = thay($0, "${SMTP_FROM}",        ENVIRON["AM_V_SMTP_FROM"])
    $0 = thay($0, "${SMTP_USER}",        ENVIRON["AM_V_SMTP_USER"])
    $0 = thay($0, "${ALERT_EMAIL_TO}",   ENVIRON["AM_V_ALERT_EMAIL_TO"])
    $0 = thay($0, "${SMTP_REQUIRE_TLS}", ENVIRON["AM_V_SMTP_REQUIRE_TLS"])
    $0 = thay($0, "${TELEGRAM_CHAT_ID}",  ENVIRON["AM_V_TELEGRAM_CHAT_ID"])
    print
  }
  ' > "$RA"

# ── 3. CHỐT CHẶN: KHÔNG ĐƯỢC SÓT MỘT `${` NÀO ─────────────────────────────
# Đây là lý do script này tồn tại. Thêm một biến vào bản mẫu mà quên thêm vào khối awk ở trên là
# lỗi DỄ mắc nhất, và hậu quả của nó là im lặng. Chốt này biến lỗi đó thành "container không lên".
# BỎ QUA dòng chú thích TRỌN VẸN (ký tự đầu khác khoảng trắng là `#`): bản mẫu có nói VỀ `${...}`
# trong phần giải thích, và chính điều đó đã làm chốt này nổ ở lần chạy thử đầu tiên.
# Chú thích ĐUÔI DÒNG thì KHÔNG được bỏ qua — cắt tại `#` đầu tiên sẽ hiểu sai một `#` nằm trong
# chuỗi nháy. Một `${` trong chú thích đuôi dòng vì thế vẫn bị coi là lỗi: bắt nhầm ở đây chỉ tốn
# công sửa lại câu chữ, còn bắt HỤT thì trả giá bằng một kênh cảnh báo câm.
# (`grep -n` TRƯỚC rồi mới lọc — làm ngược lại thì lượt `grep -n` thứ hai đánh số lại và in ra
# số dòng SAI, tức phá đúng mẩu tin duy nhất mà thông điệp lỗi này cần đưa cho người đọc.)
if grep -n '\${' "$RA" | grep -v '^[0-9][0-9]*:[[:space:]]*#' >&2; then
  echo "alertmanager-entrypoint: CÒN SÓT biến chưa thay (xem dòng ở trên)." >&2
  echo "  → thêm biến đó vào khối awk trong infra/observability/alertmanager-entrypoint.sh" >&2
  exit 78
fi

echo "alertmanager-entrypoint: đã dựng $RA"
echo "  smarthost = $SMTP_HOST:$SMTP_PORT"
echo "  gửi tới   = $ALERT_EMAIL_TO"
echo "  xác thực  = $XAC_THUC"
echo "  telegram  = $TG_TRANG_THAI"
echo "  nhịp tim  = $HB_TRANG_THAI"
# `AM_BIN` chỉ là KHE ĐỂ KIỂM ĐƯỢC, mặc định y như cũ. Không có nó thì bộ test không cách nào chạy
# THẬT script này (máy dev không có /bin/alertmanager), và mọi bài kiểm buộc phải lùi về so khớp
# VĂN BẢN của script — thứ không chứng minh được phép thay có chạy đúng hay không.
exec "${AM_BIN:-/bin/alertmanager}" --config.file="$RA" "$@"
