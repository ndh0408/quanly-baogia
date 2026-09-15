-- BẢNG GIÁ HÀ NỘI: từ "theo TỪNG TRANG của chủ" (QuoteSheet.extraTables, category='hanoi')
-- lên "MỘT mảng cho cả BÁO GIÁ" (Quote.hnTables).
--
-- ── VÌ SAO ──────────────────────────────────────────────────────────────────
-- Chỗ lưu cũ buộc account Hà Nội làm việc BÊN TRONG cấu trúc trang của chủ báo giá. Ba hệ quả,
-- cả ba đều là lỗi thật đang xảy ra:
--   1. Màn account HN lặp theo trang và in cả TÊN TRANG → lộ cấu trúc báo giá cho người chỉ được
--      giao điền giá.
--   2. Lưu phải ghép theo `sheetId`, mà lưu báo giá là XOÁ TRANG RỒI TẠO LẠI nên mọi id đổi →
--      account HN gõ nửa tiếng, bấm Lưu, nhận 409 "phải tải lại trang".
--   3. Chủ xoá một trang là bảng HN nằm trên trang đó CHẾT THEO, im lặng, không ai biết.
-- Ở cấp báo giá, account HN có không gian riêng: tự tạo/xoá/đặt tên bảng như khi làm báo giá.
--
-- ── DI TRÚ KHÔNG ĐỔI MỘT ĐỒNG NÀO ───────────────────────────────────────────
-- CHÉP mọi phần tử category='hanoi' của MỌI trang thuộc một báo giá sang cột mới, GIỮ NGUYÊN thứ
-- tự đang hiển thị (trang theo "order" rồi "id", bảng theo thứ tự trong mảng). Bản cũ để nguyên
-- tại chỗ (xem pha EXPAND bên dưới) nên đây là phép CHÉP, không phải phép DỜI. Mọi
-- trường của từng bảng/hàng được bê nguyên xi — kể cả `rid`, `approved*`, `paid*` và `paidProof`
-- (ảnh uỷ nhiệm chi) — nên tổng tiền, cờ đã duyệt, cờ đã thanh toán và ảnh chứng từ đều y nguyên.
--
-- ĐO TRƯỚC/SAU (chạy để tự kiểm, không phải một phần của migration):
--   trước: xem scripts đo trong mô tả PR — đếm số bảng, số dòng, tổng quantity*unitPrice trên
--          jsonb_array_elements của QuoteSheet.extraTables lọc category='hanoi';
--   sau:   đúng ba con số đó trên jsonb_array_elements(Quote."hnTables").
--
-- ── ĐÂY LÀ PHA "EXPAND" — KHÔNG XOÁ CHỖ CŨ ─────────────────────────────────
-- `docs/operations/DEPLOYMENT.md` chốt quy ước của chính repo: "thêm cột trước, đổi mã sau, bỏ cột
-- cũ ở một bản phát hành SAU NỮA", và "migration không tự rollback". Nếu bản này xoá luôn phần
-- hanoi khỏi `QuoteSheet.extraTables` thì:
--   · trong cửa sổ giữa bước [4/6] migrate và [5/6] recreate của deploy.sh, mã CŨ đọc bảng HN ở
--     chỗ vừa bị xoá → mọi người thấy phần Hà Nội TRỐNG, và account HN bấm Lưu là ghi vào chỗ
--     không ai còn đọc — im lặng, không lỗi nào hiện ra;
--   · lệnh rollback mà chính deploy.sh in ra (lùi ẢNH, KHÔNG lùi CSDL) làm TOÀN BỘ phần Hà Nội
--     biến mất khỏi mọi màn hình, và đường thoát duy nhất là restore bản dump.
-- Để bản cũ nằm yên thì cả hai kịch bản đều vô hại. KHÔNG có chuyện cộng hai lần: từ bản này
-- `sanitizeExtraTables` loại category "hanoi" khỏi đường ghi theo trang, và mọi phép cộng tiền HN
-- (hnTotal, listProjects) chỉ đọc cột mới.
--
-- PHA "CONTRACT" là một migration RIÊNG ở bản phát hành SAU, khi bản mới đã chạy ổn định:
--   UPDATE "QuoteSheet" s SET "extraTables" = (
--     SELECT COALESCE(jsonb_agg(t ORDER BY o), '[]'::jsonb)
--     FROM jsonb_array_elements(s."extraTables"::jsonb) WITH ORDINALITY AS x(t, o)
--     WHERE NOT (jsonb_typeof(t) = 'object' AND t->>'category' = 'hanoi'))
--   WHERE jsonb_typeof(s."extraTables"::jsonb) = 'array'
--     AND s."extraTables"::jsonb @> '[{"category":"hanoi"}]'::jsonb;
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Bản cũ CÒN NGUYÊN trong `QuoteSheet.extraTables`, nên lùi ẢNH một mình là chạy được ngay: mã cũ
-- đọc lại đúng chỗ cũ. (Phần HN ai đó sửa bằng mã MỚI nằm ở `Quote.hnTables` nên mã cũ không thấy
-- — chép tay lại nếu cần.) Muốn dọn hẳn:
--   ALTER TABLE "Quote" DROP COLUMN "hnTables";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260915140000_hn_tables_quote_level';
-- Dòng thứ hai hay bị quên: thiếu nó thì lượt roll-forward sau coi migration này "đã chạy" và bỏ
-- qua, để lại schema cũ với mã mới.
--
-- ── NẾU BƯỚC [4/6] HỎNG VÌ lock_timeout (55P03) ─────────────────────────────
-- Prisma để lại hàng migration ở trạng thái FAILED, nên lần deploy sau KHÔNG tự thử lại mà báo
-- P3009 và từ chối áp MỌI migration. Gỡ bằng đúng một lệnh trên VM rồi deploy lại:
--   docker compose -f <compose> run --rm app npx prisma migrate resolve --rolled-back 20260915140000_hn_tables_quote_level

-- Không xếp hàng sau transaction dài của người đang dùng: thà dừng sớm để deploy.sh `set -e` chặn
-- lại, còn hơn khoá Quote + QuoteSheet cho tới hết thời gian chờ.
SET lock_timeout = '10s';

ALTER TABLE "Quote" ADD COLUMN "hnTables" JSONB;

-- GOM: thứ tự trang (order, id) → thứ tự bảng trong mảng của từng trang. `WITH ORDINALITY` giữ
-- đúng thứ tự phần tử; thiếu nó thì jsonb_agg gom theo thứ tự KHÔNG xác định và bảng của account
-- HN xáo chỗ sau khi deploy — không mất tiền, nhưng người dùng sẽ tưởng mình gõ nhầm.
WITH hn AS (
  SELECT
    s."quoteId"                              AS quote_id,
    s."order"                                AS sheet_order,
    s."id"                                   AS sheet_id,
    e.ord                                    AS tbl_ord,
    (e.tbl - 'category')                     AS tbl      -- bỏ khoá category: cả cột này là "hanoi"
  FROM "QuoteSheet" s
  CROSS JOIN LATERAL jsonb_array_elements(s."extraTables"::jsonb) WITH ORDINALITY AS e(tbl, ord)
  WHERE jsonb_typeof(s."extraTables"::jsonb) = 'array'
    AND jsonb_typeof(e.tbl) = 'object'
    AND e.tbl->>'category' = 'hanoi'
), gom AS (
  SELECT quote_id, jsonb_agg(tbl ORDER BY sheet_order, sheet_id, tbl_ord) AS tables
  FROM hn GROUP BY quote_id
)
UPDATE "Quote" q SET "hnTables" = gom.tables
FROM gom WHERE q."id" = gom.quote_id;

