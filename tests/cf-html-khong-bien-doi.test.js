// Cloudflare (Web Analytics tự động) chèn <script src="https://static.cloudflareinsights.com/beacon.min.js/…"> vào MỌI
// trang HTML đi qua nó (chỉ với request giống trình duyệt — curl trơn không thấy). CSP của app là `script-src 'self'`
// nên trình duyệt chặn script đó và in một lỗi console ở mọi trang, mọi người dùng, cả production lẫn dev (đo bằng
// Chrome DevTools 2026-10-06). Tài liệu Cloudflare (Web Analytics FAQ): phản hồi có `Cache-Control: no-transform` thì
// proxy không sửa nội dung → không chèn. Cách này KHÔNG nới CSP.
//
// Chốt: tài liệu HTML của SPA mang `no-cache, no-transform`; asset tĩnh thì KHÔNG mang no-transform (để Cloudflare vẫn
// nén JS/CSS như cũ). ĐỎ trên mã cũ: index.html chỉ có `no-cache`.
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

let app;
beforeAll(async () => {
  app = (await import("../src/app.js")).createApp();
});

describe("HTML của SPA: Cloudflare không được biến đổi (không chèn beacon)", () => {
  for (const p of ["/", "/app2/", "/quotes/123"]) {
    it(`${p} → Cache-Control có no-cache VÀ no-transform`, async () => {
      const r = await request(app).get(p);
      expect(r.status).toBe(200);
      expect(r.headers["content-type"] || "").toMatch(/text\/html/);
      const cc = r.headers["cache-control"] || "";
      expect(cc, "mất no-cache là người dùng kẹt bản giao diện cũ").toMatch(/\bno-cache\b/);
      expect(cc, "thiếu no-transform → Cloudflare chèn beacon bị CSP chặn, lỗi console ở mọi trang").toMatch(/\bno-transform\b/);
    });
  }

  it("asset tĩnh KHÔNG mang no-transform (Cloudflare vẫn nén JS)", async () => {
    const r = await request(app).get("/app2/registerSW.js");
    if (r.status !== 200) return;   // bản dựng web chưa có trong cây (verify dựng web SAU bước test backend)
    expect(r.headers["cache-control"] || "").not.toMatch(/no-transform/);
  });
});
