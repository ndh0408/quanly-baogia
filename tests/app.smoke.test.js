// DB-free smoke tests: prove the app factory wires the full middleware/route
// stack (helmet, session, auth gates, routers, 404) without binding a port.
// These run on every machine — no Postgres required.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

let app;
beforeAll(async () => {
  const { createApp } = await import("../src/app.js");
  app = createApp();
});

describe("app factory (no DB)", () => {
  it("GET /livez → 200", async () => {
    const res = await request(app).get("/livez");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("GET /api/health → 200", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
  });

  it("unauthenticated /api/quotes → 401 (auth gate wired)", async () => {
    const res = await request(app).get("/api/quotes");
    expect(res.status).toBe(401);
  });

  it("unauthenticated /api/users → 401 (admin router wired)", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(401);
  });

  it("unknown API path → 404 JSON, not the SPA fallback", async () => {
    const res = await request(app).get("/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it("security headers are set; CSP script-src has no unsafe-inline", async () => {
    const res = await request(app).get("/livez");
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  // object-src 'none' và frame-ancestors 'self' được nêu ĐÍCH DANH trong yêu cầu bảo mật, có
  // trong src/app.ts, nhưng trước bài này KHÔNG cổng nào khoá.
  //   · object-src 'none'      → chặn <object>/<embed>/<applet>. default-src 'self' vẫn cho nhúng
  //     plugin từ chính origin, mà app này không bao giờ dùng plugin.
  //   · frame-ancestors 'self' → chặn clickjacking. Chỉ thị này KHÔNG kế thừa default-src, thiếu
  //     nó là hở thật.
  //
  // CHỐT TRÊN HEADER THẬT, KHÔNG CHỐT TRÊN MÃ CẤU HÌNH — có chủ ý. Hai giá trị này đến từ HAI
  // nguồn: helmet `useDefaults: true` đã cấp sẵn, và src/app.ts còn khai lại tường minh. Nên xoá
  // riêng hai dòng khai trong app.ts thì header KHÔNG đổi và bài này vẫn xanh (đã thử). Cái bài
  // này bắt được là thứ thật sự nguy hiểm: header ĐẦU RA mất/nới hai chỉ thị đó — do nới giá trị
  // (object-src 'self', frame-ancestors *), do tắt useDefaults, hay do nâng cấp helmet đổi mặc
  // định. Kiểm ngược: đổi thành "'self'" / "*" trong app.ts → bài này ĐỎ.
  it("CSP khoá object-src 'none' và frame-ancestors 'self'", async () => {
    const res = await request(app).get("/livez");
    const csp = res.headers["content-security-policy"];
    expect(csp).toMatch(/(^|;)\s*object-src\s+'none'\s*(;|$)/);
    expect(csp).toMatch(/(^|;)\s*frame-ancestors\s+'self'\s*(;|$)/);
    // frame-ancestors không kế thừa default-src → phải có mặt TƯỜNG MINH, không được nhờ vả.
    expect(csp).toContain("frame-ancestors");
    expect(csp).toContain("object-src");
  });
});

describe("CSRF origin guard (no DB)", () => {
  it("blocks a state-changing request from a foreign Origin", async () => {
    const res = await request(app).post("/api/auth/logout").set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("csrf_origin");
  });

  it("blocks a state-changing request from a foreign Referer (no Origin)", async () => {
    const res = await request(app).post("/api/auth/logout").set("Referer", "https://evil.example/x");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("csrf_referer");
  });

  it("allows a same-origin request (Origin matches APP_BASE_URL)", async () => {
    const res = await request(app).post("/api/auth/logout").set("Origin", "http://localhost:3000");
    expect(res.status).not.toBe(403);
  });

  it("allows a non-browser request with neither Origin nor Referer", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).not.toBe(403);
  });

  it("never blocks safe (GET) requests", async () => {
    const res = await request(app).get("/api/health").set("Origin", "https://evil.example");
    expect(res.status).toBe(200);
  });
});
