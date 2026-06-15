-- Bỏ vai trò "employee" (chỉ còn admin + manager):
--   1) Chuyển mọi user đang là employee sang manager.
--   2) Đổi default cột role sang 'manager'.
-- Giữ NGUYÊN giá trị enum 'employee' trong kiểu Role — Postgres không hỗ trợ xoá
-- enum value an toàn (cần recreate type), và để giá trị thừa lại là vô hại sau khi
-- không còn user nào dùng + validator/UI đã chặn gán. Additive, an toàn dữ liệu cũ.
UPDATE "User" SET "role" = 'manager' WHERE "role" = 'employee';
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'manager';
