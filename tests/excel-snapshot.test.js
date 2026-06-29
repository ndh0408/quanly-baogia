// REGRESSION-LOCK cho Excel xuất khách: build nhiều quote (đủ mẫu + cấu trúc), ĐỌC LẠI workbook +
// snapshot semantic (giá trị + numFmt + bold + fill từng ô) → hash. KHÔNG hash bytes thô (xlsx có
// timestamp → flaky). Hash phải KHỚP golden → mọi thay đổi output Excel (kể cả refactor) sẽ làm test ĐỎ.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import crypto from "node:crypto";
import { buildQuoteBuffer } from "../src/excel.js";

function q(over = {}) {
  return {
    quoteNumber: "GN26SNAP", title: "Báo giá snapshot", toCompany: "Công ty Kiểm Thử",
    toContact: "Anh Test", toEmail: "t@test.vn", toPhone: "0900000000", toAddress: "123 Đường X, Q.7",
    vatPercent: 8, discount: 0, showTotals: true, city: "TP. Hồ Chí Minh",
    quoteDate: new Date("2026-06-13"), executionDate: new Date("2026-06-20"),
    fromContact: "Chị Sale", fromTitle: "Trưởng phòng", fromPhone: "0911111111", fromAddress: "456 Đường Y",
    greeting: "Xin trân trọng gửi báo giá:", ...over,
  };
}
const sheet = (items, over = {}) => ({ order: 1, name: "Sheet 1", groupSubtotal: false, template: { code: "marico_decor" }, items, ...over });
const item = (o) => ({ kind: "item", name: "Hạng mục", detail: "", unit: "cái", quantity: 1, unitPrice: 1000000, days: null, notes: "", ...o });

// Các quote phủ: mẫu GN-không-ngày, GN-có-ngày, CLF, nhóm/nhóm-con/info, days, discount, groupSubtotal.
const CASES = {
  "gn-nodate-simple": q({ sheets: [sheet([item({ name: "A" }), item({ name: "B", quantity: 2, unitPrice: 500000 })])] }),
  "gn-withdate": q({ sheets: [sheet([item({ name: "Có ngày", days: 3, quantity: 2, unitPrice: 300000 })], { template: { code: "unibenfood" } })] }),
  "clf": q({ sheets: [sheet([item({ name: "CLF item", detail: "chi tiết CLF" })], { template: { code: "clofull_decor" } })] }),
  "groups": q({ sheets: [sheet([
    { kind: "section", name: "NHÓM A", quantity: 1 },
    item({ name: "A1" }), item({ name: "A2", quantity: 3 }),
    { kind: "subsection", name: "Nhóm con", quantity: 1 },
    item({ name: "Con 1", unitPrice: 200000 }),
    { kind: "info", name: "Dòng thông tin (không tính tiền)" },
  ], { groupSubtotal: true })] }),
  "discount": q({ discount: 150000, sheets: [sheet([item({ name: "X", quantity: 2, unitPrice: 2000000 })])] }),
  // Nhiều sheet: tab Excel đánh số "1. …/2. …" + tiêu đề mỗi sheet nối tên sheet ("… - Banner").
  "multi-sheet": q({ sheets: [
    sheet([item({ name: "Banner item" })], { name: "Banner" }),
    sheet([item({ name: "Standee item", quantity: 2, unitPrice: 500000 })], { order: 2, name: "Standee" }),
  ] }),
  // 1 sheet KHÔNG đặt tên: tiêu đề KHÔNG nối tên sheet (giữ logic gốc).
  "single-noname": q({ sheets: [sheet([item({ name: "X" })], { name: "" })] }),
};

async function snapshot(quote) {
  const buf = await buildQuoteBuffer(quote);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const dump = [];
  wb.eachSheet((ws) => {
    const cells = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const v = cell.value;
        const val = v && typeof v === "object" ? (v.result ?? v.formula ?? v.richText?.map((t) => t.text).join("") ?? JSON.stringify(v)) : v;
        cells.push([r, c, String(val ?? ""), cell.numFmt || "", cell.font?.bold ? "B" : "", cell.fill?.fgColor?.argb || ""]);
      });
    });
    dump.push([ws.name, cells]);
  });
  return crypto.createHash("sha256").update(JSON.stringify(dump)).digest("hex").slice(0, 16);
}

describe("Excel xuất khách — REGRESSION LOCK (semantic snapshot)", () => {
  for (const [name, quote] of Object.entries(CASES)) {
    it(`giữ NGUYÊN output: ${name}`, async () => {
      const h = await snapshot(quote);
      // Golden hash sinh từ excel.ts (lần đầu in ra để chốt). Đổi output = test ĐỎ.
      expect({ [name]: h }).toMatchSnapshot();
    });
  }
});
