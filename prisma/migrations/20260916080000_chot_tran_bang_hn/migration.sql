-- CHỐT CHẶN: KHÔNG ĐỂ LẠI BÁO GIÁ "MỞ ĐƯỢC NHƯNG KHÔNG LƯU ĐƯỢC".
--
-- `MAX_HN_TABLES` (src/validators.ts) chặn ở 60 bảng Hà Nội cho MỘT báo giá. Ở mô hình CŨ trần là
-- 20 bảng cho MỖI TRANG, nên một báo giá nhiều trang về lý thuyết gom được nhiều hơn 60 sau khi
-- 20260915140000_hn_tables_quote_level dồn chúng về một danh sách phẳng. Một báo giá như vậy sẽ
-- MỞ RA BÌNH THƯỜNG rồi từ chối MỌI lần Lưu bằng lỗi zod — kiểu hỏng tệ nhất: im lặng lúc deploy,
-- chỉ nổ khi người dùng đã gõ xong.
--
-- Thà HỎNG TO LÚC MIGRATE: deploy dừng ở bước [4/6], app CŨ vẫn chạy, người deploy đọc được đúng
-- báo giá nào và xử lý (gộp bảng, hoặc nâng trần) TRƯỚC khi có ai mất việc.
--
-- VÌ SAO LÀ MIGRATION RIÊNG, không sửa thẳng vào 20260915140000: migration đó ĐÃ CHẠY trên dev.
-- Prisma lưu checksum của từng migration đã áp; sửa nội dung là lượt `migrate deploy` kế tiếp trên
-- dev chết với "migration was modified after it was applied". Thêm file mới thì cả dev (đã chạy
-- bản trước) lẫn production (chạy cả hai một lượt) đều đi qua đúng một đường.
--
-- Đổi trần ở src/validators.ts thì đổi luôn số 60 dưới đây.

DO $$
DECLARE qua RECORD;
BEGIN
  SELECT q."id" AS id, q."quoteNumber" AS so, jsonb_array_length(q."hnTables") AS n INTO qua
  FROM "Quote" q
  WHERE jsonb_typeof(q."hnTables") = 'array' AND jsonb_array_length(q."hnTables") > 60
  ORDER BY jsonb_array_length(q."hnTables") DESC
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Báo giá % (id=%) có % bảng Hà Nội, vượt trần MAX_HN_TABLES=60 của src/validators.ts. Migrate tiếp thì báo giá này mở được nhưng KHÔNG lưu được. Gộp bớt bảng hoặc nâng trần rồi chạy lại.',
      qua.so, qua.id, qua.n;
  END IF;
END $$;
