// XLSX-01 / XLSX-02 / XLSX-03 — PDF gửi khách phải khớp tệp Excel cùng báo giá.
//
// XLSX-01: drawItemsTable tăng `sectionIdx` TRƯỚC khi gọi groupLetter (vốn đánh 0 → "A") nên nhóm
//          đầu in "B", nhóm hai "C"… trong khi Excel và màn hình in "A", "B".
// XLSX-02: Thành Tiền từng MỤC nhân hệ số nhóm (SL nhóm) khi bật "Thành Tiền nhóm": Bàn 1×100.000
//          in 300.000. Excel ghi ROUND(SL×ĐG) = 100.000, lưới web cũng vậy; hệ số chỉ áp ở hàng nhóm.
// XLSX-03: PDF bỏ qua `showTotals`, luôn in Tổng phụ/VAT/Thành tiền dù người dùng đã tắt — trong
//          khi Excel bỏ sheet "Tổng Báo Giá" và UI hứa ẩn "cả màn hình lẫn Excel/PDF".
//
// Không bài PDF nào trước đây kiểm NỘI DUNG chữ (xp-pdf-rowheight chỉ đo chiều cao). Ở đây chặn
// PDFDocument.prototype.text để ghi lại mọi chuỗi được vẽ, theo đúng thứ tự.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import PDFDocument from "pdfkit";
import { renderQuotePdf, pdfTotals } from "../src/pdf.js";

let chu = [];
beforeEach(() => {
  chu = [];
  const goc = PDFDocument.prototype.text;
  vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (t, ...rest) {
    chu.push(String(t));
    return goc.call(this, t, ...rest);
  });
});
afterEach(() => vi.restoreAllMocks());

const baoGia = (items, extra = {}) => ({
  quoteNumber: "PDFKHOP", title: "Bao gia", quoteDate: new Date("2026-08-01"),
  company: { name: "Cty" }, subtotal: 0, vat: 0, total: 0, vatPercent: 10,
  sheets: [{ name: "S1", groupSubtotal: extra.groupSubtotal ?? false, items }],
  ...extra,
});

describe("XLSX-01 — chữ nhóm A/B/C", () => {
  it("nhóm đầu là A, nhóm hai là B; nhóm có label giữ label", async () => {
    await renderQuotePdf(baoGia([
      { kind: "section", name: "Nhom mot" },
      { kind: "item", name: "Ban", quantity: 1, unitPrice: 1000 },
      { kind: "section", name: "Nhom hai" },
      { kind: "item", name: "Ghe", quantity: 1, unitPrice: 1000 },
      { kind: "section", name: "Nhom ba", label: "X" },
      { kind: "item", name: "Tu", quantity: 1, unitPrice: 1000 },
    ]));
    const truoc = (ten) => chu[chu.indexOf(ten) - 1];
    expect(truoc("Nhom mot"), "nhóm đầu bị đánh chữ lệch một bậc").toBe("A");
    expect(truoc("Nhom hai")).toBe("B");
    expect(truoc("Nhom ba")).toBe("X");
  });
});

describe("XLSX-02 — Thành Tiền mục không nhân hệ số nhóm", () => {
  it("nhóm SL=3: mục in SL×ĐG; hàng nhóm in Σ mục × 3; tổng không đổi", async () => {
    const q = baoGia([
      { kind: "section", name: "Nhom", quantity: 3 },
      { kind: "item", name: "Ban", quantity: 1, unitPrice: 100000 },
      { kind: "item", name: "Ghe", quantity: 2, unitPrice: 50000 },
    ], { groupSubtotal: true });
    await renderQuotePdf(q);
    const hang = (ten) => chu.slice(chu.indexOf(ten), chu.indexOf(ten) + 5);
    // [tên, ĐVT, SL, Đơn giá, Thành tiền]
    expect(hang("Ban")[4], "Thành Tiền mục bị nhân hệ số nhóm").toBe((100000).toLocaleString("vi-VN"));
    expect(hang("Ghe")[4]).toBe((100000).toLocaleString("vi-VN"));
    const nhom = chu.slice(chu.indexOf("Nhom"), chu.indexOf("Nhom") + 5);
    expect(nhom).toContain((200000).toLocaleString("vi-VN"));   // Đơn giá nhóm = Σ mục
    expect(nhom).toContain((600000).toLocaleString("vi-VN"));   // Thành tiền nhóm = × 3
    expect(pdfTotals(q).subtotal).toBe(600000);
  });
});

describe("XLSX-03 — showTotals", () => {
  const items = [{ kind: "item", name: "Ban", quantity: 1, unitPrice: 100000 }];
  it("showTotals=false → không in khối Tổng phụ / VAT / Thành tiền", async () => {
    await renderQuotePdf(baoGia(items, { showTotals: false }));
    const noi = chu.join("\n");
    expect(noi).not.toMatch(/Tổng phụ:|VAT \(|Thành tiền:/);
  });
  it("showTotals mặc định (undefined/true) → vẫn in đủ", async () => {
    await renderQuotePdf(baoGia(items));
    const noi = chu.join("\n");
    expect(noi).toMatch(/Tổng phụ:/);
    expect(noi).toMatch(/VAT \(10%\)/);
    expect(noi).toMatch(/Thành tiền:/);
  });
});
