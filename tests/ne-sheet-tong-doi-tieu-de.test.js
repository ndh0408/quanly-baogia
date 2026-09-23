// Soát toàn diện L50 — sheet "Tổng Báo Giá" do app sinh chỉ được nhận ra nhờ chữ ở ô A1. Khách đổi
// tiêu đề ("TỔNG HỢP BÁO GIÁ") hoặc chèn một hàng logo lên đầu là luật bỏ qua trượt: hàng
// "STT | Hạng mục | Thành tiền (VNĐ)" đủ điều kiện làm hàng tiêu đề nên sheet tổng thành sheet DỮ
// LIỆU — mỗi sheet con thành một hạng mục 0đ, mẫu đoán GN kể cả tệp Colorfull; modal mặc định "Thay
// toàn bộ" nên tạo thêm sheet rác, hoặc ĐÈ lên một sheet GN chưa được ghép.
//   ĐÃ ĐO: [F5] đổi tiêu đề / chèn 1 hàng trên cùng: skipped=undefined · items=[["item","Décor",0]]
//          · mẫu đoán=marico_decor
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";

const baoGia = (code) => ({
  quoteNumber: "GN26L50", title: "Sheet tổng", toCompany: "Cty", vatPercent: 8, showTotals: true, city: "HCM",
  quoteDate: new Date("2026-08-01T00:00:00Z"), fromContact: "S",
  sheets: ["Décor", "Banner"].map((name, i) => ({ order: i + 1, name, groupSubtotal: false, template: { code }, items: [
    { kind: "item", name: `Backdrop ${name}`, unit: "m2", quantity: 2, unitPrice: 250000 },
  ] })),
});

async function tep(code, sua) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(baoGia(code)));
  const tong = wb.worksheets[wb.worksheets.length - 1];
  expect(tong.name).toBe("Tổng Báo Giá");
  sua(tong);
  return parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
}

const SUA = {
  "đổi tiêu đề A1": (ws) => { ws.getCell("A1").value = "TỔNG HỢP BÁO GIÁ"; },
  "chèn 1 hàng logo lên đầu": (ws) => { ws.spliceRows(1, 0, ["Logo công ty khách"]); },
  "đổi tiêu đề + dán giá trị đè công thức": (ws) => {
    ws.getCell("A1").value = "BẢNG TỔNG";
    ws.eachRow((row) => row.eachCell((c) => { if (c.value && typeof c.value === "object" && "formula" in c.value) c.value = c.value.result ?? null; }));
  },
};

describe("L50: sheet 'Tổng Báo Giá' vẫn bị bỏ qua khi khách đổi tiêu đề / chèn hàng", () => {
  for (const code of ["clofull_decor", "marico_decor"]) {
    for (const [ten, sua] of Object.entries(SUA)) {
      it(`${code} · ${ten}`, async () => {
        const res = await tep(code, sua);
        const tong = res.sheets.find((s) => s.name === "Tổng Báo Giá");
        expect(tong.skipped, "sheet tổng bị nạp thành sheet hạng mục 0đ").toBeTruthy();
        // Hai sheet dữ liệu vẫn nạp bình thường.
        const doc = res.sheets.filter((s) => !s.skipped);
        expect(doc.map((s) => s.items.map((i) => [i.kind, i.name, i.unitPrice]))).toEqual([
          [["item", "Backdrop Décor", 250000]], [["item", "Backdrop Banner", 250000]],
        ]);
      });
    }
  }

  it("tệp ngoài chỉ có STT | Hạng mục | Thành tiền (số thường, tên tab khác) vẫn được nạp", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Báo giá");
    ws.addRow(["STT", "Hạng mục", "Thành tiền"]);
    ws.addRow([1, "Trọn gói sự kiện", 12000000]);
    ws.addRow([2, "Vận chuyển", 800000]);
    const res = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(res.sheets[0].skipped).toBeUndefined();
    expect(res.sheets[0].items.map((i) => i.name)).toEqual(["Trọn gói sự kiện", "Vận chuyển"]);
  });
});
