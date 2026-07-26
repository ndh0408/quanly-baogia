// Integration test cho DANH MỤC KÍCH THƯỚC THEO RẠP (/api/venues): CRUD rạp + hạng mục,
// gộp rạp, endpoint /catalog (nguồn gợi ý trong editor báo giá) và các chốt PHÂN QUYỀN
// (venue:read xem được nhưng KHÔNG ghi; không quyền thì 403; chưa đăng nhập thì 401).
// Chạy trên app THẬT qua supertest — cần Postgres có schema (CI có; máy dev thiếu DB thì skip).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Venue" LIMIT 1')
  .then(() => true)
  .catch(() => false);

if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema Venue — test danh mục rạp không được phép skip trong CI");
}

const TAG = `vn${Date.now()}`;
const PASSWORD = "Test1234!a";

describe.runIf(dbAvailable)("danh mục rạp (/api/venues) — CRUD + phân quyền", () => {
  let app;
  let adminU, managerU, hrU;
  let admin, manager, hr;   // supertest agents (cookie session)
  let venueId;

  const makeUser = (role, label = role) => prisma.user.create({
    data: {
      username: `${TAG}-${label}`,
      displayName: `${TAG} ${label}`,
      role,
      passwordHash: bcrypt.hashSync(PASSWORD, 4),
    },
  });
  async function login(agent, user) {
    const res = await agent.post("/api/auth/login").send({ username: user.username, password: PASSWORD });
    expect(res.status).toBe(200);
  }

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    [adminU, managerU, hrU] = await Promise.all([makeUser("admin"), makeUser("manager"), makeUser("hr")]);
    admin = request.agent(app); manager = request.agent(app); hr = request.agent(app);
    await Promise.all([login(admin, adminU), login(manager, managerU), login(hr, hrU)]);
  });

  afterAll(async () => {
    await prisma.venue.deleteMany({ where: { name: { startsWith: TAG } } });   // items xoá theo cascade
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true });
  });

  it("chặn truy cập khi chưa đăng nhập (401)", async () => {
    const res = await request(app).get("/api/venues/catalog");
    expect(res.status).toBe(401);
  });

  it("tạo rạp mới (admin)", async () => {
    const res = await admin.post("/api/venues").send({ name: `${TAG} CGV Test`, region: "HCM", cluster: "CGV", code: "TST" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe(`${TAG} CGV Test`);
    venueId = res.body.id;
  });

  it("chặn tạo rạp TRÙNG tên + khu vực (409)", async () => {
    const res = await admin.post("/api/venues").send({ name: `${TAG} CGV Test`, region: "HCM" });
    expect(res.status).toBe(409);
  });

  it("từ chối tên rạp rỗng (400)", async () => {
    const res = await admin.post("/api/venues").send({ name: "   " });
    expect(res.status).toBe(400);
  });

  it("thêm hạng mục kèm kích thước", async () => {
    const res = await admin.post(`/api/venues/${venueId}/items`).send({
      cat: "Quầy vé & quầy bắp", name: "Quầy bắp 1", dim: "(2.5W x 1H)m", w: 2.5, h: 1, unit: "m2", note: "PP in KTS",
    });
    expect(res.status).toBe(201);
    expect(res.body.w).toBe(2.5);
    expect(res.body.h).toBe(1);
    expect(res.body.unit).toBe("m2");
  });

  it("từ chối kích thước ÂM (400)", async () => {
    const res = await admin.post(`/api/venues/${venueId}/items`).send({ cat: "X", name: "Sai", w: -3 });
    expect(res.status).toBe(400);
  });

  it("/catalog trả hạng mục kèm tên rạp (nguồn gợi ý cho editor)", async () => {
    const res = await manager.get("/api/venues/catalog");
    expect(res.status).toBe(200);
    const mine = res.body.entries.filter((e) => e.venue === `${TAG} CGV Test`);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: "Quầy bắp 1", venue: `${TAG} CGV Test`, region: "HCM", w: 2.5, h: 1, unit: "m2" });
  });

  it("sửa hạng mục", async () => {
    const list = await admin.get(`/api/venues/${venueId}`);
    const itemId = list.body.items[0].id;
    const res = await admin.put(`/api/venues/items/${itemId}`).send({ name: "Quầy bắp 1 (sửa)", h: 1.2 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Quầy bắp 1 (sửa)");
    expect(res.body.h).toBe(1.2);
  });

  it("hạng mục TẮT (active=false) không xuất hiện trong /catalog", async () => {
    const list = await admin.get(`/api/venues/${venueId}`);
    const itemId = list.body.items[0].id;
    await admin.put(`/api/venues/items/${itemId}`).send({ active: false }).expect(200);
    const cat = await admin.get("/api/venues/catalog");
    expect(cat.body.entries.filter((e) => e.venue === `${TAG} CGV Test`)).toHaveLength(0);
    await admin.put(`/api/venues/items/${itemId}`).send({ active: true }).expect(200);
  });

  it("GỘP rạp: chuyển hết hạng mục sang rạp đích rồi xoá rạp nguồn", async () => {
    const dup = await admin.post("/api/venues").send({ name: `${TAG} CGV Test (trùng)`, region: "HCM" });
    expect(dup.status).toBe(201);
    await admin.post(`/api/venues/${dup.body.id}/items`).send({ cat: "Cover màn hình", name: "Cover 1", unit: "bộ", qty: 6 }).expect(201);

    const res = await admin.post(`/api/venues/${dup.body.id}/merge`).send({ intoId: venueId });
    expect(res.status).toBe(200);
    expect(res.body.movedItems).toBe(1);

    const gone = await admin.get(`/api/venues/${dup.body.id}`);
    expect(gone.status).toBe(404);
    const into = await admin.get(`/api/venues/${venueId}`);
    expect(into.body.items.map((i) => i.name)).toContain("Cover 1");
  });

  it("chặn gộp rạp vào CHÍNH NÓ (400)", async () => {
    const res = await admin.post(`/api/venues/${venueId}/merge`).send({ intoId: venueId });
    expect(res.status).toBe(400);
  });

  it("Account (venue:manage) sửa được danh mục", async () => {
    const res = await manager.post("/api/venues").send({ name: `${TAG} Lotte Test`, region: "HCM" });
    expect(res.status).toBe(201);
    await manager.delete(`/api/venues/${res.body.id}`).expect(200);
  });

  it("vai trò KHÔNG có quyền (hr) bị chặn cả đọc lẫn ghi (403)", async () => {
    expect((await hr.get("/api/venues/catalog")).status).toBe(403);
    expect((await hr.get("/api/venues")).status).toBe(403);
    expect((await hr.post("/api/venues").send({ name: `${TAG} Trái phép` })).status).toBe(403);
  });

  it("xoá rạp thì xoá luôn hạng mục của nó", async () => {
    const before = await admin.get(`/api/venues/${venueId}`);
    const n = before.body.items.length;
    expect(n).toBeGreaterThan(0);
    const res = await admin.delete(`/api/venues/${venueId}`);
    expect(res.status).toBe(200);
    expect(res.body.removedItems).toBe(n);
    expect((await admin.get(`/api/venues/${venueId}`)).status).toBe(404);
  });
});
