-- BỐN MẪU BÁO GIÁ CINETOUR (chủ repo 2026-11-25) — mỗi công ty hai mẫu, Không ngày và Có ngày, thêm cột SỐ CA.
--
-- ── VÌ SAO QUA MIGRATION ──────────────────────────────────────────────────
-- Cùng lý do với 20260923091000_clf_templates: deploy.sh chỉ chạy `prisma migrate deploy`, không chạy seed, mà
-- trình tạo báo giá đọc QuoteTemplate từ CSDL (metaService). Thêm mẫu chỉ ở seed là production không bao giờ thấy.
--
-- ── GIÁ TRỊ ───────────────────────────────────────────────────────────────
-- Khớp đúng prisma/seed.js (code, name, filePath). Bố cục cột + công thức nằm ở src/templateConfigs.ts theo `code`;
-- tệp mẫu dựng lại được bằng `node scripts/dung-mau-cinetour.mjs`.
--   gn_cinetour               GN CINETOUR (không ngày)    templates/GN_Cinetour_KhongNgay.xlsx
--   gn_cinetour_conngay       GN CINETOUR (có ngày)       templates/GN_Cinetour_CoNgay.xlsx
--   clofull_cinetour          CLF CINETOUR (không ngày)   templates/CLF_Cinetour_KhongNgay.xlsx
--   clofull_cinetour_conngay  CLF CINETOUR (có ngày)      templates/CLF_Cinetour_CoNgay.xlsx
--
-- ── KHÔNG ĐỔI MẪU DỰ PHÒNG CỦA BẢNG CŨ ───────────────────────────────────
-- Bảng nội bộ / Hà Nội thiếu templateId dùng "mẫu ĐẦU của công ty" theo tên (`orderBy name asc`, collation CSDL —
-- quoteUtils.bangNoiBoCoNgay, web mauBangHn). Tên mới đều bắt đầu "GN CINETOUR" / "CLF CINETOUR". Đo trên collation
-- en_US.utf8 (CSDL production và test): "(" xếp TRƯỚC chữ cái, nên thứ tự là "CLF (có ngày)", "CLF (không ngày)",
-- "CLF Banner…", rồi mới tới "CLF CINETOUR…" (GN cũng vậy); collation C cũng ra "(" (0x28) trước "B"/"C". Mẫu đầu
-- không đổi ⇒ tiền bảng cũ không đổi (tests/cinetour-luu-bao-gia.test.js đo trên collation thật của CSDL).
--
-- ── AN TOÀN ───────────────────────────────────────────────────────────────
--   · ON CONFLICT (code) DO NOTHING — mẫu đã có (do seed, do tay, kể cả hàng đã xoá mềm) GIỮ NGUYÊN, không đè
--     tên / đường dẫn / cờ active mà quản trị có thể đã chỉnh.
--   · Tra công ty theo MÃ (`gia_nguyen`, `clofull`) — không cứng id; công ty chưa có hoặc đã xoá mềm thì không chèn
--     mẫu của nó. CSDL rỗng (chưa seed) thì không chèn gì — seed lo phần đó như trước.
--   · IDEMPOTENT: chạy lại không nhân đôi (unique index "QuoteTemplate_code_key").
-- ROLLBACK: DELETE FROM "QuoteTemplate" WHERE code IN ('gn_cinetour','gn_cinetour_conngay','clofull_cinetour',
-- 'clofull_cinetour_conngay') AND NOT EXISTS (SELECT 1 FROM "QuoteSheet" s WHERE s."templateId" = "QuoteTemplate".id);
-- (bảng nội bộ trỏ mẫu bằng templateId trong JSON — mẫu đã có người dùng thì đặt active = false thay vì xoá).
INSERT INTO "QuoteTemplate" ("code", "name", "companyId", "filePath", "updatedAt")
SELECT v.code, v.name, c.id, v.file_path, CURRENT_TIMESTAMP
FROM (VALUES
  ('gia_nguyen', 'gn_cinetour', 'GN CINETOUR (không ngày)', 'templates/GN_Cinetour_KhongNgay.xlsx'),
  ('gia_nguyen', 'gn_cinetour_conngay', 'GN CINETOUR (có ngày)', 'templates/GN_Cinetour_CoNgay.xlsx'),
  ('clofull', 'clofull_cinetour', 'CLF CINETOUR (không ngày)', 'templates/CLF_Cinetour_KhongNgay.xlsx'),
  ('clofull', 'clofull_cinetour_conngay', 'CLF CINETOUR (có ngày)', 'templates/CLF_Cinetour_CoNgay.xlsx')
) AS v(company_code, code, name, file_path)
JOIN "Company" c ON c.code = v.company_code AND c."deletedAt" IS NULL
ON CONFLICT ("code") DO NOTHING;
