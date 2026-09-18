// REGRESSION-LOCK cho Excel xuất khách: build nhiều quote (đủ mẫu + cấu trúc), ĐỌC LẠI workbook +
// snapshot semantic (giá trị + numFmt + bold + fill từng ô) → hash. KHÔNG hash bytes thô (xlsx có
// timestamp → flaky). Hash phải KHỚP golden → mọi thay đổi output Excel (kể cả refactor) sẽ làm test ĐỎ.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import crypto from "node:crypto";
import { buildQuoteBuffer } from "../src/excel.js";

function q(over = {}) {
  return {
    quoteNumber: "GN26SNAP", title: "Báo giá snapshot", toCompany: "Công ty Kiểm Thử",
    toContact: "Anh Test", toEmail: "t@test.vn", toPhone: "0900000000", toAddress: "123 Đường X, Q.7",
    vatPercent: 8, discount: 0, showTotals: true, city: "TP. Hồ Chí Minh",
    quoteDate: new Date("2026-06-13"), executionDate: new Date("2026-06-20"),
    fromContact: "Chị Sale", fromTitle: "Trưởng phòng", fromPhone: "0911111111", fromAddress: "456 Đường Y",
    greeting: "Xin trân trọng gửi báo giá:", ...over,
  };
}
const sheet = (items, over = {}) => ({ order: 1, name: "Sheet 1", groupSubtotal: false, template: { code: "marico_decor" }, items, ...over });
const item = (o) => ({ kind: "item", name: "Hạng mục", detail: "", unit: "cái", quantity: 1, unitPrice: 1000000, days: null, notes: "", ...o });

// Các quote phủ: mẫu GN-không-ngày, GN-có-ngày, CLF, nhóm/nhóm-con/info, days, discount, groupSubtotal.
const CASES = {
  "gn-nodate-simple": q({ sheets: [sheet([item({ name: "A" }), item({ name: "B", quantity: 2, unitPrice: 500000 })])] }),
  "gn-withdate": q({ sheets: [sheet([item({ name: "Có ngày", days: 3, quantity: 2, unitPrice: 300000 })], { template: { code: "unibenfood" } })] }),
  "clf": q({ sheets: [sheet([item({ name: "CLF item", detail: "chi tiết CLF" })], { template: { code: "clofull_decor" } })] }),
  "groups": q({ sheets: [sheet([
    { kind: "section", name: "NHÓM A", quantity: 1 },
    item({ name: "A1" }), item({ name: "A2", quantity: 3 }),
    { kind: "subsection", name: "Nhóm con", quantity: 1 },
    item({ name: "Con 1", unitPrice: 200000 }),
    { kind: "info", name: "Dòng thông tin (không tính tiền)" },
  ], { groupSubtotal: true })] }),
  // Discount ở MỨC SHEET → khối tổng dài ra 2 hàng: Cộng / Discount / Tổng Cộng / VAT / Thành Tiền.
  "discount": q({ sheets: [sheet([item({ name: "X", quantity: 2, unitPrice: 2000000 })], { discount: 150000 })] }),
  // Chỉ MỘT trong nhiều sheet có Discount — sheet kia phải giữ NGUYÊN khối 3 hàng như cũ.
  "discount-multi": q({ sheets: [
    sheet([item({ name: "Có giảm", quantity: 2, unitPrice: 2000000 })], { name: "Banner", discount: 150000 }),
    sheet([item({ name: "Không giảm" })], { order: 2, name: "Standee" }),
  ] }),
  // Nhiều sheet: tab Excel đánh số "1. …/2. …" + tiêu đề mỗi sheet nối tên sheet ("… - Banner").
  "multi-sheet": q({ sheets: [
    sheet([item({ name: "Banner item" })], { name: "Banner" }),
    sheet([item({ name: "Standee item", quantity: 2, unitPrice: 500000 })], { order: 2, name: "Standee" }),
  ] }),
  // 1 sheet KHÔNG đặt tên: tiêu đề KHÔNG nối tên sheet (giữ logic gốc).
  "single-noname": q({ sheets: [sheet([item({ name: "X" })], { name: "" })] }),
};

async function snapshot(quote) {
  const buf = await buildQuoteBuffer(quote);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const dump = [];
  wb.eachSheet((ws) => {
    const cells = [];
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const v = cell.value;
        const val = v && typeof v === "object" ? (v.result ?? v.formula ?? v.richText?.map((t) => t.text).join("") ?? JSON.stringify(v)) : v;
        cells.push([r, c, String(val ?? ""), cell.numFmt || "", cell.font?.bold ? "B" : "", cell.fill?.fgColor?.argb || ""]);
      });
    });
    dump.push([ws.name, cells]);
  });
  return crypto.createHash("sha256").update(JSON.stringify(dump)).digest("hex").slice(0, 16);
}

describe("Excel xuất khách — REGRESSION LOCK (semantic snapshot)", () => {
  for (const [name, quote] of Object.entries(CASES)) {
    it(`giữ NGUYÊN output: ${name}`, async () => {
      const h = await snapshot(quote);
      // Golden hash sinh từ excel.ts (lần đầu in ra để chốt). Đổi output = test ĐỎ.
      //
      // ── LẦN ĐỔI HASH CÓ CHỦ Ý: 2026-09-17 ─────────────────────────────────
      // `templates/Marico_Decor.xlsx` có hai Ô NHÃN nhúng cứng chữ "Ms." (B3 khối To, E3 khối
      // From). Tên người đi vào C3/F3 nên hai ô đó không bao giờ bị ghi đè — file khách nhận được
      // luôn ghi "Ms." dù thực tế là ai ("Ms.  Mr. Tài"). Nay chúng bị xoá lúc xuất
      // (`extraCellsToClear`, src/templateConfigs.ts); danh xưng do người dùng tự gõ.
      //
      // TRƯỚC KHI CẬP NHẬT HASH, đã đối chiếu nội dung ô của bản CŨ và bản MỚI: khác biệt đúng
      // HAI dòng — `B3 "Ms."` và `E3 "Ms."` biến mất, 63 ô còn 61, không gì khác. Cập nhật một
      // golden hash mà không đối chiếu là tự tay vô hiệu hoá chính chốt chặn này.
      //
      // ── LẦN ĐỔI HASH CÓ CHỦ Ý: 2026-09-17 (mẫu CÓ NGÀY) ───────────────────
      // CHỈ fixture `gn-withdate` đổi — nó là fixture duy nhất dùng mẫu có-ngày. Bảy fixture còn
      // lại giữ nguyên hash, tức bản không-ngày / banner / CLF không bị đụng.
      //
      // Mẫu có-ngày chuyển từ `templates/Unibenfood.xlsx` sang `templates/GN_CoNgay.xlsx` (dựng
      // từ nền không-ngày). ĐÃ ĐỐI CHIẾU TỪNG Ô trước khi đổi hash — bản CŨ để lọt:
      //   · DÒNG TIÊU ĐỀ TRÙNG ở r10 (r11 mới là hàng thật);
      //   · HẠNG MỤC CỦA MỘT BÁO GIÁ KHÁCH KHÁC còn sót trong file mẫu: "Đá lạnh mỗi ngày",
      //     "Thùng rác, túi rác, găn tay nilong…", "Vận chuyển hàng sampling đến Emart",
      //     "Phí quản lý", "* Lấy hàng tại Emart" — đi vào MỌI file có-ngày gửi khách;
      //   · ba công thức tổng trỏ RA NGOÀI bảng: =G25*E25 · =H26*8% · =SUM(H26:H27).
      // 100 ô → 70 ô. Đối chiếu lại bất cứ lúc nào: node scripts/so-o-mau-co-ngay.mjs
      //
      // ── LẦN ĐỔI HASH CÓ CHỦ Ý: 2026-09-18 (Colorfull hiện cột Chi Tiết) ───
      // CHỈ fixture `clf` đổi — nó là fixture duy nhất dùng mẫu Colorfull. Bảy fixture còn lại giữ
      // nguyên hash, tức ba mẫu GN không bị đụng (yêu cầu: "Chi Tiết chỉ của Colorfull").
      //
      // ĐÃ ĐỐI CHIẾU TỪNG Ô trước khi đổi hash — khác biệt đúng BỐN ô trên 69, không gì khác:
      //     C4  "Hạng Mục [gộp→C4]"   →  "Hạng Mục"        (nhả phần gộp sang D)
      //     D4  "Hạng Mục [gộp→C4]"   →  "Chi Tiết"        (ô tiêu đề có sẵn trong file mẫu)
      //     C6  "CLF item [gộp→C6]"   →  "CLF item"
      //     D6  "CLF item [gộp→C6]"   →  "chi tiết CLF"    (nội dung Chi Tiết ra đúng cột)
      //   bề rộng: C 38→21, D 10→50 (đúng số trong file mẫu).
      // Tổng cộng / VAT / Thành Tiền / ngày / chân trang: KHÔNG một ô nào đổi.
      //
      // ── LẦN ĐỔI HASH CÓ CHỦ Ý: 2026-09-18 lần 2 (xoá tên người ký nhúng cứng) ──
      // Vẫn CHỈ fixture `clf` đổi. ĐÃ ĐỐI CHIẾU TỪNG Ô: khác ĐÚNG MỘT ô trên 90 —
      //     Sheet 1!G16  "Trần Thị Lan Anh"  →  (trống)
      // Ô đó là tên người ký NHÚNG CỨNG trong `templates/CLF_KhongNgay.xlsx` (G22 ở toạ độ mẫu),
      // không có đường nào ghi đè, nên mọi báo giá Colorfull ra file khách với tên một người cụ
      // thể đứng chỗ ký trong khi người gửi thật nằm ở khối F1. Cùng lớp lỗi với nhãn "Ms." mà
      // nhánh GN đã vá. Nay nằm trong `extraCellsToClear`.
      // Khối `palette.note` thêm cùng lượt KHÔNG đổi ô nào ở đây — fixture này không có
      // `quote.notes`, và nhánh ghi chú chỉ ghi khi có nội dung.
      expect({ [name]: h }).toMatchSnapshot();
    });
  }
});
