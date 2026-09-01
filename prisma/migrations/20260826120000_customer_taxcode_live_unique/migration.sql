-- MST khách hàng: ràng buộc DUY NHẤT thật sự, thay cho check-then-write ở tầng ứng dụng.
--
-- src/services/customerService.ts kiểm trùng bằng `findFirst` rồi mới `create`/`update` — NGOÀI
-- transaction. Hai người nhập cùng một mã số thuế trong cùng vài mili-giây thì CẢ HAI đọc "chưa
-- có" rồi CẢ HAI ghi được. Chỉ CSDL mới đóng được cửa sổ đó.
--
-- PHẠM VI của index CỐ Ý là "khách SỐNG, có MST":
--   · `"taxCode" IS NOT NULL` — đa số khách lẻ không có MST, NULL không được coi là trùng nhau;
--   · `"deletedAt" IS NULL`  — kiểm ở service chạy qua extension soft-delete nên KHÔNG thấy bản
--     đã xoá mềm. Thiếu vế này là ràng buộc CHẶT HƠN hành vi đang có: người dùng bị 409 cho một
--     MST mà giao diện khẳng định là còn trống.
-- Prisma KHÔNG biểu diễn được partial index ⇒ đây là drift ĐƯỢC PHÉP, đã khai trong
-- prisma/migrations/README.md (mục "Drift ĐƯỢC PHÉP").

-- Dừng SỚM và nói rõ phải làm gì, thay vì để CREATE UNIQUE INDEX ngã với một lỗi 23505 trần trụi.
DO $$
DECLARE trung text;
BEGIN
  SELECT string_agg(t, ', ') INTO trung FROM (
    SELECT "taxCode" AS t FROM "Customer"
    WHERE "taxCode" IS NOT NULL AND "deletedAt" IS NULL
    GROUP BY "taxCode" HAVING count(*) > 1
    LIMIT 20
  ) x;
  IF trung IS NOT NULL THEN
    RAISE EXCEPTION 'Còn khách hàng SỐNG trùng mã số thuế: %. Gộp/sửa các bản trùng trước rồi chạy lại migration. Liệt kê đầy đủ: SELECT "taxCode", count(*), array_agg(code) FROM "Customer" WHERE "taxCode" IS NOT NULL AND "deletedAt" IS NULL GROUP BY 1 HAVING count(*) > 1;', trung;
  END IF;
END $$;

-- Trên production ĐANG TẢI thì chạy TAY bản CONCURRENTLY dưới đây (không khoá ghi), rồi
-- `prisma migrate resolve --applied 20260826120000_customer_taxcode_live_unique`:
--   CREATE UNIQUE INDEX CONCURRENTLY "Customer_taxCode_live_key" ON "Customer"("taxCode")
--     WHERE "taxCode" IS NOT NULL AND "deletedAt" IS NULL;
--   DROP INDEX CONCURRENTLY "Customer_taxCode_idx";
-- ⚠️ CONCURRENTLY đứt giữa chừng để lại index INVALID MANG ĐÚNG TÊN ĐÓ, và `IF NOT EXISTS` bên
-- dưới sẽ lặng lẽ bỏ qua ⇒ trước khi resolve phải kiểm:
--   SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE NOT i.indisvalid;
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_taxCode_live_key"
  ON "Customer"("taxCode") WHERE "taxCode" IS NOT NULL AND "deletedAt" IS NULL;

-- Index thường cũ nay THỪA: mọi truy vấn tra theo MST đều kèm `deletedAt IS NULL` (extension
-- soft-delete tự thêm) nên rơi đúng vào predicate của index unique ở trên.
DROP INDEX IF EXISTS "Customer_taxCode_idx";
