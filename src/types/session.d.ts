// Augment express-session với các field session app dùng (req.session.userId/role…).
// Giúp code .ts type-safe; code .js cũ không bị ảnh hưởng.
import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: number;
    role: string;
    displayName?: string;
    username?: string;
  }
}
