/**
 * ============================================================================
 * Ô `<input type="date">` CHỈ NHẬN `yyyy-MM-dd`.
 *
 * ── TÌM RA BẰNG TRÌNH DUYỆT THẬT, KHÔNG PHẢI BẰNG ĐỌC MÃ ───────────────────
 * Mở báo giá #278 trên dev bằng Chrome DevTools, console ghi:
 *
 *     The specified value "2026-09-17T02:39:36.399Z" does not conform to the required format,
 *     "yyyy-MM-dd".
 *
 * API trả `quoteDate` là DateTime → chuỗi ISO đầy đủ, và nó được nhét thẳng vào `defaultValue`
 * của ô date. Theo chuẩn HTML, giá trị không hợp lệ thì ô phải hiện RỖNG. Chrome tự cắt nên ô vẫn
 * hiện đúng ngày — tức tính năng này đang chạy đúng chỉ nhờ một trình duyệt dễ dãi, và bài kiểm
 * đơn vị nào cũng không thấy vì không bài nào chạm tới phép gán đó.
 *
 * ── VÌ SAO CẮT CHUỖI CHỨ KHÔNG QUY MÚI GIỜ ─────────────────────────────────
 * Ô date ghi ngược lại đúng `yyyy-MM-dd`, máy chủ đọc thành nửa đêm UTC. Nên phép nghịch đảo ĐÚNG
 * là lấy phần ngày của chuỗi UTC. Dùng `toLocaleDateString` hay `getDate()` sẽ cộng thêm lệch múi
 * giờ và làm ngày NHẢY MỘT BẬC với bản ghi sát nửa đêm UTC — bài áp chót khoá đúng điều đó.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { ngayChoO } from "./QuoteEditor";

describe("ngayChoO", () => {
  it("chuỗi ISO đầy đủ → đúng phần ngày", () => {
    expect(ngayChoO("2026-09-17T02:39:36.399Z")).toBe("2026-09-17");
  });

  it("đã đúng dạng rồi thì để nguyên — người dùng vừa gõ xong không được bị đổi", () => {
    expect(ngayChoO("2026-09-17")).toBe("2026-09-17");
  });

  it("rỗng / null / undefined → chuỗi rỗng, KHÔNG phải 'Invalid Date'", () => {
    // Ô "Ngày thi công" thường trống. Trả về chuỗi lạ sẽ in cảnh báo y hệt lỗi đang vá.
    for (const x of ["", null, undefined]) expect(ngayChoO(x)).toBe("");
  });

  it("đối tượng Date cũng nhận được", () => {
    expect(ngayChoO(new Date("2026-01-05T10:00:00.000Z"))).toBe("2026-01-05");
  });

  it("KHÔNG quy về múi giờ địa phương — ngày sát nửa đêm UTC không được nhảy bậc", () => {
    // Máy chạy ở Asia/Ho_Chi_Minh (UTC+7). `new Date("2026-03-31T23:30:00Z").getDate()` ra NGÀY 1
    // THÁNG 4 theo giờ địa phương. Máy chủ lưu 31/3 nên ô phải hiện 31/3.
    expect(ngayChoO("2026-03-31T23:30:00.000Z")).toBe("2026-03-31");
  });

  it("rác không đúng dạng → rỗng, không ném", () => {
    for (const x of ["hôm nay", "17/09/2026", 12345, {}, []]) {
      expect(() => ngayChoO(x)).not.toThrow();
      expect(ngayChoO(x)).toBe("");
    }
  });
});
