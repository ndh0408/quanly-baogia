// Tiện ích HTTP trung lập: ném lỗi nghiệp vụ kèm HTTP status để errorHandler (middleware.ts) map sang
// res.status(status).json({error}). Đặt ở module RIÊNG (không ký sinh trong quoteService) để mọi service
// import mà không tạo phụ thuộc chéo domain (trước đây 6 service import ngược vào quoteService chỉ vì helper này).
export const httpError = (status: number, message: string): Error & { status: number } =>
  Object.assign(new Error(message), { status });
