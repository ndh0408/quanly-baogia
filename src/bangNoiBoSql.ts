// BẢNG NỘI BỘ đọc bằng SQL, ĐÃ CẮT ẢNH CHỨNG TỪ (`paidProof`) NGAY TẠI CSDL — hai câu SQL DUY NHẤT của repo làm
// việc cắt đó (một cho `QuoteSheet.extraTables`, một cho `Quote.hnTables`). Hai bản chép của quy tắc cắt sẽ trôi
// khỏi nhau, nên mọi đường cần chữ/số của bảng nội bộ mà KHÔNG cần ảnh đều đi qua đây.
//
// Tách khỏi src/services/quoteService.ts (2026-10-06) để dịch vụ kế toán (src/services/inputInvoiceService.ts)
// dùng chung được mà không import ngược vào quoteService — vòng import giữa các service là đỏ [K4]
// (scripts/ci/check-architecture.mjs). quoteService vẫn export lại hai hàm này: listQuotes, listProjects,
// listInputInvoices và bản xuất GDPR (src/services/gdprService.ts) gọi qua đó như trước.
//
// Hàng có ảnh nhận cờ `hasPaidProof: true` thay cho ảnh — trang Hóa đơn đầu vào cần biết "khoản cũ có ảnh hay
// chưa" mà không kéo ảnh về. Cờ là boolean, không phải dữ liệu cá nhân.
import { prisma, type TxClient } from "./db.js";

/** `prisma` hoặc client của một transaction đang mở (đọc TRONG transaction thì thấy bản đã khoá). */
type DocSql = Pick<TxClient, "$queryRaw">;

/**
 * Bảng nội bộ THEO TỪNG SHEET của một nhóm báo giá, ĐÃ CẮT `paidProof` NGAY TẠI SQL.
 *
 * Các đường dùng nó: `listQuotes` (gộp theo báo giá), `listProjects` (cần theo TỪNG sheet vì trang Quản lý dự án /
 * Hoá đơn cộng hcm/hanoi/khach cho mỗi trang), `listInputInvoices` + dịch vụ kế toán (Hóa đơn đầu vào), và bản xuất
 * GDPR — đường đó cũng cần dữ liệu chữ/số của bảng nội bộ mà KHÔNG kéo ảnh chứng từ qua dây.
 *
 * Vì sao phải cắt ở tầng SQL chứ không lọc sau khi nạp: lọc ở JS thì base64 đã đi qua dây và đã nằm trong heap rồi —
 * đúng chi phí cần bỏ. Ảnh vẫn sống trong CSDL; ảnh của khoản chi tải theo yêu cầu qua
 * GET /api/quotes/input-invoices/:quoteId/:side/:rid/proof.
 *
 * Phép tính TIỀN/ĐẾM vẫn do `extraTableSum`/`presentQuoteRow` ở JS làm, KHÔNG dịch sang SQL: quy tắc ở đó (làm tròn
 * từng dòng, cờ `quantityExact`, `days`, chỉ cộng hàng đã duyệt với hcm/khách) là quy tắc TIỀN — dựng lại nó bằng SQL
 * là mở đường cho hai nguồn số lệch nhau.
 *
 * `extraTables` là cột Json TỰ DO (đường ghi ở hnWorkflow và lúc nhân bản không qua sanitizeExtraTables), nên phải
 * phòng cả ca không phải mảng: CASE ở ngoài chặn `jsonb_array_elements` ném lỗi trên object/chuỗi, và bảng có
 * `items` không phải mảng thì để nguyên.
 */
export async function bangNoiBoTheoSheet(ids: number[], db: DocSql = prisma) {
  const rows = await db.$queryRaw<{ quoteId: number; sheetId: number; order: number; tables: any }[]>`
    SELECT s."quoteId" AS "quoteId", s.id AS "sheetId", s."order" AS "order",
           coalesce(jsonb_agg(x.t ORDER BY x.ord), '[]'::jsonb) AS "tables"
      FROM "QuoteSheet" s
      CROSS JOIN LATERAL (
        SELECT CASE WHEN jsonb_typeof(e.t->'items') = 'array'
                    THEN jsonb_set(e.t, '{items}', (SELECT coalesce(jsonb_agg(
                                                           -- Phep tru jsonb-text NEM LOI 22023 "cannot delete from
                                                           -- scalar" khi phan tu KHONG phai object/array. CASE ben
                                                           -- ngoai chi phong extraTables khong phai mang va items
                                                           -- khong phai mang - KHONG phong PHAN TU vo huong ben trong
                                                           -- items (null, chuoi, so). Cot nay la jsonb tu do, da qua
                                                           -- nhieu doi ma ghi, nen phan tu di dang la chuyen co that.
                                                           -- Duong JS cu chiu duoc hoan toan, nen chuyen sang SQL ma
                                                           -- thieu lop nay la lam HONG CA TRANG DANH SACH bao gia vi
                                                           -- mot hang du lieu cu. (Chu thich khong dau: khoi SQL nay
                                                           -- nam trong template literal, backtick se lam dut chuoi.)
                                                           -- Hang CO anh nhan co hasPaidProof = true thay cho anh.
                                                           CASE WHEN jsonb_typeof(it) = 'object'
                                                                THEN CASE WHEN coalesce(it->>'paidProof', '') <> ''
                                                                          THEN (it - 'paidProof') || '{"hasPaidProof":true}'::jsonb
                                                                          ELSE it - 'paidProof' END
                                                                ELSE it END
                                                         ), '[]'::jsonb)
                                                    FROM jsonb_array_elements(e.t->'items') it))
                    ELSE e.t END AS t, e.ord AS ord
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."extraTables") = 'array'
                                         THEN s."extraTables" ELSE '[]'::jsonb END) WITH ORDINALITY AS e(t, ord)
         -- BO QUA ban cu cua bang Ha Noi con nam lai trong trang: migration 20260915140000 la
         -- EXPAND-ONLY (chep sang Quote.hnTables, CHUA xoa cho cu de lui anh con an toan). Khong
         -- loc thi phan HN bi dem HAI LAN tren du lieu cu. (Chu thich khong dau: nam trong
         -- template literal, dau backtick se lam dut chuoi.)
         WHERE NOT (jsonb_typeof(e.t) = 'object' AND e.t->>'category' = 'hanoi')
      ) x
     WHERE s."quoteId" = ANY(${ids})
     GROUP BY s."quoteId", s.id, s."order"`;
  // WITH ORDINALITY giu dung THU TU bang trong mang goc: jsonb_agg khong co ORDER BY thi thu tu
  // do planner quyet, va thu tu bang la thu tu nguoi dung nhin thay tren man hinh.
  return rows;
}

/**
 * Bảng HÀ NỘI của một nhóm báo giá, ĐÃ CẮT `paidProof` NGAY TẠI SQL.
 *
 * Song sinh với `bangNoiBoTheoSheet`, khác mỗi chỗ đọc: cột `Quote.hnTables` (cấp báo giá, từ migration
 * 20260915140000) thay vì `QuoteSheet.extraTables`. Lý lẽ "vì sao cắt ở tầng SQL" và "vì sao phải phòng cột jsonb
 * không phải mảng" giống hệt — đọc chú thích ở hàm kia.
 */
export async function bangHnTheoBaoGia(ids: number[], db: DocSql = prisma) {
  const rows = await db.$queryRaw<{ quoteId: number; tables: any }[]>`
    SELECT q.id AS "quoteId",
           coalesce(jsonb_agg(x.t ORDER BY x.ord), '[]'::jsonb) AS "tables"
      FROM "Quote" q
      CROSS JOIN LATERAL (
        SELECT CASE WHEN jsonb_typeof(e.t->'items') = 'array'
                    THEN jsonb_set(e.t, '{items}', (SELECT coalesce(jsonb_agg(
                                                           CASE WHEN jsonb_typeof(it) = 'object'
                                                                THEN CASE WHEN coalesce(it->>'paidProof', '') <> ''
                                                                          THEN (it - 'paidProof') || '{"hasPaidProof":true}'::jsonb
                                                                          ELSE it - 'paidProof' END
                                                                ELSE it END
                                                         ), '[]'::jsonb)
                                                    FROM jsonb_array_elements(e.t->'items') it))
                    ELSE e.t END AS t, e.ord AS ord
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q."hnTables") = 'array'
                                         THEN q."hnTables" ELSE '[]'::jsonb END) WITH ORDINALITY AS e(t, ord)
      ) x
     WHERE q.id = ANY(${ids})
     GROUP BY q.id`;
  const out = new Map<number, any[]>();
  for (const r of rows) out.set(r.quoteId, Array.isArray(r.tables) ? r.tables : []);
  return out;
}
