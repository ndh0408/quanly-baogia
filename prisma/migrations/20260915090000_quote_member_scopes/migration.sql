-- "ACCOUNT PHỤ": m2m NGẦM `_QuoteMembers(A,B)` → model TƯỜNG MINH `QuoteMember` có PHẠM VI.
--
-- VÌ SAO: bảng nối ngầm chỉ đựng được MỘT BIT — "có phải thành viên không". Nên hôm nay ai được
-- chủ báo giá thêm vào là sửa được TOÀN BỘ báo giá đó (mọi bảng, mọi đơn giá). Chủ dự án muốn
-- giao từng phần ("người này chỉ điền bảng Hà Nội"), mà chỗ đựng điều đó thì không tồn tại.
--
-- DI TRÚ KHÔNG ĐỔI HÀNH VI: mọi hàng đang có nhận ĐỦ 4 vùng, tức đúng quyền họ đang dùng hôm nay.
-- Người được thêm MỚI (sau bản này) mới có phạm vi hẹp, và do chủ báo giá tự tick.
--
-- ⚠️ ĐỌC TRƯỚC KHI DEPLOY — migration này XOÁ bảng cũ trong CÙNG release với mã mới.
--
-- `deploy.sh` chạy `[4/6] prisma migrate deploy` TRƯỚC rồi `[5/6]` mới recreate container, nên có
-- một CỬA SỔ (vài chục giây) mà mã CŨ chạy trên schema đã bỏ `_QuoteMembers`: mọi request báo giá
-- trong khoảng đó trả 500. Đây là công cụ nội bộ, deploy do người vận hành tự bấm, nên cửa sổ đó
-- chấp nhận được — nhưng ĐỪNG deploy giữa lúc cả phòng đang gõ báo giá.
--
-- QUAN TRỌNG HƠN — ĐƯỜNG LÙI: đường lùi mà deploy.sh in ra chỉ lùi ẢNH, KHÔNG lùi CSDL. Lùi ảnh
-- MỘT MÌNH sau migration này = mã cũ trên schema mới = 500 vĩnh viễn. Nếu buộc phải lùi ảnh thì
-- chạy KÈM khối SQL dưới đây để dựng lại bảng cũ từ dữ liệu bảng mới (chạy được nhiều lần):
--
--   CREATE TABLE IF NOT EXISTS "_QuoteMembers" ("A" INTEGER NOT NULL, "B" INTEGER NOT NULL);
--   INSERT INTO "_QuoteMembers" ("A","B") SELECT "quoteId","userId" FROM "QuoteMember"
--     ON CONFLICT DO NOTHING;
--   CREATE UNIQUE INDEX IF NOT EXISTS "_QuoteMembers_AB_unique" ON "_QuoteMembers"("A","B");
--   CREATE INDEX IF NOT EXISTS "_QuoteMembers_B_index" ON "_QuoteMembers"("B");
--   ALTER TABLE "_QuoteMembers" ADD CONSTRAINT "_QuoteMembers_A_fkey" FOREIGN KEY ("A")
--     REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--   ALTER TABLE "_QuoteMembers" ADD CONSTRAINT "_QuoteMembers_B_fkey" FOREIGN KEY ("B")
--     REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260915090000_quote_member_scopes';
--   DROP TABLE "QuoteMember";
--
-- Dòng `DELETE FROM "_prisma_migrations"` là thứ hay bị quên: thiếu nó thì lượt roll-forward sau
-- coi migration này "đã chạy" và bỏ qua, để lại schema cũ với mã mới.
-- (Phạm vi đã tick sẽ mất khi lùi: bảng cũ không có chỗ đựng. Đó là một chiều.)

-- Không để lệnh DDL xếp hàng sau một transaction dài của người đang dùng: thà migration dừng sớm
-- và deploy.sh `set -e` chặn lại, còn hơn khoá bảng Quote/User cho tới khi hết thời gian chờ.
SET lock_timeout = '10s';

CREATE TABLE "QuoteMember" (
    "quoteId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "addedById" INTEGER,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteMember_pkey" PRIMARY KEY ("quoteId","userId")
);

CREATE INDEX "QuoteMember_userId_idx" ON "QuoteMember"("userId");

ALTER TABLE "QuoteMember" ADD CONSTRAINT "QuoteMember_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteMember" ADD CONSTRAINT "QuoteMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteMember" ADD CONSTRAINT "QuoteMember_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHÉP DỮ LIỆU TRƯỚC KHI BỎ BẢNG CŨ. `addedById` để NULL: không có gì trong bảng ngầm ghi lại
-- ai đã phân công, và bịa ra người tạo báo giá thì nhật ký sẽ nói dối.
INSERT INTO "QuoteMember" ("quoteId", "userId", "scopes", "addedById", "addedAt")
SELECT m."A", m."B", ARRAY['main','hcm','hanoi','khach'], NULL, CURRENT_TIMESTAMP
FROM "_QuoteMembers" m
WHERE EXISTS (SELECT 1 FROM "Quote" q WHERE q."id" = m."A")
  AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = m."B")
ON CONFLICT ("quoteId", "userId") DO NOTHING;

DROP TABLE "_QuoteMembers";
