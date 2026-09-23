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
  // Soát chéo money#3: bài cũ ở đây đòi showTotals=false thì KHÔNG có VAT/Thành tiền nào — tức khoá
  // đúng hồi quy. Excel tắt bảng tổng chỉ bỏ sheet "Tổng Báo Giá"; trong sheet vẫn có Tổng Cộng →
  // VAT → Thành Tiền (fillSheetData), màn hình cũng vậy. PDF phải in khối đó của TỪNG sheet.
  const vnd = (n) => `${n.toLocaleString("vi-VN")} VND`;
  it("showTotals=false → bỏ khối tổng CẢ báo giá, nhưng vẫn in Tổng cộng / VAT / Thành tiền của sheet", async () => {
    await renderQuotePdf(baoGia(items, { showTotals: false }));
    const noi = chu.join("\n");
    expect(noi).not.toMatch(/Tổng phụ:/);                            // khối cả báo giá — đã tắt
    expect(noi).toContain(`Tổng cộng: ${vnd(100000)}`);
    expect(noi, "PDF gửi khách mất VAT trong khi Excel vẫn in").toContain(`VAT (10%): ${vnd(10000)}`);
    expect(noi).toContain(`Thành tiền: ${vnd(110000)}`);
  });
  it("showTotals=false + Discount → dòng cuối là Thành tiền ĐÃ có VAT (99.000), không phải Tổng cộng 90.000", async () => {
    const q = baoGia(items, { showTotals: false });
    q.sheets[0].discount = 10000;
    await renderQuotePdf(q);
    const tong = chu.filter((s) => / VND$/.test(s));
    expect(tong).toEqual([
      `Cộng: ${vnd(100000)}`, `Discount: ${vnd(-10000)}`, `Tổng cộng: ${vnd(90000)}`,
      `VAT (10%): ${vnd(9000)}`, `Thành tiền: ${vnd(99000)}`,
    ]);
  });
  it("showTotals=false, 2 sheet → mỗi sheet một khối VAT/Thành tiền riêng, khớp khối tổng từng tab Excel", async () => {
    const q = baoGia(items, { showTotals: false });
    q.sheets.push({ name: "S2", groupSubtotal: false, items: [{ kind: "item", name: "Ghe", quantity: 3, unitPrice: 50000 }] });
    await renderQuotePdf(q);
    const tong = chu.filter((s) => / VND$/.test(s));
    expect(tong).toEqual([
      `Tổng cộng: ${vnd(100000)}`, `VAT (10%): ${vnd(10000)}`, `Thành tiền: ${vnd(110000)}`,
      `Tổng cộng: ${vnd(150000)}`, `VAT (10%): ${vnd(15000)}`, `Thành tiền: ${vnd(165000)}`,
    ]);
  });
  it("showTotals mặc định + Discount → khối từng sheet GIỮ như cũ (không thêm VAT theo sheet)", async () => {
    const q = baoGia(items);
    q.sheets[0].discount = 10000;
    await renderQuotePdf(q);
    const tong = chu.filter((s) => / VND$/.test(s));
    expect(tong).toEqual([
      `Cộng: ${vnd(100000)}`, `Discount: ${vnd(-10000)}`, `Tổng cộng: ${vnd(90000)}`,   // khối sheet
      `Cộng: ${vnd(100000)}`, `Discount: ${vnd(-10000)}`, `Tổng cộng: ${vnd(90000)}`,   // khối báo giá
      `VAT (10%): ${vnd(9000)}`, `Thành tiền: ${vnd(99000)}`,
    ]);
  });
  it("showTotals mặc định (undefined/true) → vẫn in đủ", async () => {
    await renderQuotePdf(baoGia(items));
    const noi = chu.join("\n");
    expect(noi).toMatch(/Tổng phụ:/);
    expect(noi).toMatch(/VAT \(10%\)/);
    expect(noi).toMatch(/Thành tiền:/);
  });
});
