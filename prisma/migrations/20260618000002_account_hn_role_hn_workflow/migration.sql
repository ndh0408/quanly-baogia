-- Thêm vai trò "account_hn" (Account Hà Nội) + trạng thái luồng GIÁ HÀ NỘI trên Quote.
--
-- Role: tái tạo enum để thêm 'account_hn' (theo đúng pattern migration drop_employee_role —
-- an toàn, KHÔNG dính bẫy "ALTER TYPE ADD VALUE trong transaction" của Postgres).
-- Role chỉ được dùng bởi cột "User"."role".
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('admin', 'manager', 'account_hn');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'manager';
DROP TYPE "Role_old";

-- Quote: trạng thái phần GIÁ HÀ NỘI (luồng account_hn) — tách khỏi cột "status" báo giá chính.
ALTER TABLE "Quote" ADD COLUMN "hnAssigneeId" INTEGER;
ALTER TABLE "Quote" ADD COLUMN "hnStatus" TEXT;
ALTER TABLE "Quote" ADD COLUMN "hnSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN "hnReviewerId" INTEGER;
ALTER TABLE "Quote" ADD COLUMN "hnReviewedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN "hnRejectNote" TEXT;
