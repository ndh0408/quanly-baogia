// Template BANNER (gn_banner) — template DUY NHẤT bật `numberSubsections`, tức template duy nhất
// mà nhóm CHA bao trùm nhóm CON. Hai lỗi công thức chỉ hại FILE GỬI KHÁCH: số ghi sẵn (`result`)
// đúng bằng lưới web + DB, nên trên màn hình mọi thứ bình thường; sai chỉ lộ ra khi KHÁCH mở file
// và Excel tính lại công thức.
//   1) Đơn Giá nhóm cha `=SUM(<đơn giá nhóm con>)` — bỏ mất các mục lẻ trực thuộc cha.
//   2) Tổng Cộng cộng cả hàng cha LẪN hàng con, trong khi cha đã bao trùm con → cộng ĐÔI
//      (nhóm cha có 2 nhóm con thì tổng gấp 3: 3.000.000 thành 9.000.000).
// Bài test tự TÍNH LẠI công thức trong file rồi đối chiếu với `result` và với
// sheetSubtotalGrouped (con số của lưới web) — không tin lời khai của công thức.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { sheetSubtotalGrouped } from "../shared/quote-math.js";

const S = (name, quantity) => ({ kind: "section", name, quantity, unitPrice: 0, days: null });
const SS = (name, quantity) => ({ kind: "subsection", name, quantity, unitPrice: 0, days: null });
const I = (name, quantity, unitPrice) => ({ kind: "item", name, detail: "", unit: "cái", quantity, unitPrice, days: null, notes: "" });

function makeQuote(code, items, groupSubtotal) {
  return {
    quoteNumber: "GN26BAN", title: "Báo giá banner", toCompany: "ABC", toContact: "A", toPhone: "0900",
    toAddress: "X", vatPercent: 8, discount: 0, showTotals: true, city: "TP. Hồ Chí Minh",
    quoteDate: new Date("2026-06-13"), fromContact: "B", fromTitle: "Sale", fromPhone: "0911",
    fromAddress: "Y", greeting: "Xin gửi báo giá:",
    sheets: [{ order: 1, name: "Sheet 1", groupSubtotal, template: { code }, items }],
  };
}

/** Máy tính công thức tối giản: SUM(vùng|danh sách), ROUND(x,n), + - * / và %, tham chiếu ô. */
function makeEvaluator(ws) {
  const cache = new Map();
  const readCell = (addr) => {
    const v = ws.getCell(addr).value;
    if (v && typeof v === "object" && "formula" in v) return { formula: v.formula, result: Number(v.result) || 0 };
    return { value: typeof v === "number" ? v : 0 };
  };
  const evalAddr = (addr) => {
    if (cache.has(addr)) return cache.get(addr);
    cache.set(addr, 0);   // chặn tham chiếu vòng
    const cell = readCell(addr);
    const out = cell.formula != null ? evalFormula(cell.formula) : cell.value;
    cache.set(addr, out);
    return out;
  };
  const expandRange = (a, b) => {
    const [, col, r1] = /^([A-Z]+)(\d+)$/.exec(a), [, , r2] = /^([A-Z]+)(\d+)$/.exec(b);
    const out = [];
    for (let r = Number(r1); r <= Number(r2); r++) out.push(col + r);
    return out;
  };
  function evalFormula(f) {
    let s = String(f).replace(/^=/, "");
    s = s.replace(/ROUND\(([^()]*)\)/gi, (_, inner) => {
      const parts = inner.split(","), digits = Number(parts.pop());
      return String(Math.round(evalFormula(parts.join(",")) * 10 ** digits) / 10 ** digits);
    });
    s = s.replace(/SUM\(([^()]*)\)/gi, (_, inner) => {
      let total = 0;
      for (const part of inner.split(",")) {
        const t = part.trim();
        if (t.includes(":")) for (const ad of expandRange(...t.split(":"))) total += evalAddr(ad);
        else if (/^[A-Z]+\d+$/.test(t)) total += evalAddr(t);
        else total += Number(t) || 0;
      }
      return String(total);
    });
    s = s.replace(/\b([A-Z]{1,2}\d+)\b/g, (m) => String(evalAddr(m)));
    s = s.replace(/(\d+(?:\.\d+)?)%/g, (_, d) => String(Number(d) / 100));
    // Sau các bước trên chuỗi PHẢI thuần số học. Còn chữ = có hàm/ô mà bộ dịch này chưa hiểu →
    // ném lỗi cho bài test đỏ, thay vì eval bừa (hoặc âm thầm trả 0 và "chứng minh" là khớp).
    if (!/^[\d+\-*/(). ]+$/.test(s)) throw new Error(`công thức chưa dịch hết: ${f} → ${s}`);
    return Number(new Function(`return (${s})`)()) || 0;  
  }
  return { evalAddr, readCell };
}

/** Mọi ô công thức trong sheet: tính lại có ra đúng con số đã ghi sẵn không. */
async function mismatches(quote) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(structuredClone(quote)));
  const ws = wb.worksheets[0];
  const ev = makeEvaluator(ws);
  const bad = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      if (!v || typeof v !== "object" || !("formula" in v) || typeof v.result !== "number") return;
      const got = Math.round(ev.evalAddr(cell.address));
      if (got !== Math.round(v.result)) bad.push(`${cell.address} =${v.formula} → ${got} ≠ ${v.result}`);
    });
  });
  return bad;
}

// Ô Tổng Cộng = ô công thức đầu tiên nằm DƯỚI bảng (cột H, sau hàng cuối của bảng items).
async function subtotalCell(quote) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(structuredClone(quote)));
  const ws = wb.worksheets[0];
  const ev = makeEvaluator(ws);
  for (let r = 12; r <= 60; r++) {
    if (String(ws.getCell(`F${r}`).value || "").startsWith("Tổng Cộng")) return { addr: `H${r}`, calc: Math.round(ev.evalAddr(`H${r}`)), result: Math.round(Number(ws.getCell(`H${r}`).value?.result) || 0) };
  }
  throw new Error("không tìm thấy hàng Tổng Cộng");
}

const CASES = {
  "nhóm cha có CẢ mục lẻ LẪN nhóm con": [S("Nhóm A", 2), I("Lẻ", 1, 500_000), SS("A1", 3), I("m1", 1, 1_000_000)],
  "nhóm cha có hai nhóm con": [S("Nhóm A", 2), SS("A1", 1), I("m1", 1, 1_000_000), SS("A2", 1), I("m2", 1, 2_000_000)],
  "nhóm cha chỉ có nhóm con": [S("Nhóm A", 2), SS("A1", 3), I("m1", 1, 1_000_000)],
  "nhóm cha chỉ có mục": [S("Nhóm A", 2), I("m1", 1, 500_000), I("m2", 2, 1_000_000)],
  "mục tự do trước nhóm + nhóm lồng": [I("tự do", 2, 300_000), S("Nhóm A", 2), I("Lẻ", 1, 500_000), SS("A1", 3), I("m1", 1, 1_000_000)],
  "hai nhóm chính đều lồng nhóm con": [S("A", 2), I("Lẻ A", 1, 400_000), SS("A1", 2), I("m1", 1, 1_000_000), S("B", 3), SS("B1", 1), I("m2", 2, 250_000)],
  "nhóm rỗng + nhóm con rỗng": [S("A", 2), SS("A1", 3), S("B", 1), I("m", 1, 700_000)],
};

describe("gn_banner — công thức trong file khớp con số đã ghi sẵn", () => {
  for (const [label, items] of Object.entries(CASES)) {
    for (const groupSubtotal of [false, true]) {
      it(`${label} (Thành Tiền nhóm ${groupSubtotal ? "BẬT" : "tắt"})`, async () => {
        expect(await mismatches(makeQuote("gn_banner", items, groupSubtotal))).toEqual([]);
      });
    }
  }
});

describe("gn_banner — Tổng Cộng khi khách mở file bằng con số của lưới web", () => {
  for (const [label, items] of Object.entries(CASES)) {
    for (const groupSubtotal of [false, true]) {
      it(`${label} (Thành Tiền nhóm ${groupSubtotal ? "BẬT" : "tắt"})`, async () => {
        const { calc, result } = await subtotalCell(makeQuote("gn_banner", items, groupSubtotal));
        expect(calc).toBe(sheetSubtotalGrouped(items, false, groupSubtotal));
        expect(result).toBe(calc);
      });
    }
  }
});

// Ba template còn lại KHÔNG bật numberSubsections (nhóm cha không bao trùm nhóm con) — chúng vốn
// đã đúng, khoá lại để lần sửa công thức nhóm sau không kéo theo hồi quy ở đây.
describe("template thường không bị lỗi kéo theo", () => {
  for (const code of ["marico_decor", "clofull_decor", "unibenfood"]) {
    for (const groupSubtotal of [false, true]) {
      it(`${code} (Thành Tiền nhóm ${groupSubtotal ? "BẬT" : "tắt"})`, async () => {
        const items = CASES["nhóm cha có CẢ mục lẻ LẪN nhóm con"];
        expect(await mismatches(makeQuote(code, items, groupSubtotal))).toEqual([]);
      });
    }
  }
});
