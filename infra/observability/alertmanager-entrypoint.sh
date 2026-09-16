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
set -eu

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

# ── 2. THAY GIÁ TRỊ ───────────────────────────────────────────────────────
mkdir -p "$(dirname "$RA")"
# Không xác thực → GỠ hai dòng `smtp_auth_*` khỏi bản mẫu TRƯỚC khi thay giá trị, nhờ đó
# `${SMTP_USER}` không còn tồn tại để chốt chặn ở bước 3 phải bắt.
if [ -n "${SMTP_USER:-}" ]; then
  LOC=cat
else
  LOC="grep -v ^[[:space:]]*smtp_auth_"
fi
$LOC "$MAU" | awk \
  -v v_SMTP_HOST="$SMTP_HOST" \
  -v v_SMTP_PORT="$SMTP_PORT" \
  -v v_SMTP_FROM="$SMTP_FROM" \
  -v v_SMTP_USER="$SMTP_USER" \
  -v v_ALERT_EMAIL_TO="$ALERT_EMAIL_TO" \
  -v v_SMTP_REQUIRE_TLS="$SMTP_REQUIRE_TLS" \
  '
  function thay(s, tim, the,   p, r) {
    r = ""
    while ((p = index(s, tim)) > 0) {
      r = r substr(s, 1, p - 1) the
      s = substr(s, p + length(tim))
    }
    return r s
  }
  {
    $0 = thay($0, "${SMTP_HOST}",     v_SMTP_HOST)
    $0 = thay($0, "${SMTP_PORT}",     v_SMTP_PORT)
    $0 = thay($0, "${SMTP_FROM}",     v_SMTP_FROM)
    $0 = thay($0, "${SMTP_USER}",     v_SMTP_USER)
    $0 = thay($0, "${ALERT_EMAIL_TO}", v_ALERT_EMAIL_TO)
    $0 = thay($0, "${SMTP_REQUIRE_TLS}", v_SMTP_REQUIRE_TLS)
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
exec /bin/alertmanager --config.file="$RA" "$@"
