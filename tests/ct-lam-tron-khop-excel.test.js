// L27 — bản phía MÁY CHỦ của web/src/lib/formula.lamTron.test.ts (cùng bộ ca) + đối chiếu HAI PHÍA
// + tệp xuất.
//
// LỖI: ROUND/ROUNDUP/ROUNDDOWN/INT tính Math.round/ceil/trunc(x*10^d) trên double. 3000*1,1 là
// 3300,0000000000005 nên =ROUNDUP(3000*1,1;-2) ra 3.400, Excel ra 3.300; Math.round đẩy nửa về +∞ nên
// =ROUND(-52500;-3) ra -52.000, Excel -53.000. Bước tự kiểm lúc xuất (cellFormula) dùng CHÍNH bộ tính
// này nên vẫn ghi công thức kèm result sai; tệp có fullCalcOnLoad → Excel tính lại khi mở → Đơn giá,
// Thành tiền, Tổng trong Excel khác app/PDF. Số kỳ vọng dưới đây ĐO BẰNG EXCEL 16 THẬT qua COM.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { evalEditorFormula } from "../src/quoteFormula.js";
import { evalFormula as evalWeb } from "../web/src/lib/formula.ts";
import { buildQuoteBuffer } from "../src/excel.js";

const CA_EXCEL = [
  ["=ROUNDUP(3000*1,1;-2)", 3300],
  ["=ROUNDUP(100000*1,1;-3)", 110000],
  ["=ROUNDDOWN(6000*1,15;-2)", 6900],
  ["=ROUND(3000*1,15;-2)", 3500],
  ["=INT(4,35*100)", 435],
  ["=INT(-4,35*100)", -435],
  ["=ROUND(-52500;-3)", -53000],
  ["=ROUNDUP(-52100;-3)", -53000],
  ["=ROUNDDOWN(-52900;-3)", -52000],
  ["=ROUND(2,675;2)", 2.68],
  ["=ROUND(1,005;2)", 1.01],
  ["=ROUND(1234,5;1,7)", 1234.5],
  ["=ROUND(1234,5678;-1,5)", 1230],
  ["=INT(-0,5)", -1],
  ["=ROUND(-0,5;0)", -1],
  ["=ROUND(-2,5;0)", -3],
  ["=ROUNDUP(-2,1;0)", -3],
  ["=ROUNDDOWN(-2,9;0)", -2],
  ["=INT(0,29*100)", 29],
  ["=ROUNDUP(-37193*0,3;-3)", -12000],
  ["=ROUNDUP(-4531000*0,29;-3)", -1314000],
  ["=ROUNDUP(940000*1,1;1)", 1034000],
  ["=ROUNDUP(431700*0,07;1)", 30219],
  ["=ROUNDUP(-54717*4,35;-1)", -238020],
  ["=INT(88000*4,35)", 382800],
  ["=INT(2514000*1,005)", 2526570],
  ["=INT(-23280*1,1)", -25608],
  ["=ROUND(-37190*0,85;0)", -31612],
  ["=ROUND(-31,95*0,3;2)", -9.59],
  ["=ROUND(-308700*1,05;-1)", -324140],
  ["=ROUNDDOWN(182000*1,005;1)", 182910],
  ["=ROUNDDOWN(13580*1,15;2)", 15617],
  ["=ROUNDDOWN(16263*0,95;2)", 15449.85],
  ["=ROUNDDOWN(4494*1,15;1)", 5168.1],
];

describe("L27 — máy chủ làm tròn khớp Excel", () => {
  it.each(CA_EXCEL)("%s = %s", (fx, excel) => expect(evalEditorFormula(fx)).toBeCloseTo(excel, 9));
});

describe("L27 — web và máy chủ ra CÙNG một số (bước tự kiểm lúc xuất dựa vào điều này)", () => {
  // Quét giá 1.000 → 5.000.000 bước 1.000 × các hệ số báo giá hay dùng: đây là vùng bản cũ lệch
  // Excel 2.383/5.000 ca với ROUNDUP ×1,1.
  const HE_SO = ["1,1", "1,15", "1,08", "0,7", "0,85"];
  const HAM = ["ROUND", "ROUNDUP", "ROUNDDOWN"];
  it("cùng bộ đầu vào → web === máy chủ, kể cả số âm", () => {
    let lech = 0;
    const vd = [];
    for (let g = 1000; g <= 5_000_000; g += 1000) {
      for (const h of HE_SO) for (const fn of HAM) for (const dau of ["", "-"]) {
        const fx = `=${fn}(${dau}${g}*${h};-2)`;
        const w = evalWeb(fx), s = evalEditorFormula(fx);
        if (w !== s) { lech++; if (vd.length < 5) vd.push(`${fx} web=${w} máy chủ=${s}`); }
      }
      const fx = `=INT(${g}*1,15)`;
      if (evalWeb(fx) !== evalEditorFormula(fx)) lech++;
    }
    expect(vd).toEqual([]);
    expect(lech).toBe(0);
  });
  it.each(CA_EXCEL)("%s: web === máy chủ", (fx) => expect(evalWeb(fx)).toBe(evalEditorFormula(fx)));
});

// Tệp xuất: GN (marico_decor) — cột editor A=_stt B=name C=detail D=unit E=quantity F=unitPrice
// G=_amount H=notes. Hàng editor 2 = item A (đơn giá 2.625.000).
function baoGia(itemB) {
  return {
    quoteNumber: "L27", title: "T", toCompany: "K", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"), vatPercent: 8, hnTables: [],
    sheets: [{ order: 1, name: "Backdrop", groupSubtotal: false, discount: 0, extraTables: [], template: { code: "marico_decor" }, items: [
      { order: 1, kind: "section", name: "Backdrop", quantity: 1 },
      { order: 2, kind: "item", name: "A", unit: "bộ", quantity: 1, unitPrice: 2625000 },
      { order: 3, kind: "item", name: "B", unit: "bộ", quantity: 1, ...itemB },
    ] }],
  };
}
async function oDonGiaHangB(q) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildQuoteBuffer(q));
  const ws = wb.worksheets[0];
  let hang = null;
  ws.eachRow((row, r) => row.eachCell((c) => { if (c.value === "B") hang = r; }));
  expect(hang, "không thấy hàng B").toBeTruthy();
  return ws.getCell(`G${hang}`).value;   // GN: Đơn giá = cột G
}

describe("L27 — tệp Excel xuất ra: số Excel tính lại khi mở PHẢI bằng số app", () => {
  it("đơn giá lưu đúng (2.887.500): ghi công thức sống, result 2.887.500", async () => {
    const v = await oDonGiaHangB(baoGia({ unitPrice: 2887500, formulas: { unitPrice: "=ROUNDUP(F2*1,1;-2)" } }));
    expect(v && typeof v === "object" ? v.formula : v).toMatch(/^ROUNDUP\(G\d+\*1\.1,-2\)$/);
    expect(v.result).toBe(2887500);
  });
  it("đơn giá lưu theo cách tính CŨ (2.887.600): KHÔNG ghi công thức (Excel sẽ tính ra 2.887.500) — ghi đúng số app đang hiện", async () => {
    const v = await oDonGiaHangB(baoGia({ unitPrice: 2887600, formulas: { unitPrice: "=ROUNDUP(F2*1,1;-2)" } }));
    expect(v).toBe(2887600);
  });
  it("số âm: =ROUND(F2*-0,02;-3) (-52.500) lưu -53.000 → ghi công thức, result -53.000", async () => {
    const v = await oDonGiaHangB(baoGia({ unitPrice: -53000, formulas: { unitPrice: "=ROUND(F2*-0,02;-3)" } }));
    expect(v && typeof v === "object" ? v.formula : v).toMatch(/^ROUND\(G\d+\*-0\.02,-3\)$/);
    expect(v.result).toBe(-53000);
  });
  it("số âm lưu theo cách tính CŨ (-52.000) → ghi số, không để Excel mở ra -53.000", async () => {
    const v = await oDonGiaHangB(baoGia({ unitPrice: -52000, formulas: { unitPrice: "=ROUND(F2*-0,02;-3)" } }));
    expect(v).toBe(-52000);
  });
});
