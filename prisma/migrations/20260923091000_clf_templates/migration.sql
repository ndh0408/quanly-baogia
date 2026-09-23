-- DB-02 — HAI MẪU COLORFULL MỚI (clofull_banner, clofull_conngay) PHẢI TỚI ĐƯỢC PRODUCTION.
--
-- ── VÌ SAO ────────────────────────────────────────────────────────────────
-- Commit f2b7245 thêm hai mẫu này CHỈ qua prisma/seed.js. deploy.sh chỉ chạy `prisma migrate deploy`,
-- không chạy seed — nên production lên bản mới mà trình tạo báo giá của Colorfull vẫn chỉ có một mẫu
-- (metaService đọc QuoteTemplate từ CSDL), dù mã xuất Excel đã hỗ trợ cả ba. Còn chạy seed tay trên
-- production thì có thể đẻ thêm một tài khoản admin nếu username admin thật không phải 'admin'.
--
-- ── GIÁ TRỊ ───────────────────────────────────────────────────────────────
-- Khớp đúng prisma/seed.js (code, name, filePath). Seed vẫn giữ nguyên cho môi trường mới.
--
-- ── AN TOÀN ───────────────────────────────────────────────────────────────
--   · ON CONFLICT (code) DO NOTHING — mẫu đã có (do seed, do tay, kể cả hàng đã xoá mềm) GIỮ NGUYÊN,
--     không đè tên/đường dẫn/cờ active mà quản trị có thể đã chỉnh.
--   · Chỉ chèn khi công ty 'clofull' tồn tại và chưa bị xoá mềm. CSDL rỗng (chưa seed) thì không chèn
--     gì — seed lo phần đó như trước.
--   · IDEMPOTENT: chạy lại không nhân đôi (unique index "QuoteTemplate_code_key").
-- ROLLBACK: DELETE FROM "QuoteTemplate" WHERE code IN ('clofull_banner','clofull_conngay') AND
-- NOT EXISTS (SELECT 1 FROM "QuoteSheet" s WHERE s."templateId" = "QuoteTemplate".id);
INSERT INTO "QuoteTemplate" ("code", "name", "companyId", "filePath", "updatedAt")
SELECT v.code, v.name, c.id, v.file_path, CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN (VALUES
  ('clofull_banner', 'CLF Banner (không ngày)', 'templates/CLF_KhongNgay.xlsx'),
  ('clofull_conngay', 'CLF (có ngày)', 'templates/CLF_CoNgay.xlsx')
) AS v(code, name, file_path)
WHERE c.code = 'clofull'
  AND c."deletedAt" IS NULL
ON CONFLICT ("code") DO NOTHING;
