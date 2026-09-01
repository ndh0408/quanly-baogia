// TÊN SHEET do người dùng gõ làm HỎNG hoặc CHẶN HẲN việc xuất Excel — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `src/excel.ts` đặt tên tab như sau:
//     const baseName = sheet.name || cfg.sheetName || `Sheet ${idx + 1}`;
//     const labeled  = sheets.length > 1 ? `${idx+1}. ${baseName}`.replace(/[[\]/\\?*:]/g,"").substring(0,31) : baseName;
//     ws.name = uniq(labeled);
// Nhánh **một sheet** dùng tên THÔ — không lọc, không cắt. Nhưng setter `ws.name` của ExcelJS
// (node_modules/exceljs/lib/doc/worksheet.js:140-170) NÉM lỗi với:
//     ký tự  * ? : \ / [ ]  ·  dấu nháy đơn ở ĐẦU hoặc CUỐI  ·  chuỗi rỗng  ·  đúng chữ "History"
// và chỉ CẢNH BÁO rồi cắt 31 ký tự.
//
// `src/validators.ts` (sheetSchema) chỉ có `z.string().max(120)` — không lọc ký tự nào. Nên một
// cái tên hoàn toàn bình thường trong ngành như **"Booth/Backdrop"** đi thẳng vào setter và ném.
// `src/routes/export.routes.ts` không bọc try/catch → asyncHandler → **500 kèm thông báo tiếng
// Anh**, người dùng chỉ thấy "Lỗi server" và KHÔNG xuất được file. Không có cách nào tự sửa ngoài
// việc đoán ra là tại tên sheet.
//
// Ca >31 ký tự còn tệ hơn vì nó KHÔNG báo lỗi. ExcelJS cắt tên TRONG BỘ NHỚ, nhưng
// `sheetNames.push(displayName)` đẩy tên THÔ (chưa cắt) vào mảng, rồi
// `src/xlsxStitcher.ts:284` `renameSheet(wb, 1, sheetNames[0])` GHI ĐÈ lại `xl/workbook.xml`
// bằng đúng tên thô đó. File tải về mở lên là Excel đòi "sửa chữa".
//
// Nhánh NHIỀU sheet cũng chưa an toàn: `.replace()` không bỏ dấu nháy nên tên kết thúc bằng `'`
// vẫn ném, và `uniq()` nối `" (2)"` SAU khi đã cắt 31 nên lại vượt.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildQuoteBuffer } from "../src/excel.js";

const item = { kind: "item", name: "Hạng mục", detail: "", unit: "cái", quantity: 1, unitPrice: 1_000_000, days: null, notes: "" };

/** Báo giá tối thiểu với N sheet, tên do bài test đặt. */
const bg = (...tenSheet) => ({
  quoteNumber: "GN26NAME", title: "Báo giá kiểm tên sheet", toCompany: "Công ty ABC",
  toContact: "Anh A", toPhone: "0900000000", toAddress: "123 Đường X",
  vatPercent: 8, discount: 0, showTotals: false, city: "TP. Hồ Chí Minh",
  quoteDate: new Date("2026-06-13"), fromContact: "Chị B", fromTitle: "Sale",
  fromPhone: "0911111111", fromAddress: "456 Đường Y", greeting: "Xin gửi báo giá:",
  sheets: tenSheet.map((name, i) => ({ order: i + 1, name, groupSubtotal: false, template: { code: "marico_decor" }, items: [item] })),
});

/** Tên tab THẬT trong file tải về — đọc từ `xl/workbook.xml`, KHÔNG qua ExcelJS.
 *  Cố ý đọc XML thô: xlsxStitcher ghi đè tên SAU khi ExcelJS đã ghi buffer, nên chỉ có
 *  đọc ở mức zip mới thấy được thứ Excel thật sự đọc. */
async function tenTabThat(buf) {
  const xml = await (await JSZip.loadAsync(buf)).file("xl/workbook.xml").async("string");
  return [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => m[1]);
}

const CAM = /[*?:/\\[\]]/;

describe("tên sheet do người dùng gõ không được làm hỏng file xuất", () => {
  // MỘT sheet — nhánh trước đây dùng tên THÔ, không lọc gì.
  it.each([
    ["Booth/Backdrop", "dấu gạch chéo — tên rất thường gặp trong ngành"],
    ["Sảnh A: Sân khấu", "dấu hai chấm"],
    ["Backdrop [chính]", "ngoặc vuông"],
    ["Hạng mục *ưu tiên*", "dấu sao"],
    ["Cần bao nhiêu?", "dấu hỏi"],
    ["'Khu VIP'", "dấu nháy đơn ở đầu và cuối"],
    ["History", "tên bị Excel giữ chỗ"],
    ["   ", "chỉ toàn khoảng trắng"],
  ])("MỘT sheet tên %j (%s) → vẫn xuất được", async (ten) => {
    const buf = await buildQuoteBuffer(bg(ten));   // trước khi vá: ném → HTTP 500
    expect(Buffer.isBuffer(buf) && buf.length > 2000).toBe(true);

    const [tab] = await tenTabThat(buf);
    expect(tab, "tên tab không được chứa ký tự Excel cấm").not.toMatch(CAM);
    expect(tab.length, "Excel giới hạn 31 ký tự").toBeLessThanOrEqual(31);
    expect(tab.trim().length, "không được rỗng / toàn khoảng trắng").toBeGreaterThan(0);
    expect(/^'|'$/.test(tab), "không được bắt đầu/kết thúc bằng dấu nháy đơn").toBe(false);
    expect(tab).not.toBe("History");

    // File phải mở lại được bằng chính thư viện đọc xlsx.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.length).toBeGreaterThan(0);
  });

  it("MỘT sheet tên 45 ký tự → tên trong workbook.xml PHẢI đã cắt (đây là ca hỏng ÂM THẦM)", async () => {
    const dai = "Backdrop sân khấu chính hội nghị thường niên 2026";   // 48 ký tự
    const buf = await buildQuoteBuffer(bg(dai));
    const [tab] = await tenTabThat(buf);
    // Trước khi vá: ExcelJS cắt trong bộ nhớ, nhưng xlsxStitcher.renameSheet ghi đè lại bằng tên
    // THÔ → workbook.xml giữ nguyên 48 ký tự → Excel báo file hỏng, đòi sửa chữa.
    expect(tab.length).toBeLessThanOrEqual(31);
    expect(dai.startsWith(tab.trim()) || tab.length === 31).toBe(true);
  });

  it("NHIỀU sheet: lọc + đánh số + cắt, kể cả khi phải thêm hậu tố chống trùng", async () => {
    const buf = await buildQuoteBuffer(bg("Booth/A", "Booth/A", "Sảnh: B"));
    const tabs = await tenTabThat(buf);
    expect(tabs.length).toBe(3);
    for (const t of tabs) {
      expect(t, `"${t}" chứa ký tự cấm`).not.toMatch(CAM);
      expect(t.length, `"${t}" dài ${t.length} > 31`).toBeLessThanOrEqual(31);
    }
    expect(new Set(tabs).size, "tên tab phải duy nhất").toBe(3);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.length).toBe(3);
  });

  it("NHIỀU sheet tên dài + trùng nhau → hậu tố chống trùng KHÔNG được đẩy quá 31", async () => {
    const dai = "Backdrop sân khấu chính hội nghị thường niên";
    const buf = await buildQuoteBuffer(bg(dai, dai, dai));
    const tabs = await tenTabThat(buf);
    for (const t of tabs) expect(t.length, `"${t}" dài ${t.length}`).toBeLessThanOrEqual(31);
    expect(new Set(tabs).size).toBe(3);
  });

  it("tên bình thường vẫn giữ NGUYÊN VĂN — không lỡ tay đục tên đang dùng tốt", async () => {
    const [tab] = await tenTabThat(await buildQuoteBuffer(bg("Banner ngoài trời")));
    expect(tab).toBe("Banner ngoài trời");
  });
});
