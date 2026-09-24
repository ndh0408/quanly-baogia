// L45 — tên sheet chứa emoji dài hơn 31 ký tự bị cắt GIỮA cặp surrogate ⇒ tab hiện ký tự '�'.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `safeSheetName` (src/excel.ts) cắt bằng `.slice(0, 31)` theo đơn vị UTF-16. Emoji ngoài BMP chiếm
// 2 đơn vị, nên '🎉'×20 (dài 40) bị cắt ở vị trí 31 và để lại NỬA ĐẦU của cặp surrogate (0xD83C)
// đứng lẻ ở cuối. Ghi ra XML UTF-8 thì nửa lẻ đó thành U+FFFD: tab hiện '🎉…🎉�', và dòng tên trong
// sheet "Tổng Báo Giá" (cùng tên đó) cũng mang '�'. Hậu tố " (2)" của `uniq` cắt lại cùng kiểu.
// Tệp vẫn mở sạch, công thức tham chiếu vẫn đúng — lỗi hiển thị, hiếm gặp.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildQuoteBuffer, safeSheetName } from "../src/excel.js";

const EMOJI20 = "🎉".repeat(20);
const loiSurrogate = (s) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|�/.test(s);

function bg(...ten) {
  return {
    quoteNumber: "GN26L45", title: "Tên sheet emoji", toCompany: "Công ty ABC", vatPercent: 8, showTotals: true,
    city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"),
    sheets: ten.map((name, i) => ({ order: i + 1, name, template: { code: "marico_decor" }, items: [{ order: 0, kind: "item", name: "A", unit: "cái", quantity: 1, unitPrice: 1000 }] })),
  };
}
async function doc(buf) {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("xl/workbook.xml").async("string");
  const tenTab = [...xml.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const tong = wb.getWorksheet("Tổng Báo Giá");
  const dongTong = [];
  tong?.eachRow((row, r) => { if (r > 4) dongTong.push(String(row.getCell(2).value ?? "")); });
  return { tenTab, dongTong };
}

describe("L45: cắt tên sheet không bao giờ chẻ đôi emoji", () => {
  it("safeSheetName: '🎉'×20 → 15 emoji nguyên vẹn, ≤ 31 đơn vị UTF-16", () => {
    const s = safeSheetName(EMOJI20, "Sheet 1");
    expect(loiSurrogate(s), `còn nửa surrogate lẻ: ${JSON.stringify(s)}`).toBe(false);
    expect(s.length).toBeLessThanOrEqual(31);
    expect(s).toBe("🎉".repeat(15));
  });

  it("safeSheetName: chữ + emoji chạm đúng ranh giới 31 cũng không chẻ", () => {
    for (let k = 25; k <= 31; k++) {
      const s = safeSheetName(`${"a".repeat(k)}😀😀😀`, "Sheet 1");
      expect(loiSurrogate(s), `k=${k}: ${JSON.stringify(s)}`).toBe(false);
      expect(s.length).toBeLessThanOrEqual(31);
    }
  });

  it("cắt 31 để lại dấu nháy đơn cuối ('…x'y') — vẫn xuất được, tên không kết thúc bằng nháy", async () => {
    // Cùng bước cắt: nháy đơn đầu/cuối được lọc TRƯỚC khi cắt, nên cắt xong có thể lòi ra nháy cuối,
    // mà setter `ws.name` của ExcelJS NÉM với tên kết thúc bằng nháy → cả lần xuất trả 500.
    const ten = `${"x".repeat(30)}'y`;
    const s = safeSheetName(ten, "Sheet 1");
    expect(s.endsWith("'"), JSON.stringify(s)).toBe(false);
    const { tenTab } = await doc(await buildQuoteBuffer(bg(ten)));
    expect(tenTab[0]).toBe("x".repeat(30));
  });

  it("báo giá 1 sheet tên '🎉'×20: tab và dòng Tổng Báo Giá không có '�'", async () => {
    const { tenTab, dongTong } = await doc(await buildQuoteBuffer(bg(EMOJI20)));
    for (const t of tenTab) expect(loiSurrogate(t), `tab "${t}"`).toBe(false);
    expect(tenTab[0]).toBe("🎉".repeat(15));
    for (const d of dongTong) expect(loiSurrogate(d), `dòng Tổng "${d}"`).toBe(false);
  });

  it("nhiều sheet trùng tên emoji dài: đánh số + hậu tố ' (2)' vẫn không chẻ emoji", async () => {
    const { tenTab, dongTong } = await doc(await buildQuoteBuffer(bg(EMOJI20, EMOJI20, `x${EMOJI20}`)));
    expect(new Set(tenTab.map((t) => t.toLowerCase())).size).toBe(tenTab.length);
    for (const t of tenTab) {
      expect(loiSurrogate(t), `tab "${t}"`).toBe(false);
      expect(t.length).toBeLessThanOrEqual(31);
    }
    for (const d of dongTong) expect(loiSurrogate(d), `dòng Tổng "${d}"`).toBe(false);
  });
});
