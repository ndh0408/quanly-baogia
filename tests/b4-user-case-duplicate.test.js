/**
 * CỤM B4 — chống trùng tài khoản ở phía GHI so BYTE-FOR-BYTE, nên một người thành HAI tài khoản.
 *
 * TÁI HIỆN (đọc mã trước khi viết test):
 *   · Phía ĐỌC đã vá: src/authCore.ts `findLoginUser` thử khớp chính xác trước rồi rơi về
 *     `equals … mode: "insensitive"` (có thoát ký tự đại diện của LIKE).
 *   · Phía GHI thì CHƯA: src/services/userService.ts `inviteUser` dùng
 *     `findFirst({ where: { OR: [{ email }, { username: email }] } })` — so bằng đúng byte;
 *     `createUser` dùng `findFirst({ where: { username } })` cũng vậy.
 *   · Cột `username`/`email` là `String @unique` THƯỜNG (prisma/schema.prisma), không citext →
 *     Postgres không chặn "bob@x.com" và "Bob@x.com" cùng tồn tại.
 * HẬU QUẢ: mời lại đúng người bằng email viết hoa khác đi là tạo tài khoản THỨ HAI — hai hồ sơ,
 * hai tập quyền, hai đường đăng nhập cho cùng một con người; gỡ quyền ở một bên không đụng bên kia.
 *
 * PHẠM VI: bài test này CHỈ nói về việc CHỐNG TRÙNG. Nó KHÔNG đòi chuẩn hoá giá trị đem lưu —
 * email/tên đăng nhập vẫn được lưu ĐÚNG như người dùng gõ.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import * as svc from "../src/services/userService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres — bài test B4 này không được skip trong CI");
}

const TAG = `b4case${Date.now()}`;
const EMAIL_THUONG = `${TAG}a@example.com`;
const USER_THUONG = `${TAG}b`;   // tài khoản RIÊNG cho ca createUser — không dùng chung với ca invite
const req = (body, actorId) => ({ body, session: { userId: actorId }, ip: "127.0.0.1", headers: { "user-agent": "vitest" } });

describe.runIf(dbAvailable)("B4 — chống trùng tài khoản KHÔNG phân biệt hoa/thường", () => {
  let actorId;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { username: EMAIL_THUONG, email: EMAIL_THUONG, passwordHash: bcrypt.hashSync("x", 4), displayName: "B4 Case Goc", role: "manager", active: true },
    });
    actorId = u.id;
    await prisma.user.create({
      data: { username: USER_THUONG, passwordHash: bcrypt.hashSync("x", 4), displayName: "B4 Case Goc 2", role: "manager", active: true },
    });
  });

  afterAll(async () => {
    const ids = (await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true }, includeDeleted: true })).map((x) => x.id);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    for (const id of ids) await prisma.user.delete({ where: { id }, hardDelete: true }).catch(() => {});
  });

  it("inviteUser: email CHỈ khác hoa/thường → 409, KHÔNG tạo tài khoản thứ hai", async () => {
    const truoc = await prisma.user.count({ where: { username: { startsWith: TAG } }, includeDeleted: true });
    await expect(
      svc.inviteUser(req({ email: EMAIL_THUONG.toUpperCase(), displayName: "B4 Case Trung", role: "manager" }, actorId))
    ).rejects.toMatchObject({ status: 409 });
    const sau = await prisma.user.count({ where: { username: { startsWith: TAG } }, includeDeleted: true });
    expect(sau).toBe(truoc);
  });

  it("createUser: tên đăng nhập CHỈ khác hoa/thường → 409", async () => {
    await expect(
      svc.createUser(req({ username: USER_THUONG.toUpperCase(), password: "Correct1!", displayName: "B4 Case Trung 2", role: "manager" }, actorId))
    ).rejects.toMatchObject({ status: 409 });
  });
});
