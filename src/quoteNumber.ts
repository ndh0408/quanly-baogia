import { prisma } from "./db.js";

/**
 * Atomically allocate the next quote number for the given prefix and year.
 *
 * Uses an upsert that increments a counter row inside a transaction. Postgres
 * guarantees row-level locking on UPDATE, so concurrent callers serialize on
 * the same (prefix, year) row and each receives a unique sequential value.
 *
 * Format: `${prefix}${YY}${NNN}` e.g. "GN26001". Two-digit year keeps the
 * legacy "GN90" style short while avoiding rollover surprises across decades.
 */
export async function nextQuoteNumber(prefix = "GN", db = prisma) {
  const year = new Date().getFullYear();
  // upsert + atomic increment in one round-trip. When a `db` (tx) is passed the
  // counter increment shares the caller's transaction, so a failed quote.create
  // rolls back the number too (no "burned"/gap numbers).
  const counter = await db.quoteCounter.upsert({
    where: { prefix_year: { prefix, year } },
    create: { prefix, year, value: 1 },
    update: { value: { increment: 1 } },
  });
  const yy = String(year).slice(-2);
  const nn = String(counter.value).padStart(3, "0");
  return `${prefix}${yy}${nn}`;
}

/**
 * Next per-employee project code: `${prefix}_${NNN}` e.g. "FE_A26_001".
 * Uses the same atomic counter table keyed by (prefix, year=0) so each employee's
 * project code increments independently of the company quote-number sequence.
 */
export async function nextProjectCode(prefix: string, db = prisma) {
  const counter = await db.quoteCounter.upsert({
    where: { prefix_year: { prefix, year: 0 } },
    create: { prefix, year: 0, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}_${String(counter.value).padStart(3, "0")}`;
}

/**
 * Đẩy bộ đếm (prefix, year) lên ÍT NHẤT phần số của một số báo giá NHẬP TAY.
 *
 * VÌ SAO: `createQuote`/`updateQuote` cho phép client gửi thẳng `quoteNumber` (chuyển dữ liệu cũ,
 * script sửa hàng loạt). Số đó KHÔNG đi qua `nextQuoteNumber` nên bộ đếm đứng yên trong khi số
 * thật đã bị dùng. Lần cấp TỰ ĐỘNG kế tiếp sinh lại đúng những số đó, đụng `Quote.quoteNumber
 * @unique`, và ngân sách thử lại chỉ có 4 lượt → người dùng KHÁC nhận 409 "Số báo giá bị trùng"
 * cho một thao tác hoàn toàn hợp lệ, bấm lại vẫn hỏng.
 *
 * GREATEST chứ không phải gán đè: số tay THẤP hơn bộ đếm (sửa lại một báo giá cũ) KHÔNG được kéo
 * bộ đếm lùi — lùi là cấp lại số đã dùng, đúng cái lỗi này sinh ra để chặn.
 *
 * Số không khớp khuôn `${prefix}${YY}${digits}` thì BỎ QUA trong im lặng: `quoteNumber` là chuỗi
 * tự do (`z.string().max(40)`), quy ước riêng của khách hàng không suy ra được thứ tự nào cả.
 * Gọi TRONG cùng transaction với `quote.create` để lần tạo hỏng cũng cuốn theo bộ đếm.
 */
export async function syncQuoteCounter(quoteNumber: string, prefix = "GN", db = prisma) {
  const year = new Date().getFullYear();
  const yy = String(year).slice(-2);
  const khuon = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${yy}(\\d{1,9})$`);
  const m = khuon.exec(String(quoteNumber ?? ""));
  if (!m) return;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n <= 0) return;
  await db.$executeRaw`
    INSERT INTO "QuoteCounter" ("prefix", "year", "value") VALUES (${prefix}, ${year}, ${n})
    ON CONFLICT ("prefix", "year") DO UPDATE SET "value" = GREATEST("QuoteCounter"."value", EXCLUDED."value")`;
}
