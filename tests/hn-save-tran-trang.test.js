// TRẦN SỐ BẢNG CỦA `PUT /api/quotes/:id/hn` — chốt hồi quy.
//
// ── LỖI CŨ (giữ lại lý lẽ, vì bẫy y hệt vẫn còn) ────────────────────────────
// `HnSaveSchema` từng viết tay `.max(50, "Tối đa 50 trang")` trong khi đường lưu báo giá cho
// `MAX_SAVE_SHEETS = 60`. Hai con số ở hai nơi thì sớm muộn cũng lệch, và lệch theo chiều đó thì
// MẤT CHỨC NĂNG: sale lưu báo giá 55 trang → account Hà Nội mở đúng báo giá ấy, điền phần HN,
// bấm Lưu và nhận 400 "Tối đa 50 trang". Họ không có cách nào tự thoát vì không được sửa số trang.
//
// ── ĐỔI HÌNH DẠNG 2026-09-15 ────────────────────────────────────────────────
// Bảng Hà Nội lên CẤP BÁO GIÁ (`Quote.hnTables`) nên payload không còn theo trang: `hnSheets[]`
// thành `hnTables[]` phẳng, và trần đếm SỐ BẢNG chứ không phải số trang. Trần cũ theo trang là 20
// bảng/trang × 60 trang; gộp về một mảng mà giữ 20 là HẠ trần thật — đó là lý do `MAX_HN_TABLES`
// bám vào `MAX_SAVE_SHEETS` chứ không phải một con số viết tay thứ hai.
import { describe, it, expect } from "vitest";
import { HnSaveSchema, MAX_HN_TABLES, MAX_SAVE_SHEETS } from "../src/validators.js";

const bang = (n) => ({ hnTables: Array.from({ length: n }, (_, i) => ({ name: `Bảng ${i + 1}`, items: [] })) });

describe("HnSaveSchema — trần số bảng Hà Nội", () => {
  it("trần bám vào trần của đường lưu, KHÔNG phải con số viết tay thứ hai", () => {
    expect(MAX_HN_TABLES).toBe(MAX_SAVE_SHEETS);
  });

  it(`nhận đủ ${MAX_HN_TABLES} bảng`, () => {
    const r = HnSaveSchema.safeParse(bang(MAX_HN_TABLES));
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
    expect(r.data.hnTables).toHaveLength(MAX_HN_TABLES);
  });

  it("bảng thứ 61 bị từ chối (trần vẫn còn hiệu lực, không phải bỏ trần)", () => {
    const r = HnSaveSchema.safeParse(bang(MAX_HN_TABLES + 1));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error.issues)).toMatch(new RegExp(`Tối đa ${MAX_HN_TABLES} bảng`));
  });

  it("hình dạng CŨ `hnSheets` → `hnTables` VẮNG MẶT (để saveHn 400, không ghi rỗng)", () => {
    // Zod v4 loại khoá lạ. Nếu schema `.default([])` thì payload cũ parse ra mảng rỗng và server
    // ghi đè = XOÁ TRẮNG phần Hà Nội, im lặng. `optional()` giữ nguyên "vắng mặt" để saveHn phân
    // biệt được và trả 400 kèm lời nhắc chép lại rồi tải lại trang.
    const r = HnSaveSchema.safeParse({ hnSheets: [{ sheetId: 1, hnTables: [{ name: "x", items: [] }] }] });
    expect(r.success).toBe(true);
    expect(r.data.hnTables, "phải VẮNG MẶT, không phải []").toBeUndefined();
    expect(r.data.hnSheets).toBeUndefined();
  });

  it("nhận mốc khoá lạc quan `baseUpdatedAt` (thay cho phép suy đoán 'trang đã chết')", () => {
    const r = HnSaveSchema.safeParse({ baseUpdatedAt: "2026-09-15T07:00:00.000Z", hnTables: [] });
    expect(r.success).toBe(true);
    expect(r.data.baseUpdatedAt).toBe("2026-09-15T07:00:00.000Z");
  });
});
