// Soát toàn diện đợt 3 (công thức) — ĐỐI SỐ RỖNG: "=MIN(F1;)", "=ROUND(;2)". Lỗi CŨ (có từ trước đợt
// sửa L27–L37, không phải hồi quy): bộ tính của app BỎ đối số rỗng, còn Excel coi nó là 0. Vì bộ tự kiểm
// máy chủ dùng cùng cách bỏ nên khớp số lưới → tệp GHI công thức "MIN(G12,)" → Excel tính lại ra số khác
// app / PDF, không cảnh báo. Excel 16 thật (COM, người phản biện đo) với F1 = 58.000:
//   MIN(F1,) = 0 · AVERAGE(F1,) = 29.000 · MAX(-F1,) = 0 · ROUND(,2) = 0   (app cũ: 58.000 / 58.000 / −58.000 / 2)
// Bộ chốt 6.000 công thức ngẫu nhiên (ct-doi-chieu-hai-phia) không sinh đối số rỗng nên không bắt được.
// Nay CẢ HAI bộ tính (web/src/lib/formula.ts và src/quoteFormula.ts) coi đối số rỗng là 0 như Excel.
import { describe, it, expect } from "vitest";
import { buildFormulaContext, evalEditorFormula, translateFormula } from "../src/quoteFormula.js";
import { evalFormula as evalWeb } from "../web/src/lib/formula.ts";

const O = { F1: 58000, F2: 57000 };
const refs = { cell: (a) => O[a.replace(/\$/g, "").toUpperCase()] ?? 0, range: () => [] };

// [công thức, số Excel ra]. null = Excel báo lỗi (FLOOR(x;0) = #DIV/0!).
const CA = [
  ["=MIN(F1;)", 0], ["=AVERAGE(F1;)", 29000], ["=MAX(-F1;)", 0], ["=ROUND(;2)", 0],
  ["=PRODUCT(F1;)", 0], ["=MIN(;F1)", 0], ["=AVERAGE(F1;;F2)", 38333.333333333336],
  ["=MIN(F1,)", 0],                                   // dấu phẩy kiểu Excel tiếng Anh sát ô → ";" rồi như trên
  ["=CEILING(F1;)", 0], ["=FLOOR(F1;)", null],        // bội số rỗng = 0: CEILING ra 0, FLOOR #DIV/0!
  // Không đổi so với trước: đối số rỗng cộng 0 / làm tròn 0 chữ số như Excel
  ["=SUM(F1;;F2)", 115000], ["=SUM(F1;)", 58000], ["=ROUND(F1*1,1;)", 63800], ["=MAX(F1;)", 58000],
];

describe("đối số rỗng = 0 như Excel, ở CẢ HAI bộ tính", () => {
  it.each(CA)("%s = %s (web === máy chủ === Excel)", (fx, kq) => {
    expect(evalEditorFormula(fx, refs)).toBe(kq);
    expect(evalWeb(fx, refs)).toBe(kq);
  });

  it("lời gọi KHÔNG có đối số nào (\"SUM()\") giữ như cũ — Excel không cho nhập, xuất Excel ghi số", () => {
    expect(evalWeb("=SUM()", refs)).toBe(0);
    expect(evalEditorFormula("=SUM()", refs)).toBe(0);
  });

  it("xuất Excel: công thức sống chỉ được ghi khi số của app KHỚP số Excel sẽ tính", () => {
    const COLS = { stt: "B", name: "C", detail: "D", unit: "E", quantity: "F", unitPrice: "G", amount: "H", notes: "I" };
    const items = [{ kind: "item", quantity: 1, unitPrice: 58000 }, { kind: "item", quantity: 2, unitPrice: 57000 }];
    const fc = buildFormulaContext({ cols: COLS, items, rowToExcel: (i) => (i < items.length ? 12 + i : null) });
    // Số app cũ (58.000) đã lưu mà Excel tính "MIN(G12,)" ra 0 → KHÔNG được ghi công thức (ghi số).
    expect(fc.cellFormula("=MIN(F1;)", 58000)).toBeNull();
    // Số app mới (0) khớp Excel → ghi công thức sống.
    expect(fc.cellFormula("=MIN(F1;)", 0)).toBe("MIN(G12,)");
    expect(translateFormula("=AVERAGE(F1;)", fc._ctx)).toBe("AVERAGE(G12,)");
  });
});
