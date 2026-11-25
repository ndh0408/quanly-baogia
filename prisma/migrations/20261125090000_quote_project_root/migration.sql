-- GỐC DỰ ÁN của phiên bản ("Bản mới") — chủ repo 2026-11-25: "tạo mới chưa duyệt thì không có mã nào, duyệt khách
-- chốt thì mới tạo mã dự án nhé, để khỏi rác mã dự án".
--
-- Mã dự án nay chỉ được cấp lúc KHÁCH CHỐT (src/maDuAn.ts). Bản nháp phiên bản mới của một dự án đã chốt vì thế KHÔNG
-- mang mã — mà trước đây "cùng dự án" chỉ suy được qua projectCode. Cột này giữ liên kết đó: id báo giá GỐC của dự án
-- (null = chính nó là gốc); chốt bản nháp thì lấy lại mã của gốc + số phiên bản kế tiếp.
--
-- THUẦN THÊM CỘT + INDEX, không đụng dữ liệu nào đang có:
--   · "Quote"."projectRootId" — INTEGER, NULL được, KHÔNG DEFAULT, KHÔNG FK (gốc bị xoá cứng thì các phiên bản vẫn nhóm
--     được theo cùng số). Thêm cột NULL không DEFAULT chỉ ghi siêu dữ liệu (không viết lại bảng).
--   · Index btree thường: đường chốt tìm "mọi bản của dự án" theo cột này.
--   · Dữ liệu cũ KHÔNG được điền ở đây — công cụ chạy tay src/tools/donMaDuAn.ts (--ap-dung) điền liên kết cho các
--     phiên bản cũ đang nhận nhau qua projectCode, sau khi người vận hành đã backup (docs/operations/DON_MA_DU_AN.md).
--
-- Mã CŨ chạy tiếp trên schema mới: nó không biết cột này (Prisma không SELECT * mà liệt kê cột), mọi thứ như trước.
--
-- ROLLBACK: DROP INDEX "Quote_projectRootId_idx"; ALTER TABLE "Quote" DROP COLUMN "projectRootId";
--   — chỉ khi chưa có bản nháp phiên bản nào được tạo bằng app mới (nếu có, chúng mất liên kết về dự án gốc).

SET lock_timeout = '10s';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "projectRootId" INTEGER;

-- CreateIndex
CREATE INDEX "Quote_projectRootId_idx" ON "Quote"("projectRootId");
