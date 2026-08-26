// Cụm B2 — báo giá LƯU ĐƯỢC nhưng KHÔNG XUẤT ĐƯỢC.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Trần LƯU (src/validators.ts): 60 trang × 1000 dòng = 60.000 dòng.
// Trần XUẤT trực tiếp (src/routes/export.routes.ts): 100 trang, 20.000 dòng — vượt là 413 kèm lời
// khuyên "vui lòng dùng xuất nền (async)". Tức khoảng 20.001–60.000 dòng là vùng người dùng soạn
// xong, bấm Lưu thấy "Đã lưu", rồi bấm Xuất file thì nhận lỗi.
//
// ── BẢN VÁ ĐẦU ĐÃ SAI CHỖ. ĐÃ ĐỔI. ĐỌC KỸ TRƯỚC KHI "SỬA LẠI". ──────────────
// Bản đầu dời chốt LÊN lúc LƯU: chặn quá 20.000 dòng ngay ở schema. Vòng phản biện bác bỏ, và
// bác bỏ đúng: trần đó áp NGƯỢC lên dữ liệu ĐÃ CÓ. Nó chưa từng tồn tại, nên CSDL production có
// thể đang chứa báo giá 25.000 dòng lưu hợp lệ từ trước. Với chốt mới, chủ báo giá đó sửa MỘT ký
// tự tiêu đề rồi bấm Lưu là nhận lỗi xác thực — mất quyền sửa chính dữ liệu của mình, và không có
// đường tự thoát (tách bớt trang cũng là một lần Lưu, nên cũng bị chặn).
//
// Cách đóng ĐÚNG chỗ: để đường LƯU yên, và làm cho đường XUẤT NỀN thật sự nhận hết những gì lưu
// được (`MAX_ASYNC_EXPORT_ITEMS` = 60 × 1000 = 60.000, dùng ở src/worker.ts). Khi đó lời khuyên
// "vui lòng dùng xuất nền" trong thông điệp 413 mới là lời khuyên THẬT.
//
// CÒN LẠI, nói cho đủ: SPA chưa nối nút xuất nền (`grep -rn "/jobs" web/src` không ra kết quả), nên
// đường thoát hiện ở tầng API chứ chưa ở giao diện. Đã ghi vào docs/REMAINING_RISKS.md.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  QuoteCreateSchema, QuoteUpdateSchema,
  MAX_EXPORT_ITEMS, MAX_EXPORT_SHEETS, MAX_ASYNC_EXPORT_ITEMS, MAX_SAVE_SHEETS,
} from "../src/validators.js";

const dong = (i) => ({ kind: "item", name: `Hạng mục ${i}`, quantity: 1, unitPrice: 1000 });
const trang = (soDong) => ({ templateId: 1, name: "Trang", items: Array.from({ length: soDong }, (_, i) => dong(i + 1)) });

const baoGia = (soTrang, soDong) => ({
  title: "Báo giá thử", toCompany: "Khách thử", companyId: 1, vatPercent: 8,
  sheets: Array.from({ length: soTrang }, () => trang(soDong)),
});

const loi = (fn) => { try { fn(); return null; } catch (e) { return e; } };

describe("đường LƯU không được siết ngược lên dữ liệu đã có", () => {
  it("21.000 dòng (vượt trần xuất ĐỒNG BỘ) VẪN phải lưu được", () => {
    expect(loi(() => QuoteCreateSchema.parse(baoGia(21, 1000))),
      "chặn ở đây là khoá chủ báo giá cũ ra khỏi chính dữ liệu của họ").toBeNull();
    expect(loi(() => QuoteUpdateSchema.parse(baoGia(21, 1000))),
      "đường SỬA còn quan trọng hơn: không sửa được thì cũng không tách bớt trang được").toBeNull();
  });

  it("sức chứa TỐI ĐA (60 × 1000) vẫn lưu được", () => {
    const ok = QuoteCreateSchema.parse(baoGia(MAX_SAVE_SHEETS, 1000));
    expect(ok.sheets.reduce((n, s) => n + s.items.length, 0)).toBe(MAX_ASYNC_EXPORT_ITEMS);
  });

  it("báo giá cỡ thật (3 trang × 40 dòng) không hề bị đụng tới", () => {
    const ok = QuoteCreateSchema.parse(baoGia(3, 40));
    expect(ok.sheets.length).toBe(3);
    expect(ok.sheets[0].items.length).toBe(40);
    expect(QuoteUpdateSchema.parse({ title: "Chỉ đổi tiêu đề" }).sheets).toBeUndefined();
  });
});

describe("các trần CẤU TRÚC vẫn còn — gỡ trần dòng không phải là mở toang", () => {
  it("vẫn chặn quá 60 trang", () => {
    expect(loi(() => QuoteCreateSchema.parse(baoGia(MAX_SAVE_SHEETS + 1, 1)))).not.toBeNull();
  });

  it("vẫn chặn quá 1000 dòng trong MỘT trang", () => {
    expect(loi(() => QuoteCreateSchema.parse({ ...baoGia(1, 1), sheets: [trang(1001)] }))).not.toBeNull();
  });
});

describe("hai đường xuất không được chồng lên nhau", () => {
  it("trần xuất NỀN phải phủ trọn sức chứa của đường lưu", () => {
    expect(MAX_ASYNC_EXPORT_ITEMS).toBeGreaterThanOrEqual(MAX_SAVE_SHEETS * 1000);
    expect(MAX_ASYNC_EXPORT_ITEMS,
      "bằng trần đồng bộ = bịt nốt lối thoát mà chính thông điệp 413 chỉ tới").toBeGreaterThan(MAX_EXPORT_ITEMS);
  });

  it("trần TRANG khi lưu (60) vẫn nằm dưới trần trang khi xuất đồng bộ (100)", () => {
    expect(MAX_EXPORT_SHEETS).toBeGreaterThanOrEqual(MAX_SAVE_SHEETS);
  });

  it("export.routes KHÔNG được khai lại hai con số — phải import từ validators", () => {
    // Kiểm trên MÃ NGUỒN vì hai hằng số nằm ở hai module và không có đường chạy nào so được chúng
    // với nhau: nạp export.routes.ts trong test kéo theo cả hàng đợi xuất + rate limiter.
    const src = readFileSync(new URL("../src/routes/export.routes.ts", import.meta.url), "utf8");
    expect(src, "khai lại hằng số ở đây là mở đường cho trần lưu và trần xuất trôi khỏi nhau")
      .not.toMatch(/const\s+MAX_EXPORT_(ITEMS|SHEETS)\s*=/);
    expect(src).toMatch(/import\s*\{[^}]*MAX_EXPORT_ITEMS[^}]*\}\s*from\s*"\.\.\/validators\.js"/);
  });

  it("worker KHÔNG được khai lại con số — phải import từ validators", () => {
    const src = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
    expect(src, "chép tay hằng số sang worker là cách hai đường xuất trôi khỏi nhau lần nữa")
      .toMatch(/import\s*\{[^}]*MAX_ASYNC_EXPORT_ITEMS[^}]*\}\s*from\s*"\.\/validators\.js"/);
  });
});
