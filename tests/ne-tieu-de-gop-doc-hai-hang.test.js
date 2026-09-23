// Soát toàn diện L52 — tệp ngoài có hàng TIÊU ĐỀ cao 2 hàng (mỗi ô gộp dọc 3:4, rất hay gặp trong
// báo giá VN). findHeaderRow lấy hàng 3; hàng 4 (nửa dưới vùng gộp) bị quét như dữ liệu: ExcelJS trả
// giá trị ô chủ cho ô phụ, cellAt chỉ loại ô gộp NGANG, nên hàng 4 có STT="STT", ĐVT="ĐVT", Ghi chú=
// "Ghi chú"; ô Hạng Mục gộp dọc với hàng trên → kind="sub" → một dòng rác đứng đầu danh sách nạp.
//   ĐÃ ĐO: [{"row":4,"kind":"sub","name":"","unit":"ĐVT","notes":"Ghi chú"},{"row":5,"kind":"item","name":"Backdrop",…}]
// Biến thể tiêu đề 2 TẦNG ("Đơn giá" gộp ngang, chia "Vật tư | Nhân công"): chỉ lấy cột con đầu →
// Đơn Giá 200.000 thay vì 250.000 (có cảnh báo dòng) — cần thêm cảnh báo cấp sheet nói rõ vì sao.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseQuoteWorkbook } from "../src/excelImport.js";

async function doc(dung) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Báo giá");
  ws.getCell("A1").value = "BÁO GIÁ THI CÔNG";
  dung(ws);
  return (await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).sheets[0];
}

describe("L52: hàng tiêu đề gộp dọc 2 hàng", () => {
  it("nửa dưới ô tiêu đề gộp dọc KHÔNG thành dòng rác", async () => {
    const s = await doc((ws) => {
      ws.getRow(3).values = ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá (VNĐ)", "Thành tiền (VNĐ)", "Ghi chú"];
      for (let c = 1; c <= 7; c++) ws.mergeCells(3, c, 4, c);
      ws.getRow(5).values = [1, "Backdrop", "m2", 12, 250000, 3000000, ""];
      ws.getRow(6).values = [2, "Standee", "cái", 2, 300000, 600000, "giao trước"];
    });
    expect(s.skipped).toBeUndefined();
    expect(s.items.map((i) => i.name), "dòng rác (ĐVT='ĐVT', Ghi chú='Ghi chú') đứng đầu danh sách").toEqual(["Backdrop", "Standee"]);
    expect(s.items.map((i) => i.kind)).toEqual(["item", "item"]);
    expect(s.firstRow).toBe(5);
  });

  it("tiêu đề 2 TẦNG (Đơn giá chia Vật tư | Nhân công) → cảnh báo cấp sheet nói rõ chỉ đọc cột con đầu", async () => {
    const s = await doc((ws) => {
      ws.getRow(3).values = ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá", "", "Thành tiền"];
      ws.getRow(4).values = ["", "", "", "", "Vật tư", "Nhân công", ""];
      for (const c of [1, 2, 3, 4, 7]) ws.mergeCells(3, c, 4, c);
      ws.mergeCells("E3:F3");
      ws.getRow(5).values = [1, "Backdrop", "m2", 12, 200000, 50000, 3000000];
    });
    expect(s.items.map((i) => i.name)).toEqual(["Backdrop"]);
    expect(s.warnings.join(" | ")).toMatch(/Đơn Giá.*nhiều cột con/);
  });

  it("tiêu đề MỘT hàng bình thường: không cảnh báo tiêu đề nhiều tầng, không bỏ dòng nào", async () => {
    const s = await doc((ws) => {
      ws.getRow(3).values = ["STT", "Hạng mục", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền"];
      ws.getRow(4).values = [1, "Backdrop", "m2", 12, 250000, 3000000];
      ws.mergeCells("B5:B6");
      ws.getRow(5).values = [2, "Standee", "cái", 2, 300000, 600000];
      ws.getRow(6).values = ["", "", "cái", 1, 100000, 100000];
    });
    expect(s.items.map((i) => i.kind)).toEqual(["item", "item", "sub"]);
    expect(s.warnings.join(" | ")).not.toMatch(/nhiều cột con/);
  });
});
