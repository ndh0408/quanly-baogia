// HTTP-06 — handler async không bọc làm request treo; errorHandler nuốt lỗi khi đã gửi header;
// 5xx lộ `code` nội bộ.
//
// · POST /api/stream/presence là handler async TRẦN: prisma ném (cạn pool P2024, CSDL chết) →
//   Express 4 không bắt promise → unhandledRejection → không ai trả lời, request treo tới khi
//   Cloudflare cắt (524). Editor gửi heartbeat mỗi 30s nên đúng lúc CSDL quá tải mỗi tab giữ thêm
//   một kết nối treo. Cùng lớp lỗi: GET /metrics.
// · errorHandler `if (res.headersSent) return;` — không gọi next(err) nên Express không đóng socket.
// · 500 trả kèm `code` gốc ("P2010", "ECONNREFUSED") — manh mối trinh sát.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { errorHandler } from "../src/middleware.js";

const { prisma } = await import("../src/db.js");
const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hetreo${Date.now()}`;
const PWD = "Test1234!a";

function resGia({ headersSent = false } = {}) {
  const r = { headersSent, statusCode: 200, body: undefined, headers: {} };
  r.status = (s) => { r.statusCode = s; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
const reqGia = { id: "req-1", path: "/x", method: "GET", session: {} };

describe("errorHandler", () => {
  it("header đã gửi → chuyển lỗi cho next(err) để Express đóng socket", () => {
    const next = vi.fn();
    const loi = Object.assign(new Error("hỏng giữa chừng"), { status: 500 });
    errorHandler(loi, reqGia, resGia({ headersSent: true }), next);
    expect(next, "return trần — kết nối treo").toHaveBeenCalledWith(loi);
  });

  it("500 KHÔNG trả `code` nội bộ; 4xx vẫn trả code nghiệp vụ", () => {
    const r500 = resGia();
    errorHandler(Object.assign(new Error("raw query failed"), { code: "P2010" }), reqGia, r500, vi.fn());
    expect(r500.statusCode).toBe(500);
    expect(r500.body.error).toBe("Lỗi server");
    expect(r500.body.code, "lộ mã lỗi nội bộ ở 5xx").toBeUndefined();

    const r400 = resGia();
    errorHandler(Object.assign(new Error("Tổng âm"), { status: 400, code: "quote_negative_total" }), reqGia, r400, vi.fn());
    expect(r400.body.code).toBe("quote_negative_total");
  });
});

describe.runIf(dbAvailable)("POST /api/stream/presence khi CSDL ném lỗi", () => {
  let agent;
  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    const app = createApp();
    const u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: TAG, role: "manager", passwordHash: await bcrypt.hash(PWD, 4) } });
    agent = agentWithCsrf(app);
    expect((await agent.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actor: { username: { startsWith: TAG } } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("trả 5xx JSON ngay, không treo", async () => {
    vi.spyOn(prisma.quote, "findFirst").mockRejectedValueOnce(Object.assign(new Error("Timed out fetching a new connection"), { code: "P2024" }));
    const r = await agent.post("/api/stream/presence").send({ quoteId: 1, action: "heartbeat" }).timeout(3000);
    expect(r.status).toBe(503);   // P2024 → 503 + Retry-After (map sẵn trong errorHandler)
    expect(r.body.error).toBeTruthy();
  });
});
