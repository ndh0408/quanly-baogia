// GET /api/csrf-token TỪNG ĐỨNG NGOÀI apiLimiter — chốt hồi quy, phát hiện qua ultracode audit
// 2026-09-07.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `app.get("/api/csrf-token", ...)` từng đăng ký NGAY TRƯỚC `app.use("/api/", apiLimiter)`
// (src/app.ts). Express khớp route theo THỨ TỰ ĐĂNG KÝ; route này trả lời và không gọi `next()`
// nên `apiLimiter` không bao giờ chạy tới nó — đúng cái bẫy mà chú thích ở `/readyz` (cùng file)
// đã tự nhận diện cho chính nó, nhưng `/readyz` có cache 5 giây riêng còn endpoint này thì không.
//
// `issueCsrfToken` ghi `req.session.csrfSecret` — với `saveUninitialized: false`, đây CHÍNH LÀ điều
// kiện khiến express-session lưu một HÀNG PHIÊN MỚI (7 ngày) vào Postgres. Route công khai, không
// cần đăng nhập, và không giới hạn nào khác che nó (không cần CSRF hợp lệ — chính nó CẤP CSRF) →
// vòng lặp gọi endpoint này bơm vô hạn hàng vào bảng phiên.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Chuyển route xuống ĐĂNG KÝ SAU `apiLimiter` (an toàn: GET nằm trong CSRF_SAFE_METHODS nên
// `csrfGuard` — cũng đứng trước nó — bỏ qua ngay dòng đầu, không đụng gì tới việc cấp mã). KHÔNG
// chặn khách ẩn danh hoàn toàn: trang đăng nhập/kích hoạt/quên-mật-khẩu đều cần xin mã này TRƯỚC
// khi có phiên đăng nhập, nên endpoint vẫn phải mở — chỉ cần đứng CHUNG một trần với phần còn lại
// của API là đủ đóng lỗ "gọi bao nhiêu cũng được".
//
// Bài dưới đọc THẲNG ngăn xếp middleware của Express (`app._router.stack`) để khẳng định thứ tự
// đăng ký — `createLimiter` tự tắt khi NODE_ENV=test (xem src/rateLimit.ts) nên không thể chứng
// minh bằng cách gọi 121 lần rồi đợi 429 trong bộ test.
import { describe, it, expect } from "vitest";

describe("GET /api/csrf-token phải nằm SAU apiLimiter trong ngăn xếp middleware", () => {
  it("4 middleware /api/ dùng chung (bearerAuth, enforceActiveUser, csrfGuard, apiLimiter) đều đứng TRƯỚC route csrf-token", async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const stack = app._router.stack;

    const idxCsrfToken = stack.findIndex((l) => l.route && l.route.path === "/api/csrf-token");
    expect(idxCsrfToken, "không tìm thấy route GET /api/csrf-token trong ngăn xếp Express").toBeGreaterThanOrEqual(0);

    // Middleware ÁP TOÀN "/api/" (app.use("/api/", fn)) — khớp regexp gốc, KHÔNG phải route riêng.
    const RE_API_PREFIX = "^\\/api\\/?(?=\\/|$)";
    const middlewareApiTruoc = stack
      .slice(0, idxCsrfToken)
      .filter((l) => !l.route && l.regexp && l.regexp.source === RE_API_PREFIX);

    // Trước khi vá: chỉ 2 (bearerAuth, enforceActiveUser) — csrfGuard VÀ apiLimiter đứng SAU route.
    // (Không kiểm "không gì nằm sau" — layer /api/ generic còn có bộ định tuyến catch-all 404 mount
    // muộn hơn nhiều, không liên quan chuỗi bảo mật/rate-limit đang xét ở đây.)
    expect(middlewareApiTruoc.length, "csrf-token phải đứng sau ĐỦ 4 middleware /api/ dùng chung, tức sau cả csrfGuard lẫn apiLimiter").toBe(4);
  });
});
