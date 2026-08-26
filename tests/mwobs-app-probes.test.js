// Cụm middleware-obs — hai lỗi trong src/app.ts.
//
// ── LỖI 1: /readyz truy vấn CSDL cho MỌI request, không auth, không rate-limit ─
// `app.get("/readyz", ...)` chạy `prisma.$queryRaw\`SELECT 1\`` mỗi lần được gọi. Limiter duy nhất
// là `app.use("/api/", apiLimiter)` — chỉ phủ tiền tố /api/, nên /livez, /readyz, /metrics nằm
// NGOÀI mọi trần. Pool Postgres của tiến trình web là 20 kết nối (DB_POOL_MAX).
// TÁI HIỆN: gọi /readyz 20 lần liên tiếp → 20 truy vấn CSDL, trong khi probe của
// Docker/k8s chỉ cần vài giây một lần.
// HẬU QUẢ: một endpoint không cần xác thực bơm thẳng tải vào pool CSDL dùng chung với người dùng thật.
//
// ── LỖI 2: kho phiên mở POOL POSTGRES THỨ HAI, không khai trần ───────────────
// `new PgSession({ conObject: { connectionString: config.DATABASE_URL }, ... })` không đặt `max`,
// nên node-pg lấy mặc định 10 kết nối — tách hẳn khỏi pool Prisma (`max: DB_POOL_MAX || 20` ở
// src/db.ts). Tổng ngân sách thật của một tiến trình web là 30, không được khai ở đâu, trong khi
// comment ở db.ts còn mời người vận hành nâng DB_POOL_MAX.
// HẬU QUẢ: cái bẫy chờ sẵn cho lần ai đó nâng DB_POOL_MAX sát max_connections rồi gặp
// "too many clients" mà không hiểu 10 kết nối thừa ở đâu ra.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp, conObjectPhien } from "../src/app.js";
import { prisma } from "../src/db.js";

let app;
beforeEach(() => { app = createApp(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("/readyz", () => {
  it("nhiều lượt gọi liên tiếp chỉ tốn MỘT truy vấn CSDL (kết quả được nhớ tạm)", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockResolvedValue([{ "?column?": 1 }]);
    for (let i = 0; i < 20; i++) {
      const r = await request(app).get("/readyz");
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
    }
    expect(spy.mock.calls.length).toBe(1);
  });

  it("CSDL chết vẫn phải trả 503 và KHÔNG lộ chi tiết lỗi", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("password authentication failed for user quanly"));
    const app2 = createApp(); // app mới → bộ nhớ tạm rỗng
    const r = await request(app2).get("/readyz");
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ ok: false });
    expect(JSON.stringify(r.body)).not.toContain("password");
  });

  it("bộ nhớ tạm KHÔNG dùng chung giữa các app (không rò trạng thái giữa test/instance)", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([{ "?column?": 1 }]);
    await request(createApp()).get("/readyz");
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("db down"));
    const r = await request(createApp()).get("/readyz");
    expect(r.status).toBe(503);
  });

  it("/livez vẫn không đụng CSDL", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockResolvedValue([{ "?column?": 1 }]);
    const r = await request(app).get("/livez");
    expect(r.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("pool của kho phiên", () => {
  it("phải khai trần kết nối tường minh, nhỏ (kho phiên chỉ SELECT/UPSERT một hàng)", () => {
    const o = conObjectPhien();
    expect(typeof o.max).toBe("number");
    expect(o.max).toBeGreaterThan(0);
    expect(o.max).toBeLessThanOrEqual(10); // nhỏ hơn hẳn mặc định 10 của node-pg
    expect(o.connectionString).toBeTruthy();
  });

  it("nới được bằng SESSION_POOL_MAX", () => {
    const cu = process.env.SESSION_POOL_MAX;
    process.env.SESSION_POOL_MAX = "7";
    try { expect(conObjectPhien().max).toBe(7); } finally {
      if (cu === undefined) delete process.env.SESSION_POOL_MAX; else process.env.SESSION_POOL_MAX = cu;
    }
  });

  it("giá trị rác không làm pool thành NaN/0", () => {
    const cu = process.env.SESSION_POOL_MAX;
    process.env.SESSION_POOL_MAX = "abc";
    try { expect(conObjectPhien().max).toBeGreaterThan(0); } finally {
      if (cu === undefined) delete process.env.SESSION_POOL_MAX; else process.env.SESSION_POOL_MAX = cu;
    }
  });
});
