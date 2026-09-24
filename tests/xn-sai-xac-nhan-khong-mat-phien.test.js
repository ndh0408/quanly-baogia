/**
 * SAI MẬT KHẨU / MÃ XÁC NHẬN KHI ĐANG ĐĂNG NHẬP ≠ MẤT PHIÊN (diễn tập production 2026-09-25).
 *
 * Bật/tắt MFA, đổi mật khẩu, xoá dữ liệu cá nhân đòi gõ lại mật khẩu (step-up). Gõ sai thì máy chủ trả
 * 401 — CÙNG mã với "chưa đăng nhập". Web (web/src/lib/api.ts) coi mọi 401 là mất phiên: hiện lớp phủ
 * "Phiên đăng nhập đã hết" và từ bản 88bf54e còn CHẶN mọi lời gọi tới khi đăng nhập lại — trong khi
 * phiên vẫn sống. Nay các lỗi đó mang `code: "xac_nhan_sai"` (src/httpError.ts loiXacNhanSai) để web
 * phân biệt; 401 mất phiên thật giữ nguyên hình dạng cũ.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const ROOT = join(import.meta.dirname, "..");
const { loiXacNhanSai, httpError } = await import("../src/httpError.js");

describe("loiXacNhanSai", () => {
  it("vẫn 401 (không đổi hợp đồng với client cũ) + code xac_nhan_sai", () => {
    const e = loiXacNhanSai("Mật khẩu không đúng");
    expect(e.status).toBe(401);
    expect(e.code).toBe("xac_nhan_sai");
    expect(e.message).toBe("Mật khẩu không đúng");
    expect(httpError(401, "Chưa đăng nhập").code, "401 mất phiên thật KHÔNG mang mã này").toBeUndefined();
  });

  it("đủ 6 chỗ step-up dùng loiXacNhanSai; không còn httpError(401, …) sai-mật-khẩu nào sót", () => {
    const doc = (p) => readFileSync(join(ROOT, p), "utf8");
    const mfa = doc("src/services/mfaService.ts");
    const auth = doc("src/services/authService.ts");
    const gdpr = doc("src/services/gdprService.ts");
    expect((mfa.match(/loiXacNhanSai\(/g) || []).length).toBe(4);
    expect(auth).toMatch(/loiXacNhanSai\("Mật khẩu cũ không đúng"\)/);
    expect(gdpr).toMatch(/loiXacNhanSai\("Mật khẩu không đúng"\)/);
    for (const [ten, ma] of [["mfaService", mfa], ["authService", auth], ["gdprService", gdpr]]) {
      expect(ma, ten).not.toMatch(/httpError\(401, "(Mật khẩu|Mã xác thực)[^"]*không đúng"\)/);
    }
  });
});

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `xnsai${Date.now()}`;
const MAT_KHAU = "XacNhanDung123!ok";

describe.runIf(dbAvailable)("luồng thật: đổi mật khẩu với mật khẩu cũ SAI", () => {
  let ag, u;
  beforeAll(async () => {
    const app = (await import("../src/app.js")).createApp();
    u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: "U", role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4) } });
    ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: u.username, password: MAT_KHAU })).status).toBe(200);
  }, 60_000);
  afterAll(async () => {
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("→ 401 kèm code xac_nhan_sai, và phiên VẪN SỐNG (/auth/me 200)", async () => {
    const r = await ag.post("/api/auth/change-password").send({ oldPassword: "SaiHoanToan123!", newPassword: "MatKhauMoiRatDai123!" });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("xac_nhan_sai");
    expect((await ag.get("/api/auth/me")).status, "phiên phải còn sống — đây không phải mất phiên").toBe(200);
  });

  it("chưa đăng nhập → 401 KHÔNG mang code xac_nhan_sai (web vẫn bật lớp phủ như cũ)", async () => {
    const app = (await import("../src/app.js")).createApp();
    const khach = agentWithCsrf(app);
    const r = await khach.get("/api/quotes");
    expect(r.status).toBe(401);
    expect(r.body.code).not.toBe("xac_nhan_sai");
  });
});
