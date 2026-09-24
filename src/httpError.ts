// Tiện ích HTTP trung lập: ném lỗi nghiệp vụ kèm HTTP status để errorHandler (middleware.ts) map sang
// res.status(status).json({error}). Đặt ở module RIÊNG (không ký sinh trong quoteService) để mọi service
// import mà không tạo phụ thuộc chéo domain (trước đây 6 service import ngược vào quoteService chỉ vì helper này).
export const httpError = (status: number, message: string): Error & { status: number } =>
  Object.assign(new Error(message), { status });

/**
 * SAI MẬT KHẨU / MÃ XÁC NHẬN ở thao tác nhạy cảm KHI ĐANG ĐĂNG NHẬP (bật-tắt MFA, đổi mật khẩu, xoá dữ
 * liệu cá nhân). Vẫn 401 như cũ nhưng mang `code: "xac_nhan_sai"` để web KHÔNG coi là mất phiên
 * (web/src/lib/api.ts): trước đây gõ sai mật khẩu xác nhận là hiện lớp phủ "Phiên đăng nhập đã hết" và
 * mọi lời gọi bị chặn tới khi đăng nhập lại — trong khi phiên vẫn sống (diễn tập 2026-09-25).
 */
export const loiXacNhanSai = (message: string): Error & { status: number; code: string } =>
  Object.assign(httpError(401, message), { code: "xac_nhan_sai" });
