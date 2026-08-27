#!/usr/bin/env node
// Chặn SQL HUỶ DỮ LIỆU lọt vào migration mà không ai ký tên.
//
//   node scripts/ci/check-destructive-sql.mjs           # liệt kê
//   node scripts/ci/check-destructive-sql.mjs --check   # có câu lệnh huỷ chưa khai → exit 1
//
// ── LỖ ĐANG BỊT ──────────────────────────────────────────────────────────────
// Repo đã có gác TRÔI SCHEMA (tests/vdb-schema-index-drift.test.js chạy `prisma migrate diff` giữa
// CSDL đã deploy và schema.prisma) và đã chặn `db:push` bằng một npm script báo lỗi. Cả hai đều
// KHÔNG đọc nội dung migration: một `DROP TABLE`/`DROP COLUMN` viết trong file .sql là hợp lệ với
// cả hai — nó làm schema và CSDL KHỚP NHAU, chỉ có dữ liệu là mất. Đã đo lúc viết file này:
// `grep -rn "DROP COLUMN|DROP TABLE|destructive" scripts/ci/ .github/` không ra dòng nào, trong khi
// prisma/migrations/ đang chứa 4 migration huỷ dữ liệu thật.
//
// Gác này KHÔNG cấm huỷ dữ liệu — đôi khi phải huỷ. Nó buộc mỗi lần huỷ phải có tên migration
// trong CHO_PHEP dưới đây kèm lý do, tức phải có người đọc và đồng ý. Sửa file này là một dòng
// trong diff mà người review nhìn thấy, thay vì một dòng SQL lẫn giữa 200 dòng migration.
//
// ── CỐ Ý KHÔNG BẮT ───────────────────────────────────────────────────────────
//   • `DROP TYPE` / `DROP CONSTRAINT`: không xoá hàng nào. Prisma sinh cặp "tạo enum mới →
//     DROP TYPE cũ" cho MỌI lần đổi enum; bắt nó thì gác thành tiếng ồn và người ta sẽ thêm
//     allowlist theo phản xạ.
//   • `DROP INDEX` của index do Prisma quản: cũng là tiếng ồn — Prisma tự dựng lại.
//     NHƯNG XEM `indexThoTrongMigrations` BÊN DƯỚI: `DROP INDEX` của index tạo bằng SQL THÔ thì
//     BỊ BẮT, vì đó là mối nguy đã xảy ra thật (2026-08-27, xem chú thích ở đó).
//   • Câu lệnh nằm trong CHÚ THÍCH: các migration ở repo này ghi hướng dẫn ROLLBACK dạng
//     `-- ROLLBACK: DROP COLUMN ...`. Bộ quét bỏ chú thích `--` và `/* */` TRƯỚC khi so mẫu.
//   • `UPDATE ... WHERE`: sửa dữ liệu tại chỗ, quá phổ biến trong migration backfill để gác nổi.
//     `DELETE FROM` KHÔNG kèm WHERE thì có bắt (xoá sạch bảng).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const THU_MUC_MIGRATION = "prisma/migrations";

/**
 * Migration ĐƯỢC PHÉP huỷ dữ liệu, kèm lý do. Khoá là TÊN THƯ MỤC migration.
 * Thêm dòng ở đây = tuyên bố "tôi đã đọc và chấp nhận mất dữ liệu đó".
 */
export const CHO_PHEP = new Map([
  ["20260617000002_remove_quote_expiry", "bỏ tính năng hết hạn báo giá: hai cột expiredAt/validUntil không còn ý nghĩa nghiệp vụ"],
  ["20260617000003_drop_approval_matrix", "bỏ bảng ma trận duyệt cũ, thay bằng luồng duyệt trong Quote"],
  ["20260619000001_drop_billing", "gỡ toàn bộ phần thanh toán/gói cước (Subscription/Plan/UsageRecord) — công cụ nội bộ, không bán"],
  ["20260619000002_drop_api_keys", "gỡ API key tĩnh, thay bằng JWT có hạn"],
]);

/** Bỏ chú thích SQL (`-- …` và `/* … *\/`) để không bắt nhầm hướng dẫn ROLLBACK. */
export function boChuThich(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

// Mỗi mẫu kèm nhãn để thông báo lỗi nói được HUỶ CÁI GÌ, không chỉ "có gì đó nguy hiểm".
const MAU_HUY = [
  { ten: "DROP TABLE", re: /\bDROP\s+TABLE\b/i },
  { ten: "DROP COLUMN", re: /\bDROP\s+COLUMN\b/i },
  { ten: "TRUNCATE", re: /\bTRUNCATE\b/i },
  { ten: "DROP SCHEMA", re: /\bDROP\s+SCHEMA\b/i },
  { ten: "DROP DATABASE", re: /\bDROP\s+DATABASE\b/i },
];

// ── INDEX TẠO BẰNG SQL THÔ: PRISMA SẼ MUỐN XOÁ CHÚNG, MÃI MÃI ───────────────
// CHUYỆN ĐÃ XẢY RA (2026-08-27). Thêm đúng một cột nullable vào `AuditEvent` rồi chạy
// `prisma migrate dev`, Prisma sinh ra migration kèm 11 câu `DROP INDEX`:
//     Quote_title_trgm · Quote_toCompany_trgm · Quote_quoteNumber_trgm · Quote_searchText_trgm_idx
//     Customer_name_trgm · Customer_taxCode_trgm · Customer_searchText_trgm_idx
//     Product_name_trgm · Product_sku_trgm · PersonnelRecord_searchText_trgm_idx · Venue_tags_idx
//
// Vì sao: `schema.prisma` KHÔNG diễn đạt được `USING gin (... gin_trgm_ops)`. Prisma nhìn CSDL,
// thấy index "không có trong schema", và kết luận là thừa. Nó sẽ làm thế Ở MỌI LẦN `migrate dev`
// sau này — đây không phải tai nạn một lần.
//
// Vì sao gác cũ không thấy: nó cố ý bỏ qua `DROP INDEX` với lý do "không xoá hàng nào". Đúng, mà
// thiếu — mất index tìm kiếm KHÔNG ném lỗi nào, không mất hàng nào; mọi truy vấn tìm báo giá /
// khách hàng / nhân sự chỉ đơn giản rơi về quét tuần tự và chậm dần. Đó là hình dạng tệ nhất của
// một sự cố production: không có tín hiệu.
//
// Cách bắt HẸP để không thành tiếng ồn: chỉ soi index được tạo bằng SQL Prisma không sinh ra được
// (`USING gin/gist/brin/spgist`, hoặc `CONCURRENTLY`). Index thường do Prisma quản thì bỏ qua như cũ.
const RE_TAO_INDEX_THO =
  /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?[\s\S]*?(?:USING\s+(?:gin|gist|brin|spgist)\b|CONCURRENTLY)/gi;

/**
 * Tên mọi index được TẠO bằng SQL thô trong toàn bộ prisma/migrations/.
 * Hàm THUẦN theo nghĩa: nhận danh sách {ten, sql}, không tự đọc đĩa.
 */
export function indexThoTrongMigrations(files) {
  const ra = new Set();
  for (const { sql } of files) {
    const sach = boChuThich(sql);
    // `CONCURRENTLY` có thể đứng trước tên; chạy thêm một vòng bắt riêng cho chắc.
    for (const m of sach.matchAll(RE_TAO_INDEX_THO)) ra.add(m[1]);
    for (const m of sach.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi)) ra.add(m[1]);
  }
  return ra;
}

/** Index THÔ bị DROP trong một file SQL. Trả danh sách TÊN. */
export function dropIndexTho(sql, tenIndexTho) {
  const sach = boChuThich(sql);
  const ra = [];
  for (const m of sach.matchAll(/DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_.]+)"?/gi)) {
    const ten = m[1].includes(".") ? m[1].split(".").pop() : m[1];
    if (tenIndexTho.has(ten)) ra.push(ten);
  }
  return ra;
}

/** Câu lệnh huỷ dữ liệu trong MỘT file SQL. Hàm THUẦN: nhận chuỗi, trả danh sách nhãn. */
export function lenhHuyTrongSql(sql) {
  const sach = boChuThich(sql);
  const thay = MAU_HUY.filter(({ re }) => re.test(sach)).map(({ ten }) => ten);
  // DELETE FROM không kèm WHERE = xoá sạch bảng. Cắt theo dấu `;` để một câu lệnh khác có WHERE
  // đứng sau không "che" cho câu lệnh này.
  for (const cau of sach.split(";")) {
    if (/\bDELETE\s+FROM\b/i.test(cau) && !/\bWHERE\b/i.test(cau)) { thay.push("DELETE FROM không WHERE"); break; }
  }
  return thay;
}

/** Đọc prisma/migrations/ → [{ ten, file, lenh[] }] cho các migration CÓ câu lệnh huỷ. */
export function quetMigrations(root = ROOT) {
  const goc = join(root, THU_MUC_MIGRATION);
  // ĐỌC HAI LƯỢT. Lượt một gom tên mọi index tạo bằng SQL thô trên TOÀN BỘ lịch sử migration —
  // phải biết trước thì lượt hai mới phân biệt được `DROP INDEX` nào là nguy hiểm.
  const files = [];
  for (const ten of readdirSync(goc).sort()) {
    const duong = join(goc, ten);
    if (!statSync(duong).isDirectory()) continue;
    try { files.push({ ten, sql: readFileSync(join(duong, "migration.sql"), "utf8") }); } catch { /* thư mục không có migration.sql */ }
  }
  const tenIndexTho = indexThoTrongMigrations(files);

  const ra = [];
  for (const { ten, sql } of files) {
    const lenh = lenhHuyTrongSql(sql);
    const idx = dropIndexTho(sql, tenIndexTho);
    if (idx.length) lenh.push(`DROP INDEX (SQL thô): ${idx.join(", ")}`);
    if (lenh.length) ra.push({ ten, file: `${THU_MUC_MIGRATION}/${ten}/migration.sql`, lenh });
  }
  return ra;
}

/** Migration huỷ dữ liệu mà CHƯA khai trong allowlist. Hàm THUẦN để test dựng dữ liệu giả. */
export const chuaKhai = (danhSach, choPhep = CHO_PHEP) => danhSach.filter((m) => !choPhep.has(m.ten));

function main() {
  const args = process.argv.slice(2);
  const danhSach = quetMigrations();
  const thieu = chuaKhai(danhSach);

  if (!args.includes("--check")) {
    for (const m of danhSach) {
      console.log(`${CHO_PHEP.has(m.ten) ? "✓" : "✖"} ${m.ten.padEnd(46)} ${m.lenh.join(", ")}`);
    }
    console.log(`\nTỔNG: ${danhSach.length} migration có SQL huỷ dữ liệu, ${thieu.length} chưa khai.`);
    return;
  }

  if (thieu.length) {
    console.error(`✖ ${thieu.length} migration chứa SQL HUỶ DỮ LIỆU mà chưa được khai:`);
    for (const m of thieu) console.error(`    ${m.file}  →  ${m.lenh.join(", ")}`);
    console.error("  Nếu việc huỷ là CỐ Ý: thêm tên thư mục migration vào CHO_PHEP trong");
    console.error("  scripts/ci/check-destructive-sql.mjs kèm lý do — đó là chữ ký của người chịu trách nhiệm.");
    console.error("  Nếu KHÔNG cố ý: viết migration chỉ-thêm (thêm cột mới, backfill, đổi mã đọc), rồi xoá");
    console.error("  cột cũ ở một bản phát hành SAU khi chắc chắn không còn ai đọc.");
    process.exit(1);
  }

  // Khai thừa cũng là lỗi: migration đã đổi tên/biến mất mà dòng cho phép ở lại thì lần sau một
  // migration MỚI trùng tên được tha im lặng.
  const co = new Set(danhSach.map((m) => m.ten));
  const thua = [...CHO_PHEP.keys()].filter((k) => !co.has(k));
  if (thua.length) {
    console.error(`✖ CHO_PHEP trỏ vào migration không còn (hoặc không còn SQL huỷ): ${thua.join(", ")}`);
    process.exit(1);
  }
  console.log(`✓ ${danhSach.length} migration huỷ dữ liệu — tất cả đều được khai tường minh kèm lý do`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
