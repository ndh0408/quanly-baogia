-- AUTH-01 — đóng mốc `passwordChangedAt` cho tài khoản ĐÃ TỪNG ĐĂNG NHẬP mà cột còn NULL.
--
-- ── VÌ SAO ────────────────────────────────────────────────────────────────
-- Migration 20260811160000 cố ý để NULL cho mọi tài khoản có từ trước. Sau đó bản vá 2026-09-07 của
-- "Quên mật khẩu" dùng `passwordChangedAt IS NULL` làm tín hiệu "chưa từng kích hoạt" — nên một tài
-- khoản CŨ bị admin khoá vẫn tự mở lại được bằng "Quên mật khẩu". Mã (authService.sendPasswordReset)
-- nay đã ghép thêm `lastLoginAt` và trạng thái lời mời, nên backfill này KHÔNG phải chốt bảo mật
-- chính; nó làm cho cột mang đúng nghĩa của nó để mọi nơi đọc sau này không vấp lại cùng một bẫy.
--
-- ── VÌ SAO AN TOÀN VỚI PHIÊN ĐANG MỞ ──────────────────────────────────────
-- enforceActiveUser huỷ phiên có `authAt < passwordChangedAt`; bearerAuth bỏ access token có
-- `iat < passwordChangedAt`. `createdAt` luôn SỚM HƠN mọi lần đăng nhập của chính tài khoản đó, nên
-- đặt mốc = createdAt không đá ai ra. KHÔNG dùng now() — đó sẽ là đăng xuất toàn bộ nhân viên.
--
-- ── PHẠM VI: CHỈ HÀNG CẦN ĐỔI ─────────────────────────────────────────────
--   · `passwordChangedAt IS NULL` — không đè mốc thật của ai;
--   · `lastLoginAt IS NOT NULL`   — chỉ tài khoản đã chứng minh từng dùng mật khẩu thật. Người được
--     mời chưa kích hoạt không có lastLoginAt nên lời mời của họ không bị ảnh hưởng.
-- Không backfill tài khoản active CHƯA TỪNG đăng nhập và không có lời mời (tạo tay chưa dùng): mã
-- mới đã chặn đúng ca đó khi bị khoá (khoá luôn đốt token mời), nên không cần đụng thêm hàng nào.
--
-- IDEMPOTENT: lượt chạy thứ hai không còn hàng nào khớp `IS NULL`.
-- ROLLBACK: không cần — chỉ ghi vào cột nullable mà mã cũ cũng hiểu (NULL = chưa có mốc).
UPDATE "User"
SET "passwordChangedAt" = "createdAt"
WHERE "passwordChangedAt" IS NULL
  AND "lastLoginAt" IS NOT NULL;
