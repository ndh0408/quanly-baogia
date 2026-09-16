// TRẦN SỐ DÒNG TRONG WORKBOOK — chặn TRƯỚC khi exceljs nạp.
//
// ── VÌ SAO CÓ BÀI NÀY ───────────────────────────────────────────────────────
// ĐÃ TÁI HIỆN được sập tiến trình trên dev THẬT: đẩy một file .xlsx 8,79 MB (DƯỚI trần upload
// 10 MB) chứa 2 sheet × 200.000 dòng → nhân hệ điều hành ghi
//     oom-kill … Killed process (node) anon-rss 1.529.596 kB
// tức CẢ APP SẬP cho MỌI người, vì MỘT người tải lên một file.
//
// ── VÀ VÌ SAO TRẦN THEO BYTE KHÔNG ĐỦ ───────────────────────────────────────
// Chính file đó chỉ bung ra 33,9 MB — DƯỚI XA trần 200 MB của `MAX_UNCOMPRESSED` — vì exceljs gom
// mọi chuỗi trùng vào `sharedStrings.xml`, nên 400.000 dòng giống nhau gần như không tốn byte.
// Byte sau giải nén vì thế KHÔNG tỉ lệ với chi phí bộ nhớ; số DÒNG thì có.
//
// ── HAI BẢN VÁ TRƯỚC ĐỀU KHÔNG ĐỦ, ĐỀU ĐÃ ĐO ───────────────────────────────
//     cắt SAU vòng quét trong excelImport   → đỉnh RSS 1.887 MB (vẫn bị giết)
//     cắt NGAY TRONG vòng quét              → đỉnh RSS 1.239 MB (vẫn chạm trần trên dev)
//     chặn ở đây, TRƯỚC `wb.xlsx.load()`    → đỉnh RSS    66 MB, từ chối trong 257 ms
// Phần đắt nhất nằm ở `wb.xlsx.load()`: exceljs dựng TOÀN BỘ workbook thành đối tượng JS trước
// khi một dòng mã nào của repo này chạy. Muốn chặn thì phải chặn trước lúc trao buffer cho nó.
import { describe, it, expect } from "vitest";
import { inspectXlsx } from "../src/zipSafety.js";
import ExcelJS from "exceljs";

/** Dựng workbook thật bằng chính exceljs — không giả lập cấu trúc zip. */
async function dungFile(soSheet, soDong, daiTen = 60) {
  const wb = new ExcelJS.Workbook();
  const ten = "H".repeat(daiTen);
  for (let s = 0; s < soSheet; s++) {
    const ws = wb.addWorksheet(`S${s + 1}`);
    ws.addRow(["STT", "Hạng Mục", "ĐVT", "Số Lượng", "Đơn Giá", "Thành Tiền"]);
    const lo = [];
    for (let i = 0; i < soDong; i++) {
      lo.push([i + 1, ten, "cái", 1, 1000, 1000]);
      if (lo.length === 5000) { ws.addRows(lo); lo.length = 0; }
    }
    if (lo.length) ws.addRows(lo);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("inspectXlsx — trần số dòng", () => {
  it("TỪ CHỐI file 2 sheet × 200.000 dòng — đúng file đã giết tiến trình trên dev", async () => {
    const buf = await dungFile(2, 200_000, 1000);
    // Dưới trần tải lên 10 MB: chốt chặn kích thước file KHÔNG đỡ được ca này.
    expect(buf.length, `file ${(buf.length / 1048576).toFixed(2)} MB`).toBeLessThan(10 * 1024 * 1024);

    const dinhTruoc = process.memoryUsage().rss;
    const v = await inspectXlsx(buf);
    const dinhSau = process.memoryUsage().rss;

    expect(v.ok, "phải TỪ CHỐI — nhận là tiến trình chết").toBe(false);
    expect(v.reason).toMatch(/quá nhiều dòng/i);
    // Và phải từ chối RẺ: nếu nó giải nén trọn rồi mới nghĩ thì chính phép kiểm là đường OOM.
    const tonThem = (dinhSau - dinhTruoc) / 1048576;
    expect(tonThem, `phép kiểm tự nó ngốn thêm ${tonThem.toFixed(0)} MB`).toBeLessThan(400);
  }, 180_000);

  it("NHẬN file hợp lệ LỚN NHẤT có thể nạp: 30 sheet × 1.000 dòng", async () => {
    // MAX_SHEETS × MAX_ITEMS_PER_SHEET của src/excelImport.ts — không được chặn nhầm mức này.
    const v = await inspectXlsx(await dungFile(30, 1000));
    expect(v.ok, `bị chặn nhầm: ${v.ok ? "" : v.reason}`).toBe(true);
  }, 180_000);

  it("NHẬN file cỡ thực tế: 9 sheet × 366 dòng", async () => {
    const v = await inspectXlsx(await dungFile(9, 366));
    expect(v.ok, `bị chặn nhầm: ${v.ok ? "" : v.reason}`).toBe(true);
  }, 120_000);

  it("đếm dòng KHÔNG được hụt khi thẻ <row bị cắt ngang ranh giới chunk", async () => {
    // Luồng inflate trả dữ liệu theo chunk; một thẻ `<row` có thể nằm vắt qua hai chunk. Nếu bộ
    // đếm không giữ đuôi chunk trước thì nó đếm hụt — và hụt đúng ở file NHIỀU CHUNK nhất, tức
    // đúng những file cần chặn. File 150.000 dòng chắc chắn đi qua rất nhiều chunk.
    const v = await inspectXlsx(await dungFile(3, 50_000));
    expect(v.ok, "150.000 dòng phải bị chặn — nếu lọt là bộ đếm hụt ở ranh giới chunk").toBe(false);
    expect(v.reason).toMatch(/quá nhiều dòng/i);
  }, 180_000);
});
