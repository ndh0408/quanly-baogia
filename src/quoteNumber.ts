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
 * Mã dự án kế tiếp của MỘT nhân viên: `${prefix}${YY}_${NNN}` — vd "FP_A" + 2026 → "FP_A26_001".
 *
 * NĂM DO ĐÂY THÊM, KHÔNG PHẢI NGƯỜI GÕ. `User.projectCode` chỉ giữ phần chữ người đặt ("FP_A").
 * Trước 2026-09-07 quản trị gõ thẳng "FP_A26" vào mã nhân viên và hàm này chỉ nối "_001", nên
 * sang năm mới mã vẫn đẻ ra "FP_A26_004": sai năm, và bộ đếm KHÔNG BAO GIỜ reset.
 *
 * Bộ đếm khoá theo (prefix, NĂM THẬT) — cùng bảng, cùng cách khoá hàng nguyên tử với
 * `nextQuoteNumber` ở trên — nên đầu mỗi năm nó tự bắt đầu lại từ 001 mà không cần ai làm gì.
 * (Quy ước cũ khoá theo (prefix-có-sẵn-năm, year=0); migration 20260907120000 dựng lại bộ đếm
 * theo khoá mới TỪ CHÍNH các mã đã cấp, xem SQL ở đó.)
 */
export async function nextProjectCode(prefix: string, db = prisma) {
  const year = new Date().getFullYear();
  const counter = await db.quoteCounter.upsert({
    where: { prefix_year: { prefix, year } },
    create: { prefix, year, value: 1 },
    update: { value: { increment: 1 } },
  });
  const yy = String(year).slice(-2);
  return `${prefix}${yy}_${String(counter.value).padStart(3, "0")}`;
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

/**
 * Đẩy bộ đếm MÃ DỰ ÁN lên ít nhất số của một mã ĐÃ TỒN TẠI — bản đối xứng của `syncQuoteCounter`.
 *
 * VÌ SAO CẦN: vòng thử lại P2002 ở createQuote/duplicateQuote chạy lại NGUYÊN transaction, mà
 * transaction hỏng cuốn theo cả lần tăng bộ đếm (chủ ý "không đốt số" của nextProjectCode). Nên
 * nếu không ghi nhận số vừa bị chiếm ra NGOÀI transaction thì lượt sau sinh LẠI ĐÚNG mã đó — bốn
 * lượt cùng một mã rồi 409. Đây là ca CÓ THẬT với mọi mã không do bộ đếm cấp: dữ liệu chuyển từ
 * hệ cũ, hoặc bộ đếm bị dựng lại (migration 20260907120000).
 *
 * GREATEST chứ không gán đè: mã THẤP hơn bộ đếm không được kéo bộ đếm lùi — lùi là cấp lại mã đã dùng.
 */
export async function syncProjectCodeCounter(projectCode: string, prefix: string, db = prisma) {
  if (!prefix) return;
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${esc}(\\d{2})_(\\d{1,9})$`).exec(String(projectCode ?? ""));
  if (!m) return;
  const year = 2000 + Number(m[1]);
  const n = Number(m[2]);
  if (!Number.isSafeInteger(n) || n <= 0) return;
  await db.$executeRaw`
    INSERT INTO "QuoteCounter" ("prefix", "year", "value") VALUES (${prefix}, ${year}, ${n})
    ON CONFLICT ("prefix", "year") DO UPDATE SET "value" = GREATEST("QuoteCounter"."value", EXCLUDED."value")`;
}
