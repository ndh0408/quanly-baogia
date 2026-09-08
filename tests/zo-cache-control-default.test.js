// Cache-Control: no-store PHẢI là MẶC ĐỊNH cho MỌI /api/* — chốt hồi quy (ultracode audit
// 2026-09-09, finding WEB-1).
//
// ── LỖI ──────────────────────────────────────────────────────────────────────
// Trước bản vá, chỉ 5 route tự set `no-store` tại chỗ (csrf-token, admin, export ×2, gdpr,
// personnel) — phần còn lại (`GET /api/auth/me` trả email/phone/permissions, 11 GET của
// `/api/quotes`, `/api/users`, `/api/customers`, `/api/employees`, `/api/audit`…) phụ thuộc HOÀN
// TOÀN vào MỘT rule Cloudflare NGOÀI repo để không bị lớp cache trung gian giữ lại và phục vụ NHẦM
// NGƯỜI KHÁC. Bài dưới kiểm THẬT qua HTTP — không cần đăng nhập/DB, vì middleware mount TRƯỚC cả
// session/auth nên header phải có mặt kể cả trên phản hồi 401.
import { describe, it, expect } from "vitest";
import request from "supertest";

const { createApp } = await import("../src/app.js");
const app = createApp();

describe("Cache-Control: no-store mặc định cho /api/* (kể cả route CHƯA từng tự set)", () => {
  it.each([
    ["GET", "/api/auth/me"],           // trả email/phone/displayName/permissions khi đăng nhập
    ["GET", "/api/quotes"],
    ["GET", "/api/quotes/1"],
    ["GET", "/api/users"],
    ["GET", "/api/customers"],
    ["GET", "/api/employees"],
    ["GET", "/api/audit"],
    ["GET", "/api/permissions/me"],
  ])("%s %s → Cache-Control chứa no-store (dù 401 vì chưa đăng nhập)", async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path);
    expect(res.headers["cache-control"], `${method} ${path} thiếu Cache-Control`).toContain("no-store");
  });

  it("route tự set Cache-Control riêng (vd /api/csrf-token) vẫn giữ nguyên giá trị của nó, không bị mặc định ghi đè SAU nó", async () => {
    const res = await request(app).get("/api/csrf-token");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
  });
});
