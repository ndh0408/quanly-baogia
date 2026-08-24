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

  it("chặn hạng mục trùng dù khác hoa thường, khoảng trắng và cách ghi kích thước (409)", async () => {
    const res = await admin.post(`/api/venues/${venueId}/items`).send({
      name: "  QUẦY   BẮP 1 ", dim: "2,5 × 1", unit: " m² ",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Đã có hạng mục");
  });

  it("hàng nhập nhanh không có kích thước vẫn chặn trùng với dữ liệu cũ", async () => {
    const res = await admin.post(`/api/venues/${venueId}/items`).send({ name: " quầy bắp 1 ", unit: "m2" });
    expect(res.status).toBe(409);
  });

  it("modal rút gọn sửa tên/ghi chú không làm mất kích thước và đơn vị cũ", async () => {
    const item = await admin.post(`/api/venues/${venueId}/items`).send({ name: `${TAG} Giữ metadata`, dim: "2 x 1", w: 2, h: 1, unit: "m2", qty: 2, note: "Ghi chú cũ" });
    expect(item.status).toBe(201);
    const newName = `${item.body.name} sửa`;
    const res = await admin.put(`/api/venues/items/${item.body.id}`).send({ name: newName, note: "Ghi chú mới", active: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: newName, dim: item.body.dim, w: item.body.w, h: item.body.h, unit: item.body.unit, qty: item.body.qty, note: "Ghi chú mới" });
    await admin.delete(`/api/venues/items/${item.body.id}`).expect(200);
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

  it("hai request thêm giống nhau chạy đồng thời chỉ tạo đúng một hạng mục", async () => {
    const body = { name: `${TAG} Đồng thời`, dim: "3 x 1,5", w: 3, h: 1.5, unit: "m2" };
    const results = await Promise.all([
      admin.post(`/api/venues/${venueId}/items`).send(body),
      admin.post(`/api/venues/${venueId}/items`).send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const rows = await prisma.venueItem.findMany({ where: { venueId, name: body.name } });
    expect(rows).toHaveLength(1);
    await admin.delete(`/api/venues/items/${rows[0].id}`).expect(200);
  });

  it("chặn sửa một hạng mục thành bản trùng với hạng mục khác", async () => {
    const temp = await admin.post(`/api/venues/${venueId}/items`).send({ name: `${TAG} Tạm`, dim: "1 x 1", unit: "m2" });
    expect(temp.status).toBe(201);
    const res = await admin.put(`/api/venues/items/${temp.body.id}`).send({
      name: "quầy bắp 1", dim: "(2,5W×1H)m", unit: "M2",
    });
    expect(res.status).toBe(409);
    await admin.delete(`/api/venues/items/${temp.body.id}`).expect(200);
  });

  it("hai request sửa đồng thời không thể tạo hai hạng mục giống nhau", async () => {
    const [a, b] = await Promise.all([
      admin.post(`/api/venues/${venueId}/items`).send({ name: `${TAG} Race A`, dim: "1 x 1", w: 1, h: 1, unit: "m2" }),
      admin.post(`/api/venues/${venueId}/items`).send({ name: `${TAG} Race B`, dim: "2 x 1", w: 2, h: 1, unit: "m2" }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const next = { name: `${TAG} Cùng đích`, dim: "4 x 2", w: 4, h: 2, unit: "m2" };
    const results = await Promise.all([
      admin.put(`/api/venues/items/${a.body.id}`).send(next),
      admin.put(`/api/venues/items/${b.body.id}`).send(next),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.venueItem.count({ where: { venueId, name: next.name } })).toBe(1);
    await Promise.all([admin.delete(`/api/venues/items/${a.body.id}`), admin.delete(`/api/venues/items/${b.body.id}`)]);
  });

  it("hai rạp đổi đồng thời về cùng tên + khu vực trả một 200 và một 409", async () => {
    const [a, b] = await Promise.all([
      admin.post("/api/venues").send({ name: `${TAG} Rename A`, region: "HCM" }),
      admin.post("/api/venues").send({ name: `${TAG} Rename B`, region: "HCM" }),
    ]);
    const next = { name: `${TAG} Rename chung`, region: "HCM" };
    const results = await Promise.all([
      admin.put(`/api/venues/${a.body.id}`).send(next),
      admin.put(`/api/venues/${b.body.id}`).send(next),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    await Promise.all([admin.delete(`/api/venues/${a.body.id}`), admin.delete(`/api/venues/${b.body.id}`)]);
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
    const targetBefore = await admin.get(`/api/venues/${venueId}`);
    const same = targetBefore.body.items.find((i) => i.name === "Quầy bắp 1 (sửa)");
    await admin.post(`/api/venues/${dup.body.id}/items`).send({
      cat: "Nhóm nguồn khác", name: same.name, dim: same.dim, w: same.w, h: same.h, unit: same.unit, note: "Ghi chú ở rạp nguồn",
    }).expect(201);

    const res = await admin.post(`/api/venues/${dup.body.id}/merge`).send({ intoId: venueId });
    expect(res.status).toBe(200);
    expect(res.body.movedItems).toBe(1);
    expect(res.body.removedDuplicates).toBe(1);

    const gone = await admin.get(`/api/venues/${dup.body.id}`);
    expect(gone.status).toBe(404);
    const into = await admin.get(`/api/venues/${venueId}`);
    expect(into.body.items.map((i) => i.name)).toContain("Cover 1");
    expect(into.body.items.filter((i) => i.name === same.name)).toHaveLength(1);
    const merged = into.body.items.find((i) => i.name === same.name);
    expect(merged.note).toContain("PP in KTS");
    expect(merged.note).toContain("Ghi chú ở rạp nguồn");
    expect(merged.note).toContain("Nhóm ở rạp nguồn: Nhóm nguồn khác");
  });

  it("không tự chọn số lượng khi hai hạng mục trùng có số lượng khác nhau", async () => {
    const target = await admin.post(`/api/venues/${venueId}/items`).send({ name: `${TAG} Ghế`, unit: "ghế", qty: 10 });
    const sourceVenue = await admin.post("/api/venues").send({ name: `${TAG} Rạp lệch SL`, region: "HCM" });
    await admin.post(`/api/venues/${sourceVenue.body.id}/items`).send({ name: `${TAG} Ghế`, unit: "ghế", qty: 12 }).expect(201);
    const merge = await admin.post(`/api/venues/${sourceVenue.body.id}/merge`).send({ intoId: venueId });
    expect(merge.status).toBe(409);
    expect(merge.body.error).toContain("số lượng khác nhau");
    expect((await admin.get(`/api/venues/${sourceVenue.body.id}`)).status).toBe(200);
    await admin.delete(`/api/venues/${sourceVenue.body.id}`).expect(200);
    await admin.delete(`/api/venues/items/${target.body.id}`).expect(200);
  });

  it("gộp hạng mục trùng giữ nguyên cặp rộng/cao và bổ sung chuỗi kích thước còn thiếu", async () => {
    const itemName = `${TAG} Metadata kích thước`;
    const target = await admin.post(`/api/venues/${venueId}/items`).send({ name: itemName, w: 2.4, h: 1.3, unit: "m2" });
    const sourceVenue = await admin.post("/api/venues").send({ name: `${TAG} Rạp metadata KT`, region: "HCM" });
    await admin.post(`/api/venues/${sourceVenue.body.id}/items`).send({ name: itemName, dim: "2,4 x 1,3", w: 2.4, h: 1.3, unit: "m²" }).expect(201);
    const merge = await admin.post(`/api/venues/${sourceVenue.body.id}/merge`).send({ intoId: venueId });
    expect(merge.status).toBe(200);
    const after = await admin.get(`/api/venues/${venueId}`);
    const merged = after.body.items.find((i) => i.id === target.body.id);
    expect(merged).toMatchObject({ dim: "2,4 x 1,3", w: 2.4, h: 1.3 });
    await admin.delete(`/api/venues/items/${target.body.id}`).expect(200);
  });

  it("gộp hàng nhập nhanh với dữ liệu legacy giữ kích thước và cả hai ghi chú", async () => {
    const itemName = `${TAG} Quick merge`;
    const target = await admin.post(`/api/venues/${venueId}/items`).send({ name: itemName, dim: "4 x 2", w: 4, h: 2, unit: "m2", note: "Ghi chú legacy" });
    const sourceVenue = await admin.post("/api/venues").send({ name: `${TAG} Rạp quick merge`, region: "HCM" });
    await admin.post(`/api/venues/${sourceVenue.body.id}/items`).send({ name: itemName, unit: "m2", note: "Ghi chú nhập nhanh" }).expect(201);
    const merge = await admin.post(`/api/venues/${sourceVenue.body.id}/merge`).send({ intoId: venueId });
    expect(merge.status).toBe(200);
    expect(merge.body.removedDuplicates).toBe(1);
    const after = await admin.get(`/api/venues/${venueId}`);
    const merged = after.body.items.find((i) => i.id === target.body.id);
    expect(merged).toMatchObject({ dim: "4 x 2", w: 4, h: 2, unit: "m2" });
    expect(merged.note).toContain("Ghi chú legacy");
    expect(merged.note).toContain("Ghi chú nhập nhanh");
    await admin.delete(`/api/venues/items/${target.body.id}`).expect(200);
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

  it("full=1 trả rạp KÈM hạng mục (trang quản lý tải 1 lần)", async () => {
    const res = await admin.get("/api/venues?full=1");
    expect(res.status).toBe(200);
    const mine = res.body.data.find((v) => v.id === venueId);
    expect(Array.isArray(mine.items)).toBe(true);
    expect(mine.items.length).toBe(mine.itemCount);
    expect(mine.items[0]).toHaveProperty("dim");
  });

  it("TỪ KHÓA: lưu khi tạo/sửa, bỏ trùng + bỏ khoảng trắng thừa", async () => {
    const res = await admin.post("/api/venues").send({ name: `${TAG} Rạp từ khóa`, tags: ["HCM", " HCM ", "khách CGV", ""] });
    expect(res.status).toBe(201);
    expect(res.body.tags.sort()).toEqual(["HCM", "khách CGV"]);
    const upd = await admin.put(`/api/venues/${res.body.id}`).send({ tags: ["HCM"] });
    expect(upd.body.tags).toEqual(["HCM"]);
    await admin.delete(`/api/venues/${res.body.id}`).expect(200);
  });

  it("TỪ KHÓA: lọc danh sách theo từ khóa + /tags đếm số rạp", async () => {
    const a = await admin.post("/api/venues").send({ name: `${TAG} Nhóm A1`, tags: [`${TAG}nhom`] });
    const b = await admin.post("/api/venues").send({ name: `${TAG} Nhóm A2`, tags: [`${TAG}nhom`] });
    const list = await admin.get(`/api/venues?q=${TAG}nhom`);
    expect(list.body.data.map((v) => v.id).sort()).toEqual([a.body.id, b.body.id].sort());
    const tags = await admin.get("/api/venues/tags");
    expect(tags.body.data.find((t) => t.tag === `${TAG}nhom`)?.count).toBe(2);
    await admin.delete(`/api/venues/${a.body.id}`).expect(200);
    await admin.delete(`/api/venues/${b.body.id}`).expect(200);
  });

  it("TỪ KHÓA: gắn/gỡ HÀNG LOẠT cho nhiều rạp", async () => {
    const a = await admin.post("/api/venues").send({ name: `${TAG} Bulk1`, tags: ["HCM"] });
    const b = await admin.post("/api/venues").send({ name: `${TAG} Bulk2`, tags: ["HCM"] });
    const ids = [a.body.id, b.body.id];
    const res = await admin.post("/api/venues/tags/bulk").send({ venueIds: ids, add: [`${TAG}tk`], remove: ["HCM"] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    const after = await admin.get(`/api/venues/${a.body.id}`);
    expect(after.body.tags).toEqual([`${TAG}tk`]);
    // không chọn từ khóa nào → 400 (khỏi ghi đè im lặng)
    expect((await admin.post("/api/venues/tags/bulk").send({ venueIds: ids })).status).toBe(400);
    for (const id of ids) await admin.delete(`/api/venues/${id}`).expect(200);
  });

  it("TỪ KHÓA: vai trò chỉ-đọc KHÔNG gắn được (403)", async () => {
    expect((await hr.post("/api/venues/tags/bulk").send({ venueIds: [venueId], add: ["X"] })).status).toBe(403);
  });

  it("/catalog kèm tags → gợi ý trong editor gõ từ khóa cũng ra", async () => {
    await admin.put(`/api/venues/${venueId}`).send({ tags: [`${TAG}cat`] }).expect(200);
    const res = await manager.get("/api/venues/catalog");
    const mine = res.body.entries.filter((e) => (e.tags || []).includes(`${TAG}cat`));
    expect(mine.length).toBeGreaterThan(0);
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
