// MÃ SẢN XUẤT CỦA SHEET KHÔNG ĐƯỢC CẤP LẠI — chốt hồi quy (src/quoteUtils.ts capSoMaSheet).
//
// ── LỖI (ultracode audit vòng 2, 2026-09-08) ────────────────────────────────
// `capSoMaSheet` tính số kế tiếp bằng `max(codeNo của sheet ĐANG CÒN) + 1`. Nhưng QuoteSheet KHÔNG
// nằm trong SOFT_DELETE_MODELS (src/db.ts) — mỗi lượt Lưu là XOÁ CỨNG rồi tạo lại — nên khi sheet
// mang số CAO NHẤT bị xoá, số đó biến mất khỏi CSDL và lượt thêm sheet kế tiếp cấp lại đúng số ấy:
//     lưu 1: A,B,C → 01,02,03      (mã _03 có thể đã in lên hoá đơn / gửi khách)
//     lưu 2: xoá C → còn 01,02
//     lưu 3: thêm D → max(01,02)+1 = 03   ← D mang ĐÚNG mã của C
// Hai chứng từ khác nhau cùng mang "FD_A26_001_03".
//
// Chính migration 20260907130000 đã hứa "sheet thêm mới nhận số kế tiếp CHƯA AI DÙNG trong cùng báo
// giá" — cột `Quote.sheetCodeSeq` (migration 20260908060000) là thứ giữ được lời hứa đó: mốc nước
// CHỈ TĂNG, đường ghi đọc nó ra và ghi lại sau mỗi lượt lưu.
//
// Bài này kiểm THUẦN qua buildSheetsCreate/mocSoMaSheet (không cần Postgres).
import { describe, it, expect } from "vitest";
import { buildSheetsCreate, mocSoMaSheet } from "../src/quoteUtils.js";

const sheet = (templateId = 1) => ({ templateId, items: [] });
/** carry[i] = hàng CSDL tương ứng trang thứ i (null = trang MỚI, chưa có mã). */
const soMa = (soTrang, carry, seq = 0) =>
  buildSheetsCreate(Array.from({ length: soTrang }, () => sheet()), undefined, carry, seq).map((s) => s.codeNo);

describe("capSoMaSheet — không cấp lại mã đã phát hành", () => {
  it("KỊCH BẢN LỖI: xoá trang mang số CAO NHẤT rồi thêm trang mới → KHÔNG được trùng", () => {
    // Lưu 1: ba trang mới → 1,2,3. Mốc nước sau lượt này = 3.
    const luu1 = soMa(3, [undefined, undefined, undefined], 0);
    expect(luu1).toEqual([1, 2, 3]);
    const seqSauLuu1 = mocSoMaSheet(luu1.map((codeNo) => ({ codeNo })), 0);
    expect(seqSauLuu1).toBe(3);

    // Lưu 2: người dùng XOÁ trang số 3 → còn hai trang mang 1,2. Mốc nước vẫn 3.
    const luu2 = soMa(2, [{ codeNo: 1 }, { codeNo: 2 }], seqSauLuu1);
    expect(luu2).toEqual([1, 2]);
    const seqSauLuu2 = mocSoMaSheet(luu2.map((codeNo) => ({ codeNo })), seqSauLuu1);
    expect(seqSauLuu2, "mốc nước CHỈ TĂNG — không được tụt về 2 khi xoá trang 3").toBe(3);

    // Lưu 3: thêm một trang MỚI. Trước khi vá nó nhận 3 — trùng mã của trang đã xoá.
    const luu3 = soMa(3, [{ codeNo: 1 }, { codeNo: 2 }, undefined], seqSauLuu2);
    expect(luu3[2], "trang mới KHÔNG được mang lại mã 3 của trang đã xoá").toBe(4);
    expect(new Set(luu3).size, "không mã nào trùng").toBe(3);
  });

  it("xoá trang GIỮA (không phải cao nhất) vẫn giữ nguyên mã các trang còn lại", () => {
    const ra = soMa(2, [{ codeNo: 1 }, { codeNo: 3 }], 3);
    expect(ra, "xoá trang 02 thì 01 và 03 giữ nguyên").toEqual([1, 3]);
  });

  it("thêm nhiều trang một lúc → cấp liên tiếp từ mốc nước", () => {
    expect(soMa(4, [{ codeNo: 1 }, undefined, undefined, undefined], 7)).toEqual([1, 8, 9, 10]);
  });

  it("báo giá MỚI (chưa có mốc, chưa có carry) → 1,2,3 như cũ", () => {
    expect(soMa(3, undefined, 0)).toEqual([1, 2, 3]);
  });

  it("mốc nước THẤP hơn mã đang có (dữ liệu cũ chưa backfill) → vẫn không cấp trùng", () => {
    expect(soMa(3, [{ codeNo: 5 }, { codeNo: 9 }, undefined], 0)[2]).toBe(10);
  });

  it("mocSoMaSheet không bao giờ trả về số NHỎ HƠN mốc đang giữ", () => {
    expect(mocSoMaSheet([{ codeNo: 1 }, { codeNo: 2 }], 42)).toBe(42);
    expect(mocSoMaSheet([], 7)).toBe(7);
    expect(mocSoMaSheet([{ codeNo: 99 }], 7)).toBe(99);
  });
});
