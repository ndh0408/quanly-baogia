// CHỐT ĐỐI CHIẾU HAI PHÍA trên bộ công thức "bẩn" sinh ngẫu nhiên (hạt giống cố định → lặp lại được):
// khoảng trắng, dấu phẩy kiểu Việt lẫn kiểu Anh, "x" nhân, ngoặc lồng, hàm lồng, dải ô, khoá $, số âm.
//
// Hai bất biến mà cả đợt sửa L27–L37 dựa vào:
//   1. web/src/lib/formula.ts (lưới tính khi soạn) và src/quoteFormula.ts (bộ tự kiểm lúc xuất) ra CÙNG
//      một kết quả — kể cả cùng null. Lệch là bước tự kiểm hoặc bỏ công thức đúng, hoặc (tệ hơn) giữ
//      công thức mà Excel tính ra số khác app.
//   2. Mọi công thức translateFormula trả về đều đúng cú pháp Excel: không khoảng trắng, không ";",
//      ngoặc cân, đúng số đối số, dải đứng nguyên một đối số, không số/ngoặc dính chữ — thứ làm Excel
//      từ chối mở tệp. Cùng bộ sinh này đã được chạy qua Excel 16 thật (COM) lúc sửa: 3.510 công thức
//      ghi được, 0 bị từ chối, 0 ô lỗi, 0 lệch số.
import { describe, it, expect } from "vitest";
import { evalEditorFormula, translateFormula, soDoiSoHopLe } from "../src/quoteFormula.js";
import { evalFormula as evalWeb } from "../web/src/lib/formula.ts";

function boSinh(hatGiong) {
  let seed = hatGiong;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const sp = () => (rnd() < 0.15 ? " " : "");
  const so = () => pick(["1", "2", "3", "10", "100", "1000", "63000", "0", "1,1", "1,15", "0,5", "1.5", "8%", "10%", "0,07", "2,675", "1 000", "500000"]);
  const ref = () => (rnd() < 0.1 ? "$" : "") + pick(["E", "F"]) + (1 + Math.floor(rnd() * 10));
  function bt(d) {
    const r = rnd();
    if (d > 3 || r < 0.3) return rnd() < 0.45 ? so() : rnd() < 0.9 ? ref() : ref() + ":" + ref();
    if (r < 0.5) return bt(d + 1) + sp() + pick(["+", "-", "*", "/", "*", "*", "x", ""]) + sp() + bt(d + 1);
    if (r < 0.6) return "(" + bt(d + 1) + ")";
    if (r < 0.65) return "-" + bt(d + 1);
    const fn = pick(["SUM", "ROUND", "ROUNDUP", "ROUNDDOWN", "INT", "ABS", "MIN", "MAX", "CEILING", "FLOOR", "AVERAGE", "PRODUCT"]);
    const tach = pick([";", ";", ",", ", "]);
    const n = /^(INT|ABS)$/.test(fn) ? 1 : /^(ROUND|CEIL|FLOOR)/.test(fn) ? 2 : 1 + Math.floor(rnd() * 3);
    const args = Array.from({ length: n }, (_, i) => (/^ROUND/.test(fn) && i === 1 ? pick(["0", "-3", "-2", "2", "1"])
      : /^(CEIL|FLOOR)/.test(fn) && i === 1 ? pick(["1000", "100", "0,5", "-100"]) : rnd() < 0.15 ? ref() + ":" + ref() : bt(d + 1)));
    return fn + "(" + args.join(tach) + ")";
  }
  const VAL = {};
  for (let r = 1; r <= 10; r++) { VAL["E" + r] = Math.round(rnd() * 100) / 10; VAL["F" + r] = Math.round(rnd() * 5000) * 1000 * (rnd() < 0.15 ? -1 : 1); }
  VAL.E3 = 0;
  return { congThuc: () => "=" + bt(0), VAL };
}

describe("đối chiếu hai phía trên công thức ngẫu nhiên", () => {
  for (const hat of [7, 11, 23]) {
    it(`hạt giống ${hat}: web === máy chủ, và mọi công thức xuất ra đúng cú pháp Excel`, () => {
      const { congThuc, VAL } = boSinh(hat);
      const cell = (a) => VAL[a.replace(/\$/g, "").toUpperCase()] ?? 0;
      const range = (a, b) => {
        const pa = /^\$?([A-Z]+)\$?(\d+)$/i.exec(a), pb = /^\$?([A-Z]+)\$?(\d+)$/i.exec(b);
        const cot = [...new Set([pa[1].toUpperCase(), pb[1].toUpperCase()])].sort();
        const out = [];
        for (let r = Math.min(+pa[2], +pb[2]); r <= Math.max(+pa[2], +pb[2]); r++) for (const c of cot) out.push(cell(c + r));
        return out;
      };
      const ctx = {
        colToField: { E: "quantity", F: "unitPrice" }, fieldToCol: { quantity: "F", unitPrice: "G" },
        allowedRef: new Set(["quantity", "unitPrice"]), rowToExcel: (n) => (n >= 1 && n <= 10 ? 11 + n : null), rangeOk: () => true,
      };
      const lech = [], saiCuPhap = [];
      let ghiDuoc = 0;
      for (let i = 0; i < 2000; i++) {
        const fx = congThuc();
        const s = evalEditorFormula(fx, { cell, range }), w = evalWeb(fx, { cell, range });
        if (s !== w) lech.push(`${fx}  web=${w}  máy chủ=${s}`);
        const ex = translateFormula(fx, ctx);
        if (!ex) continue;
        ghiDuoc++;
        let sau = 0, can = true;
        for (const ch of ex) { if (ch === "(") sau++; else if (ch === ")" && --sau < 0) can = false; }
        const dai = [...ex.matchAll(/\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+/g)].every((m) => /^$|[(,]/.test(ex.charAt(m.index - 1)) && /^$|[),]/.test(ex.charAt(m.index + m[0].length)));
        if (/\s|;/.test(ex) || !can || sau !== 0 || !soDoiSoHopLe(ex) || !dai || /[\d.)%][A-Za-z($]|[)%][\d.]/.test(ex) || /[A-Za-z]\$?\d+\.|\.\$?[A-Za-z]/.test(ex)) saiCuPhap.push(`${fx} → ${ex}`);
      }
      expect(lech.slice(0, 5)).toEqual([]);
      expect(saiCuPhap.slice(0, 5)).toEqual([]);
      expect(ghiDuoc).toBeGreaterThan(800);   // bộ sinh vẫn phủ đủ ca dịch được, không "xanh vì rỗng"
    });
  }
});
