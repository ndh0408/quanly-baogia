// So từng Ô giữa mẫu có-ngày CŨ và MỚI cho cùng một báo giá. Chạy tay khi cần giải trình việc đổi
// golden hash của tests/excel-snapshot.test.js — KHÔNG phải bài kiểm, không chạy trong bộ test.
//
//   node scripts/so-o-mau-co-ngay.mjs
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { TEMPLATE_CONFIGS } from "../src/templateConfigs.js";

const q = (over = {}) => ({
  id: 1, quoteNumber: "GN26999", title: "So mẫu", toCompany: "CGV", toContact: "Mr. Tài",
  fromContact: "Lan Anh", fromTitle: "Account", fromPhone: "0914291951", fromAddress: "x",
  city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-17T00:00:00Z"), vatPercent: 8, hnTables: [],
  sheets: [{
    id: 1, name: "Premiere", order: 1, templateCode: "unibenfood", groupSubtotal: false, discount: 0,
    extraTables: [],
    items: [{ order: 1, kind: "item", name: "Có ngày", detail: "chi tiết", unit: "cái", quantity: 2, days: 3, unitPrice: 300_000, notes: "gc" }],
  }],
  ...over,
});

const chu = (v) => (v && typeof v === "object" && Array.isArray(v.richText))
  ? v.richText.map((x) => x.text).join("")
  : (v && typeof v === "object" && v.formula) ? `=${v.formula}` : String(v ?? "");

async function doc() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(q()));
  const ws = wb.worksheets[0];
  const m = new Map();
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    if (r > 26) return;
    row.eachCell({ includeEmpty: false }, (c) => { const t = chu(c.value); if (t !== "") m.set(c.address, t); });
  });
  return m;
}

const goc = { ...TEMPLATE_CONFIGS.unibenfood };
TEMPLATE_CONFIGS.unibenfood = {
  ...TEMPLATE_CONFIGS.marico_decor,
  sheetName: "Quotation",
  filePath: "templates/Unibenfood.xlsx",
  items: {
    ...TEMPLATE_CONFIGS.marico_decor.items,
    removeDetail: false,
    columns: { stt: "B", name: "C", unit: "D", quantity: "E", days: "F", unitPrice: "G", amount: "H" },
    amountFormula: (r) => `G${r}*E${r}*F${r}`,
  },
};
const cu = await doc();
TEMPLATE_CONFIGS.unibenfood = goc;
const moi = await doc();

const khoa = [...new Set([...cu.keys(), ...moi.keys()])].sort((a, b) => {
  const na = +a.replace(/\D/g, ""), nb = +b.replace(/\D/g, "");
  return na - nb || a.localeCompare(b);
});
let doi = 0;
for (const k of khoa) {
  const a = cu.get(k), b = moi.get(k);
  if (a === b) continue;
  doi++;
  console.log(`${k.padEnd(5)} CŨ=${JSON.stringify(a ?? null)}`.padEnd(52) + ` MỚI=${JSON.stringify(b ?? null)}`);
}
console.log(`\nsố ô khác nhau: ${doi} · ô cũ: ${cu.size} · ô mới: ${moi.size}`);
