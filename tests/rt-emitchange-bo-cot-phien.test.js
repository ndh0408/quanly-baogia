// RT-10 — ghi User chỉ chạm cột PHIÊN/BẢO MẬT không được bắn `changed` tới mọi phiên.
//
// Extension ở src/db.ts bắn emitChange('user', 'update') cho MỌI lần ghi User — kể cả lastLoginAt
// (đăng nhập thành công), failedAttempts/lockedUntil (đăng nhập SAI, do người CHƯA đăng nhập kích
// hoạt) và mfaLastStep (mỗi mã TOTP). broadcast tới mọi phiên → mọi tab invalidateQueries() toàn bộ;
// người ngoài điều khiển được tải đọc của cả công ty và mọi phiên thấy nhịp đăng nhập.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ goi: [] }));
vi.mock("../src/sse.js", async (importOriginal) => ({
  ...(await importOriginal()),
  emitChange: (entity, action) => { h.goi.push({ entity, action }); },
}));

const { prisma, chiGhiCotPhienUser } = await import("../src/db.js");
const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `rtemit${Date.now()}`;
const cho = () => new Promise((r) => setTimeout(r, 50));   // emitChange chạy sau import động

describe("chiGhiCotPhienUser", () => {
  it("chỉ đúng khi MỌI khoá của data là cột phiên", () => {
    expect(chiGhiCotPhienUser("User", "update", { data: { failedAttempts: { increment: 1 } } })).toBe(true);
    expect(chiGhiCotPhienUser("User", "update", { data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: "1.2.3.4" } })).toBe(true);
    expect(chiGhiCotPhienUser("User", "updateMany", { data: { mfaLastStep: 5 } })).toBe(true);
    expect(chiGhiCotPhienUser("User", "update", { data: { role: "admin", lastLoginAt: new Date() } })).toBe(false);
    expect(chiGhiCotPhienUser("Quote", "update", { data: { lastLoginAt: 1 } })).toBe(false);
    expect(chiGhiCotPhienUser("User", "create", { data: { lastLoginAt: 1 } })).toBe(false);
  });
});

describe.runIf(dbAvailable)("extension prisma: không broadcast cho ghi cột phiên", () => {
  let u;
  beforeAll(async () => {
    // Nạp sẵn sse.js: db.ts gọi emitChange qua import() ĐỘNG — lần nạp đầu chậm hơn nhịp chờ `cho()`,
    // lượt gọi rơi sang bài sau và bài "KHÔNG emitChange" xanh giả (đã gặp khi chạy trên mã cũ).
    await import("../src/sse.js");
    u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: TAG, role: "manager", passwordHash: "x" } });
    await cho();
  });
  afterAll(async () => { await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {}); });
  beforeEach(() => { h.goi = []; });

  it("đăng nhập sai (failedAttempts++) và đăng nhập đúng (lastLoginAt) → KHÔNG emitChange", async () => {
    await prisma.user.update({ where: { id: u.id }, data: { failedAttempts: { increment: 1 } } });
    await prisma.user.update({ where: { id: u.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: "203.0.113.1" } });
    await cho();
    expect(h.goi, "mỗi lượt đăng nhập làm cả công ty refetch").toEqual([]);
  });

  it("đổi vai trò / tên hiển thị → VẪN emitChange", async () => {
    await prisma.user.update({ where: { id: u.id }, data: { displayName: `${TAG} moi` } });
    await cho();
    expect(h.goi).toContainEqual({ entity: "user", action: "update" });
  });
});
