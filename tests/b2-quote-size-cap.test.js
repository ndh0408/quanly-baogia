// Cụm B2 — báo giá LƯU ĐƯỢC nhưng KHÔNG XUẤT ĐƯỢC.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Trần LƯU (src/validators.ts): 60 trang × 1000 dòng = 60.000 dòng.
// Trần XUẤT trực tiếp (src/routes/export.routes.ts): 100 trang, 20.000 dòng — vượt là 413 kèm lời
// khuyên "vui lòng dùng xuất nền (async)". Nhưng SPA React KHÔNG có nút nào gọi đường xuất nền
// (`grep -rn "/jobs" web/src` không ra kết quả — nó chỉ mở thẳng /api/export/:id.xlsx|pdf), và
// đường ấy còn tự tắt khi không có hàng đợi (`export_async_unavailable`). Tức khoảng 20.001–60.000
// dòng là vùng người dùng soạn xong, bấm Lưu thấy "Đã lưu", rồi bấm Xuất file thì nhận một lỗi kèm
// lời khuyên không bấm được ở đâu cả — công đã bỏ ra không có đường lấy lại thành file.
//
// ── VÁ ──────────────────────────────────────────────────────────────────────
// Dời chốt chặn LÊN lúc LƯU và lấy CHUNG một cặp số với trần xuất (validators.MAX_EXPORT_ITEMS,
// export.routes import lại chứ không khai lại). Hỏng sớm, ngay tại thao tác gây ra, kèm câu nói rõ
// phải làm gì. Bài test này khoá cả hai nửa: schema từ chối, và hai con số không được trôi khỏi nhau.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { QuoteCreateSchema, QuoteUpdateSchema, MAX_EXPORT_ITEMS, MAX_EXPORT_SHEETS } from "../src/validators.js";

const dong = (i) => ({ kind: "item", name: `Hạng mục ${i}`, quantity: 1, unitPrice: 1000 });
const trang = (soDong) => ({ templateId: 1, name: "Trang", items: Array.from({ length: soDong }, (_, i) => dong(i + 1)) });

/** Báo giá đúng `soTrang` trang, mỗi trang `soDong` dòng. */
const baoGia = (soTrang, soDong) => ({
  title: "Báo giá thử", toCompany: "Khách thử", companyId: 1, vatPercent: 8,
  sheets: Array.from({ length: soTrang }, () => trang(soDong)),
});

const loi = (fn) => { try { fn(); return null; } catch (e) { return e; } };

describe("Trần LƯU phải nằm trong trần XUẤT", () => {
  it("21 trang × 1000 dòng (21.000 > 20.000) — KHÔNG lưu được, kèm lời nhắc tách báo giá", () => {
    const e = loi(() => QuoteCreateSchema.parse(baoGia(21, 1000)));
    expect(e, "báo giá 21.000 dòng vẫn lưu được ⇒ vẫn còn vùng lưu-được-mà-không-xuất-được").not.toBeNull();
    const thongDiep = e.issues.map((i) => i.message).join(" | ");
    expect(thongDiep).toContain("không xuất được file");
    expect(thongDiep).toContain("tách bớt");
    // Cùng một chốt chặn phải áp cho cả đường SỬA, không chỉ đường TẠO.
    expect(loi(() => QuoteUpdateSchema.parse(baoGia(21, 1000)))).not.toBeNull();
  });

  it("đúng trần (20.000 dòng) thì vẫn lưu được — chốt chặn không lấn vào vùng hợp lệ", () => {
    const ok = QuoteCreateSchema.parse(baoGia(20, 1000));
    expect(ok.sheets.length).toBe(20);
    expect(ok.sheets.reduce((n, s) => n + s.items.length, 0)).toBe(MAX_EXPORT_ITEMS);
  });

  it("báo giá cỡ thật (3 trang × 40 dòng) không hề bị đụng tới", () => {
    const ok = QuoteCreateSchema.parse(baoGia(3, 40));
    expect(ok.sheets.length).toBe(3);
    expect(ok.sheets[0].items.length).toBe(40);
    // Đường SỬA cũng vậy, và vẫn cho phép bỏ hẳn `sheets` (chỉ đổi tiêu đề chẳng hạn).
    expect(QuoteUpdateSchema.parse({ title: "Chỉ đổi tiêu đề" }).sheets).toBeUndefined();
  });

  it("trần TRANG khi lưu (60) vẫn nằm dưới trần trang khi xuất", () => {
    expect(MAX_EXPORT_SHEETS).toBeGreaterThanOrEqual(60);
    expect(loi(() => QuoteCreateSchema.parse(baoGia(61, 1)))).not.toBeNull();
  });

  it("export.routes KHÔNG được khai lại hai con số — phải import từ validators", () => {
    // Kiểm trên MÃ NGUỒN vì hai hằng số nằm ở hai module và không có đường chạy nào so được chúng
    // với nhau: nạp export.routes.ts trong test kéo theo cả hàng đợi xuất + rate limiter.
    const src = readFileSync(new URL("../src/routes/export.routes.ts", import.meta.url), "utf8");
    expect(src, "khai lại hằng số ở đây là mở đường cho trần lưu và trần xuất trôi khỏi nhau")
      .not.toMatch(/const\s+MAX_EXPORT_(ITEMS|SHEETS)\s*=/);
    expect(src).toMatch(/import\s*\{[^}]*MAX_EXPORT_ITEMS[^}]*\}\s*from\s*"\.\.\/validators\.js"/);
  });
});
