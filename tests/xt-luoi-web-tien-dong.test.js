// Soát chéo money#6 / excel#11 — XLSX-06 mới đưa phép nhân CHÍNH XÁC (src/tienDong.ts) vào Excel,
// PDF và nhập Excel; lưới web (shared/quote-math.ts `lineAmount`) vẫn `Math.round(q * p)` trên double.
//
// ĐÃ ĐO: 0,7 × 163.845 = 114691,49999999999 (double) → lưới hiện 114.691, còn PDF/Excel/số lưu là
// 114.692. Trước XLSX-06 ba chỗ kia cùng sai với lưới; nay người bán nhìn một số, khách nhận số
// khác. Cùng lớp lỗi: 4,1 × 15 (61 ↔ 62), dòng quantityExact 0,0029 × 5.000 (14 ↔ 15), và bước tự
// kiểm công thức (src/quoteFormula.ts `amountOf`) — ô tham chiếu Thành Tiền phải khớp giá trị web.
//
// Bài này chạy CẢ HAI bản cài đặt (web ↔ máy chủ) trên cùng dữ liệu: shared/ không import được
// src/ lúc chạy (tsconfig.build rootDir=src), nên phép nhân phải khai hai lần và chỉ test mới giữ
// hai bản khỏi trôi nhau.
import { describe, it, expect } from "vitest";
import * as WEB from "../shared/quote-math.js";
import { nhanLamTronDong } from "../src/tienDong.js";
import { computeQuoteTotals } from "../src/money.js";
import { pdfTotals } from "../src/pdf.js";
import { buildFormulaContext } from "../src/quoteFormula.js";

const dong = (quantity, unitPrice, extra = {}) => ({ kind: "item", quantity, unitPrice, ...extra });

describe("lưới web ra CÙNG Thành Tiền với PDF/Excel/số lưu", () => {
  it("ca đã đo: 0,7 × 163.845 = 114.692 và 4,1 × 15 = 62 (double cho 114.691 và 61)", () => {
    expect(Math.round(0.7 * 163845)).toBe(114691);            // chứng minh cách cũ sai
    expect(WEB.lineAmount(dong(0.7, 163845), false)).toBe(114692);
    expect(WEB.lineAmount(dong(4.1, 15), false)).toBe(62);
  });

  it("dòng quantityExact (4 số lẻ): 0,0029 × 5.000 = 15 (double cho 14)", () => {
    expect(WEB.lineAmount(dong(0.0029, 5000, { quantityExact: true }), false)).toBe(15);
  });

  it("có Số Ngày: nhân q × ngày × giá chính xác", () => {
    for (const [q, d, p] of [[0.7, 1, 163845], [4.1, 3, 5], [2.5, 2, 1.1]]) {
      expect(WEB.lineAmount(dong(q, p, { days: d }), true), `${q}×${d}×${p}`).toBe(nhanLamTronDong(q, d, p));
    }
  });

  it("số âm làm tròn nửa-XA-số-0 như Decimal ROUND_HALF_UP (-2,5 → -3), không trả -0", () => {
    expect(WEB.lineAmount(dong(0.5, -5), false)).toBe(-3);    // Math.round(-2.5) = -2
    expect(Object.is(WEB.lineAmount(dong(-0.1, 1), false), -0)).toBe(false);
    expect(Object.is(WEB.lineAmount(dong(0.1, -3), false), -0)).toBe(false);
  });

  it("vét: SL k/10 (k=1..99) × giá 1..3000 × ngày {1,2,3} — web trùng nhanLamTronDong từng đồng", () => {
    let lech = 0;
    const mau = [];
    for (let k = 1; k < 100; k++) {
      const q = k / 10;
      for (let p = 1; p <= 3000; p++) {
        if (WEB.lineAmount(dong(q, p), false) !== nhanLamTronDong(q, p)) { lech++; if (mau.length < 3) mau.push(`${q}×${p}`); }
        for (const d of [2, 3]) {
          if (WEB.lineAmount(dong(q, p, { days: d }), true) !== nhanLamTronDong(q, d, p)) { lech++; if (mau.length < 3) mau.push(`${q}×${d}×${p}`); }
        }
      }
    }
    expect(lech, `lệch, ví dụ ${mau.join(", ")}`).toBe(0);
  });

  it("vét quantityExact: SL 4 số lẻ × các giá lẻ thường gặp", () => {
    let lech = 0;
    for (let k = 1; k <= 20000; k += 7) {
      const q = k / 10000;
      for (const p of [5, 15, 25, 125, 5000, 12345, 163845, 1234565]) {
        if (WEB.lineAmount(dong(q, p, { quantityExact: true }), false) !== nhanLamTronDong(q, p)) lech++;
      }
    }
    expect(lech).toBe(0);
  });

  it("số lớn (sát trần an toàn của double) vẫn khớp bản BigInt", () => {
    for (const [q, p] of [[0.5, 99999999999999], [1.5, 3333333333333], [0.7, 1234567890123]]) {
      expect(WEB.nhanLamTronDong(q, p), `${q}×${p}`).toBe(nhanLamTronDong(q, p));
    }
  });

  it("tổng sheet / tổng báo giá của web = pdfTotals = computeQuoteTotals (Decimal)", () => {
    const items = [dong(0.7, 163845), dong(4.1, 15), { kind: "section", quantity: 2 }, dong(1.3, 25), dong(2.5, 1.1)];
    for (const groupSubtotal of [false, true]) {
      const q = { vatPercent: 8, sheets: [{ groupSubtotal, discount: 1001, items }] };
      const web = WEB.quoteTotals([WEB.sheetTotals(q.sheets[0], false)], 8);
      const pdf = pdfTotals(q);
      const soLuu = computeQuoteTotals(q);
      expect(web.subtotal, `groupSubtotal=${groupSubtotal}`).toBe(pdf.subtotal);
      expect(web.subtotal).toBe(Number(soLuu.subtotal));
      expect(web.total).toBe(Number(soLuu.total));
    }
  });
});

describe("bước tự kiểm công thức (amountOf) dùng CÙNG phép nhân với lưới web", () => {
  // Mẫu GN: cột editor A=_stt B=name C=detail D=unit E=quantity F=unitPrice G=_amount H=notes
  const GN_COLS = { stt: "B", name: "C", detail: "D", unit: "E", quantity: "F", unitPrice: "G", amount: "H", notes: "I" };
  const items = [
    { kind: "item", name: "Lẻ", quantity: 4.1, unitPrice: 15 },
    { kind: "item", name: "Theo dòng 1", quantity: 1, unitPrice: 124, formulas: { unitPrice: "=G1*2" } },
  ];
  const hang = new Map([[items[0], 12], [items[1], 13]]);
  const fc = buildFormulaContext({ cols: GN_COLS, items, rowToExcel: (i) => hang.get(items[i]) ?? null });

  it("ô Thành Tiền 4,1 × 15 mà bước tự kiểm đọc là 62 (web hiện 62)", () => {
    expect(fc._editorRefs.cell("G1")).toBe(62);
  });

  it("công thức =G1*2 web tính ra 124 → vẫn xuất thành công thức sống, không rơi về số chết", () => {
    expect(fc.cellFormula(items[1].formulas.unitPrice, 124, { item: items[1], field: "unitPrice" })).toBe("H12*2");
  });
});
