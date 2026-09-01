// §6 — SÁU VECTOR CHÈN CÔNG THỨC MÀ PROMPT NÊU ĐÍCH DANH.
//
// MASTER PROMPT §6 liệt kê chính xác sáu chuỗi phải có bài hồi quy:
//     =SUM(A1:A2) · +CMD · -1+2 · @SUM(A1:A2) · tab-prefix · CR-prefix
//
// ── TRẠNG THÁI TRƯỚC BÀI NÀY ────────────────────────────────────────────────
// `neutralizeFormula` (src/excel.ts) đã dùng regex `/^[\t\r]|^\s*[=+\-@]/` — tức đã PHỦ cả sáu.
// Nhưng bộ test chỉ dùng vector bắt đầu bằng `=` (tests/xp3-excel-cells.test.js dùng "=1+1",
// tests/b3-excel-formula-lead.test.js dùng "=SUM(...)"). `@`, tab và CR CHƯA từng là ĐẦU VÀO của
// bài nào — grep `'"@'` và `'\\t='` trên tests/ trả rỗng.
//
// Nghĩa là: ba nhánh của regex đó chưa bao giờ được chạy. Ai rút gọn nó thành `/^\s*[=+]/` cho
// "gọn" sẽ thấy bộ test vẫn xanh. Đây KHÔNG phải bài vá lỗi — là bài khoá một chốt đang có.
//
// ── ĐI QUA ĐƯỜNG XUẤT THẬT, KHÔNG GỌI HÀM TRỰC TIẾP ─────────────────────────
// `neutralizeFormula` không được export. Cố ý không export nó ra chỉ để test: bài gọi thẳng hàm
// chỉ chứng minh HÀM đúng, không chứng minh mọi đường ghi ô đều ĐI QUA nó — mà đó mới là lỗi đã
// từng xảy ra thật (xem đầu tests/xp3-excel-cells.test.js: `writeMerged` gán thẳng `cell.value`).
// Nên bài này dựng workbook bằng `buildQuoteBuffer` rồi đọc lại ô.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

// Sáu vector của §6, cộng vài biến thể sát sườn.
const VECTOR = [
  ["=SUM(A1:A2)", "công thức Excel kinh điển"],
  ["+CMD", "dấu + mở đầu — Excel vẫn coi là công thức"],
  ["-1+2", "dấu - mở đầu"],
  ["@SUM(A1:A2)", "@ mở đầu — cú pháp Lotus, Excel vẫn nhận"],
  ["\t=SUM(A1:A2)", "tab-prefix: Excel bỏ tab rồi coi phần sau là công thức"],
  ["\r=SUM(A1:A2)", "CR-prefix: y hệt tab"],
  [" =SUM(A1:A2)", "khoảng trắng rồi = (regex có \\s*)"],
  ["=cmd|' /C calc'!A0", "DDE — vector thực thi lệnh, không chỉ tính toán"],
];

function quoteVoi(ten) {
  return {
    quoteNumber: "GN26X9", title: "Báo giá kiểm chèn công thức", toCompany: "Công ty ABC",
    toContact: "Anh A", toPhone: "0900000000", toAddress: "123 Đường X",
    vatPercent: 8, discount: 0, showTotals: true, city: "TP. Hồ Chí Minh",
    quoteDate: new Date("2026-06-13"), fromContact: "Chị B", fromTitle: "Sale",
    fromPhone: "0911111111", fromAddress: "456 Đường Y", greeting: "Xin gửi báo giá:",
    sheets: [{
      order: 1, name: "Sheet 1", groupSubtotal: false, template: { code: "clofull_decor" },
      items: [
        { kind: "item", name: ten, detail: ten, unit: "cái", quantity: 2, unitPrice: 1_000_000, days: null, notes: ten },
      ],
    }],
  };
}

/** Mọi ô KIỂU CHỮ trong workbook. Trả [{sheet, ref, text}]. */
async function moiOChu(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ra = [];
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        const s = typeof v === "string" ? v : (v && typeof v === "object" && typeof v.richText === "undefined" && typeof v.text === "string" ? v.text : null);
        if (typeof s === "string" && s.length) ra.push({ sheet: ws.name, ref: cell.address, text: s });
      });
    });
  });
  return ra;
}

describe("§6 — sáu vector chèn công thức không được sống sót vào file gửi khách", () => {
  for (const [vec, vi] of VECTOR) {
    it(`${JSON.stringify(vec)} — ${vi}`, async () => {
      const buf = await buildQuoteBuffer(quoteVoi(vec));
      const o = await moiOChu(buf);

      // ── SO SÁNH PHẢI CHỊU ĐƯỢC CHUẨN HOÁ XUỐNG DÒNG CỦA XML ────────────
      // Đặc tả XML 1.0 §2.11 buộc bộ phân tích chuyển MỌI "\r" và "\r\n" trong nội dung văn bản
      // thành "\n". Nên vector CR-prefix ghi vào là "\r=SUM(...)" nhưng đọc lại từ file .xlsx
      // luôn ra "\n=SUM(...)". Đó là hành vi của XML, không phải lỗi của ứng dụng.
      // (Đo được: bản đầu của bài này so bằng `===` và bài CR-prefix đỏ với "không tìm thấy ô nào
      //  chứa vector" — tức chính chốt bảo hiểm của bài đã bắt được lỗi trong bài.)
      const chuan = (x) => x.replace(/\r\n?/g, "\n");
      const vecC = chuan(vec);
      const lienQuan = o.filter((c) => chuan(c.text) === vecC || chuan(c.text) === `'${vecC}`);
      expect(lienQuan.length, `không tìm thấy ô nào chứa vector — bài này đang không kiểm gì`).toBeGreaterThan(0);

      for (const c of lienQuan) {
        expect(
          c.text.startsWith("'"),
          `${c.sheet}!${c.ref} giữ nguyên ${JSON.stringify(c.text)} — Excel sẽ diễn giải thành CÔNG THỨC ở máy khách hàng`,
        ).toBe(true);
      }
    }, 60_000);
  }

  it("bảo hiểm: chữ BÌNH THƯỜNG không bị thêm dấu nháy oan", async () => {
    // Chiều chống-kêu-oan. Nếu ai đó siết regex thành "mọi chuỗi đều thêm '", mọi bài trên vẫn
    // xanh còn file gửi khách thì đầy dấu nháy. Bài này chặn đúng chuyện đó.
    const buf = await buildQuoteBuffer(quoteVoi("Ghế Tiffany trắng"));
    const o = await moiOChu(buf);
    const banh = o.filter((c) => c.text.startsWith("'"));
    expect(banh.map((c) => `${c.ref}=${c.text}`), "thêm dấu nháy vào chữ thường").toEqual([]);
  }, 60_000);

  it("KHÔNG ô chữ nào trong workbook bắt đầu bằng ký tự công thức chưa được vô hiệu hoá", async () => {
    // Quét TOÀN BỘ workbook thay vì chỉ ô ta biết — bắt cả những đường ghi ô mà bài trên không chạm.
    const buf = await buildQuoteBuffer(quoteVoi("@SUM(A1:A2)"));
    const o = await moiOChu(buf);
    const song = o.filter((c) => /^[\t\r]|^\s*[=+\-@]/.test(c.text));
    expect(song.map((c) => `${c.sheet}!${c.ref}=${JSON.stringify(c.text)}`), "ô công thức sống").toEqual([]);
  }, 60_000);
});
