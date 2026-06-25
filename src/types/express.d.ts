// Augmentation kiểu cho Express — props tùy biến middleware gắn lên `req` + dữ liệu `req.session`.
// File .d.ts AMBIENT: chỉ cấp kiểu cho strict/noImplicitAny, KHÔNG ảnh hưởng runtime.
import "express-session";

declare global {
  namespace Express {
    interface Request {
      id: string; // requestId middleware gán (header X-Request-Id)
      viaJwt?: boolean; // bearerAuth: đã xác thực qua JWT thay vì cookie session
    }
  }
}

declare module "express-session" {
  interface SessionData {
    userId: number; // User.id (Int)
    role: string; // Role enum — so khớp chuỗi "admin"/"account_hn"/… ở các check phân quyền
    username: string;
  }
}
