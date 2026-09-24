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
      //
      // ── LẦN ĐỔI HASH CÓ CHỦ Ý: 2026-09-22 (bố cục Colorfull theo nếp GN) ────
      // Vẫn CHỈ fixture `clf`. ĐÃ ĐỐI CHIẾU TỪNG Ô: khác 17 ô trên 79, và tất cả đều là thứ người
      // dùng yêu cầu sau khi đặt hai file cạnh nhau:
      //   · hàng tiêu đề + cạnh trái/phải bảng: viền 'thin' → 'medium' (GN vốn có khung ngoài dày,
      //     Colorfull thì không — bảng trông mỏng hơn hẳn);
      //   · C3/D3/E3: khối "Kính gửi" nay phủ C3:I3 và canh giữa, sau khi bỏ ô giữ chỗ logo khách;
      //   · C11: câu "* Ghi chú: - Tất cả các hạng mục…" NHÚNG CỨNG trong file mẫu biến mất — nay
      //     ô đó chỉ in khi người dùng bật ô "Thêm Ghi chú" (fixture này không bật).
      // Bề rộng C 21→34 và D 50→30 không hiện trong snapshot (nó chụp giá trị + style từng ô).
      //
      // ── LẦN ĐỔI HASH CÓ CHỦ Ý: 2026-09-22 lần 2 (sửa theo ảnh chụp của người dùng) ──
      // Vẫn CHỈ fixture `clf`. Ba thay đổi, tất cả do người dùng xem file thật rồi chốt:
      //   · BỎ dòng "(Số://…)  Chân thành cảm ơn…" khỏi dải trên bảng — dải đó nay chỉ in khi báo
      //     giá THẬT SỰ có dòng thông tin chương trình, không có thì ẨN HÀNG;
      //   · khung ngoài DỪNG ở hàng hạng mục cuối. Kéo tới hết khối tổng để lại hai vạch dọc lơ
      //     lửng ở cột đầu/cuối và một ô rỗng có viền bên dưới bảng — người dùng khoanh đỏ đúng
      //     hai chỗ đó trong ảnh chụp;
      //   · khối tổng có khung riêng (trái hộp nhãn · phải ô tiền · đáy hàng cuối), đúng như GN.
      //
      // ── LẦN ĐỔI HASH CÓ CHỦ Ý: 2026-09-18 lần 3 (đồng bộ trình bày CLF với GN) ──
      // Vẫn CHỈ fixture `clf` đổi. Bản mới in mã tra cứu + lời chào ở B5, đưa khối Kính gửi vào
      // C3:I3, thu nhãn tổng về F:G và xoá ghi chú nhúng cứng khi người dùng không bật ghi chú.
      // Các bất biến tương ứng (kể cả mở lại file, merge không chồng, khung ngoài và bề rộng cột)
      // được kiểm chi tiết ở `cf-colorfull-cot-chi-tiet.test.js`; cả cụm Excel 129 bài đã xanh.
      //
      // ── LẦN ĐỔI HASH CÓ CHỦ Ý: 2026-09-23 (bảng màu Colorfull mới) ─────────
      // Vẫn CHỈ fixture `clf`. ĐÃ ĐỐI CHIẾU TỪNG Ô: khác 25 ô trên 109, TẤT CẢ chỉ là màu —
      // giá trị, định dạng số, chữ đậm không đổi ô nào:
      //   · B2:I2 dải tiêu đề   theme8/t0.4 → nền FF9CCDC9 · chữ FF243139
      //   · B4:I4 tiêu đề cột   theme8/t0.4 → FF9DCCC9
      //   · F7:H9 khối tổng     theme8/t0.4 → FF9DCCC9
      // Màu lấy từ tệp mẫu người dùng chỉnh lại sáng 2026-09-23 (xem scripts/doi-mau-clf.mjs).
      //
      // ── LẦN ĐỔI HASH CÓ CHỦ Ý: 2026-09-23 lần 2 (sheet Tổng Báo Giá của Colorfull) ──
      // Vẫn CHỈ fixture `clf`. ĐÃ ĐỐI CHIẾU TỪNG Ô: khác 12 ô trên 109, TẤT CẢ ở sheet "Tổng Báo
      // Giá" và chỉ là màu nền — A4:C4 tiêu đề + A6:C8 khối tổng: FFFFCC99 → FFF4CFB0 (người dùng
      // chốt bằng ảnh chụp: cùng màu hàng nhóm Colorfull). Giá trị, định dạng số, chữ đậm giữ nguyên.
      //
      // ── ĐỔI CÓ CHỦ Ý NHƯNG HASH KHÔNG ĐỔI: 2026-09-24 (chiều cao hàng, soát toàn diện đợt 3) ──
      // Bản chụp này KHÔNG chụp chiều cao hàng (cũng không chụp căn lề), nên đợt nới chiều cao dưới
      // đây không làm đổi hash nào. Không ô nào đổi giá trị; chiều cao hàng đổi theo từng commit:
      //   · 1d — so TOÀN BỘ chiều cao hàng + giá trị/căn lề/cỡ chữ từng ô của 72 sheet (6 mẫu ×
      //     có/không cột ảnh × tiêu đề ngắn/dài) trước và sau RIÊNG commit này: khác đúng hai loại
      //     hàng, không ô nào đổi —
      //       GN (marico_decor / unibenfood / gn_banner), hàng 7 tiêu đề một dòng: 17,5 → 18,75pt;
      //       Colorfull (cả ba mẫu), hàng 4 tiêu đề cột: 25 → 34,5pt ("THÀNH TIỀN" xuống hai dòng).
      //     Chốt riêng: tests/xl-cao-hang-tieu-de-cot.test.js.
      //   · 1b — ô chữ cỡ 12 của Colorfull tính 15,75pt mỗi dòng: hàng 3 khối "Kính gửi" và hàng 5
      //     dải thông tin chương trình (khi có chữ) cao thêm.
      //   · 1a (chữ tổ hợp NFD hết tính gấp đôi) và 1c (tiêu đề sát ngưỡng một dòng không còn bật
      //     wrap) — chỉ đổi hàng có loại chữ đó; fixture ở đây không có.
      // Tính CẢ ĐỢT (gốc 2f591e0 → sau đợt 3), các fixture ở đây đổi: GN hàng 7 (mọi fixture GN) và
      // `clf` HAI hàng — hàng 3 "Kính gửi" 78 → 81,75pt (1b) và hàng 4 25 → 34,5pt (1d).
      //
      // ── ĐỔI CÓ CHỦ Ý NHƯNG HASH KHÔNG ĐỔI: 2026-09-24 (soát toàn diện đợt 4 d4-excel 1) ──
      // HE_SO_TIEU_DE nâng lên (cỡ 14: 1,045 · cỡ 18: 1,025): chỉ tiêu đề DÀI sát ngưỡng đổi căn lề
      // (wrap) và chiều cao hàng tiêu đề. Tiêu đề các fixture ở đây ngắn nên không đổi gì.
      expect({ [name]: h }).toMatchSnapshot();
    });
  }
});
