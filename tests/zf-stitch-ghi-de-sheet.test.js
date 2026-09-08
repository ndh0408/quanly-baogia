// GHÉP SHEET GHI ĐÈ CHÍNH TRANG 1 CỦA MẪU — chốt hồi quy (src/xlsxStitcher.ts).
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `baseSheetCount` được khởi tạo CỨNG bằng 1, rồi mỗi sheet ghép thêm lấy số kế tiếp và ghi vào
// `xl/worksheets/sheet${n}.xml`. Giả định ngầm: workbook nền luôn đặt worksheet ở `sheet1.xml`.
//
// Giả định đó SAI với mẫu đang dùng thật: `templates/Unibenfood.xlsx` đặt worksheet ở
// `xl/worksheets/sheet21.xml` (đo bằng `unzip -l`), và ExcelJS GIỮ NGUYÊN đường dẫn đó khi ghi lại
// (đo: load → writeBuffer → vẫn `sheet21.xml`) — nên buffer nền đưa vào stitcher cũng vậy.
//
// Hậu quả: sheet ghép thứ 20 nhận `newSheetNum = 21` → ghi đè `xl/worksheets/sheet21.xml`, tức
// GHI ĐÈ CHÍNH TRANG 1. Báo giá 21 sheet trở lên dùng mẫu Unibenfood gửi cho khách một file mà
// trang đầu không còn là trang đầu. Trần chặn xuất là 100 sheet (export.routes.ts) và chú thích ở
// src/app.ts còn nói rõ báo giá thật "tới 50 trang", nên 21 nằm gọn trong vùng dùng thật.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Lấy số sheet lớn nhất CÓ THẬT trong zip nền (đúng hàm `maxNumberInPath` mà chính file này đã
// dùng cho drawings/images) thay vì đoán bằng 1.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { stitchXlsxBuffers } from "../src/xlsxStitcher.js";

/** Workbook một sheet, nhưng worksheet nằm ở `sheet<n>.xml` — mô phỏng đúng mẫu Unibenfood. */
async function sheetTaiViTri(n, giaTri) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Nen").getCell("A1").value = giaTri;
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  if (n === 1) return buf;
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  zip.remove("xl/worksheets/sheet1.xml");
  zip.file(`xl/worksheets/sheet${n}.xml`, xml);
  // Trỏ lại rel của workbook sang tệp mới (giữ đúng hình dạng OOXML như mẫu thật).
  const relsPath = "xl/_rels/workbook.xml.rels";
  const rels = await zip.file(relsPath).async("string");
  zip.file(relsPath, rels.replace("worksheets/sheet1.xml", `worksheets/sheet${n}.xml`));
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

async function sheetThuong(giaTri) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("X").getCell("A1").value = giaTri;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("stitchXlsxBuffers — workbook nền KHÔNG đặt worksheet ở sheet1.xml", () => {
  it("mẫu nền ở sheet21.xml + 20 sheet ghép → KHÔNG sheet nào bị ghi đè", async () => {
    const SO_GHEP = 20; // sheet ghép thứ 20 chính là chỗ đụng sheet21.xml
    const bufs = [await sheetTaiViTri(21, "TRANG-1-GOC")];
    const ten = ["Trang1"];
    for (let i = 1; i <= SO_GHEP; i++) { bufs.push(await sheetThuong(`GHEP-${i}`)); ten.push(`S${i}`); }

    const out = await stitchXlsxBuffers(bufs, ten);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out);

    expect(wb.worksheets, "phải đủ 21 sheet").toHaveLength(SO_GHEP + 1);
    // Trước khi vá: ô này là "GHEP-20" — nội dung trang 21 đã đè lên trang 1.
    expect(wb.worksheets[0].getCell("A1").value, "TRANG 1 bị ghi đè bằng nội dung trang 21").toBe("TRANG-1-GOC");
    const thay = wb.worksheets.map((w) => w.getCell("A1").value);
    expect(new Set(thay).size, "mọi trang phải giữ nội dung RIÊNG, không trang nào trùng/mất").toBe(thay.length);
  }, 60_000);

  it("mẫu nền ở sheet1.xml (đường thường) vẫn ghép đúng — không phá ca đang chạy", async () => {
    const out = await stitchXlsxBuffers(
      [await sheetTaiViTri(1, "A"), await sheetThuong("B"), await sheetThuong("C")],
      ["S1", "S2", "S3"],
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out);
    expect(wb.worksheets.map((w) => w.getCell("A1").value)).toEqual(["A", "B", "C"]);
  }, 30_000);
});
