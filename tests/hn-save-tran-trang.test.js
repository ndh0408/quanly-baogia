// TRẦN TRANG CỦA `PUT /api/quotes/:id/hn` PHẢI ĐI THEO TRẦN CỦA ĐƯỜNG LƯU — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `HnSaveSchema` (src/validators.ts) từng viết tay `.max(50, "Tối đa 50 trang")`, trong khi đường
// lưu báo giá cho `MAX_SAVE_SHEETS = 60`. Hai con số ở hai nơi thì sớm muộn cũng lệch, và lệch
// theo chiều này thì mất chức năng:
//
//   sale dựng và lưu một báo giá 55 trang  → OK (60 ≥ 55)
//   account Hà Nội mở đúng báo giá đó, điền phần HN của mình, bấm Lưu → 400 "Tối đa 50 trang"
//
// Người đó không có cách nào tự thoát: họ KHÔNG được sửa số trang của báo giá (chỉ có
// `quote:hn:fill`), và client gửi lên đủ mọi trang chứ không chỉ trang có bảng Hà Nội. Nghĩa là
// mọi báo giá 51–60 trang đều KHÔNG điền được phần Hà Nội — đúng cỡ báo giá mà trần 60 sinh ra
// để phục vụ.
//
// Bài này ghim hai điều: trần đúng bằng MAX_SAVE_SHEETS, và nó thật sự từ chối ở trang thứ 61.
import { describe, it, expect } from "vitest";
import { HnSaveSchema, MAX_SAVE_SHEETS } from "../src/validators.js";

const trang = (n) => ({ hnSheets: Array.from({ length: n }, (_, i) => ({ sheetId: i + 1, hnTables: [] })) });

describe("HnSaveSchema — trần số trang", () => {
  it(`nhận đủ ${MAX_SAVE_SHEETS} trang (bằng trần của đường lưu)`, () => {
    const r = HnSaveSchema.safeParse(trang(MAX_SAVE_SHEETS));
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
    expect(r.data.hnSheets).toHaveLength(MAX_SAVE_SHEETS);
  });

  it("trang thứ 61 bị từ chối (trần vẫn còn hiệu lực, không phải bỏ trần)", () => {
    const r = HnSaveSchema.safeParse(trang(MAX_SAVE_SHEETS + 1));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error.issues)).toMatch(new RegExp(`Tối đa ${MAX_SAVE_SHEETS} trang`));
  });

  it("KHÔNG được thấp hơn trần lưu — đó chính là lỗi cũ", () => {
    // 51 trang là con số nằm giữa trần cũ (50) và trần thật (60): bài này đỏ nếu ai đó hạ lại.
    expect(HnSaveSchema.safeParse(trang(51)).success).toBe(true);
  });
});
