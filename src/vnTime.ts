// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ src/vnTime.ts — MỐC THỜI GIAN THEO GIỜ VIỆT NAM, dùng cho mọi thứ ĐÁNH SỐ.  │
// │                                                                              │
// │ VÌ SAO PHẢI CÓ: container production chạy ở UTC (`TZ` rỗng — đo trên VM dev  │
// │ 2026-09-07: `date` == `date -u`). Nên `new Date().getFullYear()` là năm UTC.  │
// │ Từ 00:00 tới 07:00 giờ Việt Nam ngày 1/1, UTC VẪN đang ở 31/12 năm cũ ⇒ mã   │
// │ báo giá / mã dự án / mã khách hàng cấp trong bảy tiếng đó mang NĂM CŨ và rơi  │
// │ vào ĐÚNG ô bộ đếm của năm cũ — số nhảy tiếp 004, 005 thay vì reset về 001.    │
// │ Đó là bảy tiếng mỗi năm cho ra dữ liệu sai mà không ai để ý.                  │
// │                                                                              │
// │ CỐ Ý DÙNG BÙ +7 CỐ ĐỊNH, KHÔNG DÙNG `Intl`/múi giờ IANA: Việt Nam là UTC+7   │
// │ quanh năm và CHƯA TỪNG có giờ mùa hè kể từ 1975, nên phép bù là chính xác     │
// │ tuyệt đối. Còn `Intl.DateTimeFormat` cần bộ dữ liệu ICU đầy đủ — ảnh alpine   │
// │ có thể build với small-icu và khi đó nó âm thầm rơi về UTC, tức lỗi y hệt     │
// │ cái đang vá, nhưng khó thấy hơn.                                             │
// └─────────────────────────────────────────────────────────────────────────────┘
const BU_VN_MS = 7 * 60 * 60 * 1000;

/** `Date` đã dịch sang giờ VN — CHỈ đọc qua các hàm `getUTC*` (xem chú thích đầu tệp). */
const nowVN = (d: Date = new Date()) => new Date(d.getTime() + BU_VN_MS);

/** Năm theo lịch Việt Nam. Đây là năm dùng để khoá bộ đếm và để ghép vào mã. */
export const namVN = (d?: Date) => nowVN(d).getUTCFullYear();

/** Hai số cuối của năm VN: 2026 → "26". */
export const namNganVN = (d?: Date) => String(namVN(d)).slice(-2);

/** "MMDD" theo lịch Việt Nam — dùng đặt tên file tải về (tháng rồi tới ngày). */
export function thangNgayVN(d?: Date) {
  const t = nowVN(d);
  return `${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}`;
}
