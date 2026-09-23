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
import { parseTheoQuyUoc, suyQuyUocSo } from "../web/src/lib/clipboard.ts";

const HDR = ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền"];
async function tep(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Báo giá ngoài");
  ws.addRow(["BÁO GIÁ"]); ws.addRow([]);
  ws.addRow(HDR);
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

  it("ô SỐ THẬT không đổi gì", async () => {
    const s = await tep([[1, "Ghế", "cái", 1500, 50000, 75000000], [2, "Chiết khấu", "gói", 1, -500000, -500000]]);
    expect(s.items.map((i) => [i.quantity, i.unitPrice])).toEqual([[1500, 50000], [1, -500000]]);
  });
});
