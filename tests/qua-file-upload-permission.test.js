// Ba đường GHI vào kho object chỉ gác `requireAuth` — chốt hồi quy phân quyền.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `src/routes/files.routes.ts` mở đầu bằng `router.use(requireAuth)` rồi thôi: `POST /api/files`
// (multipart), `POST /api/files/sign-upload` và `POST /api/files/finalize` KHÔNG có
// `requirePermission` nào — chỉ `DELETE /` mới gác `requireRole("admin")`. Nghĩa là MỌI tài khoản
// đăng nhập được, kể cả `hr` và `accountant` (vai trò CHỈ-ĐỌC hồ sơ nhân sự, không có nghiệp vụ
// tải tệp nào), đều ghi được vào bucket.
//
// ── KHÔNG NÓI QUÁ ───────────────────────────────────────────────────────────
// Đây là lỗ GHI, không phải lỗ ĐỌC: đường ghi đã bị siết khá chặt sẵn (allowlist MIME + dò magic
// bytes, inspectXlsx cho .xlsx, staging key không tải về được, trần 10MB, key gắn namespace theo
// userId, canAccessKey chặn đọc chéo). Cái còn thiếu là quyền NĂNG LỰC — "ai được phép ghi" — và
// hệ quả đo được là một tài khoản nội bộ bất kỳ bơm được rác vào kho lưu trữ.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Thêm quyền `file:upload` (PERMISSIONS.FILE_UPLOAD) vào danh sách NỀN của EMPLOYEE — manager và
// admin kế thừa, hr/accountant/account_hn thì không — rồi gắn `requirePermission` vào đúng ba
// route ghi. `GET /sign-download` CỐ Ý giữ nguyên `requireAuth`: `canAccessKey` mới là chốt phạm
// vi đúng cho đường đọc, siết thêm năng lực ghi ở đó là chặn nhầm người xem hợp lệ.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P, ROLE_PERMISSIONS } from "../src/permissions.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `quafile${Date.now()}`;
const PWD = "Test1234!a";
// PNG 1x1 thật — phải là ảnh THẬT để không dừng ở lớp dò magic bytes; ta đang kiểm lớp QUYỀN.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe.runIf(dbAvailable)("/api/files: ba đường GHI phải đòi quyền file:upload", () => {
  let app;
  const U = {}, A = {};

  const taoUser = async (key, role) => {
    U[key] = await prisma.user.create({ data: { username: `${TAG}-${key}`, displayName: `${TAG} ${key}`, role, passwordHash: await bcrypt.hash(PWD, 4) } });
    A[key] = agentWithCsrf(app);
    expect((await A[key].post("/api/auth/login").send({ username: U[key].username, password: PWD })).status, `đăng nhập ${key}`).toBe(200);
  };

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    for (const [k, r] of [["hr", "hr"], ["ketoan", "accountant"], ["hn", "account_hn"], ["manager", "manager"]]) await taoUser(k, r);
  });

  afterAll(async () => {
    const ids = Object.values(U).map((u) => u.id);
    await prisma.uploadObject.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.$disconnect();
  });

  it.each(["hr", "ketoan", "hn"])("%s: POST /api/files/sign-upload → 403", async (who) => {
    const res = await A[who].post("/api/files/sign-upload").send({ contentType: "image/png", size: PNG.length });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    // Không được để lại hàng `UploadObject` nào — 403 mà vẫn ghi CSDL thì cổng quyền nằm sai chỗ.
    expect(await prisma.uploadObject.count({ where: { ownerId: U[who].id } })).toBe(0);
  });

  it.each(["hr", "ketoan", "hn"])("%s: POST /api/files (multipart, ảnh PNG thật) → 403", async (who) => {
    const res = await A[who].post("/api/files").attach("file", PNG, { filename: "a.png", contentType: "image/png" });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await prisma.uploadObject.count({ where: { ownerId: U[who].id } })).toBe(0);
  });

  it.each(["hr", "ketoan", "hn"])("%s: POST /api/files/finalize (key trong namespace của CHÍNH mình) → 403", async (who) => {
    // Cố ý dùng key HỢP LỆ về namespace: nếu không, 403 trả về là của lớp kiểm namespace chứ không
    // phải của cổng quyền, và bài test sẽ xanh cả khi chưa vá.
    const res = await A[who].post("/api/files/finalize").send({ key: `uploads/u${U[who].id}/khong-ton-tai.png` });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
  });

  it("manager (có file:upload) KHÔNG bị cổng quyền chặn — không siết nhầm", async () => {
    const res = await A.manager.post("/api/files/sign-upload").send({ contentType: "image/png", size: PNG.length });

    // Điều bài này chốt là CỔNG QUYỀN, nên nó phải đo đúng cổng quyền: 403 = chặn nhầm người có
    // quyền. Khẳng định cứng `200` sẽ đo lẫn cả việc kho object có được cấu hình hay không —
    // route trả 503 "Chưa cấu hình lưu trữ tệp" khi thiếu S3_*, và máy dev thường không có. CI thì
    // có (job `test` dựng service MinIO), nên bài cũ xanh ở CI và đỏ ở máy dev vì một lý do KHÔNG
    // liên quan tới thứ nó muốn kiểm.
    expect(res.status, `cổng quyền chặn nhầm manager: ${JSON.stringify(res.body)}`).not.toBe(403);
    expect([200, 503], JSON.stringify(res.body)).toContain(res.status);

    // Chỉ khi kho object THẬT SỰ được cấu hình mới kiểm được hình dạng khoá.
    if (res.status === 200) expect(res.body.key).toMatch(new RegExp(`^uploads/u${U.manager.id}/`));
  });

  it("mặc định vai trò: manager/admin CÓ file:upload, hr/accountant/account_hn KHÔNG", () => {
    for (const r of ["admin", "manager"]) expect(ROLE_PERMISSIONS[r].has(P.FILE_UPLOAD), r).toBe(true);
    for (const r of ["hr", "accountant", "account_hn"]) expect(ROLE_PERMISSIONS[r].has(P.FILE_UPLOAD), r).toBe(false);
  });
});
