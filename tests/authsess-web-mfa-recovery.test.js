/**
 * CỤM auth-session — GIAO DIỆN KHOÁ CHẾT NGƯỜI DÙNG ĐÃ BẬT MFA (web/src/App.tsx, web/src/lib/api.ts).
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────────────────
 * Hai nửa cộng lại thành một cái bẫy không lối ra:
 *   (a) Ô nhập mã MFA ở màn ĐĂNG NHẬP có `pattern="[0-9A-Za-z]{6,8}"`, trong khi mã dự phòng hiện
 *       tại dài 20 ký tự hex (mã cũ 10 ký tự cũng đã bị chặn sẵn). Form không có noValidate nên
 *       CHÍNH TRÌNH DUYỆT chặn submit — request còn không rời máy.
 *   (b) Màn ONBOARD (kiêm "đặt lại mật khẩu") không có ô nhập mã MFA và không đọc cờ `mfaRequired`,
 *       trong khi backend giờ trả 401 { error, mfaRequired: true } cho tài khoản đã bật MFA.
 *
 * ── HẬU QUẢ ─────────────────────────────────────────────────────────────────────────────
 * Kế toán bật MFA rồi mất điện thoại: dán mã dự phòng ở màn đăng nhập → trình duyệt từ chối gửi;
 * bấm "Quên mật khẩu", mở link trong mail, đặt mật khẩu mới → 401 "Cần mã MFA" mà KHÔNG có ô nào để
 * nhập. Không có endpoint admin nào gỡ MFA hộ → mất tài khoản vĩnh viễn. Đây là HỒI QUY do chính
 * bản vá cổng MFA tạo ra: trước đó đường "Quên mật khẩu" vẫn vào được (chính là lỗ hổng đã vá).
 *
 * ── VÌ SAO KIỂM BẰNG CÁCH ĐỌC NGUỒN ─────────────────────────────────────────────────────
 * Bộ test backend chạy môi trường "node", không có DOM và không có react-testing-library trong
 * repo. Nhưng thứ cần khoá ở đây là một HẰNG SỐ trong nguồn (regex `pattern`) và việc một tham số
 * có được truyền hay không — đọc nguồn kiểm được ĐÚNG những thứ đó, và nó bắt được đúng kịch bản
 * hồi quy: ai thu regex về `{6,8}` là đỏ ngay.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const doc = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const APP = doc("../web/src/App.tsx");
const API = doc("../web/src/lib/api.ts");
const VALIDATORS = doc("../src/validators.ts");

// Ba hình dạng mã mà BACKEND chấp nhận (src/validators.ts + hai route) — giao diện không được hẹp hơn.
const MAU_HOP_LE = ["123456", "A1B2C3D4E5", "0123456789ABCDEF0123"];

describe("giao diện không được khoá chết người dùng đã bật MFA", () => {
  it("mọi ô nhập mã MFA chấp nhận cả TOTP 6 số lẫn mã dự phòng 10/20 ký tự", () => {
    const o = [...APP.matchAll(/<input[^>]*name="mfaToken"[^>]*>/g)].map((m) => m[0]);
    expect(o.length).toBeGreaterThan(0);
    for (const the of o) {
      const pattern = /pattern="([^"]+)"/.exec(the)?.[1];
      if (!pattern) continue; // Bỏ hẳn pattern cũng hợp lệ: server đã kiểm bằng Zod.
      const re = new RegExp(`^(?:${pattern})$`);
      for (const ma of MAU_HOP_LE) expect(re.test(ma), `pattern ${pattern} chặn mã hợp lệ ${ma}`).toBe(true);
    }
  });

  it("backend vẫn nhận đúng ba hình dạng đó (chốt để giao diện bám theo)", () => {
    const re = /mfaToken: z\.string\(\)\.regex\((\/[^/]+\/)/.exec(VALIDATORS);
    expect(re).not.toBeNull();
    const beRe = new RegExp(re[1].slice(1, -1));
    for (const ma of MAU_HOP_LE) expect(beRe.test(ma)).toBe(true);
  });

  it("api.acceptInvite chuyển tiếp được mfaToken", () => {
    const khoi = API.slice(API.indexOf("acceptInvite:"), API.indexOf("acceptInvite:") + 600);
    expect(khoi).toMatch(/mfaToken\?: string/);
  });

  it("màn onboard có ô nhập mã MFA, gửi kèm mfaToken và bắt cờ mfaRequired", () => {
    const ob = APP.slice(APP.indexOf("function OnboardPage"));
    expect(ob).toMatch(/name="mfaToken"/);
    expect(ob).toMatch(/api\.acceptInvite\([\s\S]{0,400}mfaToken/);
    expect(ob).toMatch(/mfaRequired/);
  });
});
