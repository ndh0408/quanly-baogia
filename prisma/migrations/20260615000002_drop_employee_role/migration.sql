-- Bỏ HẲN vai trò "employee" — kiểu Role chỉ còn (admin, manager).
-- Postgres KHÔNG hỗ trợ "ALTER TYPE ... DROP VALUE" nên phải TÁI TẠO enum:
--   1) chuyển mọi user employee → manager (an toàn cả khi đã chuyển trước đó);
--   2) bỏ DEFAULT của cột (đang tham chiếu kiểu cũ);
--   3) đổi tên kiểu cũ → tạo kiểu mới chỉ gồm admin/manager → ép cột sang kiểu mới;
--   4) đặt lại DEFAULT = manager; xoá kiểu cũ.
-- Role chỉ được dùng bởi cột "User"."role" nên việc tái tạo là an toàn.
UPDATE "User" SET "role" = 'manager' WHERE "role" = 'employee';
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('admin', 'manager');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'manager';
DROP TYPE "Role_old";
