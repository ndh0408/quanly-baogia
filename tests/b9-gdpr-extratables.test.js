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
 * ── BẢN VÁ ──────────────────────────────────────────────────────────────────
 * Giữ `extraTables`, cắt đúng khoá `paidProof` ở tầng ứng dụng, để lại `hasPaidProof` — cùng hình
 * dạng mà `stripExtraProofs` (src/quoteUtils.ts) và bản chụp phiên bản (src/quoteVersion.ts) dùng.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/services/gdprService.ts", "utf8");
/** Bỏ chú thích: phép kiểm dưới đây nói về MÃ CHẠY, không về văn bản giải thích. */
const boChuThich = SRC.split("\n").filter((d) => !/^\s*(\/\/|\*|\/\*)/.test(d)).join("\n");

describe("gdprService — không được vứt cả cột extraTables", () => {
  it("KHÔNG còn `omit: { extraTables: true }`", () => {
    expect(boChuThich, "cắt cả cột jsonb là cắt luôn bảng chi phí HCM/HN/phí khách của chính người xin")
      .not.toMatch(/omit:\s*\{\s*extraTables:\s*true\s*\}/);
  });

  it("vẫn cắt ẢNH: customerLogo và item.images bị bỏ như cũ", () => {
    expect(boChuThich).toMatch(/omit:\s*\{\s*customerLogo:\s*true\s*\}/);
    expect(boChuThich).toMatch(/omit:\s*\{\s*images:\s*true\s*\}/);
  });

  it("có hàm cắt riêng paidProof và nó được dùng trên đường xuất", () => {
    expect(boChuThich).toMatch(/function catAnhChungTu/);
    expect(boChuThich).toMatch(/extraTables:\s*catAnhChungTu\(/);
  });
});

// Hàm cắt là hàm THUẦN nên kiểm thẳng hành vi của nó, không cần CSDL.
describe("catAnhChungTu — giữ chữ/số, bỏ ảnh, để lại cờ", () => {
  // Nạp lại hàm bằng cách trích nguyên văn từ nguồn: nó không được export (chỉ dùng nội bộ), mà
  // export nó ra chỉ để test thì lại mở thêm bề mặt. Trích từ nguồn nên test luôn đọc bản mới nhất.
  const khop = /function catAnhChungTu\([\s\S]*?\n\}/.exec(SRC);
  // Không dùng `khop[0]` thẳng: trên bản CŨ (chưa có hàm này) nó là null và cả file test sập ở lúc
  // nạp module — đỏ thì đúng nhưng đọc không ra lý do. Ném một câu nói thẳng vấn đề.
  const catAnhChungTu = khop
    ?  
      new Function(`${khop[0].replace(/:\s*unknown/g, "").replace(/:\s*any/g, "")}; return catAnhChungTu;`)()
    : () => { throw new Error("src/services/gdprService.ts KHÔNG có hàm catAnhChungTu — extraTables vẫn đang bị vứt cả cột"); };

  const bang = (items) => [{ category: "hcm", name: "Chi phí HCM", items }];

  it("giữ nguyên mọi trường chữ/số của từng dòng", () => {
    const ra = catAnhChungTu(bang([
      { rid: "r1", kind: "item", name: "Thuê xe", detail: "4 chỗ", unit: "chuyến", quantity: 3, unitPrice: 500000, days: 2, notes: "ghi chú" },
    ]));
    const it0 = ra[0].items[0];
    for (const [k, v] of Object.entries({ rid: "r1", kind: "item", name: "Thuê xe", detail: "4 chỗ", unit: "chuyến", quantity: 3, unitPrice: 500000, days: 2, notes: "ghi chú" })) {
      expect(it0[k], `mất trường ${k} khỏi bản xuất GDPR`).toBe(v);
    }
    expect(ra[0].category).toBe("hcm");
    expect(ra[0].name).toBe("Chi phí HCM");
  });

  it("bỏ paidProof, để lại hasPaidProof", () => {
    const ra = catAnhChungTu(bang([
      { rid: "a", name: "X", paidProof: "data:image/png;base64,AAAA" },
      { rid: "b", name: "Y", paidProof: null },
    ]));
    expect(ra[0].items[0]).not.toHaveProperty("paidProof");
    expect(ra[0].items[0].hasPaidProof).toBe(true);
    expect(ra[0].items[1].hasPaidProof).toBe(false);
  });

  it("chịu được dữ liệu méo: null, không phải mảng, phần tử vô hướng", () => {
    expect(catAnhChungTu(null)).toBeNull();
    expect(catAnhChungTu(undefined)).toBeNull();
    expect(catAnhChungTu("chuỗi")).toBe("chuỗi");
    const ra = catAnhChungTu([null, 5, "x", { category: "hn", items: [null, 7, { name: "ok", paidProof: "d" }] }]);
    expect(ra[0]).toBeNull();
    expect(ra[3].items[2]).not.toHaveProperty("paidProof");
    expect(ra[3].items[2].hasPaidProof).toBe(true);
  });

  it("bảng không có items vẫn đi qua nguyên vẹn", () => {
    const ra = catAnhChungTu([{ category: "khach", name: "Phí KH" }]);
    expect(ra[0].category).toBe("khach");
  });
});
