// XLSX-04 — thụt lề (nhóm con) và in nghiêng (dòng info) KHÔNG được lan sang hàng khác.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Báo giá dài hơn số khe của mẫu (GN: 10 khe, hàng 12–21) → `ws.duplicateRow(21, …)`. ExcelJS gán
// CÙNG MỘT đối tượng style cho hàng 21 và mọi hàng nhân bản. src/excel.ts gán thẳng
// `nameCell.alignment = {…, indent: 1}` (nhóm con) và `nameCell.font = {…, italic: true}` (dòng info)
// → sửa đối tượng chung → MỌI tên hạng mục từ hàng 21 trở xuống bị thụt lề / in nghiêng trong tệp
// gửi khách.
//
// ── GN CỦA BÁO GIÁ BÌNH THƯỜNG KHÔNG ĐỔI ────────────────────────────────────
// Đã đo bằng bộ 246 báo giá (6 mẫu × nhiều cỡ × có/không Thành tiền nhóm): mọi báo giá GN mà hàng
// nhóm con/info nằm trong 10 khe đầu cho ra từng phần XML (styles + sheet) GIỐNG HỆT bản trước.
// Khác biệt chỉ xuất hiện khi hàng đặc biệt rơi vào vùng nhân bản, và so từng ô thì CHỈ có
// indent/italic của tên hạng mục THƯỜNG bị gỡ — hàng nhóm con/info vẫn giữ đúng định dạng của nó.
// Ca "trong khe" bên dưới khoá phần "không đổi".
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

const item = (name) => ({ kind: "item", name, detail: "", unit: "cái", quantity: 1, unitPrice: 100000, days: null, notes: "" });
const baoGia = (code, n, dacBiet) => {
  const items = [];
  for (let i = 0; i < n; i++) items.push(dacBiet[i] ?? item(`HM${i}`));
  return {
    quoteNumber: "GN26XL04", title: "T", toCompany: "K", vatPercent: 8, showTotals: true, city: "HCM",
    quoteDate: new Date("2026-06-13T00:00:00Z"), fromContact: "S",
    sheets: [{ order: 1, name: "S", groupSubtotal: true, template: { code }, items }],
  };
};
async function oTen(quote) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(quote));
  const ws = wb.worksheets[0];
  const ra = [];
  ws.eachRow((row, r) => {
    const c = row.getCell("C");
    const v = typeof c.value === "string" ? c.value : null;
    if (v && (/^HM\d+$/.test(v) || /muộn|sớm/.test(v))) ra.push({ r, v, indent: c.alignment?.indent ?? 0, italic: !!c.font?.italic });
  });
  return ra;
}

describe("XLSX-04 — định dạng không lan trên hàng nhân bản (mẫu GN, 16 dòng > 10 khe)", () => {
  for (const code of ["marico_decor", "unibenfood"]) {
    it(`${code}: nhóm con ở vị trí 14 → chỉ đúng hàng đó thụt lề`, async () => {
      const o = await oTen(baoGia(code, 16, { 0: { kind: "section", name: "Nhóm A" }, 13: { kind: "subsection", name: "Nhóm con muộn" } }));
      expect(o.find((x) => x.v === "Nhóm con muộn")?.indent).toBe(1);
      const lan = o.filter((x) => x.v !== "Nhóm con muộn" && x.indent);
      expect(lan.map((x) => `${x.v}@${x.r}`), "tên hạng mục thường bị thụt lề theo nhóm con").toEqual([]);
    });

    it(`${code}: dòng info ở vị trí 13 → chỉ đúng hàng đó in nghiêng`, async () => {
      const o = await oTen(baoGia(code, 16, { 0: { kind: "section", name: "Nhóm A" }, 12: { kind: "info", name: "Dòng info muộn" } }));
      expect(o.find((x) => x.v === "Dòng info muộn")?.italic).toBe(true);
      const lan = o.filter((x) => x.v !== "Dòng info muộn" && x.italic);
      expect(lan.map((x) => `${x.v}@${x.r}`), "tên hạng mục thường bị in nghiêng theo dòng info").toEqual([]);
    });
  }

  it("nhóm con nằm TRONG 10 khe đầu: vẫn thụt lề đúng hàng đó, hàng khác không (hành vi cũ giữ nguyên)", async () => {
    const o = await oTen(baoGia("marico_decor", 16, { 0: { kind: "section", name: "Nhóm A" }, 3: { kind: "subsection", name: "Nhóm con sớm" } }));
    expect(o.find((x) => x.v === "Nhóm con sớm")?.indent).toBe(1);
    expect(o.filter((x) => x.v !== "Nhóm con sớm" && x.indent)).toEqual([]);
  });
});
