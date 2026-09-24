/**
 * DB-04 — EXTENSION XOÁ MỀM KHÔNG ĐƯỢC CHẠY RA NGOÀI INTERACTIVE TRANSACTION; QUAN HỆ LỒNG PHẢI LỌC
 * BẢN GHI ĐÃ XOÁ MỀM Ở CHỖ CẦN.
 *
 * (a) `tx.user.findUnique` từng bị đổi thành `base.user.findFirst` — chạy trên client gốc, NGOÀI
 *     transaction → không thấy hàng chính transaction đó vừa tạo.
 * (b) `tx.<model mềm>.delete` cũng chạy trên client gốc (không rollback theo tx). Hiện không ai viết
 *     vậy; bài tĩnh ở đây cấm người viết mới.
 * (c) GET /api/meta/companies lồng `templates` — mẫu đã xoá mềm (active vẫn true) vẫn hiện.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { listCompanies } from "../src/services/metaService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAG = `dbtx${Date.now()}`;

describe("DB-04 — cấm xoá mềm bên trong transaction (tĩnh)", () => {
  it("không tệp nào trong src/ gọi tx.<model xoá mềm>.delete/deleteMany", () => {
    const tep = (dir, out = []) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) tep(p, out); else if (/\.ts$/.test(e.name)) out.push(p);
      }
      return out;
    };
    const mau = /\btx\.(user|company|quoteTemplate|quote|customer|product|personnelRecord|employee)\.delete(Many)?\(/;
    const vi = tep(path.join(ROOT, "src")).filter((f) => mau.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(vi, "xoá mềm trong transaction chạy trên client gốc, không rollback theo tx — dùng tx.<model>.update({ data: { deletedAt } })").toEqual([]);
  });
});

describe.runIf(dbAvailable)("DB-04 — hành vi", () => {
  let company;
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("tx.user.findUnique thấy hàng chính transaction vừa tạo", async () => {
    let thay = null;
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { username: `${TAG}-u`, displayName: "x", passwordHash: bcrypt.hashSync("x", 4) } });
      thay = await tx.user.findUnique({ where: { id: u.id } });
    });
    expect(thay, "findUnique chạy ngoài transaction").not.toBeNull();
    // Và findUnique ở ngoài vẫn lọc bản ghi đã xoá mềm như cũ.
    const u = await prisma.user.findFirst({ where: { username: `${TAG}-u` } });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: u.id }, includeDeleted: true })).not.toBeNull();
  });

  it("listCompanies không trả mẫu đã xoá mềm", async () => {
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: `${TAG} Co`, address: "x" } });
    const song = await prisma.quoteTemplate.create({ data: { code: `${TAG}-song`, name: "Sống", companyId: company.id, filePath: "templates/GN_KhongNgay.xlsx" } });
    const xoa = await prisma.quoteTemplate.create({ data: { code: `${TAG}-xoa`, name: "Đã xoá", companyId: company.id, filePath: "templates/GN_KhongNgay.xlsx" } });
    await prisma.quoteTemplate.delete({ where: { id: xoa.id } });   // xoá mềm, active vẫn true
    const c = (await listCompanies()).find((x) => x.id === company.id);
    expect(c.templates.map((t) => t.id)).toEqual([song.id]);
  });
});
