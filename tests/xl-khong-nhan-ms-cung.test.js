/**
 * ============================================================================
 * FILE XUẤT RA KHÔNG ĐƯỢC MANG DANH XƯNG NHÚNG CỨNG.
 *
 * ── LỖI ĐÃ THẤY TRÊN FILE THẬT ─────────────────────────────────────────────
 * `templates/Marico_Decor.xlsx` — file mà CẢ `marico_decor` LẪN `gn_banner` dùng — có hai Ô NHÃN
 * riêng chứa đúng chuỗi `"Ms."`: B3 (khối To) và E3 (khối From). Tên người đi vào C3 và F3, nên
 * hai ô nhãn đó KHÔNG BAO GIỜ bị ghi đè.
 *
 * Kết quả trên file khách nhận được, khi người dùng gõ "Mr. Tài" vào ô Người liên hệ:
 *     To:   CGV
 *     Ms.   Mr. Tài          ← vừa sai giới tính, vừa lặp danh xưng
 * Bên gửi y hệt: "Ms.  Lan Anh _ Account_0914291951".
 *
 * Danh xưng do NGƯỜI DÙNG TỰ GÕ vào ô Người liên hệ / Người gửi — họ biết khách là ai, template
 * thì không. Nên xoá nhãn, không đoán hộ.
 *
 * ── VÌ SAO BÀI NÀY XUẤT FILE THẬT, KHÔNG ĐỌC CẤU HÌNH ─────────────────────
 * Khẳng định cần chứng minh là "file khách nhận được không có chữ Ms.". Đọc
 * `extraCellsToClear` chỉ chứng minh cấu hình có ghi B3/E3 — nó KHÔNG chứng minh cơ chế xoá chạy,
 * chạy đúng ô, hay chạy trước khi ghi dữ liệu. Chỉ có mở file xuất ra mới trả lời được.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

/** Chữ trong một ô, gộp cả rich text. */
const chu = (v) =>
  v && typeof v === "object" && Array.isArray(v.richText)
    ? v.richText.map((x) => x.text).join("")
    : String(v ?? "");

/** Báo giá tối thiểu nhưng ĐỦ để đi qua đường xuất thật. */
const baoGia = (templateCode) => ({
  id: 1,
  quoteNumber: "GN26999",
  title: "Thử danh xưng",
  toCompany: "CGV",
  // ĐÚNG thứ người dùng gõ trong ảnh chụp lỗi.
  toContact: "Mr. Tài",
  fromContact: "Lan Anh",
  fromTitle: "Account",
  fromPhone: "0914291951",
  fromAddress: "34 Đào Trí, P.Phú Thuận, TP.HCM",
  city: "TP. Hồ Chí Minh",
  quoteDate: new Date("2026-09-14T00:00:00Z"),
  vatPercent: 8,
  hnTables: [],
  sheets: [
    {
      id: 1,
      name: "Banner",
      order: 1,
      templateCode,
      groupSubtotal: false,
      discount: 0,
      extraTables: [],
      items: [
        { order: 1, kind: "item", name: "Hạng mục thử", unit: "m2", quantity: 1, unitPrice: 100000 },
      ],
    },
  ],
});

/** Mở buffer vừa xuất, trả về sheet đầu tiên. */
async function moFile(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets[0];
}

describe("Không nhãn danh xưng nhúng cứng trong file xuất", () => {
  // `gn_banner` và `marico_decor` dùng CHUNG một file mẫu — phải kiểm cả hai, vì sửa cấu hình một
  // bên mà quên bên kia là đúng kiểu lỗi chỉ hiện ở một nửa số báo giá.
  for (const code of ["gn_banner", "marico_decor"]) {
    it(`${code}: ô nhãn B3/E3 RỖNG — không còn "Ms."`, async () => {
      const ws = await moFile(await buildQuoteBuffer(baoGia(code)));
      expect(chu(ws.getCell("B3").value).trim(), 'B3 vẫn mang nhãn "Ms." nhúng cứng').toBe("");
      expect(chu(ws.getCell("E3").value).trim(), 'E3 vẫn mang nhãn "Ms." nhúng cứng').toBe("");
    }, 120_000);

    it(`${code}: KHÔNG ô nào trong khối đầu trang chứa danh xưng trần`, async () => {
      // Quét rộng hơn hai ô đã biết: nếu ai đó đổi bố cục mẫu và nhãn dời sang ô khác, bài này vẫn
      // bắt được — còn phép kiểm B3/E3 ở trên thì không.
      const ws = await moFile(await buildQuoteBuffer(baoGia(code)));
      const xau = [];
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        if (r > 10) return;
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (/^\s*(Ms|Mr|Mrs)\.?\s*$/i.test(chu(cell.value))) xau.push(`${cell.address}="${chu(cell.value).trim()}"`);
        });
      });
      expect(xau, `còn ô danh xưng trần: ${xau.join(", ")}`).toEqual([]);
    }, 120_000);

    it(`${code}: tên NGƯỜI DÙNG GÕ vẫn nguyên vẹn — không bị xoá lây`, async () => {
      // Vế đối trọng: xoá nhãn là đúng, xoá luôn tên thì file thành vô dụng.
      const ws = await moFile(await buildQuoteBuffer(baoGia(code)));
      expect(chu(ws.getCell("C3").value), "mất tên người liên hệ").toContain("Mr. Tài");
      expect(chu(ws.getCell("F3").value), "mất thông tin người gửi").toContain("Lan Anh");
      expect(chu(ws.getCell("C2").value), "mất tên công ty khách").toContain("CGV");
    }, 120_000);
  }
});
