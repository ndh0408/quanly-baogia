// Bảng 5 màu của GHI CHÚ ở dòng Danh sách báo giá — kiểu Zalo (một hàng chấm tròn màu, chấm đang chọn có
// dấu ✓; bấm lại chính nó để bỏ). Lưu KHOÁ tiếng Anh, còn màu thật (mỗi chế độ sáng/tối một sắc độ) nằm ở
// CSS (`.qn-c-<khoá>` trong styles.css) — đổi tông màu không kéo theo chuyển dữ liệu.
//
// ⚠️ MIRROR của src/quoteListNote.ts (MAU_GHI_CHU, GHI_CHU_TOI_DA): web không import được server và ngược
// lại. tests/ql-ghi-chu-mau-khop.test.js khoá hai bản không được lệch.
export const MAU_GHI_CHU = ["red", "orange", "green", "blue", "purple"] as const;
export type MauGhiChu = (typeof MAU_GHI_CHU)[number];

/** Tên gọi tiếng Việt — dùng cho tooltip và `aria-label` của từng chấm màu. */
export const NHAN_MAU: Record<MauGhiChu, string> = { red: "Đỏ", orange: "Cam", green: "Xanh lá", blue: "Xanh dương", purple: "Tím" };

/** Ô một dòng trên bảng — đúng với trần của máy chủ (QuoteListNoteSchema). */
export const GHI_CHU_TOI_DA = 200;

export const laMauGhiChu = (v: unknown): v is MauGhiChu => typeof v === "string" && (MAU_GHI_CHU as readonly string[]).includes(v);
