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
 * ── NGÀY THEO LỊCH VIỆT NAM (+7 CỐ ĐỊNH), KHÔNG THEO MÚI GIỜ MÁY ─────────────
 * Ô date ghi ngược lại đúng `yyyy-MM-dd`, máy chủ lưu nửa đêm UTC; cộng 7 giờ vẫn cùng ngày nên giá
 * trị do web ghi đi một vòng không đổi. Nhưng bản ghi cũ tạo/nhân bản trước MONEY-07/XLSX-11 lưu
 * THỜI ĐIỂM đầy đủ (vd 2026-06-13T20:00Z = 03:00 sáng 14/06 giờ VN), và Excel/PDF nay đọc ngày theo
 * lịch VN (src/vnTime.ts ngayThangNamVN) nên in 14. Cắt 10 ký tự UTC thì ô hiện 13, và lần Lưu kế
 * tiếp ghi đè 13 — ngày trên chứng từ đổi qua lại theo một lần Lưu không liên quan (soát chéo
 * excel#10). Dùng `getDate()` thì sai kiểu khác: phụ thuộc múi giờ của máy đang mở.
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

  // Bài cũ ở đây đòi "2026-03-31T23:30Z" → "2026-03-31" với lý do "máy chủ lưu 31/3". Sau XLSX-11 máy
  // chủ ĐỌC mốc đó là 01/04 (06:30 sáng giờ VN) khi in Excel/PDF, trang danh sách cũng hiện 01/04 —
  // bài cũ khoá đúng chỗ lệch màn soạn ↔ tệp gửi khách (soát chéo excel#10), nên sửa theo lịch VN.
  it("mốc có giờ → ngày theo LỊCH VN, khớp Excel/PDF (ngayThangNamVN)", () => {
    expect(ngayChoO("2026-06-13T20:00:00.000Z")).toBe("2026-06-14");   // 03:00 sáng 14/06 giờ VN
    expect(ngayChoO("2026-03-31T23:30:00.000Z")).toBe("2026-04-01");   // 06:30 sáng 01/04 giờ VN
    expect(ngayChoO("2026-12-31T17:00:00.000Z")).toBe("2027-01-01");   // qua năm
    expect(ngayChoO("2026-06-13T16:59:59.999Z")).toBe("2026-06-13");   // 23:59 giờ VN — chưa sang ngày
  });

  it("nửa đêm UTC (mọi giá trị web/máy chủ ghi) → GIỮ NGUYÊN ngày, đi một vòng không đổi", () => {
    expect(ngayChoO("2026-06-13T00:00:00.000Z")).toBe("2026-06-13");
    expect(ngayChoO(new Date("2026-06-13T00:00:00.000Z"))).toBe("2026-06-13");
  });

  it("KHÔNG phụ thuộc múi giờ của máy đang mở", () => {
    // tsconfig web chỉ nạp kiểu vite/client (không có @types/node) — đọc process qua globalThis.
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    const goc = env.TZ;
    try {
      for (const tz of ["UTC", "America/New_York", "Asia/Ho_Chi_Minh"]) {
        env.TZ = tz;
        expect(ngayChoO("2026-06-13T20:00:00.000Z"), tz).toBe("2026-06-14");
        expect(ngayChoO("2026-06-13T00:00:00.000Z"), tz).toBe("2026-06-13");
      }
    } finally {
      if (goc === undefined) delete env.TZ; else env.TZ = goc;
    }
  });

  it("rác không đúng dạng → rỗng, không ném", () => {
    for (const x of ["hôm nay", "17/09/2026", 12345, {}, []]) {
      expect(() => ngayChoO(x)).not.toThrow();
      expect(ngayChoO(x)).toBe("");
    }
  });
});
