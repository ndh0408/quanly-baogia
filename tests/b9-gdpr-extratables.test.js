/**
 * ============================================================================
 * BẢN XUẤT GDPR cắt mất DỮ LIỆU NGHIỆP VỤ, không chỉ cắt ảnh.
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────
 * src/services/gdprService.ts dùng `omit: { extraTables: true }`, và chú thích ngay trên đó khẳng
 * định "Mọi trường chữ/số của báo giá, sheet và hạng mục vẫn nguyên". Sai: `extraTables` là MỘT cột
 * jsonb, cắt nó là cắt cả nội dung — các bảng nội bộ Chi Phí HCM / Giá Hà Nội / Phí Khách Hàng,
 * gồm {name, detail, unit, quantity, unitPrice, days, notes} của từng dòng.
 *
 * Đó là dữ liệu do CHÍNH người xin bản xuất nhập vào báo giá của họ. Thứ thật sự không được đưa ra
 * chỉ là `paidProof` — ảnh uỷ nhiệm chi, chứng từ của công ty/người khác.
 *
 * ── BẢN VÁ ĐẦU CẮT Ở TẦNG JS. ĐÃ ĐỔI SANG SQL. ĐỌC KỸ TRƯỚC KHI "ĐƠN GIẢN HOÁ". ─────────────
 * Bản đầu của tôi giữ `extraTables` rồi map bỏ khoá `paidProof` bằng JS. Đúng về nội dung nhưng
 * SAI về chi phí, và tests/b5-gdpr-export-anh.test.js đo được ngay: ảnh vẫn đi qua dây rồi mới bị
 * bỏ — 2,4 MB thay vì 0,36 MB cho cùng bộ dữ liệu.
 *
 * Cách đúng: dùng lại `bangNoiBoTheoSheet` của src/services/quoteService.ts — câu SQL DUY NHẤT
 * trong repo cắt `paidProof` ngay tại CSDL. Viết bản thứ hai của quy tắc cắt ấy là mở đường cho
 * hai bản trôi khỏi nhau; chính chú thích của hàm đó đã nói vậy từ trước.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/services/gdprService.ts", "utf8");
/** Bỏ chú thích: phép kiểm dưới đây nói về MÃ CHẠY, không về văn bản giải thích. */
const boChuThich = SRC.split("\n").filter((d) => !/^\s*(\/\/|\*|\/\*)/.test(d)).join("\n");

describe("gdprService — giữ dữ liệu bảng nội bộ, và cắt ảnh Ở SQL", () => {
  it("KHÔNG tự viết bản cắt paidProof thứ hai bằng JS", () => {
    expect(boChuThich, "hai bản của quy tắc cắt sẽ trôi khỏi nhau — dùng lại bangNoiBoTheoSheet")
      .not.toMatch(/paidProof/);
  });

  it("dùng lại `bangNoiBoTheoSheet` — câu SQL duy nhất cắt paidProof", () => {
    expect(boChuThich).toMatch(/import\s*\{[^}]*bangNoiBoTheoSheet[^}]*\}\s*from\s*"\.\/quoteService\.js"/);
    expect(boChuThich).toMatch(/bangNoiBoTheoSheet\(/);
    // Và phải GẮN kết quả vào từng sheet, không phải gọi rồi vứt.
    expect(boChuThich).toMatch(/extraTables:\s*theoSheet\.get\(/);
  });

  it("vẫn KHÔNG kéo cột extraTables thô qua Prisma (ảnh nằm trong đó)", () => {
    expect(boChuThich, "bỏ omit là kéo cả ảnh chứng từ qua dây rồi mới vứt")
      .toMatch(/omit:\s*\{\s*extraTables:\s*true\s*\}/);
  });

  it("vẫn cắt ẢNH khác như cũ: customerLogo và item.images", () => {
    expect(boChuThich).toMatch(/omit:\s*\{\s*customerLogo:\s*true\s*\}/);
    expect(boChuThich).toMatch(/omit:\s*\{\s*images:\s*true\s*\}/);
  });

  it("bangNoiBoTheoSheet phải được EXPORT — nếu không gdprService không dùng lại được", async () => {
    const m = await import("../src/services/quoteService.js");
    expect(typeof m.bangNoiBoTheoSheet, "không export thì đường GDPR buộc phải chép lại câu SQL").toBe("function");
  });
});
