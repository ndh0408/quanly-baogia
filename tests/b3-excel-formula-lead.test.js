// B3 — `neutralizeFormula` (src/excel.ts) bỏ lọt chuỗi có KHOẢNG TRẮNG ĐỨNG TRƯỚC ký tự công thức.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Regex cũ là `/^[=+\-@\t\r]/` — neo cứng vào KÝ TỰ ĐẦU TIÊN. Một tên hạng mục gõ là
// `" =SUM(1+1)"` (một dấu cách rồi tới `=`) KHÔNG khớp, nên ô chữ đi thẳng vào file .xlsx
// gửi khách mà không được trung hoà. Tên hạng mục KHÔNG đi qua `clean()` (excel.ts:629/678/714
// truyền thẳng `it.name`), nên khoảng trắng đầu chuỗi sống sót tới lúc ghi ô.
//
// Vì sao khoảng trắng vẫn đáng chặn: chuỗi này không chỉ nằm trong .xlsx. Người dùng copy ô
// sang Google Sheets / dán vào một file .csv / một công cụ khác — phần lớn nơi đó CẮT khoảng
// trắng đầu trước khi quyết định "đây có phải công thức không". Trung hoà ở nguồn thì không
// phải đoán xem đầu nhận làm gì.
//
// ── VÒNG XUẤT → NHẬP ────────────────────────────────────────────────────────
// `cellText` (src/excelImport.ts) bóc dấu nháy bằng `/^'(?=[=+\-@\t\r])/`. Nếu chỉ sửa phía
// XUẤT thì `"' =SUM(1+1)"` không khớp lookahead → mỗi vòng xuất→nhập cộng thêm một dấu nháy
// vào tên hạng mục. Hai phía phải đổi CÙNG NHAU; bài `round-trip` dưới là chốt cho điều đó.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";

const TEN_CACH = " =SUM(1+1)";        // dấu cách rồi tới `=`
const TEN_NBSP = " +84 khuyến mãi"; // no-break space (dán từ Word rất hay ra ký tự này)
const TEN_THUONG = "Hạng mục bình thường";

function baoGia(over = {}) {
  return {
    quoteNumber: "GN26B3F", title: "Báo giá kiểm thử B3", toCompany: "Công ty ABC",
    toContact: "Anh A", toPhone: "0900000000", toAddress: "123 Đường X",
    vatPercent: 8, discount: 0, showTotals: true, city: "TP. Hồ Chí Minh",
    quoteDate: new Date("2026-06-13"), fromContact: "Chị B", fromTitle: "Sale",
    fromPhone: "0911111111", fromAddress: "456 Đường Y", greeting: "Xin gửi báo giá:",
    sheets: [{
      order: 1, name: "Trang 1", groupSubtotal: false, template: { code: "marico_decor" },
      items: [
        { kind: "item", name: TEN_CACH, detail: "", unit: "cái", quantity: 1, unitPrice: 1000, days: null, notes: "" },
        { kind: "item", name: TEN_NBSP, detail: "", unit: "cái", quantity: 1, unitPrice: 2000, days: null, notes: "" },
        { kind: "item", name: TEN_THUONG, detail: "", unit: "cái", quantity: 1, unitPrice: 3000, days: null, notes: "" },
      ],
    }],
    ...over,
  };
}

/** Mọi giá trị CHỮ trong sheet đầu (đọc lại từ file thật, không đọc biến trong bộ nhớ). */
async function chuTrongSheet(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = [];
  wb.worksheets[0].eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "string") out.push(cell.value);
    });
  });
  return out;
}

describe("neutralizeFormula: khoảng trắng đứng trước ký tự công thức", () => {
  it("tên bắt đầu bằng ' =' được trung hoà (không đi nguyên vào file gửi khách)", async () => {
    const texts = await chuTrongSheet(await buildQuoteBuffer(baoGia()));
    expect(texts, "tên hạng mục phải có mặt trong file").toContain(`'${TEN_CACH}`);
    expect(texts).not.toContain(TEN_CACH);
  });

  it("no-break space rồi tới '+' cũng được trung hoà", async () => {
    const texts = await chuTrongSheet(await buildQuoteBuffer(baoGia()));
    expect(texts).toContain(`'${TEN_NBSP}`);
    expect(texts).not.toContain(TEN_NBSP);
  });

  it("chữ thường KHÔNG bị thêm dấu nháy (không hồi quy)", async () => {
    const texts = await chuTrongSheet(await buildQuoteBuffer(baoGia()));
    expect(texts).toContain(TEN_THUONG);
    expect(texts).not.toContain(`'${TEN_THUONG}`);
  });

  it("ký tự công thức ở NGAY đầu vẫn được trung hoà như cũ", async () => {
    const q = baoGia();
    q.sheets[0].items = [{ kind: "item", name: "=1+1", detail: "", unit: "cái", quantity: 1, unitPrice: 1000, days: null, notes: "" }];
    const texts = await chuTrongSheet(await buildQuoteBuffer(q));
    expect(texts).toContain("'=1+1");
  });

  it("round-trip xuất→nhập KHÔNG cộng dồn dấu nháy (excelImport.cellText phải bóc được)", async () => {
    // ĐÃ ĐO: phía NHẬP cắt khoảng trắng hai đầu, nên tên quay về là bản đã trim — điều bài này
    // chốt KHÔNG phải khoảng trắng, mà là dấu nháy `'` không được sót lại trong tên.
    const res = await parseQuoteWorkbook(await buildQuoteBuffer(baoGia()));
    const ten = res.sheets.flatMap((s) => s.items.map((i) => i.name));
    expect(ten).toContain(TEN_CACH.trim());
    expect(ten).toContain(TEN_NBSP.trim());
    expect(ten.some((t) => t.startsWith("'"))).toBe(false);
  });
});
