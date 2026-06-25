// Mức 1 realtime báo giá:
// (1a) KHÓA LẠC QUAN — lưu với baseUpdatedAt CŨ (người khác vừa sửa xen vào) → 409, KHÔNG ghi đè im lặng.
// (1b) PRESENCE — POST /api/stream/presence open/heartbeat/close; 2 người mở cùng báo giá thấy nhau.
// Drive REAL app qua supertest — cần Postgres có schema (CI cấp; local tự skip).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema Quote");

const TAG = `qrt${Date.now()}`;
const PASSWORD = "Test1234!a";

describe.runIf(dbAvailable)("Mức 1 realtime — optimistic lock + presence (integration)", () => {
  let app, company, template;
  let aU, bU, a, b; // 2 user (admin) + 2 agent

  const makeUser = async (label) =>
    prisma.user.create({ data: { username: `${TAG}-${label}`, displayName: `${TAG} ${label}`, role: "admin", passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  const login = async (agent, u) => { const r = await agent.post("/api/auth/login").send({ username: u.username, password: PASSWORD }); expect(r.status).toBe(200); };
  const payload = (o = {}) => ({ title: `${TAG} bg`, toCompany: "Khách Test", companyId: company.id, vatPercent: 8,
    sheets: [{ templateId: template.id, items: [{ name: "Hạng mục A", quantity: 2, unitPrice: 1_000_000 }] }], ...o });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    company = await prisma.company.create({ data: { code: `${TAG}-co`, name: `${TAG} Co`, address: "1 Test St", quotePrefix: "RT" } });
    template = await prisma.quoteTemplate.create({ data: { code: `${TAG}-tpl`, name: `${TAG} Template`, companyId: company.id, filePath: "templates/Unibenfood.xlsx" } });
    [aU, bU] = await Promise.all([makeUser("a"), makeUser("b")]);
    a = request.agent(app); b = request.agent(app);
    await Promise.all([login(a, aU), login(b, bU)]);
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true });
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true });
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true });
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true });
  });

  it("1a — lưu với baseUpdatedAt CŨ (người khác vừa sửa) → 409, title GIỮ của người lưu trước", async () => {
    const id = (await a.post("/api/quotes").send(payload())).body.id;
    const loaded = (await a.get(`/api/quotes/${id}`)).body;
    const staleBase = loaded.updatedAt; // mốc CŨ cả 2 cùng tải

    const bSave = await b.put(`/api/quotes/${id}`).send({ title: `${TAG} b-sửa`, baseUpdatedAt: loaded.updatedAt });
    expect(bSave.status).toBe(200); // b lưu trước (base khớp) → updatedAt DB nhảy

    const aSave = await a.put(`/api/quotes/${id}`).send({ title: `${TAG} a-sửa`, baseUpdatedAt: staleBase });
    expect(aSave.status).toBe(409); // a base CŨ → chặn ghi đè

    const after = (await a.get(`/api/quotes/${id}`)).body;
    expect(after.title).toBe(`${TAG} b-sửa`); // KHÔNG bị a ghi đè
  });

  it("1a — lưu với baseUpdatedAt ĐÚNG (mới nhất) → 200", async () => {
    const id = (await a.post("/api/quotes").send(payload({ title: `${TAG} ok` }))).body.id;
    const loaded = (await a.get(`/api/quotes/${id}`)).body;
    const r = await a.put(`/api/quotes/${id}`).send({ title: `${TAG} ok2`, baseUpdatedAt: loaded.updatedAt });
    expect(r.status).toBe(200);
  });

  it("1a — KHÔNG gửi baseUpdatedAt (client cũ) → vẫn 200 (tương thích ngược)", async () => {
    const id = (await a.post("/api/quotes").send(payload({ title: `${TAG} legacy` }))).body.id;
    const r = await a.put(`/api/quotes/${id}`).send({ title: `${TAG} legacy2` });
    expect(r.status).toBe(200);
  });

  it("1b — presence: 2 người mở cùng báo giá thấy nhau; đóng → mất; heartbeat → còn", async () => {
    const id = (await a.post("/api/quotes").send(payload({ title: `${TAG} presence` }))).body.id;

    const aOpen = (await a.post("/api/stream/presence").send({ quoteId: id, action: "open" })).body;
    expect(aOpen.editing.some((u) => u.id === aU.id)).toBe(true);

    const bOpen = (await b.post("/api/stream/presence").send({ quoteId: id, action: "open" })).body;
    expect(bOpen.editing.map((u) => u.id).sort((x, y) => x - y)).toEqual([aU.id, bU.id].sort((x, y) => x - y));
    expect(bOpen.editing.find((u) => u.id === aU.id).name).toBe(`${TAG} a`); // dùng displayName

    const bClose = (await b.post("/api/stream/presence").send({ quoteId: id, action: "close" })).body;
    expect(bClose.editing.map((u) => u.id)).toEqual([aU.id]); // còn mình a

    const aHb = (await a.post("/api/stream/presence").send({ quoteId: id, action: "heartbeat" })).body;
    expect(aHb.editing.map((u) => u.id)).toEqual([aU.id]);

    await a.post("/api/stream/presence").send({ quoteId: id, action: "close" }); // dọn
  });

  it("1b — presence: tham số sai → 400", async () => {
    expect((await a.post("/api/stream/presence").send({ quoteId: "x", action: "open" })).status).toBe(400);
    expect((await a.post("/api/stream/presence").send({ quoteId: 1, action: "bad" })).status).toBe(400);
  });
});
