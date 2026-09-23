/**
 * OPS · OBS-02 — `db_up` KHÔNG được đo qua pool của người dùng.
 *
 * LỖI (c450a46): doCsdl() gọi `prisma.$queryRaw` — pool dùng chung với request. Pool cạn (nhiều người
 * lưu báo giá lớn) thì phép đo xếp hàng, quá hạn 2s → `db_up 0` → QuanlyCsdlKhongToiDuoc (CRITICAL)
 * trong khi Postgres khoẻ, và inhibit_rules nén mất cảnh báo đúng (pool phải chờ). Người trực bị đẩy
 * đi restart Postgres.
 *
 * TÁI HIỆN: giả lập pool người dùng TREO (prisma.$queryRaw không bao giờ trả) còn đường riêng trả số.
 * Mã cũ: db_up = 0. Mã mới: db_up = 1 và số kết nối lấy từ đường riêng.
 */
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.HEALTH_METRICS_TIMEOUT_MS = "300";
  process.env.HEALTH_METRICS_TTL_MS = "1";
});

vi.mock("../src/db.js", () => ({
  prisma: { $queryRaw: () => new Promise(() => {}) }, // pool người dùng CẠN: chờ mãi
  doSoKetNoiCsdl: async () => ({ dung: 7, tran: 100 }),
  thongKePool: () => ({ tong: 20, ranh: 0, dangCho: 5, tran: 20 }),
}));

const { capNhatSucKhoe, dbUp, dbConnectionsUsed } = await import("../src/observability.js");

describe("OBS-02 — db_up đo qua đường riêng", () => {
  it("pool người dùng cạn mà Postgres khoẻ → db_up = 1, không báo 'CSDL chết'", async () => {
    await capNhatSucKhoe();
    expect((await dbUp.get()).values[0]?.value, "đo qua pool người dùng → pool cạn bị đọc thành CSDL chết").toBe(1);
    expect((await dbConnectionsUsed.get()).values[0]?.value).toBe(7);
  });
});
