// TRẦN ĐĂNG NHẬP KHOÁ THEO TÀI KHOẢN, KHÔNG THEO IP — chốt hồi quy, phát hiện qua ultracode audit
// 2026-09-07 (src/routes/auth.routes.ts, loginLimiter).
//
// Trước bản vá limiter không khai keyGenerator → express-rate-limit dùng req.ip: MỘT bộ đếm 10 lần/15
// phút cho cả văn phòng (một IP công cộng sau NAT), và 401 {mfaRequired} — lần POST đầu BẮT BUỘC của
// mọi người bật MFA — bị tính là "sai". 10 người có MFA đăng nhập cùng buổi sáng là người thứ 11 ăn
// 429 dù gõ đúng; một người bất mãn bắn 10 request sai là khoá đăng nhập cả công ty 15 phút.
//
// createLimiter tự tắt khi NODE_ENV=test nên không thể chứng minh bằng 429; kiểm THẲNG hai hàm mà
// limiter dùng: khoá sinh ra từ đâu, và response nào được coi là "không phải đăng nhập sai".
import { describe, it, expect } from "vitest";
import { loginLimiterKey, loginRequestWasSuccessful } from "../src/routes/auth.routes.js";

const req = (body, ip = "203.0.113.7") => ({ body, ip });

describe("loginLimiterKey — khoá theo tài khoản", () => {
  it("cùng IP, hai tài khoản khác nhau → HAI khoá khác nhau (không dùng chung hạn mức)", () => {
    const a = loginLimiterKey(req({ username: "an@x.vn" }));
    const b = loginLimiterKey(req({ username: "binh@x.vn" }));
    expect(a).not.toBe(b);
    expect(a.startsWith("lg:u:")).toBe(true);
  });

  it("cùng tài khoản gõ hoa/thường/khoảng trắng khác nhau → MỘT khoá (kẻ dò không né được bằng cách đổi chữ hoa)", () => {
    expect(loginLimiterKey(req({ username: "An@X.vn" }))).toBe(loginLimiterKey(req({ username: "  an@x.vn " })));
  });

  it("khoá KHÔNG chứa username dạng rõ (chỉ băm) — Redis/log không lộ danh sách tài khoản", () => {
    expect(loginLimiterKey(req({ username: "an@x.vn" }))).not.toContain("an@x.vn");
  });

  it("thiếu username (thân request hỏng) → rơi về IP, không ném lỗi", () => {
    expect(loginLimiterKey(req({}))).toMatch(/^lg:ip:/);
    expect(loginLimiterKey(req({ username: 123 }))).toMatch(/^lg:ip:/);
  });
});

describe("loginRequestWasSuccessful — 401 mfaRequired KHÔNG phải đăng nhập sai", () => {
  const res = (statusCode, locals = {}) => ({ statusCode, locals });
  it("200 → thành công (không tính)", () => expect(loginRequestWasSuccessful({}, res(200))).toBe(true));
  it("401 thường (sai mật khẩu) → TÍNH", () => expect(loginRequestWasSuccessful({}, res(401))).toBe(false));
  it("401 kèm res.locals.mfaRequired (mật khẩu ĐÚNG, chờ mã) → KHÔNG tính", () =>
    expect(loginRequestWasSuccessful({}, res(401, { mfaRequired: true }))).toBe(true));
  it("429/500 → tính như thất bại", () => {
    expect(loginRequestWasSuccessful({}, res(429))).toBe(false);
    expect(loginRequestWasSuccessful({}, res(500))).toBe(false);
  });
});
