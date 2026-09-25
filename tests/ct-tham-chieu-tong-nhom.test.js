// CÔNG THỨC THAM CHIẾU Ô TỔNG NHÓM bị ghi SỐ CHẾT vào tệp Excel (báo giá #49, nhóm D "Phí vận chuyển,
// lắp đặt và tháo dỡ" — dữ liệu dưới đây TỰ DỰNG, chỉ mô phỏng CẤU TRÚC của sheet thật).
//
// Hai hàng D1/D2 giữ Đơn Giá "=ROUND((SUM(G50;G43;…;G6)*14%);-6)" — G6, G11… là ô THÀNH TIỀN của các
// hàng NHÓM CON. Lưới web tính được (cellNum trả tổng nhóm × SL nhóm khi bật "Hiện Thành Tiền nhóm") nên
// ô hiện 23.000.000 kèm dấu ƒ. Tệp Excel thì ô Đơn Giá chỉ là SỐ 23000000: bộ dịch (src/quoteFormula.ts)
// chỉ cho tham chiếu hàng item/sub — hàng nhóm không có trong bản đồ hàng Excel → cả công thức bị huỷ.
//
// ĐÃ ĐO TRÊN MÃ CŨ (8e1920d): ca (a) cả hai biến thể ";-6" / ",-6" ra số 23000000, không có công thức;
// ca (c) (d) (f) (g) và ô Đơn Giá nhóm khi tắt "Thành Tiền nhóm" cũng ra số. Các ca "vẫn ghi số" (vòng,
// dải đi qua hàng nhóm, ô trống, hàng info, SL nhóm) xanh cả trước lẫn sau — chúng là GÁC, không phải
// tái hiện.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { TEMPLATE_CONFIGS } from "../src/templateConfigs.js";

const muc = (name, quantity, unitPrice, formulas) => ({ kind: "item", name, unit: "cái", quantity, unitPrice, ...(formulas ? { formulas } : {}) });
const nhom = (name, quantity = 1) => ({ kind: "section", name, unit: "gói", quantity, unitPrice: 0 });
const nhomCon = (name, quantity = 1) => ({ kind: "subsection", name, unit: "gói", quantity, unitPrice: 0 });
const info = (name) => ({ kind: "info", name, quantity: 0, unitPrice: 0 });

const baoGia = (code, items, { groupSubtotal = true } = {}) => ({
  quoteNumber: "TN49", title: "Tổng nhóm", toCompany: "Cty mẫu", city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-25"), vatPercent: 8, hnTables: [],
  sheets: [{ order: 1, name: "S", groupSubtotal, discount: 0, extraTables: [], template: { code },
    items: items.map((it, i) => ({ order: i + 1, ...it })) }],
});
async function mo(q) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(q));
  return wb.worksheets[0];
}
const laCongThuc = (v) => !!v && typeof v === "object" && typeof v.formula === "string";
/** Hàng Excel của mục/nhóm theo TÊN (cột Hạng Mục) — không đoán toạ độ tay cho các mẫu có lọc info. */
function hangCua(ws, code, ten) {
  const L = TEMPLATE_CONFIGS[code].items.columns.name;
  let r0 = 0;
  ws.eachRow((_row, r) => { if (!r0 && ws.getCell(`${L}${r}`).value === ten) r0 = r; });
  expect(r0, `không thấy hàng "${ten}" trong tệp`).toBeGreaterThan(0);
  return r0;
}

// ── (a) Ca báo giá #49: cấu trúc 73 hàng như sheet thật ───────────────────────────────────────────────
// Hàng editor (1-based): 1 info · 2 nhóm · 3 mục · 4 nhóm "Decor" · 5 info · 6/11/16/20/23/29/31/33/35/37/
// 39/41/43/47/50/52 nhóm con (mục ở giữa) · 49 info · 56 nhóm (57–69 mục) · 70 nhóm D · 71 D1 · 72 D2 · 73
// mục rỗng. Mẫu GN (marico_decor): cột editor A stt · B tên · C chi tiết · D ĐVT · E SL · F ĐG · G Thành
// Tiền · H ghi chú; cột Excel SL=F · ĐG=G · Thành Tiền=H; hàng editor k → hàng Excel 11 + k.
const CT_D = "=ROUND((SUM(G50;G43;G41;G39;G37;G35;G33;G31;G29;G23;G16;G11;G6)*14%);-6)";
const CT_D_PHAY = "=ROUND((SUM(G50;G43;G41;G39;G37;G35;G33;G31;G29;G23;G16;G11;G6)*14%),-6)";   // ",-6" kiểu Excel EN trộn ";"
function sheet49({ d1 = CT_D, d2 = CT_D_PHAY, giaD = 23000000, slNhomCon6 = 1 } = {}) {
  const items = [
    info("Thông tin chương trình"),                                                      // 1
    nhom("Nhóm mở đầu"), muc("Mục mở đầu", 1, 2000000),                                  // 2, 3
    nhom("Decor"), info("Ghi chú Decor"),                                                // 4, 5
    nhomCon("Nhóm con 6", slNhomCon6),                                                   // 6
    muc("M7", 19.2, 95000, { quantity: "=6,4*3" }),
    muc("M8", 2, 2600000, { unitPrice: "=320000*4+120000*11" }),
    muc("M9", 1, 8415000, { unitPrice: "=(1,5*2,4+(1,5*4,8)+(1,5*3))*550000" }),
    muc("M10", 2.04, 450000, { quantity: "=2,4*0,85" }),                                 // 7–10 = 16.339.000
    nhomCon("Nhóm con 11"), ...[12, 13, 14, 15].map((k) => muc(`M${k}`, 1, 3000000)),    // 12.000.000
    nhomCon("Nhóm con 16"), ...[17, 18, 19].map((k) => muc(`M${k}`, 2, 2000000)),        // 12.000.000
    nhomCon("Nhóm con 20"), ...[21, 22].map((k) => muc(`M${k}`, 1, 5000000)),            // (không được trỏ tới)
    nhomCon("Nhóm con 23"), ...[24, 25, 26, 27, 28].map((k) => muc(`M${k}`, 1, 4000000)), // 20.000.000
    nhomCon("Nhóm con 29"), muc("M30", 1, 18750000, { unitPrice: "=15000000*1,25" }),   // 18.750.000
    nhomCon("Nhóm con 31"), muc("M32", 1, 10000000),
    nhomCon("Nhóm con 33"), muc("M34", 1, 9000000),
    nhomCon("Nhóm con 35"), muc("M36", 1, 8000000),
    nhomCon("Nhóm con 37"), muc("M38", 2, 5000000),
    nhomCon("Nhóm con 39"), muc("M40", 1, 7000000),
    nhomCon("Nhóm con 41"), muc("M42", 1, 6000000),
    nhomCon("Nhóm con 43"), ...[44, 45, 46].map((k) => muc(`M${k}`, 1, 5000000)),        // 15.000.000
    nhomCon("Nhóm con 47"), muc("M48", 1, 1000000),
    info("Ghi chú 49"),
    nhomCon("Nhóm con 50"), muc("M51", 1, 20000000),
    nhomCon("Nhóm con 52"), ...[53, 54, 55].map((k) => muc(`M${k}`, 1, 1000000)),
    nhom("Nhóm 56"), ...Array.from({ length: 13 }, (_x, k) => muc(`M${57 + k}`, 1, 500000)),
    nhom("Phí vận chuyển, lắp đặt và tháo dỡ"),                                          // 70
    muc("D1", 1, giaD, { unitPrice: d1 }),                                               // 71
    muc("D2", 0, giaD, { unitPrice: d2 }),                                               // 72
    muc("", 0, 0),                                                                       // 73
  ];
  items[60].notes = "500000"; items[60].formulas = { notes: "=F60*E60" };   // ghi chú công thức như sheet thật
  expect(items.length).toBe(73);
  expect(items[70].name).toBe("D1");
  return items;
}
const EXCEL_D = "ROUND((SUM(H61,H54,H52,H50,H48,H46,H44,H42,H40,H34,H27,H22,H17)*14%),-6)";

describe("(a) báo giá #49: Đơn Giá D1/D2 tham chiếu Thành Tiền các nhóm con → công thức sống", () => {
  it("cả hai biến thể \";-6\" và \",-6\" ra đúng công thức Excel, result 23.000.000", async () => {
    const ws = await mo(baoGia("marico_decor", sheet49()));
    expect(ws.getCell("C82").value).toBe("D1");
    expect(ws.getCell("C83").value).toBe("D2");
    for (const addr of ["G82", "G83"]) {
      const v = ws.getCell(addr).value;
      expect(laCongThuc(v), `${addr} bị ghi số chết: ${JSON.stringify(v)}`).toBe(true);
      expect(v.formula).toBe(EXCEL_D);
      expect(v.result).toBe(23000000);
    }
    // Ô Thành Tiền nhóm con được trỏ tới giữ đúng con số web dùng (Σ mục con × SL nhóm = 1).
    expect(ws.getCell("H17").value).toMatchObject({ formula: "G17", result: 16339000 });
    expect(ws.getCell("G17").value).toMatchObject({ formula: "SUM(H18:H21)", result: 16339000 });
    expect(ws.getCell("H61").value).toMatchObject({ result: 20000000 });
    // Thành Tiền D1 = ROUND(ĐG × SL) như mọi mục; D2 SL 0.
    expect(ws.getCell("H82").value).toMatchObject({ formula: "ROUND(G82*F82,0)", result: 23000000 });
    expect(ws.getCell("H83").value).toMatchObject({ formula: "ROUND(G83*F83,0)" });   // result 0: exceljs không ghi lại
  });

  it("gác: số đã lưu lệch kết quả công thức (tự kiểm trượt) → vẫn ghi số", async () => {
    const ws = await mo(baoGia("marico_decor", sheet49({ giaD: 24000000 })));
    expect(ws.getCell("G82").value).toBe(24000000);
  });
});

// ── Sheet nhỏ cho các cấu hình còn lại ────────────────────────────────────────────────────────────────
// 1 nhóm A · 2 mục lẻ của A · 3 nhóm con A1 · 4–5 mục · 6 nhóm con A2 · 7 mục · 8 nhóm B · 9 dòng phí.
// Không banner: tổng A = 800.000 (chỉ mục lẻ), A1 = 2.000.000, A2 = 3.000.000.
// Banner: tổng A = 5.800.000 (cuộn qua nhóm con).
const sheetNho = ({ phi, giaPhi, slA = 1, slA1 = 1, slA2 = 1, ext = {} }) => [
  nhom("Nhóm A", slA), muc("A lẻ", 1, 800000),
  nhomCon("Nhóm con A1", slA1), muc("A1-1", 1, 1000000), muc("A1-2", 2, 500000),
  nhomCon("Nhóm con A2", slA2), muc("A2-1", 1, 3000000),
  nhom("Nhóm B"), muc("Phí", 1, giaPhi, { unitPrice: phi }),
  ...(ext.sau || []),
];
async function oPhi(code, opts, cfg) {
  const ws = await mo(baoGia(code, sheetNho(opts), cfg));
  const cols = TEMPLATE_CONFIGS[code].items.columns;
  const r = hangCua(ws, code, "Phí");
  return { ws, cols, r, v: ws.getCell(`${cols.unitPrice}${r}`).value, hang: (ten) => hangCua(ws, code, ten) };
}

describe("(b) \"Hiện Thành Tiền nhóm\" TẮT", () => {
  it("Thành Tiền nhóm (ô Excel trống, web đọc 0) → ghi SỐ", async () => {
    const { v } = await oPhi("marico_decor", { phi: "=ROUND((G3+G6)*10%;-3)", giaPhi: 0 }, { groupSubtotal: false });
    expect(laCongThuc(v), JSON.stringify(v)).toBe(false);
    expect(v || 0).toBe(0);
  });
  it("Đơn Giá nhóm (ô Excel = Σ mục con, như web) → công thức sống", async () => {
    const { v, hang } = await oPhi("marico_decor", { phi: "=ROUND((F3+F6)*10%;-3)", giaPhi: 500000 }, { groupSubtotal: false });
    expect(laCongThuc(v), JSON.stringify(v)).toBe(true);
    expect(v.formula).toBe(`ROUND((G${hang("Nhóm con A1")}+G${hang("Nhóm con A2")})*10%,-3)`);
    expect(v.result).toBe(500000);
  });
});

describe("(c) SL nhóm ≠ 1 khi bật ×SL", () => {
  it("SL nhóm con 2 và 1,5: Thành Tiền nhóm = tổng × SL, công thức sống", async () => {
    // A1: 2.000.000 × 2 = 4.000.000; A2: 3.000.000 × 1,5 = 4.500.000 → (8.500.000) × 10% = 850.000
    const { ws, v, hang } = await oPhi("marico_decor", { phi: "=ROUND((G3+G6)*10%;-3)", giaPhi: 850000, slA1: 2, slA2: 1.5 });
    const r1 = hang("Nhóm con A1"), r2 = hang("Nhóm con A2");
    expect(laCongThuc(v), JSON.stringify(v)).toBe(true);
    expect(v.formula).toBe(`ROUND((H${r1}+H${r2})*10%,-3)`);
    expect(ws.getCell(`H${r1}`).value).toMatchObject({ formula: `G${r1}*F${r1}`, result: 4000000 });
    expect(ws.getCell(`H${r2}`).value).toMatchObject({ formula: `G${r2}*F${r2}`, result: 4500000 });
  });
  it("gác: số đã lưu tính theo SL nhóm 1 (lệch ×SL) → ghi số", async () => {
    const { v } = await oPhi("marico_decor", { phi: "=ROUND((G3+G6)*10%;-3)", giaPhi: 500000, slA1: 2 });
    expect(v).toBe(500000);
  });
});

describe("(d) bản GN banner: nhóm cha = Σ nhóm con", () => {
  it("tham chiếu Thành Tiền nhóm CHA (cuộn qua nhóm con) và nhóm con", async () => {
    // Banner: A = 800.000 + 2.000.000 + 3.000.000 = 5.800.000; A1 × 2 = 4.000.000 → 9.800.000 × 10%
    const { ws, v, hang } = await oPhi("gn_banner", { phi: "=ROUND((G1+G3)*10%;-3)", giaPhi: 980000, slA1: 2 });
    const rA = hang("Nhóm A"), r1 = hang("Nhóm con A1");
    expect(laCongThuc(v), JSON.stringify(v)).toBe(true);
    expect(v.formula).toBe(`ROUND((H${rA}+H${r1})*10%,-3)`);
    expect(ws.getCell(`G${rA}`).value).toMatchObject({ result: 5800000 });
    expect(ws.getCell(`H${rA}`).value).toMatchObject({ result: 5800000 });
  });
  it("tham chiếu Đơn Giá nhóm cha (banner) → công thức sống", async () => {
    const { v, hang } = await oPhi("gn_banner", { phi: "=F1*10%", giaPhi: 580000 });
    expect(laCongThuc(v), JSON.stringify(v)).toBe(true);
    expect(v.formula).toBe(`G${hang("Nhóm A")}*10%`);
  });
});

// Công thức vòng viết dạng "…*0 + số đã lưu" để BỘ TỰ KIỂM KHỚP: nếu không có chốt vòng thì tệp sẽ mang
// công thức sống thật và Excel báo "circular reference" — tức bài đỏ đúng lúc chốt vòng hỏng, không nhờ
// tự kiểm trượt. Web giữ nguyên số đã lưu cho ô vòng (cellNum bật cờ, recomputeAll không ghi).
describe("(e) VÒNG: mục trong nhóm trỏ tổng CHÍNH nhóm mình → ghi số", () => {
  it("mục trong nhóm B trỏ Thành Tiền nhóm B", async () => {
    const { v } = await oPhi("marico_decor", { phi: "=G8*0+123000", giaPhi: 123000 });
    expect(v).toBe(123000);
  });
  it("mục trong nhóm con trỏ tổng nhóm con của nó / nhóm cha của nó", async () => {
    for (const [fx, code] of [["=G3*0+777000", "marico_decor"], ["=G1*0+777000", "marico_decor"], ["=G1*0+777000", "gn_banner"], ["=F3*0+777000", "marico_decor"], ["=F1*0+777000", "gn_banner"]]) {
      const items = sheetNho({ phi: "=1", giaPhi: 1 });
      items[3] = muc("A1-1", 1, 777000, { unitPrice: fx });   // hàng 4, nằm trong A1 (và A)
      const ws = await mo(baoGia(code, items));
      const c = TEMPLATE_CONFIGS[code].items.columns;
      expect(ws.getCell(`${c.unitPrice}${hangCua(ws, code, "A1-1")}`).value, `${code} ${fx}`).toBe(777000);
    }
  });
  it("vòng GIÁN TIẾP: Phí trỏ tổng A1, một mục trong A1 trỏ Đơn Giá của Phí → Phí ghi số, vòng Excel bị cắt", async () => {
    // A1 = 1.000.000 + 2 × 500.000 = 2.000.000 → Phí 200.000 → A1-2 = 200.000 × 2,5 = 500.000: số khớp
    // hết, chỉ chốt vòng mới ngăn được công thức sống ở Phí.
    const items = sheetNho({ phi: "=G3*10%", giaPhi: 200000 });
    items[4] = muc("A1-2", 2, 500000, { unitPrice: "=F9*2,5" });
    const ws = await mo(baoGia("marico_decor", items));
    const rPhi = hangCua(ws, "marico_decor", "Phí");
    expect(ws.getCell(`G${rPhi}`).value).toBe(200000);
    // A1-2 không trỏ ô tổng nhóm nào → giữ đúng hành vi cũ (công thức trỏ ô Đơn Giá Phí, nay là SỐ).
    expect(ws.getCell(`G${hangCua(ws, "marico_decor", "A1-2")}`).value).toMatchObject({ formula: `G${rPhi}*2.5`, result: 500000 });
  });
});

describe("(f) tham chiếu nhóm CHÍNH lẫn nhóm CON", () => {
  it("không banner: G1 = mục lẻ của A (800.000), G3 = A1, F6 = A2", async () => {
    // 800.000 + 2.000.000 + 3.000.000 = 5.800.000 × 10% = 580.000
    const { v, hang } = await oPhi("marico_decor", { phi: "=ROUND((G1+G3+F6)*10%;-3)", giaPhi: 580000 });
    expect(laCongThuc(v), JSON.stringify(v)).toBe(true);
    expect(v.formula).toBe(`ROUND((H${hang("Nhóm A")}+H${hang("Nhóm con A1")}+G${hang("Nhóm con A2")})*10%,-3)`);
  });
  it("gác: nhóm không có mục (ô Excel trống) → ghi số", async () => {
    const items = sheetNho({ phi: "=G8+G1", giaPhi: 800000 });
    items.splice(8, 1);                                   // bỏ "Phí" khỏi nhóm B → B rỗng
    items.push(nhom("Nhóm C"), muc("Phí", 1, 800000, { unitPrice: "=G8+G1" }));
    const ws = await mo(baoGia("marico_decor", items));
    expect(ws.getCell(`G${hangCua(ws, "marico_decor", "Phí")}`).value).toBe(800000);
  });
});

describe("(g) mẫu Colorfull có lọc hàng info", () => {
  for (const code of ["clofull_decor", "clofull_banner", "clofull_conngay"]) {
    it(`${code}: tham chiếu nhóm con qua hàng info bị lọc vẫn trỏ đúng hàng Excel`, async () => {
      const coNgay = !!TEMPLATE_CONFIGS[code].items.columns.days;
      // Cột editor: có Số Ngày thì Thành Tiền là H, không thì G.
      const G = coNgay ? "H" : "G";
      const items = [
        info("Thông tin CT"), nhom("Nhóm A"), muc("A lẻ", 1, 800000),
        nhomCon("Nhóm con A1", 2), info("Ghi chú giữa"), muc("A1-1", 1, 1000000), muc("A1-2", 2, 500000),
        nhom("Nhóm B"), muc("Phí", 1, 400000, { unitPrice: `=${G}4*10%` }),
      ];
      if (coNgay) items.forEach((it) => { if (it.kind === "item") it.days = 1; });
      const ws = await mo(baoGia(code, items));
      const c = TEMPLATE_CONFIGS[code].items.columns;
      const v = ws.getCell(`${c.unitPrice}${hangCua(ws, code, "Phí")}`).value;
      expect(laCongThuc(v), JSON.stringify(v)).toBe(true);
      expect(v.formula).toBe(`${c.amount}${hangCua(ws, code, "Nhóm con A1")}*10%`);
      expect(v.result).toBe(400000);
    });
  }
});

describe("(h) các chốt cũ giữ nguyên: vẫn ghi số", () => {
  it("dải đi qua hàng nhóm (SUM(G2:G7)) → ghi số", async () => {
    // Web cộng cả ô tổng nhóm trong dải: 0,8 + 2 + 1 + 1 + 3 + 3 = 10,8 triệu → 1.080.000 (số khớp,
    // chỉ luật "dải phải toàn hàng mục liền mạch" chặn).
    const { v } = await oPhi("marico_decor", { phi: "=SUM(G2:G7)*10%", giaPhi: 1080000 });
    expect(v).toBe(1080000);
  });
  it("dải bắt đầu/kết thúc ĐÚNG ở hàng nhóm (G3:G3) → ghi số", async () => {
    const { v } = await oPhi("marico_decor", { phi: "=SUM(G3:G3)*10%", giaPhi: 200000 });
    expect(v).toBe(200000);
  });
  it("Số Lượng của hàng nhóm (E3) → ghi số (không phải ô tổng nhóm)", async () => {
    const { v } = await oPhi("marico_decor", { phi: "=E3*100000", giaPhi: 200000, slA1: 2 });
    expect(v).toBe(200000);
  });
  it("hàng info → ghi số", async () => {
    const items = sheetNho({ phi: "=G10+100", giaPhi: 100 });
    items.push(info("Ghi chú"));
    const ws = await mo(baoGia("marico_decor", items));
    expect(ws.getCell(`G${hangCua(ws, "marico_decor", "Phí")}`).value).toBe(100);
  });
  it("công thức thường (không đụng nhóm) không đổi", async () => {
    const { v, hang } = await oPhi("marico_decor", { phi: "=G2*10%", giaPhi: 80000 });
    expect(v).toMatchObject({ formula: `H${hang("A lẻ")}*10%`, result: 80000 });
  });
});

// ── (i) SOÁT CHÉO: công thức trỏ ô tổng nhóm — số Excel TÍNH LẠI phải TRÙNG số lưới web ─────────────
// Tệp đặt fullCalcOnLoad: Excel tính lại mọi công thức khi mở. Bộ tự kiểm chừa dung sai 1e-3, còn số
// lưu đã bị DB cắt (SL / Đơn Giá 4 số lẻ, Số Ngày 2 số lẻ). Công thức ra nhiều số lẻ hơn thế vẫn lọt tự
// kiểm, nên tệp mang công thức mà Excel tính ra số KHÁC số lưới web / PDF dùng. Excel 16 đo được Thành
// Tiền 76.469 so với web 76.466, lệch lan lên tổng nhóm và Tổng Cộng. Trên af17fe6 bốn ca "ghi SỐ" dưới
// đây ra công thức (đỏ). Trên 8e1920d chúng ra số, vì tham chiếu ô nhóm khi đó luôn bị huỷ. Hai ca
// "đối chứng" ra công thức: số khớp tuyệt đối thì không được chặn thừa.
describe("(i) công thức trỏ ô tổng nhóm ra nhiều số lẻ hơn số lưu → ghi SỐ", () => {
  const sheetTiLe = (x, tongA, code = "marico_decor") => baoGia(code, [x, nhom("Nhóm A"), muc("A1", 1, tongA)]);
  async function oCua(code, q, ten, field) {
    const ws = await mo(q);
    const c = TEMPLATE_CONFIGS[code].items.columns;
    const r = hangCua(ws, code, ten);
    return { ws, c, r, v: ws.getCell(`${c[field]}${r}`).value };
  }

  it("SL chính xác \"=G2/1000000\": tổng nhóm 804.937 → 0,804937, số lưu 0,8049 → ghi SỐ", async () => {
    const x = { ...muc("X", 0.8049, 95000, { quantity: "=G2/1000000" }), quantityExact: true };
    const { ws, c, r, v } = await oCua("marico_decor", sheetTiLe(x, 804937), "X", "quantity");
    expect(v, JSON.stringify(v)).toBe(0.8049);
    // Thành Tiền mục vẫn là công thức sống, tính trên đúng SL web dùng → 76.466 như lưới.
    expect(ws.getCell(`${c.amount}${r}`).value).toMatchObject({ formula: `ROUND(G${r}*F${r},0)`, result: 76466 });
  });
  it("đối chứng: SL chính xác, tổng nhóm 805.000 → 0,805 trùng số lưu → công thức sống", async () => {
    const x = { ...muc("X", 0.805, 95000, { quantity: "=G2/1000000" }), quantityExact: true };
    const { ws, v } = await oCua("marico_decor", sheetTiLe(x, 805000), "X", "quantity");
    expect(v).toMatchObject({ formula: `H${hangCua(ws, "marico_decor", "Nhóm A")}/1000000`, result: 0.805 });
  });
  it("SL thường \"=G2/1000000\": 0,84996 lọt tự kiểm với số lưu 0,85, nhưng Excel ROUND ra 0,8 còn web 0,9 → ghi SỐ", async () => {
    const x = muc("X", 0.85, 100000, { quantity: "=G2/1000000" });
    const { v } = await oCua("marico_decor", sheetTiLe(x, 849960), "X", "quantity");
    expect(v, JSON.stringify(v)).toBe(0.9);
  });
  it("Đơn Giá \"=G2/3\": 5.446.333,333… so với số lưu 4 số lẻ 5.446.333,3333 → ghi SỐ", async () => {
    const x = muc("X", 1, 5446333.3333, { unitPrice: "=G2/3" });
    const { v } = await oCua("marico_decor", sheetTiLe(x, 16339000), "X", "unitPrice");
    expect(v, JSON.stringify(v)).toBe(5446333.3333);
  });
  it("Số Ngày \"=G2/1000000\" (unibenfood): 1,2304 so với số lưu 1,23 → ghi SỐ; đối chứng 1,5 → công thức sống", async () => {
    // unibenfood: cột editor A stt · B tên · C ĐVT · D SL · E Số Ngày · F ĐG · G Thành Tiền.
    const lech = { ...muc("X", 1, 10000000, { days: "=G2/1000000" }), days: 1.23 };
    const a = await oCua("unibenfood", sheetTiLe(lech, 1230400, "unibenfood"), "X", "days");
    expect(a.v, JSON.stringify(a.v)).toBe(1.23);
    expect(a.ws.getCell(`${a.c.amount}${a.r}`).value).toMatchObject({ result: 12300000 });
    const khop = { ...muc("X", 1, 10000000, { days: "=G2/1000000" }), days: 1.5 };
    const b = await oCua("unibenfood", sheetTiLe(khop, 1500000, "unibenfood"), "X", "days");
    expect(b.v).toMatchObject({ formula: `H${hangCua(b.ws, "unibenfood", "Nhóm A")}/1000000`, result: 1.5 });
  });
});

// ── (j) SOÁT CHÉO: ô KHÔNG trỏ ô tổng nhóm phải giữ ĐÚNG tệp cũ (8e1920d), kể cả khi dính "vòng" gián tiếp
// Ô A trỏ THÀNH TIỀN của mục B, B trỏ ô tổng nhóm chứa A. B dính vòng nên ghi số (như cũ). A thì không:
// Excel thấy A trỏ một ô Thành Tiền tính từ SỐ của B, không có vòng. Trên af17fe6 A cũng bị ghi số chết,
// vì bộ bắt vòng của A đi qua cả cạnh ô tổng nhóm (đỏ). Trên 8e1920d A giữ công thức (xanh).
const chuCotEditor = (code) => {
  const c = TEMPLATE_CONFIGS[code].items.columns;
  const f = ["_stt", "name"]; if (c.detail) f.push("detail"); f.push("unit", "quantity"); if (c.days) f.push("days"); f.push("unitPrice", "_amount", "notes");
  return { F: String.fromCharCode(65 + f.indexOf("unitPrice")), G: String.fromCharCode(65 + f.indexOf("_amount")), c };
};
describe("(j) vòng gián tiếp qua Thành Tiền MỤC: ô không trỏ tổng nhóm giữ công thức cũ", () => {
  for (const code of ["marico_decor", "gn_banner", "unibenfood", "clofull_decor", "clofull_banner", "clofull_conngay"]) {
    it(`${code}: XA "=G6*2" (Thành Tiền YB), YB "=F1*10%" (Đơn Giá nhóm X chứa XA)`, async () => {
      const { F, G, c } = chuCotEditor(code);
      // Tổng X = 1.000.000 + 250.000 = 1.250.000 → YB 125.000 → XA = 125.000 × 2 = 250.000: số tự khớp.
      const items = [
        nhom("Nhóm X"), muc("X1", 1, 1000000), muc("XA", 1, 250000, { unitPrice: `=${G}6*2` }),
        nhom("Nhóm Y"), muc("Y1", 1, 1000000), muc("YB", 1, 125000, { unitPrice: `=${F}1*10%` }),
      ];
      const ws = await mo(baoGia(code, items));
      const rXA = hangCua(ws, code, "XA"), rYB = hangCua(ws, code, "YB");
      expect(ws.getCell(`${c.unitPrice}${rXA}`).value).toMatchObject({ formula: `${c.amount}${rYB}*2`, result: 250000 });
      expect(ws.getCell(`${c.unitPrice}${rYB}`).value).toBe(125000);   // YB dính vòng qua tổng X → số
    });
  }
  for (const code of ["marico_decor", "unibenfood", "clofull_decor", "clofull_conngay"]) {
    it(`${code} (không banner): SA trong nhóm con S trỏ Thành Tiền QB, QB trỏ Đơn Giá nhóm cha P`, async () => {
      // Không banner: tổng P chỉ gồm mục TRỰC THUỘC (p1) = 1.000.000 → QB 100.000 → SA 200.000.
      const { F, G, c } = chuCotEditor(code);
      const items = [
        nhom("Nhóm P"), muc("p1", 1, 1000000), nhomCon("Nhóm con S"), muc("SA", 1, 200000, { unitPrice: `=${G}7*2` }),
        nhom("Nhóm Q"), muc("q1", 1, 500000), muc("QB", 1, 100000, { unitPrice: `=${F}1*10%` }),
      ];
      const ws = await mo(baoGia(code, items));
      const rSA = hangCua(ws, code, "SA"), rQB = hangCua(ws, code, "QB");
      expect(ws.getCell(`${c.unitPrice}${rSA}`).value).toMatchObject({ formula: `${c.amount}${rQB}*2`, result: 200000 });
    });
  }
  it("biến thể bài (e): A1-2 \"=G9*2,5\" trỏ THÀNH TIỀN Phí (Phí trỏ tổng A1) → A1-2 giữ công thức", async () => {
    const items = sheetNho({ phi: "=G3*10%", giaPhi: 200000 });
    items[4] = muc("A1-2", 2, 500000, { unitPrice: "=G9*2,5" });
    const ws = await mo(baoGia("marico_decor", items));
    const rPhi = hangCua(ws, "marico_decor", "Phí");
    expect(ws.getCell(`G${rPhi}`).value).toBe(200000);
    expect(ws.getCell(`G${hangCua(ws, "marico_decor", "A1-2")}`).value).toMatchObject({ formula: `H${rPhi}*2.5`, result: 500000 });
  });
});
