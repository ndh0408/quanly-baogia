// Cấu hình Prisma 7 (thay cho `url` trong schema). Migrate/CLI đọc DATABASE_URL từ đây; runtime
// dùng driver adapter @prisma/adapter-pg (src/db.ts). Schema chỉ còn `provider`.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
