// Soát toàn diện L51 — số lưu dạng CHỮ kiểu VN trong tệp ngoài (cột định dạng Text, hoặc dán từ nơi
// khác): SL "1.500" đọc thành 1,5; Đơn Giá "(500.000)" kiểu KẾ TOÁN đọc thành +500.000. Đường DÁN
// vào lưới đã được sửa đúng (GRID-13 tachNgoacKeToan, suyQuyUocSo ở web/src/lib/clipboard.ts) nhưng
// bộ nhập Excel — chú thích tự nhận là "PORT từ clipboard.ts" — chưa port theo: cùng dữ liệu, dán
// một kiểu, nạp tệp một kiểu.
//   ĐÃ ĐO: [{"ten":"Ghế","sl":1.5,"dg":50000,"warn":["Thành Tiền … (75.000.000) không khớp … (75.000)"]},
//           {"ten":"Chiết khấu","sl":1,"dg":500000}]   ← chiết khấu thành CỘNG, không cảnh báo dòng
// Ô SỐ THẬT (không phải chữ) thì không bị — bài chốt cuối giữ nguyên hành vi đó.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseQuoteWorkbook } from "../src/excelImport.js";
import { parseTheoQuyUoc, suyQuyUocSo, khopQuyUoc, parseLooseDecimal, parseLooseNumber, chuKhongRaSo } from "../web/src/lib/clipboard.ts";

const HDR = ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền"];
async function tep(rows, hdr = HDR) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Báo giá ngoài");
  ws.addRow(["BÁO GIÁ"]); ws.addRow([]);
  ws.addRow(hdr);
  for (const r of rows) ws.addRow(r);
  const res = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  return res.sheets[0];
}

const CHU = [
  ["1", "Ghế", "cái", "1.500", "50.000", "75.000.000"],
  ["2", "Chiết khấu", "gói", "1", "(500.000)", "(500.000)"],
];

describe("L51: số dạng chữ trong tệp ngoài đọc như khi dán vào lưới", () => {
  it("SL '1.500' trong bảng quy ước VN = 1500; '(500.000)' = −500.000; không cảnh báo sai", async () => {
    const s = await tep(CHU);
    const [ghe, ck] = s.items;
    expect(ghe).toMatchObject({ name: "Ghế", quantity: 1500, unitPrice: 50000 });
    expect(ghe.warn, "Thành Tiền 75.000.000 đúng bằng 1.500 × 50.000").toBeUndefined();
    expect(ck).toMatchObject({ name: "Chiết khấu", quantity: 1, unitPrice: -500000 });
    expect(ck.warn).toBeUndefined();
  });

  it("KHỚP đường dán tay: cùng khối chữ → cùng con số với clipboard.ts", async () => {
    const s = await tep(CHU);
    const qu = suyQuyUocSo(CHU.map((r) => r.slice(3)), (c) => c >= 1);
    expect(qu).toBe("vn");
    expect(s.items.map((i) => [i.quantity, i.unitPrice])).toEqual(CHU.map((r) => [parseTheoQuyUoc(r[3], qu), parseTheoQuyUoc(r[4], qu)]));
  });

  it("Tổng Cộng dạng chữ khớp tổng tự tính — không còn cảnh báo lệch giả", async () => {
    const s = await tep([...CHU, [], ["Tổng cộng", "", "", "", "", "74.500.000"]]);
    expect(s.totals?.subtotal).toBe(74500000);
    expect(s.warnings.join(" | ")).not.toMatch(/lệch/);
  });

  it("không có tín hiệu quy ước (không ô chữ nào rõ ràng) → giữ cách đọc cũ: SL '1.5' là 1,5", async () => {
    const s = await tep([["1", "Thảm", "m2", "1.5", 200000, 300000]]);
    expect(s.items[0]).toMatchObject({ quantity: 1.5, unitPrice: 200000 });
  });

  // Đợt 3: bản đầu của L51 bỏ MỌI dấu "." khi bảng là quy ước VN → SL chữ "0.5" / "1.5" thành 5 / 15.
  // Có cột Thành Tiền thì dòng còn cảnh báo lệch; KHÔNG có cột đó thì tiền sai 10 lần mà im lặng.
  // Dấu "." chỉ là dấu nghìn VN khi nhóm sau nó đúng 3 chữ số — "0.5" là thập phân.
  it("bảng quy ước VN mà SL chữ '0.5' / '1.5' → đọc thập phân, không phải 5 / 15", async () => {
    const s = await tep([
      ["1", "Ghế", "cái", "0.5", "1.500.000", "750.000"],
      ["2", "Thảm", "m2", "1.5", "200.000", "300.000"],
      ["3", "Vách", "m2", "1.500", "250.000", "375.000.000"],
    ]);
    expect(s.items.map((i) => i.quantity)).toEqual([0.5, 1.5, 1500]);
    expect(s.items.map((i) => i.warn)).toEqual([undefined, undefined, undefined]);
  });

  it("KHÔNG có cột Thành Tiền (không còn cảnh báo nào đỡ): SL '0.5' vẫn là 0,5", async () => {
    const s = await tep([["1", "Ghế", "cái", "0.5", "1.500.000"]], ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá"]);
    expect(s.items[0]).toMatchObject({ name: "Ghế", quantity: 0.5, unitPrice: 1500000 });
  });

  it("KHỚP đường dán tay cả ở ô lệch khuôn: '0.5' / '2.25' đọc như khi dán (khopQuyUoc → parseLooseDecimal)", async () => {
    const rows = [
      ["1", "Ghế", "cái", "0.5", "1.500.000", "750.000"],
      ["2", "Bàn", "cái", "2.25", "100.000", "225.000"],
      ["3", "Thảm", "m2", "1.500", "95.000", "142.500.000"],
    ];
    const s = await tep(rows);
    const qu = suyQuyUocSo(rows.map((r) => r.slice(3)), (c) => c >= 1);
    expect(qu).toBe("vn");
    // Lưới (GridTable pasteCellVal / reconstructExportRows): ô khớp khuôn theo quy ước khối, ô lệch
    // khuôn đọc theo cột (SL = parseLooseDecimal). Nạp tệp phải ra đúng những con số đó.
    const danTay = (v) => (khopQuyUoc(v, qu) ? parseTheoQuyUoc(v, qu) : parseLooseDecimal(v));
    expect(s.items.map((i) => i.quantity)).toEqual(rows.map((r) => danTay(r[3])));
    expect(s.items.map((i) => i.quantity)).toEqual([0.5, 2.25, 1500]);
  });

  // Đợt 3: tachNgoacKeToan nhận MỌI chuỗi mở "(" đóng ")" là số âm kế toán — kể cả hai chú thích ở hai
  // đầu. Đơn Giá chữ "(Tạm tính) 500.000 (chưa VAT)" nạp thành −500.000 (hạng mục thành khoản TRỪ).
  it("Đơn Giá chữ '(Tạm tính) 500.000 (chưa VAT)' là +500.000; '(500.000)' vẫn là −500.000; khớp dán tay", async () => {
    const rows = [
      ["1", "Sân khấu", "gói", "1", "(Tạm tính) 500.000 (chưa VAT)"],
      ["2", "Chiết khấu", "gói", "1", "(500.000)"],
    ];
    const s = await tep(rows, ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá"]);
    expect(s.items.map((i) => i.unitPrice)).toEqual([500000, -500000]);
    const qu = suyQuyUocSo(rows.map((r) => r.slice(3)), (c) => c >= 1);
    expect(s.items.map((i) => i.unitPrice)).toEqual(rows.map((r) => (qu ? parseTheoQuyUoc(r[4], qu) : parseLooseNumber(r[4]))));
  });

  // Soát toàn diện L15 (phần nạp tệp): dán "10%" vào lưới đã ra 0,1 (b98716d) nhưng bản port số ở bộ nhập
  // Excel chưa nhận hậu tố "%" — ô CHỮ "10%" ở cột SL nạp thành 10: "Phí quản lý 10% × 50.000.000" ra
  // 500.000.000 thay vì 5.000.000. (Ô SỐ định dạng % trong xlsx vốn là 0,1 nên không bị.)
  it("ô CHỮ '10%' / '12,5%' ở cột SL/Đơn Giá → 0,1 / 0,125 như khi dán; '10% VAT' vẫn đọc như cũ", async () => {
    const rows = [
      ["1", "Phí quản lý", "%", "10%", "50000000"],
      ["2", "Phụ phí", "gói", "1", "12,5%"],
      ["3", "Ghi chú giá", "gói", "1", "10% VAT"],
    ];
    const s = await tep(rows, ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá"]);
    expect(s.items[0].quantity).toBeCloseTo(0.1, 10);
    expect(s.items[1].unitPrice).toBeCloseTo(0.125, 10);
    expect(s.items[2].unitPrice).toBe(10);
    // Không có ô chữ nào mang tín hiệu quy ước → lưới đọc SL bằng parseLooseDecimal, giá bằng parseLooseNumber
    expect(s.items.map((i) => [i.quantity, i.unitPrice])).toEqual(rows.map((r) => [parseLooseDecimal(r[3]), parseLooseNumber(r[4])]));
  });

  it("bảng có quy ước VN: SL chữ '10%' vẫn là 0,1 (nhánh parseTheoQuyUoc)", async () => {
    const s = await tep([["1", "Phí quản lý", "%", "10%", "50.000.000", "5.000.000"]]);
    expect(s.items[0].quantity).toBeCloseTo(0.1, 10);
    expect(s.items[0].warn).toBeUndefined();
  });

  // Phản biện đợt 3: "(1.500.000 đồng)" — chữ "đồng" trong ngoặc không nằm trong danh sách ký hiệu tiền
  // được gỡ nên ngoặc bị coi là chú thích → nạp +1.500.000 (trước bản sửa ngoặc chú thích là −1.500.000).
  it("Đơn Giá chữ '(1.500.000 đồng)' / '(US$1,500)' là số âm; khớp dán tay", async () => {
    const rows = [
      ["1", "Chiết khấu", "gói", "1", "(1.500.000 đồng)"],
      ["2", "Giảm giá", "gói", "1", "(US$1,500)"],
    ];
    const s = await tep(rows, ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá"]);
    expect(s.items.map((i) => i.unitPrice)).toEqual([-1500000, -1500]);
    const qu = suyQuyUocSo(rows.map((r) => r.slice(3)), (c) => c >= 1);
    expect(s.items.map((i) => i.unitPrice)).toEqual(rows.map((r) => (qu ? parseTheoQuyUoc(r[4], qu) : parseLooseNumber(r[4]))));
  });

  it("ô SỐ THẬT không đổi gì", async () => {
    const s = await tep([[1, "Ghế", "cái", 1500, 50000, 75000000], [2, "Chiết khấu", "gói", 1, -500000, -500000]]);
    expect(s.items.map((i) => [i.quantity, i.unitPrice])).toEqual([[1500, 50000], [1, -500000]]);
  });
});

describe("L17 (đợt 3): chữ số dính sau chữ cái trong ô CHỮ không được nạp làm số", () => {
  it("SL chữ '12 m2' = 12 (không phải 122); Đơn Giá '95.000đ/m2' = 95.000; SL 'm2' = 0 — khớp đường dán", async () => {
    const rows = [
      ["1", "Vách", "m2", "12 m2", "95.000đ/m2"],
      ["2", "Sàn", "m2", "m2", "50000"],
    ];
    const s = await tep(rows, ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá"]);
    expect(s.items.map((i) => [i.quantity, i.unitPrice])).toEqual([[12, 95000], [0, 50000]]);
    expect(s.items.map((i) => [i.quantity, i.unitPrice])).toEqual(rows.map((r) => [parseLooseDecimal(r[3]), parseLooseNumber(r[4])]));
  });

  // Phản biện đợt 3: tiền tố "x" / mã tiền viết liền ở ĐẦU ô ("x2", "VNĐ1.500.000") từng bị bỏ cả cụm → 0.
  it("SL chữ 'x2' = 2; Đơn Giá 'VNĐ1.500.000' = 1.500.000; 'USD1,500' = 1.500 — khớp đường dán", async () => {
    const rows = [
      ["1", "Vách", "cái", "x2", "VNĐ1.500.000"],
      ["2", "Sàn", "cái", "3", "USD1,500"],
    ];
    const s = await tep(rows, ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá"]);
    expect(s.items.map((i) => [i.quantity, i.unitPrice])).toEqual([[2, 1500000], [3, 1500]]);
    expect(s.items.map((i) => [i.quantity, i.unitPrice])).toEqual(rows.map((r) => [parseLooseDecimal(r[3]), parseLooseNumber(r[4])]));
  });
});

// Soát toàn diện đợt 4 (việc 1): sau L17 ô CHỮ có chữ cái dính liền trước/sau số ("ĐG1.500.000", "gia1.500",
// "SL12", "x.5", "1e3", "12m2") đọc 0 — đúng luật "không đoán", nhưng KHÔNG một cảnh báo dòng nào (chỉ có
// cảnh báo NGÀY THÁNG / ô LỖI). Tệp không có cột Thành Tiền thì Đơn Giá về 0 mà không ai thấy.
//   ĐÃ ĐO (fed1461): 6 dòng dưới đều nạp số 0 với warn = undefined.
describe("đợt 4 việc 1: ô CHỮ ở cột số đọc ra 0 phải có cảnh báo dòng", () => {
  const HDR5 = ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá"];

  it("không có cột Thành Tiền: 'ĐG1.500.000' / 'gia1.500' / 'SL12' / 'x.5' / '1e3' / '12m2' → 0 KÈM cảnh báo đúng ô", async () => {
    const rows = [
      ["1", "Sân khấu", "gói", "1", "ĐG1.500.000"],
      ["2", "Loa", "cái", "2", "gia1.500"],
      ["3", "Ghế", "cái", "SL12", "50.000"],
      ["4", "Thảm", "m2", "x.5", "200.000"],
      ["5", "Đèn", "cái", "1e3", "10.000"],
      ["6", "Vách", "m2", "12m2", "95.000"],
    ];
    const s = await tep(rows, HDR5);
    expect(s.items.map((i) => [i.quantity, i.unitPrice])).toEqual([[1, 0], [2, 0], [0, 50000], [0, 200000], [0, 10000], [0, 95000]]);
    s.items.forEach((it, k) => expect(it.warn?.join(" | "), rows[k][1]).toMatch(/không đọc được số/));
    expect(s.items[0].warn.join(" | ")).toMatch(/Đơn Giá.*ĐG1\.500\.000/);
    expect(s.items[2].warn.join(" | ")).toMatch(/Số Lượng.*SL12/);
    expect(s.items[0].warn.join(" | ")).not.toMatch(/Số Lượng/);
  });

  it("chữ KHÔNG có chữ số ('Liên hệ', 'Theo thực tế') ở Đơn Giá cũng về 0 → cảnh báo", async () => {
    const s = await tep([["1", "Âm thanh", "gói", "1", "Liên hệ"], ["2", "Ánh sáng", "gói", "1", "Theo thực tế"]], HDR5);
    expect(s.items.map((i) => i.unitPrice)).toEqual([0, 0]);
    s.items.forEach((it) => expect(it.warn?.join(" | ")).toMatch(/Đơn Giá.*không đọc được số/));
  });

  it("KHÔNG cảnh báo giả: số 0 viết bằng chữ ('0', '0đ', '-', '(0)', '0,00'), ô trống, ô chữ đọc ra số, ô SỐ thật 0", async () => {
    const s = await tep([
      ["1", "Tặng kèm", "cái", "1", "0"],
      ["2", "Khuyến mãi", "cái", "2", "0đ"],
      ["3", "Miễn phí", "cái", "3", "-"],
      ["4", "Bù trừ", "cái", "1", "(0)"],
      ["5", "Phí 0", "cái", "1", "0,00"],
      ["6", "Để trống giá", "cái", "1", ""],
      ["7", "Vách", "m2", "12 m2", "95.000đ/m2"],
      ["8", "Ghế", "cái", "x2", "VNĐ1.500.000"],
      ["9", "Bàn", "cái", 0, 0],
      ["10", "Thảm", "m2", "0 m2", "USD1,500"],
    ], HDR5);
    expect(s.items.map((i) => i.warn)).toEqual(s.items.map(() => undefined));
  });

  it("Số Ngày chữ 'cả tuần' → cảnh báo; Đơn Giá chữ của hàng NHÓM không xét (app tự cộng lại, vốn không nạp)", async () => {
    const s = await tep([
      ["A", "Hạng mục chính", "", "", "", "Trọn gói"],
      ["1", "Nhân sự", "người", "2", "cả tuần", "500.000"],
    ], ["STT", "Hạng mục", "ĐVT", "Số lượng", "Số ngày", "Đơn giá"]);
    const [nhom, ns] = s.items;
    expect(nhom.kind).toBe("section");
    expect(nhom.warn).toBeUndefined();
    expect(ns).toMatchObject({ quantity: 2, unitPrice: 500000, days: null });
    expect(ns.warn?.join(" | ")).toMatch(/Số Ngày.*cả tuần.*không đọc được số/);
  });

  // Phản biện đợt 4: bản đầu miễn cảnh báo cho mọi ô còn sót MỘT chữ số BẤT KỲ sau bước bỏ cụm, trong khi ý định
  // chỉ là "số 0 viết bằng chữ". Khoảng giá đọc NaN → 0 mà vẫn im lặng — đúng lớp "Đơn Giá về 0 không ai thấy".
  //   ĐÃ ĐO (2721ffb, tệp không cột Thành Tiền): "1.500.000 - 2.000.000" → unitPrice 0, warn undefined;
  //   "1,2,3.4.5" → 0, warn undefined.
  it("còn chữ số KHÁC 0 mà đọc ra 0 ('1.500.000 - 2.000.000', '1,2,3.4.5') → cảnh báo; chỉ còn chữ số 0 thì không", async () => {
    const khoang = ["1.500.000 - 2.000.000", "1,2,3.4.5"];
    const so0 = ["0.000", "-0", "0 (tặng)", "ĐG: 0", "0%", "0 m2"];
    const s = await tep([...khoang, ...so0].map((g, k) => [String(k + 1), `Mục ${k + 1}`, "cái", "1", g]), HDR5);
    expect(s.items.map((i) => i.unitPrice)).toEqual([...khoang, ...so0].map(() => 0));
    khoang.forEach((g, k) => expect(s.items[k].warn?.join(" | "), g).toMatch(/Đơn Giá.*không đọc được số, đã để 0/));
    expect(s.items.slice(khoang.length).map((i) => i.warn)).toEqual(so0.map(() => undefined));
    // Phía web (đường dán) cùng kết luận.
    for (const g of khoang) expect(chuKhongRaSo(g, parseLooseNumber(g)), g).toBe(true);
    for (const g of so0) expect(chuKhongRaSo(g, parseLooseNumber(g)), g).toBe(false);
  });

  it("KHỚP phía web: chuKhongRaSo ở clipboard.ts (dùng cho đường dán) cho cùng kết luận với bộ nhập", async () => {
    const giaChu = ["ĐG1.500.000", "gia1.500", "Liên hệ", "0", "0đ", "-", "(0)", "95.000đ/m2", "VNĐ1.500.000", "1e3"];
    const s = await tep(giaChu.map((g, k) => [String(k + 1), `Mục ${k + 1}`, "cái", "1", g]), HDR5);
    expect(s.items.map((i) => !!i.warn)).toEqual(giaChu.map((g) => chuKhongRaSo(g, parseLooseNumber(g))));
    expect(giaChu.map((g) => chuKhongRaSo(g, parseLooseNumber(g)))).toEqual([true, true, true, false, false, false, false, false, false, true]);
    expect(chuKhongRaSo("SL12", parseLooseDecimal("SL12"))).toBe(true);
    expect(chuKhongRaSo("", 0)).toBe(false);
    expect(chuKhongRaSo("12 m2", parseLooseDecimal("12 m2"))).toBe(false);
  });
});

// Soát toàn diện đợt 4 (việc 2): ngoặc kế toán đòi phần trong ngoặc là SỐ thuần (đợt 3, để "(Tạm tính) 500.000
// (chưa VAT)" không thành số âm), nhưng danh sách chữ được gỡ trước khi xét chỉ có VNĐ / USD / đồng / ₫ / $.
// Âm kế toán kèm đơn vị hay tiền khác đọc thành DƯƠNG — khoản giảm giá thành khoản cộng, không cảnh báo:
//   ĐÃ ĐO (fed1461): "(1.500.000 đ/bộ)" / "(1.500.000 VND/bộ)" / "(1.500.000 k)" → +1.500.000;
//   "(€1.500)" / "(1.500 EUR)" / "(1.500)€" → +1.500; "(1.5tr)" → +1,5 (ở 2f591e0 đều là số âm).
// Luật: ô trong ngoặc đọc đúng bằng ô đó bỏ ngoặc, ĐỔI DẤU — đọc không ngoặc vốn đã bỏ qua các chữ này.
describe("đợt 4 việc 2: ngoặc kế toán kèm đơn vị '/bộ' / EUR / € / k / nghìn / tr vẫn là số âm — hai phía khớp", () => {
  const NGOAC = [
    "(1.500.000 đ/bộ)", "(1.500.000 VND/bộ)", "(1.500.000/cái)", "(1.500.000 đ / suất)", "(1.500.000 đ/m²)",
    "(1.500.000 đồng/m2)", "(1.500.000 k)", "(€1.500)", "(1.500 EUR)", "(1.500€)", "(1.500)€", "€(1.500)",
    "(1.5tr)", "(1,5 tr)", "(500 nghìn)", "(500 ngàn)", "(2 triệu)",
  ];
  const boNgoac = (x) => x.replace(/[()]/g, "");

  it("clipboard.ts: parseLooseNumber / parseTheoQuyUoc đọc = −(cùng ô bỏ ngoặc); parseLooseDecimal cũng âm", () => {
    for (const x of NGOAC) {
      expect(parseLooseNumber(x), x).toBe(-parseLooseNumber(boNgoac(x)));
      expect(parseLooseNumber(x), x).toBeLessThan(0);
      expect(parseTheoQuyUoc(x, "vn"), x).toBe(-parseTheoQuyUoc(boNgoac(x), "vn"));
      expect(parseLooseDecimal(x), x).toBe(-parseLooseDecimal(boNgoac(x)));
    }
    expect(parseLooseNumber("(1.500.000 đ/bộ)")).toBe(-1500000);
    expect(parseLooseNumber("(1.500 EUR)")).toBe(-1500);
    expect(parseLooseDecimal("(2,5 /bộ)")).toBeCloseTo(-2.5);
    // Chữ tổ hợp NFD (dán từ máy Mac / trình duyệt khác): "ì" / "ồ" là hai điểm mã, vẫn phải nhận ra.
    expect(parseLooseNumber("(500 nghìn)".normalize("NFD"))).toBe(-500);
    expect(parseLooseNumber("(1.500.000 đồng)".normalize("NFD"))).toBe(-1500000);
  });

  it("không nới quá tay: chú thích hai đầu, '/' theo sau là SỐ, ngoặc chỉ có chữ đơn vị — vẫn không phải số âm", () => {
    expect(parseLooseNumber("(Tạm tính) 500.000 (chưa VAT)")).toBe(500000);
    expect(parseLooseNumber("(tạm k) 500.000 (chưa tr)")).toBe(500000);
    expect(parseLooseNumber("(1/2)")).toBeGreaterThanOrEqual(0);
    expect(parseLooseNumber("(k)")).toBe(0);
    expect(parseLooseNumber("(/bộ)")).toBe(0);
    // Chữ đơn vị phải đứng riêng: "kg" / "trọn" không phải "k" / "tr".
    expect(parseLooseNumber("(1.500 kg)")).toBeGreaterThanOrEqual(0);
    expect(parseLooseNumber("(1.500 trọn gói)")).toBeGreaterThanOrEqual(0);
  });

  it("nạp tệp (src/excelImport.ts) ra ĐÚNG những con số đó — hai phía giữ khớp", async () => {
    const rows = NGOAC.map((g, k) => [String(k + 1), `Giảm ${k + 1}`, "gói", "1", g]);
    const s = await tep(rows, ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá"]);
    const qu = suyQuyUocSo(rows.map((r) => r.slice(3)), (c) => c >= 1);
    expect(s.items.map((i) => i.unitPrice)).toEqual(rows.map((r) => (qu ? parseTheoQuyUoc(r[4], qu) : parseLooseNumber(r[4]))));
    s.items.forEach((it, k) => expect(it.unitPrice, NGOAC[k]).toBeLessThan(0));
    expect(s.items.map((i) => i.warn)).toEqual(s.items.map(() => undefined));
  });
});
