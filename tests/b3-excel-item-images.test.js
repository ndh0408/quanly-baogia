// B3 — cột HÌNH ẢNH: chiều cao hàng tính theo SỐ ẢNH KHAI, không theo số ảnh NHÚNG ĐƯỢC.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `insertItemImages` (src/excel.ts) đặt `n = list.length` rồi kéo `row.height` lên `n` tầng
// TRƯỚC khi biết ảnh nào nhúng được. Hai loại ảnh bị bỏ ngay sau đó:
//   • định dạng ExcelJS không nhúng (regex chỉ nhận png/jpe?g/gif — .webp thì `continue`),
//     mà src/validators.ts:132 và web/src/components/GridTable.tsx:89 ĐỀU cho phép webp;
//   • ảnh vượt `MAX_ITEM_IMG_BYTES`.
// Kết quả trong file gửi khách: hàng bị kéo cao gấp 2–3 lần (mỗi tầng ≈ 74px) trong khi ô ảnh
// TRỐNG — một khoảng trắng lớn giữa bảng báo giá, không ai thấy lỗi ở đâu.
//
// Bài này chốt CHIỀU CAO HÀNG chứ không chốt "webp có nhúng được không": việc nhúng webp cần
// một bộ chuyển mã (dự án không có sharp/jimp trong package.json) hoặc phải tin rằng Excel của
// khách hỗ trợ WebP — không đo được ở đây.
import { describe, it, expect, beforeAll } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

// WebP 1x1 thật (RIFF....WEBP) — đúng thứ validators cho lưu.
const WEBP = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/vuUAAA=";
// PNG 1x1 thật.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const TEN = "Hạng mục có ảnh";

function baoGia(images) {
  return {
    quoteNumber: "GN26B3I", title: "Báo giá kiểm thử ảnh", toCompany: "Công ty ABC",
    toContact: "Anh A", toPhone: "0900000000", toAddress: "123 Đường X",
    vatPercent: 8, discount: 0, showTotals: true, city: "TP. Hồ Chí Minh",
    quoteDate: new Date("2026-06-13"), fromContact: "Chị B", fromTitle: "Sale",
    fromPhone: "0911111111", fromAddress: "456 Đường Y", greeting: "Xin gửi báo giá:",
    sheets: [{
      order: 1, name: "Trang 1", groupSubtotal: false, showImages: true, template: { code: "marico_decor" },
      items: [{ kind: "item", name: TEN, detail: "", unit: "cái", quantity: 1, unitPrice: 1000, days: null, notes: "", images }],
    }],
  };
}

/** Chiều cao (pt) của hàng chứa hạng mục, đọc lại từ file thật. */
async function chieuCaoHang(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  let h = null;
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "string" && cell.value.includes(TEN)) h = row.height ?? 0;
    });
  });
  return { h, media: wb.model.media || [] };
}

describe("insertItemImages: chiều cao hàng theo ảnh NHÚNG ĐƯỢC", () => {
  // File mẫu .xlsx đã có sẵn ảnh của CHÍNH công ty (đo được: 1 ảnh) — nên mọi phép đếm ảnh
  // dưới đây so với NỀN này chứ không so với 0.
  let nen = 0;
  beforeAll(async () => { nen = (await chieuCaoHang(await buildQuoteBuffer(baoGia([])))).media.length; });

  it("toàn ảnh .webp (không nhúng được) → KHÔNG kéo cao hàng", async () => {
    const { h, media } = await chieuCaoHang(await buildQuoteBuffer(baoGia([WEBP, WEBP, WEBP])));
    expect(h, "không tìm thấy hàng hạng mục").not.toBeNull();
    // 3 tầng × (74+6)px × 0,75 = 180pt nếu đếm nhầm. Ngưỡng 100pt tách hẳn hai trường hợp.
    expect(h, `hàng cao ${h}pt trong khi KHÔNG có ảnh nào nhúng được`).toBeLessThan(100);
    expect(media.length - nen, "không ảnh nào được thêm vào file").toBe(0);
  });

  it("1 png + 2 webp → cao đúng 1 tầng, và png vẫn được nhúng", async () => {
    const { h, media } = await chieuCaoHang(await buildQuoteBuffer(baoGia([PNG, WEBP, WEBP])));
    // 1 tầng: box 74px + 6 = 80px → 60pt. Đếm nhầm 3 tầng thì ra 180pt.
    expect(h).toBeLessThan(100);
    expect(media.length - nen).toBe(1);
  });

  it("3 ảnh png hợp lệ → vẫn kéo cao đủ 3 tầng (không hồi quy)", async () => {
    const { h, media } = await chieuCaoHang(await buildQuoteBuffer(baoGia([PNG, PNG, PNG])));
    expect(h).toBeGreaterThan(100);
    expect(media.length - nen).toBe(3);
  });
});
