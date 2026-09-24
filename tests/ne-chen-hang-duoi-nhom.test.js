// Soát toàn diện L49 — khách chèn hàng NGAY DƯỚI hàng NHÓM trong Excel. Lệnh Insert Row mặc định
// "Format Same As Above" nên hàng mới mang nền màu nhóm (Colorfull F4CFB0, GN FAE9DB). Bộ nhập xét
// MÀU trước HÌNH DẠNG dòng, nên "1 | Hạng mục mới | cái | 2 | 500.000" thành NHÓM: Đơn Giá ép 0, còn
// SL 2 thành hệ số nhân của các mục bên dưới — sai tiền, không cảnh báo ở chính dòng đó.
//   ĐÃ ĐO: [F4] nền ô C7 sau khi chèn = FFF4CFB0 · kind=section ĐG=0 SL=2 · cảnh báo dòng=[]
//
// Chốt kèm: nhóm HỢP LỆ của app vẫn phải là nhóm — kể cả khi khách gõ số đè lên Đơn Giá (phá
// `=SUM`), và nhóm con bản BANNER (STT là số) — xem cf-clf-bon-loi-tep-gui-khach.test.js [1].
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { computeSubtotal, parseQuoteWorkbook } from "../src/excelImport.js";
import { TEMPLATE_CONFIGS } from "../src/templateConfigs.js";

const baoGia = (code, items) => ({
  quoteNumber: "GN26L49", title: "Chèn hàng", toCompany: "Cty", vatPercent: 8, showTotals: true, city: "HCM",
  quoteDate: new Date("2026-08-01T00:00:00Z"), fromContact: "S",
  sheets: [{ order: 1, name: "Décor", groupSubtotal: true, template: { code }, items }],
});
const MUC = [
  { kind: "section", name: "NHÓM A", quantity: 1 },
  { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000 },
  { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 300000 },
  { kind: "subsection", name: "Nhóm con A1", unit: "bộ", quantity: 1 },
  { kind: "item", name: "Bàn", unit: "cái", quantity: 4, unitPrice: 150000 },
];

async function moTep(code, items = MUC) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(baoGia(code, items)));
  const ws = wb.worksheets[0];
  const c = TEMPLATE_CONFIGS[code].items.columns;
  const hang = (ten) => { let r = 0; ws.eachRow((_row, rr) => { if (ws.getCell(`${c.name}${rr}`).value === ten) r = rr; }); return r; };
  return { wb, ws, c, hang };
}
const doc = async (wb) => (await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).sheets.find((s) => !s.skipped);

/** Chèn "1 | Hạng mục mới | cái | 2 | 500.000" ngay dưới hàng `tenNhom`, kiểu chép từ hàng trên. */
async function chenDuoi(code, tenNhom, boA1) {
  const { wb, ws, c, hang } = await moTep(code);
  if (boA1) ws.getCell("A1").value = null;
  const r = hang(tenNhom) + 1;
  ws.insertRow(r, [], "i");
  ws.getCell(`${c.stt}${r}`).value = "1";
  ws.getCell(`${c.name}${r}`).value = "Hạng mục mới";
  ws.getCell(`${c.unit}${r}`).value = "cái";
  ws.getCell(`${c.quantity}${r}`).value = 2;
  ws.getCell(`${c.unitPrice}${r}`).value = 500000;
  ws.getCell(`${c.amount}${r}`).value = { formula: `${c.quantity}${r}*${c.unitPrice}${r}`, result: 1000000 };
  return { mau: ws.getCell(`${c.name}${r}`).fill?.fgColor?.argb, sheet: await doc(wb) };
}

describe("L49: hàng chèn dưới hàng nhóm (mang màu nhóm) mà có đủ hình dạng hạng mục", () => {
  const CA = [];
  for (const code of ["clofull_decor", "marico_decor"])
    for (const tenNhom of ["NHÓM A", "Nhóm con A1"])
      for (const boA1 of [false, true]) CA.push([code, tenNhom, boA1]);
  it.each(CA)("%s · chèn dưới %s · bỏ mã A1=%s → là HẠNG MỤC, có cảnh báo ngay tại dòng", async (code, tenNhom, boA1) => {
    const { mau, sheet } = await chenDuoi(code, tenNhom, boA1);
    const cfg = TEMPLATE_CONFIGS[code].items;
    // Tiền đề của kịch bản: hàng chèn thật sự mang màu nhóm.
    // (Mặc định khi mẫu không khai màu: đúng hai giá trị excel.ts dùng.)
    expect(String(mau).toUpperCase()).toBe(String(tenNhom === "NHÓM A" ? cfg.sectionFill || "FFFAE9DB" : cfg.subFill || "FFC9D9EF").toUpperCase());
    const moi = sheet.items.find((i) => i.name === "Hạng mục mới");
    expect(moi.kind, "hàng chèn bị nạp thành nhóm → Đơn Giá ép 0, SL thành hệ số nhân").toBe("item");
    expect(moi).toMatchObject({ quantity: 2, unitPrice: 500000 });
    expect((moi.warn || []).join(" | ")).toMatch(/tô màu nhóm/);
    // Nhóm thật vẫn là nhóm, cấu trúc còn lại không đổi.
    expect(sheet.items.map((i) => i.kind)).toEqual(
      tenNhom === "NHÓM A"
        ? ["section", "item", "item", "item", "subsection", "item"]
        : ["section", "item", "item", "subsection", "item", "item"]);
    expect(computeSubtotal(sheet)).toBe(1000000 + 500000 + 900000 + 600000);
    // Không có mã A1 thì mẫu phải ĐOÁN: một hàng chèn không được lật cách đánh số nhóm con của cả
    // sheet (→ đoán ra mẫu Banner → web ghép không được vào sheet đang có).
    const { wb: wbGoc } = await moTep(code);
    if (boA1) wbGoc.worksheets[0].getCell("A1").value = null;
    const goc = await doc(wbGoc);
    expect(sheet.numberSubs).toBe(goc.numberSubs);
    expect(sheet.templateCode).toBe(goc.templateCode);
  });

  it("nhóm con bản BANNER (STT là số) bị khách gõ số đè Đơn Giá vẫn là NHÓM CON", async () => {
    for (const code of ["gn_banner", "clofull_banner"]) {
      const { wb, ws, c, hang } = await moTep(code);
      const r = hang("Nhóm con A1");
      expect(String(ws.getCell(`${c.stt}${r}`).value), `${code}: nhóm con banner phải đánh số`).toMatch(/^\d+$/);
      ws.getCell(`${c.unitPrice}${r}`).value = 600000;   // phá =SUM
      const sheet = await doc(wb);
      expect(sheet.items.map((i) => i.kind), code).toEqual(["section", "item", "item", "subsection", "item"]);
      expect(sheet.items[3].warn, code).toBeUndefined();
    }
  });
});

// ── Hồi quy của chính bản sửa trên (phản biện độc lập đo) ───────────────────────────────────────
// Nhóm CHÍNH đặt nhãn SỐ ("1" — hợp lệ: GridTable ghi "nhãn nhóm A/B/1/2 ngồi trong ô STT") + có ĐVT
// + SL + có nhóm con, xuất theo mẫu BANNER: app ghi Đơn Giá nhóm cha là `=SUM(G7,G9)` — trỏ cột ĐƠN GIÁ
// của các nhóm con (src/excel.ts subSectionRows), không phải cột Thành Tiền. hasGroupPriceFormula chưa
// bao giờ nhận dạng này, nên bản sửa đầu coi dòng là "đủ bốn điều kiện hạng mục" và hạ màu nhóm →
// "NHÓM A" thành HẠNG MỤC 1.400.000 + các mục con vẫn cộng → tổng 2.800.000 (đúng 1.400.000).
// ĐÃ ĐO: lệch cả 4 ca (2 mẫu banner × có/không A1); bản trước 5fa78e1 ra section, tổng 1.400.000.
const MUC_BANNER = (label) => [
  { kind: "section", name: "NHÓM A", unit: "gói", quantity: 1, ...(label ? { label } : {}) },
  { kind: "subsection", name: "CGV 1" },
  { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000 },
  { kind: "subsection", name: "CGV 2" },
  { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 300000 },
];

describe("L49 (hồi quy): nhóm chính bản BANNER nhãn số + ĐVT + SL + nhóm con vẫn là NHÓM", () => {
  const CA = [];
  for (const code of ["clofull_banner", "gn_banner"]) for (const boA1 of [false, true]) CA.push([code, boA1]);
  it.each(CA)("%s · bỏ mã A1=%s", async (code, boA1) => {
    const { wb, ws, c, hang } = await moTep(code, MUC_BANNER("1"));
    const r = hang("NHÓM A");
    // Tiền đề: Đơn Giá nhóm cha trỏ cột ĐƠN GIÁ của nhóm con, dòng đủ STT số + ĐVT + SL.
    expect(String(ws.getCell(`${c.stt}${r}`).value)).toBe("1");
    expect(ws.getCell(`${c.unitPrice}${r}`).formula).toMatch(new RegExp(String.raw`^SUM\(${c.unitPrice}\d+,${c.unitPrice}\d+\)$`));
    if (boA1) ws.getCell("A1").value = null;
    const sheet = await doc(wb);
    expect(sheet.items.map((i) => i.kind), "nhóm chính bị hạ thành hạng mục → tiền cộng đôi")
      .toEqual(["section", "subsection", "item", "subsection", "item"]);
    expect(sheet.items[0]).toMatchObject({ name: "NHÓM A", label: "1", unitPrice: 0 });
    expect(sheet.items[0].warn).toBeUndefined();
    expect(computeSubtotal(sheet)).toBe(500000 + 900000);
    // Không đổi cách đánh số / mẫu đoán so với cùng tệp để nhãn mặc định "A".
    const { wb: wbGoc } = await moTep(code, MUC_BANNER(""));
    if (boA1) wbGoc.worksheets[0].getCell("A1").value = null;
    const goc = await doc(wbGoc);
    expect(sheet.numberSubs).toBe(goc.numberSubs);
    expect(sheet.templateCode).toBe(goc.templateCode);
  });

  it.each(CA)("%s · bỏ mã A1=%s · nhóm cha có CẢ mục lẻ lẫn nhóm con (=SUM(H..)+SUM(G..,G..))", async (code, boA1) => {
    const muc = MUC_BANNER("1");
    muc.splice(1, 0, { kind: "item", name: "Thảm", unit: "m2", quantity: 4, unitPrice: 50000 });
    const { wb, ws, c, hang } = await moTep(code, muc);
    const r = hang("NHÓM A");
    expect(ws.getCell(`${c.unitPrice}${r}`).formula).toMatch(new RegExp(String.raw`^SUM\(${c.amount}\d+:${c.amount}\d+\)\+SUM\(${c.unitPrice}\d+,${c.unitPrice}\d+\)$`));
    if (boA1) ws.getCell("A1").value = null;
    const sheet = await doc(wb);
    expect(sheet.items.map((i) => i.kind)).toEqual(["section", "item", "subsection", "item", "subsection", "item"]);
    expect(sheet.items[0]).toMatchObject({ name: "NHÓM A", label: "1", unitPrice: 0 });
    expect(computeSubtotal(sheet)).toBe(200000 + 500000 + 900000);
  });
});

// ── Soát toàn diện đợt 3 — biến thể STT TRỐNG ──────────────────────────────────────────────────
// Bản sửa trên đòi STT là SỐ. Nhưng ở mẫu Banner mục vốn KHÔNG đánh số (STT trống), và ở mọi mẫu khách
// chèn hàng tự nhiên hay để trống STT: "'' | Hạng mục mới | cái | 2 | 500.000" dưới NHÓM A (mang nền
// nhóm) vẫn nạp thành NHÓM — Đơn Giá ép 0, SL 2 thành hệ số nhân các mục bên dưới, không cảnh báo dòng.
// Nhóm CHÍNH do app xuất luôn có nhãn ở ô STT (sectionLetter hoặc nhãn tự đặt — src/excel.ts), nên nền
// nhóm chính + STT trống + đủ hình dạng hạng mục là hàng chèn. Nền NHÓM CON thì giữ luật STT số: nhóm con
// mẫu thường vốn để trống STT, khách gõ số đè Đơn Giá của nó vẫn phải là nhóm con.
describe("L49 (đợt 3): hàng chèn dưới NHÓM mà để trống STT", () => {
  const CA = [];
  for (const code of ["clofull_decor", "clofull_banner", "gn_banner", "marico_decor"]) for (const boA1 of [false, true]) CA.push([code, boA1]);
  it.each(CA)("%s · bỏ mã A1=%s → là HẠNG MỤC, có cảnh báo tại dòng, tổng đúng", async (code, boA1) => {
    // Dựng hàng mới NGAY từ tệp app xuất rồi chép định dạng hàng nhóm bên trên (đúng "Format Same As
    // Above"), thay vì ws.insertRow: ExcelJS chèn hàng KHÔNG dời tham chiếu trong công thức như Excel
    // thật, nên `=SUM(H16:H16)` của nhóm con banner trỏ về chính nó và kịch bản thành ca khác hẳn.
    const muc = [MUC[0], { kind: "item", name: "Hạng mục mới", unit: "cái", quantity: 2, unitPrice: 500000 }, ...MUC.slice(1)];
    const { wb, ws, c, hang } = await moTep(code, muc);
    if (boA1) ws.getCell("A1").value = null;
    const rNhom = hang("NHÓM A"), r = hang("Hạng mục mới");
    expect(r).toBe(rNhom + 1);
    for (const col of Object.values(c)) ws.getCell(`${col}${r}`).style = JSON.parse(JSON.stringify(ws.getCell(`${col}${rNhom}`).style));
    ws.getCell(`${c.stt}${r}`).value = "";
    const cfg = TEMPLATE_CONFIGS[code].items;
    expect(String(ws.getCell(`${c.name}${r}`).fill?.fgColor?.argb).toUpperCase()).toBe(String(cfg.sectionFill || "FFFAE9DB").toUpperCase());
    const sheet = await doc(wb);
    const moi = sheet.items.find((i) => i.name === "Hạng mục mới");
    expect(moi.kind, "hàng chèn STT trống bị nạp thành nhóm").toBe("item");
    expect(moi).toMatchObject({ quantity: 2, unitPrice: 500000 });
    expect((moi.warn || []).join(" | ")).toMatch(/tô màu nhóm/);
    expect(sheet.items.map((i) => i.kind)).toEqual(["section", "item", "item", "item", "subsection", "item"]);
    expect(computeSubtotal(sheet)).toBe(1000000 + 500000 + 900000 + 600000);
    const { wb: wbGoc } = await moTep(code);
    if (boA1) wbGoc.worksheets[0].getCell("A1").value = null;
    const goc = await doc(wbGoc);
    expect(sheet.numberSubs).toBe(goc.numberSubs);
    expect(sheet.templateCode).toBe(goc.templateCode);
  });

  it("nhóm con mẫu THƯỜNG (STT trống) bị khách gõ số đè Đơn Giá vẫn là NHÓM CON", async () => {
    for (const code of ["clofull_decor", "marico_decor"]) {
      const { wb, ws, c, hang } = await moTep(code);
      const r = hang("Nhóm con A1");
      expect(String(ws.getCell(`${c.stt}${r}`).value ?? ""), `${code}: nhóm con mẫu thường để trống STT`).toBe("");
      ws.getCell(`${c.unitPrice}${r}`).value = 600000;   // phá =SUM
      const sheet = await doc(wb);
      expect(sheet.items.map((i) => i.kind), code).toEqual(["section", "item", "item", "subsection", "item"]);
    }
  });
});
