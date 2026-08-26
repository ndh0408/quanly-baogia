// So sánh mã CSRF — chốt một lỗi biến 403 thành 500.
//
// Node PHÍA MÁY CHỦ giải mã giá trị header theo latin1: 64 byte thô trên dây trở thành chuỗi 64
// KÝ TỰ. Nếu trong đó có byte ≥ 0x80 thì `Buffer.from(chuỗi, "utf8")` cho RA NHIỀU HƠN 64 byte.
//
// Bản đầu của hàm này so ĐỘ DÀI CHUỖI trước:
//     if (typeof sent !== "string" || sent.length !== expected.length) return false;
//     return timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
// 64 === 64 nên lọt qua, rồi timingSafeEqual ném RangeError ("Input buffers must have the same
// byte length"). Kết quả: 500 kèm vết stack trong log, thay vì một lần từ chối 403 gọn gàng — và
// bất kỳ ai cũng gây được, chỉ bằng một header.
//
// Ca này KHÔNG dựng được qua supertest: Node phía CLIENT từ chối gửi header ngoài Latin-1
// ("Invalid character in header content"). Vì vậy kiểm thẳng ở mức hàm.
import { describe, it, expect } from "vitest";
import { csrfTokenMatches } from "../src/app.js";

const TOKEN = "a".repeat(64); // giống mã thật: 64 ký tự hex

describe("csrfTokenMatches", () => {
  it("mã đúng → true", () => {
    expect(csrfTokenMatches(TOKEN, TOKEN)).toBe(true);
  });

  it("mã sai cùng độ dài → false", () => {
    expect(csrfTokenMatches("b".repeat(64), TOKEN)).toBe(false);
  });

  it("khác độ dài → false, không ném", () => {
    expect(csrfTokenMatches("a".repeat(63), TOKEN)).toBe(false);
    expect(csrfTokenMatches("a".repeat(65), TOKEN)).toBe(false);
  });

  it("không phải chuỗi → false (header trùng lặp cho ra mảng)", () => {
    expect(csrfTokenMatches(undefined, TOKEN)).toBe(false);
    expect(csrfTokenMatches([TOKEN, TOKEN], TOKEN)).toBe(false);
    expect(csrfTokenMatches(123, TOKEN)).toBe(false);
  });

  it("ĐÂY LÀ CA ĐÃ VÁ: 64 ký tự nhưng nhiều hơn 64 byte → false, KHÔNG ném", () => {
    // Đúng thứ mà Node dựng ra khi nhận 64 byte thô có byte ≥ 0x80.
    const latin1_64ky_tu_65byte = "a".repeat(63) + "ÿ";
    expect(latin1_64ky_tu_65byte.length).toBe(64); // qua được phép so độ dài CHUỖI
    expect(Buffer.from(latin1_64ky_tu_65byte, "utf8").length).toBe(65); // nhưng khác SỐ BYTE
    expect(() => csrfTokenMatches(latin1_64ky_tu_65byte, TOKEN)).not.toThrow();
    expect(csrfTokenMatches(latin1_64ky_tu_65byte, TOKEN)).toBe(false);
  });

  it("chuỗi tiếng Việt cùng số ký tự → false, KHÔNG ném", () => {
    const viet = "ă".repeat(64); // 64 ký tự, 128 byte
    expect(viet.length).toBe(64);
    expect(() => csrfTokenMatches(viet, TOKEN)).not.toThrow();
    expect(csrfTokenMatches(viet, TOKEN)).toBe(false);
  });
});
