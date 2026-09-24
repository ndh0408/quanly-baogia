// L33 — dải vượt số hàng ("=SUM(F1:F50)" trên bảng 4 hàng): web ra 0 (GridTable trả null cho dải có đầu
// ngoài bảng, evalFormula thay cả dải bằng "0") còn bộ tự kiểm máy chủ (editorRefs.range đệm 0) ra 115.000
// → hai phía lệch nhau. Bài này đối chiếu TRỰC TIẾP bộ tính web (với bộ giải mô phỏng GridTable) và bộ tự
// kiểm thật của máy chủ (buildFormulaContext._editorRefs) trên cùng một bảng.
import { describe, it, expect } from "vitest";
import { buildFormulaContext, evalEditorFormula } from "../src/quoteFormula.js";
import { evalFormula as evalWeb } from "../web/src/lib/formula.ts";

// GN (có Chi Tiết, không ngày): cột editor A=_stt B=name C=detail D=unit E=quantity F=unitPrice G=_amount
const GN_COLS = { stt: "B", name: "C", detail: "D", unit: "E", quantity: "F", unitPrice: "G", amount: "H", notes: "I" };
const items = [
  { kind: "item", quantity: 1, unitPrice: 58000 },
  { kind: "item", quantity: 2, unitPrice: 57000 },
  { kind: "item", quantity: 3, unitPrice: 0 },
  { kind: "item", quantity: 4, unitPrice: 0 },
];
const fc = buildFormulaContext({ cols: GN_COLS, items, rowToExcel: (i) => (i < items.length ? 12 + i : null) });

// Bộ giải kiểu GridTable: cell ngoài bảng = 0; range trả null nếu một đầu dải ngoài bảng.
const COT = { E: "quantity", F: "unitPrice" };
const tach = (a) => { const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a); return m ? { L: m[1].toUpperCase(), r: +m[2] - 1 } : null; };
const trong = (p) => !!p && p.r >= 0 && p.r < items.length && "ABCDEFGH".includes(p.L);
const webRefs = {
  cell: (a) => { const p = tach(a); return trong(p) && COT[p.L] ? items[p.r][COT[p.L]] : 0; },
  range: (a, b) => {
    const pa = tach(a), pb = tach(b);
    if (!trong(pa) || !trong(pb)) return null;
    const out = [];
    for (let r = Math.min(pa.r, pb.r); r <= Math.max(pa.r, pb.r); r++) out.push(COT[pa.L] ? items[r][COT[pa.L]] : 0);
    return out;
  },
};

describe("L33 — web === máy chủ với dải vượt số hàng", () => {
  it.each([
    ["=SUM(F1:F50)", 115000], ["=SUM(F1:F5)", 115000], ["=SUM(F50:F1)", 115000], ["=SUM(E1:E9)", 10],
    ["=SUM(F3:F9)", 0], ["=SUM(F1:F3)", 115000], ["=MAX(F1:F20)", 58000], ["=F1+F9", 58000],
  ])("%s = %s ở cả hai phía", (fx, kq) => {
    expect(evalEditorFormula(fx, fc._editorRefs)).toBe(kq);
    expect(evalWeb(fx, webRefs)).toBe(kq);
  });
  it("xuất Excel: dải vượt bảng không dịch được (G13:G61 sẽ ôm cả hàng tổng) → ghi SỐ 115.000", () => {
    expect(fc.cellFormula("=SUM(F1:F50)", 115000)).toBeNull();
    expect(fc.cellFormula("=SUM(F1:F2)", 115000)).toBe("SUM(G12:G13)");
  });
});
