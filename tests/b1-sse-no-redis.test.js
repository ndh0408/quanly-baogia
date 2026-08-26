// Cụm SSE/quan trắc — `sse_backplane_up` báo 0 VĨNH VIỄN trên bản triển khai không dùng Redis.
//
// ── LỖI (sse-backplane-silent-degradation, điểm (c)) ────────────────────────
// Gauge chỉ được `.set(1)` bên trong `if (config.REDIS_URL)` (src/sse.ts). Chạy một tiến trình
// duy nhất, không Redis, là cấu hình HỢP LỆ và được ghi rõ ở đầu file ("Without Redis it behaves
// exactly as the previous single-process broker") — nhưng /metrics khi đó báo `sse_backplane_up 0`
// ngay từ giây đầu tiên. Cảnh báo đặt trên số này (đúng cách đặt: `== 0` là hỏng) kêu giả mãi mãi,
// và một cảnh báo kêu giả mãi mãi là một cảnh báo bị tắt.
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/config.js", () => ({ config: { REDIS_URL: undefined, NODE_ENV: "test" } }));

const sse = await import("../src/sse.js");
const { registry } = await import("../src/observability.js");

describe("SSE không cấu hình Redis", () => {
  it("sse_backplane_up = 1: một tiến trình, không có backplane nào để hỏng", async () => {
    const v = (await registry.getSingleMetric("sse_backplane_up").get()).values[0].value;
    expect(v).toBe(1);
  });

  it("publish vẫn phát thẳng cho client cục bộ (hành vi cũ không đổi)", () => {
    const hs = {};
    const res = { daGhi: [], writableLength: 0, setHeader() {}, flushHeaders() {}, status() { return this; }, json() { return this; }, write(s) { this.daGhi.push(s); return true; }, end() {}, destroy() {} };
    sse.attach({ on(ev, fn) { hs[ev] = fn; } }, res, 930001);
    sse.publish(930001, "thu", { a: 1 });
    expect(res.daGhi.some((s) => s.includes("event: thu"))).toBe(true);
    hs.close?.();
  });
});
