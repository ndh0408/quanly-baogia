// `tieuDeHienThi` (chữ ô "Tiêu đề" của danh sách) có MỘT bản ở máy chủ (src/quoteListFilter.ts) để cột Tiêu đề sắp theo
// ĐÚNG chữ này. Hai gói riêng nên không import chéo được — khoá bằng CÙNG bộ ca ở cả hai bài (tests/ql-loc-danh-sach.test.js).
// Sửa bộ ca thì sửa cả hai, không thì cột sắp xếp và chữ hiện ra lệch nhau.
import { describe, it, expect } from "vitest";
import { tieuDeHienThi } from "./format";

describe("tieuDeHienThi — khớp bản ở máy chủ", () => {
  it("cùng bộ ca với tests/ql-loc-danh-sach.test.js", () => {
    const ca: [string, string | null | undefined, string][] = [
      ["BẢNG BÁO GIÁ - A", null, "A"],
      ["Bảng báo giá | B", "", "B"],
      ["C", "  c rút gọn ", "c rút gọn"],
      ["BẢNG BÁO GIÁ — D", undefined, "D"],
    ];
    for (const [title, shortTitle, ra] of ca) expect(tieuDeHienThi({ title, shortTitle })).toBe(ra);
  });
  it("các ca biên giống bản máy chủ: rút gọn toàn khoảng trắng → dùng tiêu đề chính; chỉ có tiền tố → giữ nguyên; rỗng → rỗng", () => {
    expect(tieuDeHienThi({ title: "BẢNG BÁO GIÁ - Zoo", shortTitle: "   " })).toBe("Zoo");
    expect(tieuDeHienThi({ title: "bảng  báo  giá : X" })).toBe("X");
    expect(tieuDeHienThi({ title: "Bảng báo giá" })).toBe("Bảng báo giá");
    expect(tieuDeHienThi({})).toBe("");
  });
});
