// CẠN POOL PHẢI TRẢ 503 + Retry-After — và phải đi qua ĐƯỜNG THẬT, không phải lỗi tự chế.
//
// ── LỖI ĐÃ ĐO ───────────────────────────────────────────────────────────────
// `src/middleware.ts` có sẵn một nhánh `P2024` với thông điệp tiếng Việt tử tế và Retry-After.
// Nhánh đó là MÃ CHẾT. Đo bằng cách dựng pool max=1, chiếm hết, rồi gọi Prisma:
//     name = "Error"   code = undefined   meta = null
//     message = "timeout exceeded when trying to connect"
// node-pg ném một Error TRẦN; `convertDriverError` của adapter Prisma thử phân loại
// (`isSocketError` đòi code+syscall+errno, `isDriverError` đòi code+message+severity) rồi trượt
// hết và ném nguyên xi. Cổng vào bảng ánh xạ của errorHandler là `/^P\d{4}$/` nên không khớp →
// status 500 → thân trả "Lỗi server", KHÔNG có Retry-After, và mỗi lượt một sự kiện Sentry.
//
// ── VÌ SAO BÀI CŨ KHÔNG BẮT ĐƯỢC ────────────────────────────────────────────
// `tests/qc-prisma-error-map.test.js` tự chế `{ code: "P2024" }` rồi đẩy vào errorHandler. Nó kiểm
// bảng ánh xạ, KHÔNG kiểm việc lỗi thật có bao giờ MANG mã đó không. Bài này đi từ đầu kia: dựng
// lỗi bằng chính node-pg + adapter Prisma, rồi đòi errorHandler xử lý đúng.
import { describe, it, expect } from "vitest";
import pg from "pg";

const URL_DB = process.env.DATABASE_URL;
const moTa = URL_DB ? describe : describe.skip;

/** Dựng ĐÚNG lỗi mà pool cạn sinh ra — qua node-pg + adapter Prisma, không tự chế. */
async function loiCanPoolThat() {
  const pool = new pg.Pool({ connectionString: URL_DB, max: 1, connectionTimeoutMillis: 600 });
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const giu = await pool.connect(); // chiếm trọn pool
  try {
    await prisma.$queryRawUnsafe("select 1");
    return null; // không cạn được → bài dưới sẽ đỏ, và đỏ đúng lý do
  } catch (e) {
    return e;
  } finally {
    giu.release();
    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
  }
}

moTa("cạn pool CSDL", () => {
  it("lỗi thật KHÔNG mang mã Prisma — đây là gốc của vấn đề", async () => {
    const e = await loiCanPoolThat();
    expect(e, "không tái hiện được cạn pool → bài dưới vô nghĩa").toBeTruthy();
    expect(e.code, `code = ${JSON.stringify(e.code)}`).toBeUndefined();
    expect(String(e.message)).toMatch(/timeout exceeded when trying to connect/i);
    // Chính vế này là lý do nhánh P2024 chết: cổng vào bảng ánh xạ đòi /^P\d{4}$/.
    expect(typeof e.code === "string" && /^P\d{4}$/.test(e.code)).toBe(false);
  }, 30_000);

  it("errorHandler biến nó thành 503 + Retry-After + thông điệp tiếng Việt", async () => {
    const e = await loiCanPoolThat();
    expect(e).toBeTruthy();
    const { errorHandler } = await import("../src/middleware.js");

    const dat = {};
    const res = {
      headersSent: false,
      statusCode: 0,
      than: null,
      setHeader(k, v) { dat[k] = v; },
      status(s) { this.statusCode = s; return this; },
      json(b) { this.than = b; return this; },
    };
    const req = { id: "t", path: "/api/quotes", method: "PUT", session: {} };
    errorHandler(e, req, res, () => {});

    expect(res.statusCode, "cạn pool là QUÁ TẢI THOÁNG QUA, không phải 500").toBe(503);
    expect(dat["Retry-After"], "thiếu Retry-After → client và proxy thử lại NGAY, thành bão retry").toBe("5");
    expect(res.than.error).toMatch(/hệ thống đang bận|kết nối cơ sở dữ liệu/i);
    expect(res.than.error).not.toBe("Lỗi server");
  }, 30_000);
});
