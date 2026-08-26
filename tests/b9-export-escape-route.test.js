/**
 * ============================================================================
 * BÁO GIÁ LỚN PHẢI CÒN MỘT ĐƯỜNG XUẤT — và trần LƯU không được siết sau lưng dữ liệu đã có.
 *
 * ── HAI BẢN VÁ ĐÁNH NHAU ────────────────────────────────────────────────────
 * Ở commit d2f6f38, hai nhóm vá song song tạo ra một lỗ chung mà từng nhóm không thấy:
 *   · B2 thêm trần LƯU 20.000 dòng vào `quoteSheetsSchema` (src/validators.ts) để đóng mục
 *     "lưu được mà không xuất được".
 *   · B1 thêm trần XUẤT NỀN đúng 100 trang / 20.000 dòng vào src/worker.ts, với lý lẽ "hai đường
 *     xuất phải từ chối cùng một tập báo giá".
 *
 * Hợp lại:
 *   (a) Đường đồng bộ trả 413 kèm lời khuyên "vui lòng dùng xuất nền (async)" — mà đường nền nay
 *       từ chối ĐÚNG tập đó. Báo giá lớn hết đường tải về.
 *   (b) Trần lưu áp NGƯỢC lên dữ liệu ĐÃ CÓ: nó chưa từng tồn tại, nên báo giá 25.000 dòng lưu
 *       hợp lệ từ trước nay sửa một ký tự tiêu đề cũng không lưu nổi — kể cả để tách bớt trang,
 *       vì tách cũng là một lần Lưu.
 *
 * ── BẢN VÁ ĐÚNG ─────────────────────────────────────────────────────────────
 * Gỡ trần lưu; nâng trần đường nền lên đúng SỨC CHỨA CỦA ĐƯỜNG LƯU (60 × 1000 = 60.000). Khi đó
 * mọi báo giá LƯU ĐƯỢC đều XUẤT ĐƯỢC bằng đường nền, và lời khuyên trong 413 thành lời khuyên thật.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import {
  QuoteUpdateSchema, MAX_EXPORT_ITEMS, MAX_ASYNC_EXPORT_ITEMS,
  MAX_SAVE_SHEETS, MAX_SAVE_ITEMS_PER_SHEET, demSoDong,
} from "../src/validators.js";

const trang = (soDong, i = 0) => ({
  name: `Trang ${i + 1}`, order: i, templateId: 1,
  items: Array.from({ length: soDong }, (_, k) => ({ kind: "item", name: `HM ${k}`, quantity: 1, unitPrice: 1000 })),
});
const baoGia = (soTrang, soDongMoiTrang) => ({
  title: "Báo giá lớn",
  sheets: Array.from({ length: soTrang }, (_, i) => trang(soDongMoiTrang, i)),
});

describe("trần LƯU không được siết sau lưng dữ liệu đã có", () => {
  it("báo giá 25.000 dòng (vượt trần xuất đồng bộ) VẪN lưu được", () => {
    const b = baoGia(25, 1000);
    expect(demSoDong(b.sheets)).toBe(25_000);
    expect(demSoDong(b.sheets)).toBeGreaterThan(MAX_EXPORT_ITEMS);
    const r = QuoteUpdateSchema.safeParse(b);
    expect(r.success, `lưu bị chặn → chủ báo giá cũ mất quyền sửa dữ liệu của mình: ${JSON.stringify(r.error?.issues?.[0])}`).toBe(true);
  });

  it("sức chứa TỐI ĐA của đường lưu (60 × 1000) vẫn lưu được", () => {
    const b = baoGia(MAX_SAVE_SHEETS, MAX_SAVE_ITEMS_PER_SHEET);
    expect(demSoDong(b.sheets)).toBe(MAX_ASYNC_EXPORT_ITEMS);
    expect(QuoteUpdateSchema.safeParse(b).success).toBe(true);
  });

  // Các trần CẤU TRÚC vẫn còn — bản vá không được mở toang.
  it("vẫn chặn quá 60 trang", () => {
    const r = QuoteUpdateSchema.safeParse(baoGia(61, 1));
    expect(r.success).toBe(false);
  });

  it("vẫn chặn quá 1000 dòng trong MỘT trang", () => {
    const r = QuoteUpdateSchema.safeParse({ title: "x", sheets: [trang(1001)] });
    expect(r.success).toBe(false);
  });
});

describe("đường xuất NỀN phải nhận hết những gì lưu được", () => {
  it("trần đường nền ≥ sức chứa đường lưu — nếu không, 413 đang chỉ vào ngõ cụt", () => {
    expect(MAX_ASYNC_EXPORT_ITEMS).toBe(MAX_SAVE_SHEETS * MAX_SAVE_ITEMS_PER_SHEET);
    expect(MAX_ASYNC_EXPORT_ITEMS,
      "trần xuất nền không được bằng hay nhỏ hơn trần xuất đồng bộ — đó là bịt lối thoát duy nhất")
      .toBeGreaterThan(MAX_EXPORT_ITEMS);
  });

  it("processor xuất NỀN không từ chối báo giá 25.000 dòng", async () => {
    const { processors } = await import("../src/worker.js");
    const { QUEUES } = await import("../src/queue.js");
    // Không có báo giá trong CSDL → processor dừng ở "Không tìm thấy báo giá".
    // Điều cần chốt là nó KHÔNG dừng ở "Báo giá quá lớn": trần kích thước phải nằm trên 25.000.
    const loi = await processors[QUEUES.EXPORT].xlsx({ data: { quoteId: -1, requestedBy: 1 } }).catch((e) => e);
    expect(String(loi?.message)).not.toMatch(/quá lớn/);
  });

  it("thông điệp từ chối của đường nền KHÔNG khuyên điều làm không được", async () => {
    const src = await import("node:fs").then((m) => m.readFileSync("src/worker.ts", "utf8"));
    // Báo giá đã "converted"/"lost" thì canEdit trả false với MỌI người (src/quoteUtils.ts),
    // nên "tách bớt trang rồi xuất lại" là lời khuyên bất khả thi. Phải khuyên nhân bản trước.
    const m = /Báo giá quá lớn để xuất[^`]*/.exec(src);
    expect(m, "không tìm thấy thông điệp từ chối trong src/worker.ts").not.toBeNull();
    expect(m[0]).toMatch(/nhân bản/);
  });
});
