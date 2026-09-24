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
import { parseTheoQuyUoc, suyQuyUocSo, khopQuyUoc, parseLooseDecimal, parseLooseNumber } from "../web/src/lib/clipboard.ts";

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

  it("ô SỐ THẬT không đổi gì", async () => {
    const s = await tep([[1, "Ghế", "cái", 1500, 50000, 75000000], [2, "Chiết khấu", "gói", 1, -500000, -500000]]);
    expect(s.items.map((i) => [i.quantity, i.unitPrice])).toEqual([[1500, 50000], [1, -500000]]);
  });
});
