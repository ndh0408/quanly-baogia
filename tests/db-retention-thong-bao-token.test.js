/**
 * DB-09 — Notification và RefreshToken PHẢI có retention.
 *
 * Trước bản vá không job nào xoá hai bảng này: thông báo tích luỹ vô hạn (listNotifications không lọc
 * unread thì ORDER BY trên toàn bộ), refresh token đã hết hạn nằm lại mãi.
 * Mốc cực xa (5 năm) để lượt dọn không đụng dữ liệu của bài khác chạy song song.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "../src/db.js";
import { donThongBaoVaRefreshToken } from "../src/retention.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `dbrt${Date.now()}`;
const XUA = new Date(Date.now() - 5 * 365 * 86_400_000);

describe.runIf(dbAvailable)("DB-09 — dọn thông báo đã đọc và refresh token hết hạn", () => {
  let user;
  const id = {};

  beforeAll(async () => {
    user = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: "U", passwordHash: "x" } });
    const n = (data) => prisma.notification.create({ data: { userId: user.id, title: TAG, body: "b", ...data } });
    id.docCu = (await n({ readAt: XUA, createdAt: XUA })).id;
    id.chuaDocCu = (await n({ readAt: null, createdAt: XUA })).id;
    id.docMoi = (await n({ readAt: new Date(), createdAt: new Date() })).id;
    const t = (hau, expiresAt) => prisma.refreshToken.create({ data: { userId: user.id, tokenHash: `${TAG}-${hau}`, family: TAG, expiresAt } });
    id.tokenCu = (await t("cu", XUA)).id;
    id.tokenMoi = (await t("moi", new Date(Date.now() - 86_400_000))).id;   // hết hạn hôm qua — còn giữ
  }, 60_000);

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.refreshToken.deleteMany({ where: { userId: user?.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("xoá thông báo ĐÃ ĐỌC quá hạn + token hết hạn quá 30 ngày; giữ chưa đọc / mới / vừa hết hạn", async () => {
    // Gọi ĐÚNG phần dọn mới, không chạy cả pruneOldRecords: lượt prune toàn cục chạy song song với
    // tests/retention.test.js sẽ xoá mất dữ liệu cố-tình-cũ của bài kia trước khi nó kịp kiểm.
    // Chỉ khẳng định TRẠNG THÁI CUỐI, không khẳng định số đếm: một lượt pruneOldRecords của bài khác
    // chạy song song (cùng luật) có thể dọn hàng của bài này trước — kết quả vẫn phải y hệt.
    const kq = await donThongBaoVaRefreshToken();
    expect(typeof kq.notif).toBe("number");
    expect(typeof kq.refresh).toBe("number");
    const conTB = (await prisma.notification.findMany({ where: { userId: user.id }, select: { id: true } })).map((r) => r.id);
    expect(conTB).not.toContain(id.docCu);
    expect(conTB, "thông báo CHƯA ĐỌC không được xoá dù cũ").toContain(id.chuaDocCu);
    expect(conTB).toContain(id.docMoi);
    const conTk = (await prisma.refreshToken.findMany({ where: { userId: user.id }, select: { id: true } })).map((r) => r.id);
    expect(conTk).not.toContain(id.tokenCu);
    expect(conTk).toContain(id.tokenMoi);
  }, 60_000);

  it("job hằng ngày (pruneOldRecords) thật sự gọi phần dọn này", () => {
    // Kiểm tĩnh: chạy pruneOldRecords thật trong bài này sẽ đua với tests/retention.test.js (xem trên).
    const src = readFileSync(new URL("../src/retention.ts", import.meta.url), "utf8");
    const than = src.slice(src.indexOf("export async function pruneOldRecords"));
    expect(than).toMatch(/await donThongBaoVaRefreshToken\(\)/);
  });
});
