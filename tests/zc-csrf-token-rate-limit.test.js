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
  it("5 middleware /api/ dùng chung (apiLimiter, Cache-Control mặc định, bearerAuth, enforceActiveUser, csrfGuard) đều đứng TRƯỚC route csrf-token", async () => {
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

    // Trước khi vá 2026-09-07: chỉ 2 (bearerAuth, enforceActiveUser) — csrfGuard VÀ apiLimiter đứng
    // SAU route. Từ ultracode audit 2026-09-09 (finding WEB-1) có thêm middleware thứ 5: đặt
    // Cache-Control: no-store mặc định cho MỌI /api/*, mount ngay sau apiLimiter (src/app.ts) — nên
    // mốc đúng nay là 5, không phải 4.
    // (Không kiểm "không gì nằm sau" — layer /api/ generic còn có bộ định tuyến catch-all 404 mount
    // muộn hơn nhiều, không liên quan chuỗi bảo mật/rate-limit đang xét ở đây.)
    expect(middlewareApiTruoc.length, "csrf-token phải đứng sau ĐỦ 5 middleware /api/ dùng chung, tức sau cả csrfGuard lẫn apiLimiter và Cache-Control mặc định").toBe(5);
  });

  // ── TRẦN PHẢI ĐỨNG TRƯỚC VIỆC NẶNG (ultracode audit vòng 2, 2026-09-08) ───────────────────
  // `decompressBody` + `express.json` giải nén gzip rồi JSON.parse tối đa 16MB — việc NẶNG và ĐỒNG
  // BỘ trên thân request. Trước bản vá, apiLimiter đứng MÃI SAU chúng (cạnh bearerAuth/csrfGuard),
  // nên một request CHƯA ĐĂNG NHẬP đã kịp tiêu CPU + heap trước khi có bất kỳ trần nào chạy: gói
  // gzip vài trăm KB nở thành 16MB JSON hợp lệ, mỗi lượt chặn event loop hàng trăm ms, và không có
  // gì giới hạn số lượt. Chú thích ngay tại chỗ mount đã tự nhận ra điều đó nhưng chỉ thu hẹp trần
  // 16MB xuống nhóm /api/quotes.
  it("apiLimiter phải đứng TRƯỚC decompressBody và express.json", async () => {
    const { createApp } = await import("../src/app.js");
    const stack = createApp()._router.stack;
    const ten = (l) => l.handle?.name || "";

    // apiLimiter = middleware /api/ ĐẦU TIÊN (bearerAuth/enforceActiveUser/csrfGuard mang tên thật).
    const idxLimiter = stack.findIndex((l) => !l.route && l.regexp?.source === "^\\/api\\/?(?=\\/|$)");
    expect(idxLimiter, "không tìm thấy middleware /api/ nào").toBeGreaterThanOrEqual(0);
    expect(ten(stack[idxLimiter]), "middleware /api/ đầu tiên phải là apiLimiter (hàm ẩn danh do express-rate-limit trả về), không phải bearerAuth").toBe("");

    // `decompressBody` trả về hàm ẨN DANH nên không dò được theo tên — nhận diện bằng regexp mount
    // riêng của nhóm /api/quotes, và loại `jsonParser` (mount cùng regexp đó, ngay sau).
    const laQuotes = (l) => l.regexp?.source?.startsWith("^\\/api\\/quotes");
    const idxGiaiNen = stack.findIndex((l) => !l.route && laQuotes(l) && ten(l) !== "jsonParser");
    const idxJson = stack.findIndex((l) => !l.route && ten(l) === "jsonParser");
    expect(idxGiaiNen, "không tìm thấy decompressBody (mount /api/quotes)").toBeGreaterThanOrEqual(0);
    expect(idxJson, "không tìm thấy express.json").toBeGreaterThanOrEqual(0);

    // Trước khi vá: idxLimiter (~20) LỚN HƠN cả hai → thân request đã được bung ra và parse xong.
    expect(idxLimiter, "trần request phải chạy TRƯỚC khi giải nén thân").toBeLessThan(idxGiaiNen);
    expect(idxLimiter, "trần request phải chạy TRƯỚC khi JSON.parse thân").toBeLessThan(idxJson);
  });
});
