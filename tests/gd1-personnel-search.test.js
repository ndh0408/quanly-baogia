// Integration test: TÌM KIẾM Nhân sự KHÔNG dấu / sai dấu (cột searchText chuẩn-hóa).
// Đọc thật: src/services/personnelService.ts (personnelSearchText → normalizeSearch) +
// src/searchText.ts (searchTextFilter). Drive REAL app qua supertest — cần Postgres có schema.
// fullName "Nguyễn Văn Đức" → searchText "nguyen van duc": gõ KHÔNG dấu lẫn CÓ dấu đều khớp;
// q rác "@#$" chuẩn-hóa ra rỗng → token-không-khớp → KHÔNG nuốt cả list.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema PersonnelRecord");
}

const TAG = `hrsearch${Date.now()}`;
const PASSWORD = "Test1234!a";
// Họ tên CÓ dấu (kèm TAG để cô lập). Phần CÓ dấu để kiểm chuẩn-hóa: "Nguyễn Văn Đức" → "nguyen van duc".
const FULL_NAME = `${TAG} Nguyễn Văn Đức`;

describe.runIf(dbAvailable)("personnel search KHÔNG dấu (integration)", () => {
  let app;
  let mgrU;
  let mgr; // supertest agent (cookie session)

  const login = async (agent, user) => {
    const r = await agent.post("/api/auth/login").send({ username: user.username, password: PASSWORD });
    expect(r.status).toBe(200);
  };
  // projectCode BẮT BUỘC khi tạo (gắn dự án đã chốt) → payload mặc định có sẵn.
  const payload = (o = {}) => ({
    fullName: FULL_NAME,
    salary: 10_000_000,
    projectName: "Dự án X",
    projectNameContract: `${TAG} Hợp đồng Ánh Dương`,
    projectCode: "PRJ-X",
    ...o,
  });

  let recId;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    mgrU = await prisma.user.create({
      data: {
        username: `${TAG}-mgr`,
        displayName: `${TAG} mgr`,
        role: "manager",
        passwordHash: await bcrypt.hash(PASSWORD, 4),
      },
    });
    mgr = request.agent(app);
    await login(mgr, mgrU);

    // (1) Tạo hồ sơ có dấu bằng user manager → 201; searchText do server tự sinh.
    const r = await mgr.post("/api/personnel").send(payload());
    expect(r.status).toBe(201);
    expect(r.body.fullName).toBe(FULL_NAME);
    recId = r.body.id;
  });

  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true });
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true });
  });

  it("(2) gõ KHÔNG dấu 'nguyen van duc' → THẤY bản ghi có dấu", async () => {
    const r = await mgr.get("/api/personnel").query({ q: `${TAG.toLowerCase()} nguyen van duc` });
    expect(r.status).toBe(200);
    expect(r.body.data.some((x) => x.id === recId)).toBe(true);
  });

  // Các query "phải thấy" đều prefix TAG (duy nhất) → khớp ĐÚNG 1 bản test, KHÔNG phụ thuộc demo data /
  // phân trang (tránh fail giả khi bản test rớt sang trang 2). Vẫn kiểm strip dấu: tên lưu có dấu
  // "Nguyễn Văn Đức" → searchText "nguyen van duc"; gõ không-dấu/có-dấu/HOA đều chuẩn-hóa khớp.
  it("(2b) một phần KHÔNG dấu (prefix) cũng khớp (substring liên tục trên searchText)", async () => {
    const r = await mgr.get("/api/personnel").query({ q: `${TAG.toLowerCase()} nguyen van` });
    expect(r.status).toBe(200);
    expect(r.body.data.some((x) => x.id === recId)).toBe(true);
  });

  it("(3) gõ CÓ dấu 'Nguyễn Văn Đức' (chuẩn-hóa cùng kết quả) → vẫn THẤY", async () => {
    const r = await mgr.get("/api/personnel").query({ q: `${TAG} Nguyễn Văn Đức` });
    expect(r.status).toBe(200);
    expect(r.body.data.some((x) => x.id === recId)).toBe(true);
  });

  it("(3b) sai dấu / HOA-thường lẫn lộn 'NGUYEN VAN DUC' → vẫn THẤY", async () => {
    const r = await mgr.get("/api/personnel").query({ q: `${TAG} NGUYEN VAN DUC` });
    expect(r.status).toBe(200);
    expect(r.body.data.some((x) => x.id === recId)).toBe(true);
  });

  it("(3c) tìm theo Tên hợp đồng tùy chỉnh, không dấu → THẤY hồ sơ", async () => {
    const r = await mgr.get("/api/personnel").query({ q: `${TAG.toLowerCase()} hop dong anh duong` });
    expect(r.status).toBe(200);
    expect(r.body.data.some((x) => x.id === recId)).toBe(true);
  });

  it("(4) q RÁC '@#$' chuẩn-hóa ra rỗng → token-không-khớp, KHÔNG nuốt cả list (bản test KHÔNG xuất hiện)", async () => {
    const r = await mgr.get("/api/personnel").query({ q: "@#$" });
    expect(r.status).toBe(200);
    // Không được trả về bản ghi nào (đặc biệt KHÔNG được trả bản test) — tránh contains:"" = LIKE '%%'.
    expect(r.body.data.some((x) => x.id === recId)).toBe(false);
    expect(r.body.data.length).toBe(0);
  });

  it("(4b) từ khóa không tồn tại 'zzzkhongcoaica' → 0 kết quả", async () => {
    const r = await mgr.get("/api/personnel").query({ q: `${TAG.toLowerCase()} zzzkhongcoaica` });
    expect(r.status).toBe(200);
    expect(r.body.data.some((x) => x.id === recId)).toBe(false);
  });
});
