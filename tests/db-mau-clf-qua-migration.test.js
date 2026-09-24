/**
 * DB-02 — HAI MẪU COLORFULL (clofull_banner, clofull_conngay) PHẢI ĐI BẰNG MIGRATION, KHÔNG CHỈ SEED.
 *
 * deploy.sh chỉ chạy `prisma migrate deploy`. Mẫu chỉ nằm trong prisma/seed.js thì production lên
 * bản mới mà không có hàng QuoteTemplate nào cho chúng → trình tạo báo giá Colorfull thiếu hai mẫu.
 *
 * Bài này chạy migration dữ liệu TRONG MỘT TRANSACTION rồi rollback, nên không để lại gì trong CSDL
 * test dùng chung. Nó khoá bốn điều:
 *   1. có công ty clofull → migration chèn đủ hai mẫu, ĐÚNG giá trị trong seed.js;
 *   2. chạy lại → không nhân đôi, không lỗi;
 *   3. mẫu đã có (quản trị đã đổi tên) → GIỮ NGUYÊN, không bị đè;
 *   4. chưa có công ty clofull (CSDL rỗng) → không chèn gì, không lỗi.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const SQL = readFileSync(new URL("../prisma/migrations/20260923091000_clf_templates/migration.sql", import.meta.url), "utf8");
const SEED = readFileSync(new URL("../prisma/seed.js", import.meta.url), "utf8");
const MA = ["clofull_banner", "clofull_conngay"];

/** Giá trị `create` của một mẫu trong seed.js — nguồn sự thật mà migration phải khớp. */
function giaTriSeed(code) {
  const i = SEED.indexOf(`where: { code: "${code}" }`);
  expect(i, `seed.js không còn mẫu ${code}`).toBeGreaterThan(-1);
  const khoi = SEED.slice(i, SEED.indexOf("update:", i));
  return { name: /name: "([^"]+)"/.exec(khoi)[1], filePath: /filePath: "([^"]+)"/.exec(khoi)[1] };
}

class Rollback extends Error {}
/** Chạy `fn(tx)` trong transaction rồi LUÔN rollback. Trả về giá trị fn trả về. */
async function trongTxRoiHuy(fn) {
  let kq;
  try {
    await prisma.$transaction(async (tx) => { kq = await fn(tx); throw new Rollback(); }, { timeout: 30_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return kq;
}

const docMau = (tx) =>
  tx.$queryRawUnsafe(
    `SELECT t.code, t.name, t."filePath", c.code AS company FROM "QuoteTemplate" t JOIN "Company" c ON c.id = t."companyId" WHERE t.code = ANY($1::text[]) ORDER BY t.code`,
    MA
  );

// Dựng đúng trạng thái production trước bản vá: có công ty clofull, CHƯA có hai mẫu mới.
async function veTrangThaiProd(tx) {
  await tx.$executeRawUnsafe(
    `INSERT INTO "Company" (code, name, address, "quotePrefix", "updatedAt") VALUES ('clofull', 'Colorfull', 'x', 'CLF', now())
     ON CONFLICT (code) DO UPDATE SET "deletedAt" = NULL`
  );
  // Gỡ tham chiếu (nếu bài khác đã tạo sheet dùng hai mẫu này) rồi xoá — tất cả trong tx sẽ rollback.
  await tx.$executeRawUnsafe(`UPDATE "QuoteSheet" SET "templateId" = NULL WHERE "templateId" IN (SELECT id FROM "QuoteTemplate" WHERE code = ANY($1::text[]))`, MA).catch(() => {});
  await tx.$executeRawUnsafe(`DELETE FROM "QuoteTemplate" WHERE code = ANY($1::text[])`, MA);
}

describe.runIf(dbAvailable)("DB-02 — migration mẫu CLF", () => {
  it("có công ty clofull → chèn đủ hai mẫu, giá trị khớp seed.js; chạy hai lần không nhân đôi", async () => {
    const rows = await trongTxRoiHuy(async (tx) => {
      await veTrangThaiProd(tx);
      await tx.$executeRawUnsafe(SQL);
      await tx.$executeRawUnsafe(SQL);
      return docMau(tx);
    });
    expect(rows.map((r) => r.code)).toEqual(MA);
    for (const r of rows) {
      const s = giaTriSeed(r.code);
      expect({ name: r.name, filePath: r.filePath, company: r.company }).toEqual({ ...s, company: "clofull" });
    }
  });

  it("mẫu ĐÃ có (quản trị đã đổi tên) → giữ nguyên, không bị đè", async () => {
    const rows = await trongTxRoiHuy(async (tx) => {
      await veTrangThaiProd(tx);
      await tx.$executeRawUnsafe(
        `INSERT INTO "QuoteTemplate" (code, name, "companyId", "filePath", "updatedAt")
         SELECT 'clofull_banner', 'Tên quản trị tự đặt', id, 'templates/khac.xlsx', now() FROM "Company" WHERE code = 'clofull'`
      );
      await tx.$executeRawUnsafe(SQL);
      return docMau(tx);
    });
    const banner = rows.find((r) => r.code === "clofull_banner");
    expect(banner.name).toBe("Tên quản trị tự đặt");
    expect(banner.filePath).toBe("templates/khac.xlsx");
    expect(rows.filter((r) => r.code === "clofull_conngay")).toHaveLength(1);
  });

  it("chưa có công ty clofull → không chèn gì, không lỗi", async () => {
    const rows = await trongTxRoiHuy(async (tx) => {
      await veTrangThaiProd(tx);
      await tx.$executeRawUnsafe(`UPDATE "Company" SET "deletedAt" = now() WHERE code = 'clofull'`);
      await tx.$executeRawUnsafe(SQL);
      return docMau(tx);
    });
    expect(rows).toHaveLength(0);
  });
});
