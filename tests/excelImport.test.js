// NHẬP FILE EXCEL → dữ liệu lưới. Ghim bằng VÒNG TRÒN: dựng báo giá → XUẤT ra file thật →
// ĐỌC NGƯỢC file đó → phải ra lại đúng cấu trúc ban đầu (nhóm / nhóm con / hàng con / dòng
// thông tin / công thức tham chiếu ô). Đây là bài kiểm chặt nhất cho luồng
// "xuất gửi khách → khách sửa trong Excel → nhập lại vào app".
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";

const baseQuote = (code, items, over = {}) => JSON.parse(JSON.stringify({
  quoteNumber: "GN26IMP", title: "Báo giá nhập lại", toCompany: "Cty ABC", toContact: "Anh A",
  toPhone: "0900000000", toAddress: "1 Đường X", vatPercent: 8, discount: 0, showTotals: true,
  city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-08-01"), fromContact: "Chị B", fromTitle: "Sale",
  fromPhone: "0911111111", fromAddress: "2 Đường Y", greeting: "Xin gửi báo giá:",
  sheets: [{ order: 1, name: "Décor", groupSubtotal: true, template: { code }, items }],
  ...over,
}));

const FULL_ITEMS = [
  { kind: "section", name: "NHÓM A", quantity: 1 },
  { kind: "item", name: "Backdrop", unit: "m2", quantity: 13.5, unitPrice: 250000, notes: "ghi chú 1" },
  { kind: "sub", name: "", unit: "cái", quantity: 2, unitPrice: 100000 },
  { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 300000, formulas: { unitPrice: "=200000+100000" } },
  { kind: "subsection", name: "Nhóm con B1", quantity: 1 },
  { kind: "item", name: "Bàn", unit: "cái", quantity: 4, unitPrice: 150000 },
  { kind: "info", name: "Dòng thông tin không tính tiền" },
  { kind: "section", name: "NHÓM B", quantity: 2 },
  { kind: "item", name: "Ghế", unit: "cái", quantity: 10, unitPrice: 50000, formulas: { quantity: "=5*2" } },
];

async function roundTrip(code, items = FULL_ITEMS, over = {}) {
  const buf = await buildQuoteBuffer(baseQuote(code, items, over));
  const res = await parseQuoteWorkbook(buf);
  return { res, sheet: res.sheets.find((s) => !s.skipped) };
}

describe("parseQuoteWorkbook — vòng tròn xuất → nhập lại", () => {
  it.each(["marico_decor", "clofull_decor", "unibenfood", "gn_banner"])(
    "giữ nguyên nhóm / nhóm con / hàng con / dòng thông tin (%s)", async (code) => {
      const { sheet } = await roundTrip(code);
      expect(sheet).toBeTruthy();
      // Mẫu CLF gom MỌI dòng "thông tin" vào 1 banner NGAY TRÊN bảng (ô B5) lúc xuất → nhập lại
      // nó về đầu danh sách, không còn nằm giữa. Đó là thiết kế của mẫu, không phải đọc sai.
      const infoFirst = code === "clofull_decor";
      const kinds = ["section", "item", "sub", "item", "subsection", "item", "info", "section", "item"];
      const names = ["NHÓM A", "Backdrop", "", "Standee", "Nhóm con B1", "Bàn", "Dòng thông tin không tính tiền", "NHÓM B", "Ghế"];
      const move = (arr) => (infoFirst ? [arr[6], ...arr.slice(0, 6), ...arr.slice(7)] : arr);
      expect(sheet.items.map((i) => i.kind)).toEqual(move(kinds));
      expect(sheet.items.map((i) => i.name)).toEqual(move(names));
      const at = (i) => sheet.items[infoFirst && i < 6 ? i + 1 : i];
      // Số liệu hạng mục phải khớp tuyệt đối (đây là TIỀN của khách).
      const backdrop = at(1);
      expect(backdrop.unit).toBe("m2");
      expect(backdrop.quantity).toBe(13.5);
      expect(backdrop.unitPrice).toBe(250000);
      expect(backdrop.notes).toBe("ghi chú 1");
      // Hàng con: tên để TRỐNG (thuộc dòng cha), vẫn giữ ĐVT + số.
      expect(at(2)).toMatchObject({ kind: "sub", name: "", unit: "cái", quantity: 2, unitPrice: 100000 });
      // Dòng NHÓM: đơn giá là tổng do app tự tính → KHÔNG nạp lại thành dữ liệu người dùng.
      expect(at(0).unitPrice).toBe(0);
      expect(at(0).quantity).toBe(1);
      expect(sheet.items[sheet.items.length - 2].quantity).toBe(2);   // hệ số nhân của nhóm B
      // Bật "tổng tiền theo nhóm" đọc lại được từ file.
      expect(sheet.groupSubtotal).toBe(true);
    });

  it("đoán đúng mẫu báo giá của từng file", async () => {
    for (const code of ["marico_decor", "clofull_decor", "unibenfood", "gn_banner"]) {
      const { sheet } = await roundTrip(code);
      expect(sheet.templateCode, `mẫu của ${code}`).toBe(code);
    }
  });

  it("bỏ qua sheet 'Tổng Báo Giá' do app tự sinh", async () => {
    const { res } = await roundTrip("marico_decor");
    const skipped = res.sheets.filter((s) => s.skipped);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].name).toMatch(/Tổng Báo Giá/i);
  });

  it("đọc lại được khối tổng: Tổng cộng / VAT % / Thành tiền", async () => {
    const { sheet } = await roundTrip("marico_decor");
    expect(sheet.totals.vatPercent).toBe(8);
    expect(sheet.totals.subtotal).toBeGreaterThan(0);
    expect(sheet.totals.total).toBe(sheet.totals.subtotal + sheet.totals.vat);
  });

  it("nhận đúng cột theo HÀNG TIÊU ĐỀ (không bám vị trí cứng)", async () => {
    const { sheet } = await roundTrip("marico_decor");
    expect(sheet.columns).toMatchObject({ _stt: "B", name: "C", unit: "E", quantity: "F", unitPrice: "G", _amount: "H" });
    const { sheet: withDays } = await roundTrip("unibenfood");
    expect(withDays.hasDays).toBe(true);
    expect(withDays.columns.days).toBe("F");        // mẫu CÓ ngày: Số Ngày chen vào giữa
    expect(withDays.columns.unitPrice).toBe("G");
  });
});

describe("parseQuoteWorkbook — công thức tham chiếu ô", () => {
  it("giữ công thức số học và KHÔNG để lọt lớp ROUND do app tự bọc", async () => {
    const { sheet } = await roundTrip("marico_decor");
    expect(sheet.items[3].formulas).toEqual({ unitPrice: "=200000+100000" });
    // Số Lượng lúc xuất bị bọc ROUND(...,1) → nhập lại phải bóc ra, không tích tụ.
    expect(sheet.items[8].formulas).toEqual({ quantity: "=5*2" });
    expect(sheet.items[8].quantity).toBe(10);
  });

  it("dịch ref Ô sang toạ độ lưới theo TÊN FIELD + đúng dòng (không lệch ô)", async () => {
    const items = [
      { kind: "item", name: "A", unit: "cái", quantity: 2, unitPrice: 100000 },
      // Editor: cột F = Đơn Giá, dòng 1 = hạng mục "A" → =F1*3 nghĩa là "gấp 3 đơn giá của A".
      { kind: "item", name: "B", unit: "cái", quantity: 1, unitPrice: 300000, formulas: { unitPrice: "=F1*3" } },
    ];
    const { sheet } = await roundTrip("marico_decor", items);
    expect(sheet.items[1].formulas).toEqual({ unitPrice: "={unitPrice:1}*3" });
    expect(sheet.items[1].unitPrice).toBe(300000);
    expect(sheet.stats.formulasDropped).toBe(0);
  });

  it("công thức KHÔNG dịch được thì giữ CON SỐ + ghi cảnh báo (không bao giờ nạp số sai)", async () => {
    const buf = await buildQuoteBuffer(baseQuote("marico_decor", [
      { kind: "item", name: "A", unit: "cái", quantity: 1, unitPrice: 100000 },
    ]));
    // Giả lập khách tự gõ công thức lạ trong Excel: hàm app không hiểu + ref ra ngoài bảng.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    ws.getCell("G12").value = { formula: "IF(F12>0,123456,0)", result: 123456 };
    const edited = Buffer.from(await wb.xlsx.writeBuffer());

    const res = await parseQuoteWorkbook(edited);
    const sheet = res.sheets.find((s) => !s.skipped);
    expect(sheet.items[0].unitPrice).toBe(123456);          // vẫn lấy đúng số Excel đã tính
    expect(sheet.items[0].formulas).toBeUndefined();        // nhưng KHÔNG nạp công thức lạ
    expect(sheet.stats.formulasDropped).toBe(1);
    expect(sheet.items[0].warn.join(" ")).toMatch(/không dịch được/);
  });
});

describe("parseQuoteWorkbook — file khách đã sửa", () => {
  it("lấy đúng số khách sửa tay (số lượng / đơn giá)", async () => {
    const buf = await buildQuoteBuffer(baseQuote("marico_decor", [
      { kind: "item", name: "Backdrop", unit: "m2", quantity: 10, unitPrice: 200000 },
      { kind: "item", name: "Standee", unit: "cái", quantity: 2, unitPrice: 500000 },
    ]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    ws.getCell("F12").value = 12;          // khách sửa Số Lượng 10 → 12
    ws.getCell("G13").value = 450000;      // khách ép giá 500.000 → 450.000
    ws.getCell("I13").value = "giảm giúp anh";
    const res = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    const sheet = res.sheets.find((s) => !s.skipped);
    expect(sheet.items[0].quantity).toBe(12);
    expect(sheet.items[1].unitPrice).toBe(450000);
    expect(sheet.items[1].notes).toBe("giảm giúp anh");
  });

  it("cảnh báo khi Thành Tiền trong file không khớp Số Lượng × Đơn Giá", async () => {
    const buf = await buildQuoteBuffer(baseQuote("marico_decor", [
      { kind: "item", name: "A", unit: "cái", quantity: 2, unitPrice: 100000 },
    ]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    wb.worksheets[0].getCell("H12").value = 999999;   // khách gõ đè ô tổng
    const res = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    const sheet = res.sheets.find((s) => !s.skipped);
    expect(sheet.items[0].warn.join(" ")).toMatch(/Thành Tiền/);
    expect(sheet.items[0].unitPrice).toBe(100000);    // KHÔNG tự sửa số của khách
  });
});

describe("parseQuoteWorkbook — file NGOÀI (không do app xuất)", () => {
  /** Bảng báo giá tự chế: bắt đầu ở cột C, tiêu đề dòng 5, chữ cột khác hẳn mẫu app. */
  async function foreignFile() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Bang gia");
    ws.getCell("C2").value = "BÁO GIÁ CỦA ĐỐI TÁC";
    const hdr = ["STT", "Nội dung", "Đơn vị tính", "SL", "Đơn giá", "Thành tiền", "Ghi chú"];
    hdr.forEach((h, i) => { ws.getCell(5, 3 + i).value = h; });
    const rows = [
      ["A", "PHẦN THI CÔNG", "", "", "", "", ""],
      [1, "Thi công sàn", "m2", 20, 150000, 3000000, ""],
      [2, "Lắp đặt đèn", "bộ", 4, "1.200.000", 4800000, "gồm công"],
      ["", "", "", "", "", "", ""],
      ["", "Tổng cộng", "", "", "", 7800000, ""],
    ];
    rows.forEach((r, ri) => r.forEach((v, ci) => { ws.getCell(6 + ri, 3 + ci).value = v; }));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it("tự dò hàng tiêu đề + map cột theo TÊN, kể cả bảng bắt đầu ở cột khác", async () => {
    const res = await parseQuoteWorkbook(await foreignFile());
    const sheet = res.sheets.find((s) => !s.skipped);
    expect(sheet.headerRow).toBe(5);
    expect(sheet.columns).toMatchObject({ _stt: "C", name: "D", unit: "E", quantity: "F", unitPrice: "G", _amount: "H", notes: "I" });
    expect(sheet.items.map((i) => i.kind)).toEqual(["section", "item", "item"]);
    expect(sheet.items[1]).toMatchObject({ name: "Thi công sàn", unit: "m2", quantity: 20, unitPrice: 150000 });
    // Số kiểu VN dạng chuỗi "1.200.000" phải ra 1200000 (không thành 1,2).
    expect(sheet.items[2].unitPrice).toBe(1200000);
    expect(sheet.totals.subtotal).toBe(7800000);
  });

  it("file không có bảng báo giá → báo rõ, không nạp bừa", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Linh tinh");
    ws.getCell("A1").value = "Ghi chú nội bộ";
    ws.getCell("A2").value = "không có bảng nào";
    const res = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(res.sheets[0].skipped).toMatch(/Không tìm thấy hàng tiêu đề/);
    expect(res.warnings.join(" ")).toMatch(/Không tìm thấy bảng báo giá/);
  });
});

describe("parseQuoteWorkbook — bẫy đã vá (rà soát edge case)", () => {
  it("tên hạng mục bắt đầu bằng '=' KHÔNG bị cộng dồn dấu nháy qua mỗi vòng xuất→nhập", async () => {
    const name = "=Gói combo A+B";
    const buf = await buildQuoteBuffer(baseQuote("marico_decor", [
      { kind: "item", name, unit: "gói", quantity: 1, unitPrice: 100000 },
    ]));
    const res = await parseQuoteWorkbook(buf);
    expect(res.sheets.find((s) => !s.skipped).items[0].name).toBe(name);
  });

  it("ô Số Lượng là NGÀY THÁNG → về 0 kèm cảnh báo, không thành 20 triệu", async () => {
    const buf = await buildQuoteBuffer(baseQuote("marico_decor", [
      { kind: "item", name: "A", unit: "cái", quantity: 2, unitPrice: 100000 },
    ]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    // Excel khi khách gõ "01/08/2026" vào ô: đổi giá trị thành ngày + đổi định dạng ô sang ngày.
    const qc = wb.worksheets[0].getCell("F12");
    qc.value = new Date("2026-08-01");
    qc.numFmt = "dd/mm/yyyy";
    const res = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    const it = res.sheets.find((s) => !s.skipped).items[0];
    expect(it.quantity).toBe(0);
    expect(it.warn.join(" ")).toMatch(/NGÀY THÁNG/);
  });

  it("còn hạng mục nằm DƯỚI phần tổng → cảnh báo, không bỏ qua âm thầm", async () => {
    const buf = await buildQuoteBuffer(baseQuote("marico_decor", [
      { kind: "item", name: "A", unit: "cái", quantity: 1, unitPrice: 100000 },
    ]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    // Khách chèn thêm hạng mục ở tít dưới, sau khối Tổng/VAT/Thành tiền.
    ws.getCell("C30").value = "Hạng mục khách thêm ở dưới";
    ws.getCell("E30").value = "cái";
    ws.getCell("F30").value = 5;
    ws.getCell("G30").value = 20000;
    const res = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    const sheet = res.sheets.find((s) => !s.skipped);
    expect(sheet.warnings.join(" ")).toMatch(/DƯỚI phần tổng/);
  });

  it("đọc HẾT bảng dài (không cắt bớt hạng mục)", async () => {
    const many = Array.from({ length: 600 }, (_, i) => ({
      kind: "item", name: `Hạng mục ${i + 1}`, unit: "cái", quantity: 1, unitPrice: 1000 + i,
    }));
    const { sheet } = await roundTrip("marico_decor", many);
    expect(sheet.items).toHaveLength(600);
    expect(sheet.items[599].unitPrice).toBe(1599);
  });
});
