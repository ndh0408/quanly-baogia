/**
 * CỤM B4 — /api/search và /api/analytics không có limiter RIÊNG.
 *
 * TÁI HIỆN (đã đọc mã, không suy đoán):
 *   · src/routes/search.routes.ts trước bản vá dài đúng 20 dòng: `router.use(requireAuth)` rồi
 *     `router.get("/", validate({ query: Query }), …)`. Không có `createLimiter` nào.
 *   · src/routes/analytics.routes.ts tương tự: requireAuth + requirePermission rồi 4 route GET.
 * Trần duy nhất của chúng là apiLimiter chung 120 req/phút (src/app.ts `app.use("/api/", apiLimiter)`).
 *
 * VÌ SAO ĐÁNG CHẶN RIÊNG: mỗi GET /api/search bắn tối đa BA truy vấn song song
 * (src/services/searchService.ts — quote.findMany + customer.findMany + product.findMany, gom bằng
 * `await Promise.all(tasks)`), và nhánh product là ILIKE `contains` trên sku/name/category KHÔNG có
 * index trigram (chú thích đầu searchService.ts tự ghi: "Product vẫn ILIKE (chưa có cột searchText)").
 * Tức 120 req/phút ở tầng chung = tới 360 lượt quét bảng/phút/IP. Đối chiếu: export, import, backup,
 * file-sign, export-async đều đã có limiter riêng.
 *
 * BÀI TEST ĐI QUA ĐÚNG LỚP CÓ LỖI — lớp GẮN middleware vào router: mount CHÍNH router thật rồi bắn
 * request HTTP. `createLimiter` bị thay bằng bản CHẶN NGAY tự khai tên prefix, nhờ đó test khẳng định
 * được ĐÚNG limiter nào đứng trước từng route (bản thật trong src/rateLimit.ts CỐ Ý no-op khi
 * NODE_ENV=test, nên KHÔNG thể khẳng định 429 thật của production từ đây).
 * requireAuth/requirePermission và tầng service bị thay bằng bản cho-qua để bài test chỉ nói về
 * VIỆC GẮN LIMITER, không phụ thuộc CSDL hay phiên đăng nhập.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../src/rateLimit.js", () => ({
  // Chặn NGAY từ request đầu: bài test hỏi "có limiter đứng trước route không", không hỏi ngưỡng.
  createLimiter: (prefix) => (_req, res) => res.status(429).json({ limiter: prefix }),
}));

vi.mock("../src/middleware.js", () => ({
  requireAuth: (_req, _res, next) => next(),
  asyncHandler: (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
}));

vi.mock("../src/permissions.js", () => ({
  requirePermission: () => (_req, _res, next) => next(),
  PERMISSIONS: { QUOTE_CREATE: "quote:create:own" },
}));

vi.mock("../src/services/searchService.js", () => ({ globalSearch: async () => ({ results: {}, denied: [] }) }));
vi.mock("../src/services/analyticsService.js", () => ({
  overview: async () => ({}),
  revenueByDay: async () => ({ data: [] }),
  topSales: async () => ({ data: [] }),
  funnel: async () => ({ data: [] }),
}));

describe("B4 — /search và /analytics phải nằm sau limiter riêng", () => {
  let app;

  beforeAll(async () => {
    const { default: searchRoutes } = await import("../src/routes/search.routes.js");
    const { default: analyticsRoutes } = await import("../src/routes/analytics.routes.js");
    app = express();
    app.use(express.json());
    app.use("/api/search", searchRoutes);
    app.use("/api/analytics", analyticsRoutes);
    app.use((err, _req, res, _next) => res.status(err?.status || 500).json({ error: String(err?.message || err) }));
  });

  it("GET /api/search đi qua limiter 'search'", async () => {
    const r = await request(app).get("/api/search?q=abc");
    expect(r.status).toBe(429);
    expect(r.body.limiter).toBe("search");
  });

  it("cả 4 route analytics đều đi qua limiter 'analytics'", async () => {
    for (const p of ["/overview", "/revenue-by-day", "/top-sales", "/funnel"]) {
      const r = await request(app).get(`/api/analytics${p}`);
      expect(r.status, `route ${p}`).toBe(429);
      expect(r.body.limiter, `route ${p}`).toBe("analytics");
    }
  });
});
