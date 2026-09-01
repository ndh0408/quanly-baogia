// Đo số block TOAST một bảng phải đụng, VÀ nói rõ phép đo ấy có sạch không.
//
// ── VÌ SAO CẦN MỘT HELPER RIÊNG ─────────────────────────────────────────────
// `pg_statio_all_tables` là bộ đếm CẤP CƠ SỞ DỮ LIỆU. Nó cộng block của MỌI backend đang đụng
// bảng đó, gồm cả autovacuum. Hai file test dùng kỹ thuật này trên cùng bảng `QuoteItem`
// (b2-update-quote-no-image-read, db3-snapshot-no-images), và cả hai đều từng hoặc đang nhấp nháy
// vì hai nguồn nhiễu KHÁC NHAU:
//
//   1. FILE TEST KHÁC chạy song song cũng đọc ảnh hạng mục trong cùng cửa sổ đo.
//   2. AUTOVACUUM quét bảng TOAST giữa hai lần đọc bộ đếm.
//
// Nguồn (1) từng được ghi lại trong chú thích của b2. Nguồn (2) thì không, và nó là nguồn còn lại
// sau khi đã chạy riêng: ĐO ĐƯỢC ngày 2026-08-27, chạy MỘT MÌNH file b2 vẫn đỏ 1/5 rồi 1/12 lượt,
// với mức tăng 10843 block trong khi một lần đọc đầy đủ chỉ tốn 612 — gấp 17 lần, không phải dao
// động thống kê.
//
// Cách xử lý ở đây KHÔNG phải "chạy lại cho tới khi xanh". Nó là: đo kèm số lần vacuum/analyze
// của chính bảng đó VÀ CỦA BẢNG TOAST CỦA NÓ, rồi chỉ CHẤP NHẬN lượt đo nào không có vacuum chen vào. Bẩn thì đo lại;
// bẩn liên tiếp thì ném lỗi NÓI ĐÚNG nguyên nhân, thay vì buộc tội mã nghiệp vụ bằng một con số
// mà chính bộ đo biết là vô nghĩa.
import { prisma } from "../../src/db.js";

const nghi = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Số block TOAST bảng đã đụng + số lần bảng đã bị vacuum/analyze.
 *
 * Postgres gom thống kê trong TỪNG backend và chỉ đẩy lên bộ nhớ chung sau PGSTAT_MIN_INTERVAL
 * (1 giây), mà kết nối của Prisma nằm trong pool nên đo liền tay sẽ ra 0 ở MỌI phép đo. Nghỉ hơn
 * một giây rồi bắn vài truy vấn rỗng để các backend đó đẩy thống kê.
 */
export async function toastBlocks(bang) {
  await nghi(1200);
  for (let i = 0; i < 8; i++) await prisma.$queryRawUnsafe("SELECT 1");
  const c = new (await import("pg")).default.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("SELECT pg_stat_force_next_flush()");
    const r = await c.query(
      "SELECT coalesce(toast_blks_hit,0) + coalesce(toast_blks_read,0) AS n FROM pg_statio_all_tables WHERE relname = $1",
      [bang]);
    // ⚠️ PHẢI ĐẾM CẢ BẢNG TOAST, KHÔNG CHỈ BẢNG CHÍNH.
    // Bản đầu chỉ `WHERE relname = $1` — tức chỉ nhìn bảng chính. Nhưng thứ đang đo là
    // `toast_blks_*`, và kẻ gây nhiễu là autovacuum của BẢNG TOAST, vốn có relname RIÊNG dạng
    // `pg_toast_<oid>`. ĐO ĐƯỢC: QuoteItem có autovacuum_count = 30, còn pg_toast_16606 (bảng
    // TOAST của chính nó) = 57. Cờ `sach` cũ mù đúng nguồn nhiễu mà nó sinh ra để bắt.
    // Bản đầu vẫn làm giảm nhấp nháy (1/5 → 0/8) nhưng KHÔNG PHẢI nhờ cờ — nhờ việc ĐO LẠI.
    // Đừng bỏ vế TOAST đi vì "thấy thừa".
    const v = await c.query(
      `SELECT coalesce(sum(s.vacuum_count + s.autovacuum_count + s.analyze_count + s.autoanalyze_count), 0) AS n
         FROM pg_stat_all_tables s
        WHERE s.relname = $1
           OR s.relid = (SELECT c2.reltoastrelid FROM pg_class c2 WHERE c2.relname = $1)`, [bang]);
    return { blocks: Number(r.rows[0]?.n ?? 0), don: Number(v.rows[0]?.n ?? 0) };
  } finally { await c.end(); }
}

/** Một lượt đo: chạy `viec()` giữa hai lần đọc bộ đếm, kèm cờ `sach`. */
export async function doMotLuot(bang, viec) {
  const truoc = await toastBlocks(bang);
  const kq = await viec();
  const sau = await toastBlocks(bang);
  return { tang: sau.blocks - truoc.blocks, sach: sau.don === truoc.don, kq };
}

/**
 * Đo tới khi được một lượt SẠCH (không vacuum/analyze chen vào). Bẩn cả `lan` lượt thì ném lỗi.
 *
 * `viec` bị gọi NHIỀU LẦN khi phải đo lại — nên nó phải lặp lại được. Việc chỉ-đọc thì mặc nhiên
 * đạt; việc có GHI (một lượt PUT chẳng hạn) phải tự lo cho lần chạy thứ hai không đụng lần đầu.
 */
/**
 * ⚠️ HAI FILE DÙNG HELPER NÀY PHẢI CHẠY TRONG HAI LỆNH `vitest run` RIÊNG.
 *
 * `tests/b2-update-quote-no-image-read.test.js` và `tests/db3-snapshot-no-images.test.js` đều đọc
 * ảnh hạng mục của CÙNG bảng `QuoteItem`. Gộp chúng vào một lệnh thì vitest chạy song song và
 * chúng tự nhiễu nhau — `pg_statio_all_tables` là bộ đếm CẤP CSDL, nó cộng cả hai.
 * ĐÃ THỬ: gộp một lệnh → db3 đỏ với "TOAST nhảy 3637 block" trong khi ngưỡng là 100.
 * `doSach` KHÔNG cứu được ca này: nó chỉ chống nhiễu VACUUM, không chống được một tiến trình khác
 * đang đọc cùng bảng.
 * Xem `npm run test:toast` và bước [1b] của scripts/verify-local.sh — cả hai đều chạy LẦN LƯỢT.
 */
export async function doSach(bang, viec, lan = 4) {
  let cuoi = null;
  for (let i = 0; i < lan; i++) {
    cuoi = await doMotLuot(bang, viec);
    if (cuoi.sach) return cuoi;
  }
  throw new Error(
    `${lan} lượt đo LIÊN TIẾP đều bị vacuum/analyze chen vào cửa sổ đo bảng ${bang} — con số cuối ` +
    `(${cuoi.tang} block) KHÔNG nói lên điều gì về số lần đọc ảnh. Đây là lỗi của BỘ ĐO, không ` +
    `phải của mã nghiệp vụ. Để CSDL yên vài phút rồi đo lại.`);
}
