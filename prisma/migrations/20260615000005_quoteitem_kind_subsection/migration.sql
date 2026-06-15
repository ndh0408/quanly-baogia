-- FIX: cho phép kind 'subsection' (nhóm con). CHECK constraint cũ chỉ nhận
-- (item, sub, info, section) → lưu nhóm con bị 500 (vi phạm QuoteItem_kind_check) → mất dữ liệu.
ALTER TABLE "QuoteItem" DROP CONSTRAINT IF EXISTS "QuoteItem_kind_check";
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_kind_check"
  CHECK ("kind" IN ('item', 'sub', 'info', 'section', 'subsection'));
