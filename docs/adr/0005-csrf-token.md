# ADR 0005 — CSRF: token đồng bộ hoá, không chỉ dựa vào Origin

**Trạng thái:** đã chấp nhận · **Ngày:** 2026-08
> **Lưu ý đọc sau này:** câu "cả hai SPA" trong thân bài là đúng TẠI THỜI ĐIỂM ký.
> SPA vanilla đã được gỡ ngày 2026-08-26 — xem [ADR 0006](0006-go-spa-vanilla-cu.md).
> Thân bài giữ nguyên vì ADR là biên bản, không phải tài liệu sống.

## Bối cảnh

Bản đầu kiểm Origin/Referer trên mọi thao tác GHI, và **kết thúc bằng `next()`**
khi không có cả hai. Lập luận đi kèm: "trình duyệt nào cũng gửi Origin trên
POST/PUT/DELETE khác site, nên thiếu cả hai nghĩa là client không phải trình
duyệt, mà client không phải trình duyệt thì không có cookie tự động".

Lập luận đó đúng với trình duyệt hiện đại, và cookie `SameSite=Lax` cũng đã chặn
sẵn CSRF cổ điển.

## Quyết định

Giữ nguyên kiểm Origin/Referer làm **lớp 1**, thêm **lớp 2**: token đồng bộ hoá
gắn với phiên, cấp qua `GET /api/csrf-token`, gửi lại qua `X-CSRF-Token`.

Áp dụng cho **đúng** tập request bị CSRF: thao tác GHI xác thực bằng **phiên
cookie**. Bearer và request chưa đăng nhập được miễn.

## Lý do

Lập luận cũ không sai — nó chỉ đặt toàn bộ hàng rào lên một hành vi mà **máy chủ
không kiểm soát được**, và mặc định của nhánh đó là **cho qua**. Một trình duyệt
cũ, một tiện ích mở rộng, một kiểu điều hướng mới lược bỏ cả hai header là hàng
rào biến mất — âm thầm, không có gì báo.

Mặc định phải là **từ chối**, và cái cho phép đi qua phải là thứ chỉ mã của chính
mình có được. Token đúng nghĩa như vậy.

## Hệ quả

- Client phải lấy mã. Cả hai SPA tự lo trong lớp bọc fetch của mình.
- **Phải có cơ chế thử lại.** Ba tình huống làm mã hết giá trị đều xảy ra thật:
  lúc deploy (phiên cũ chưa có bí mật), sau `session.regenerate()` khi đăng nhập,
  và khi đăng nhập lại ở tab khác. Không có thử-lại thì cả ba hiện ra thành 403
  khó hiểu giữa lúc làm việc.
- Client API dùng Bearer không bị ảnh hưởng.
- Test tích hợp phải làm giống SPA — xem `tests/helpers/agent.js`.

## Đường lùi

Gỡ lớp 2 (token đồng bộ hoá) và quay về chỉ kiểm Origin/Referer: xoá khối "LỚP 2" trong `csrfGuard`
(`src/app.ts`). Client không cần đổi — `web/src/lib/api.ts` vẫn gửi `X-CSRF-Token`, chỉ là máy chủ
thôi đọc.

**Nhưng đọc `tests/csrf.test.js` trước.** Lùi là mở lại đúng lỗ mà ADR này đóng: thao tác GHI xác
thực bằng phiên cookie mà KHÔNG có Origin lẫn Referer sẽ đi qua. Bài "ĐÂY LÀ CHỖ ĐÃ SIẾT" sẽ đỏ, và
nó đỏ đúng.

Không có trạng thái nào cần dọn: `session.csrfSecret` là một chuỗi trong phiên, hết hạn theo phiên.
