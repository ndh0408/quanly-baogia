// Ghi chú + màu ở dòng của Danh sách báo giá (bảng `QuoteListNote`, chủ repo 2026-09-30).
//
// ⚠️ MIRROR của web/src/lib/ghiChuMau.ts (khoá màu) — runtime server chạy trên `src/` nên không import
// được `web/`. tests/ql-ghi-chu-mau-khop.test.js khoá hai bản không được lệch.

/**
 * BẢNG 5 MÀU — tập ĐÓNG, kiểu Zalo ("Phân loại": đỏ · cam · xanh lá · xanh dương · tím). Lưu khoá tiếng
 * Anh chứ không lưu mã hex: hex là chuyện của giao diện (mỗi chế độ sáng/tối một sắc độ), đổi tông màu
 * không được kéo theo chuyển dữ liệu. Kiểm ở lớp API (QuoteListNoteSchema) chứ không bằng CHECK trong
 * CSDL để thêm màu thứ sáu không cần migration.
 */
export const MAU_GHI_CHU = ["red", "orange", "green", "blue", "purple"] as const;
export type MauGhiChu = (typeof MAU_GHI_CHU)[number];

/** Ô một dòng trên bảng — đủ cho "Chờ khách duyệt, gọi lại thứ Hai" mà không phình hàng. */
export const GHI_CHU_TOI_DA = 200;

/**
 * Ghi chú hiển thị trên MỘT dòng bảng: xuống dòng (kể cả dán từ Excel) → một dấu cách, cắt hai đầu.
 * Độ dài đã kiểm ở schema TRƯỚC khi gọi — ở đây không cắt thầm, vì cắt im lặng là mất chữ người ta vừa gõ.
 */
export const chuanHoaGhiChu = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
