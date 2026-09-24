/**
 * DB-12 — TRANG QUẢN LÝ DỰ ÁN / HOÁ ĐƠN (trần 2000) VÀ Ô CHỌN DỰ ÁN NHÂN SỰ (trần 300) PHẢI BÁO KHI BỊ CẮT.
 *
 * Trước bản vá: cắt cứng, không cờ nào — dự án cũ nhất (công nợ cũ chưa thu) biến mất im lặng.
 * Dữ liệu dựng bằng createMany cho MỘT manager (phạm vi "của mình"). NHƯNG admin ở bài khác chạy song
 * song vẫn thấy chúng: /quotes/projects xếp theo ngày báo giá mới nhất, /personnel/projects theo ngày
 * tạo — 2000 dự án mang ngày LÚC NÀY chen lên đầu và đẩy dự án của bài kia ra khỏi trần 2000 (đo được
 * 2026-09-24: fe-du-an-tra-y-kien-khach đỏ "không thấy báo giá vừa tạo"). Nên chúng mang ngày CŨ (2001):
 * vẫn đủ số để chạm trần trong phạm vi của manager này, mà luôn xếp cuối danh sách của người khác.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { TRAN_DU_AN } from "../src/services/quoteService.js";
import { TRAN_CHON_DU_AN } from "../src/services/personnelService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `dbdc${Date.now()}`;
const MAT_KHAU = "BaoCat1234!ok";
const NGAY_CU = new Date("2001-01-01T00:00:00.000Z");   // xem chú thích đầu tệp

describe.runIf(dbAvailable)("DB-12 — cờ truncated", () => {
  let app, company, u, ag;
  const taoN = (n, tu = 0) => prisma.quote.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      quoteNumber: `${TAG}-${tu + i}`, title: `${TAG} bg ${tu + i}`, toCompany: "K", companyId: company.id, createdById: u.id,
      fromContact: "x", fromAddress: "x", city: "x", quoteDate: NGAY_CU, createdAt: NGAY_CU, status: "converted",
    })),
  });

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Co", address: "x", quotePrefix: "DC" } });
    u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: "U", role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: u.username, password: MAT_KHAU })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: u?.id }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("dưới trần → truncated false; chạm trần → true (ô chọn dự án Nhân sự)", async () => {
    await taoN(TRAN_CHON_DU_AN - 1);
    expect((await ag.get("/api/personnel/projects")).body.truncated).toBe(false);
    await taoN(1, TRAN_CHON_DU_AN - 1);
    const r = await ag.get("/api/personnel/projects");
    expect(r.body.truncated, "cắt im lặng").toBe(true);
  }, 120_000);

  it("trang Quản lý dự án / Hoá đơn chạm trần → truncated true", async () => {
    const co = await prisma.quote.count({ where: { createdById: u.id } });
    expect((await ag.get("/api/quotes/projects")).body.truncated).toBe(false);
    await taoN(TRAN_DU_AN - co, co);
    const r = await ag.get("/api/quotes/projects");
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBe(TRAN_DU_AN);
    expect(r.body.truncated, "cắt im lặng").toBe(true);
  }, 120_000);
});
