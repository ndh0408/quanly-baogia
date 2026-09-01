// ngay từ giây đầu tiên. Cảnh báo đặt trên số này (đúng cách đặt: `== 0` là hỏng) kêu giả mãi mãi,
// và một cảnh báo kêu giả mãi mãi là một cảnh báo bị tắt.
//
// ── BẢN VÁ ĐẦU ĐẶT `up = 1` Ở ĐÂY. ĐÃ ĐỔI. ĐỌC KỸ TRƯỚC KHI "SỬA LẠI". ──────
// Nó lập luận "chạy một tiến trình là cấu hình hợp lệ nên backplane coi như đang chạy". Nhưng
// KHÔNG có gì bảo đảm một tiến trình: infra/k8s/app.yaml khai `replicas: 2`; `REDIS_URL` là
// `.optional()` và thiếu nó ở production chỉ sinh một `console.warn`; infra/helm/quanly/values.yaml
// để sẵn `REDIS_URL: ""`. Tổ hợp "nhiều replica + không Redis" vì thế DỰNG ĐƯỢC — và đó chính là
// cấu hình hỏng mà gauge này sinh ra để bắt, trong khi nó lại báo 1.
//
// Nay tách hai nghĩa: `sse_backplane_up` chỉ nói về backplane REDIS; CHẾ ĐỘ nằm ở
// `sse_backplane_mode{mode="redis"|"local"}`. Cảnh báo đúng:
//     sse_backplane_mode{mode="redis"} == 1  và  sse_backplane_up == 0
// — im lặng với bản một tiến trình cố ý, kêu đúng lúc backplane chết hoặc thiếu Redis ở cụm nhiều
// instance. Vẫn giải quyết được nỗi lo ban đầu (không báo động giả), mà không nói dối.
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/config.js", () => ({ config: { REDIS_URL: undefined, NODE_ENV: "test" } }));

const sse = await import("../src/sse.js");
const { registry } = await import("../src/observability.js");

describe("SSE không cấu hình Redis", () => {
  const doc = async (ten, nhan) => {
    const m = await registry.getSingleMetric(ten).get();
    const v = nhan ? m.values.find((x) => x.labels?.mode === nhan) : m.values[0];
    return v ? v.value : null;
  };

  it("KHÔNG báo `up = 1` — không có backplane Redis nào đang chạy cả", async () => {
    expect(await doc("sse_backplane_up"),
      "báo 1 ở đây thì cụm 2 replica không Redis — cấu hình hỏng thật — cũng báo 1").toBe(0);
  });

  it("CHẾ ĐỘ nói rõ đây là bản một tiến trình, để cảnh báo không kêu giả", async () => {
    expect(await doc("sse_backplane_mode", "local"), 'thiếu mode="local" thì không phân biệt được "cố ý không dùng Redis" với "Redis chết"').toBe(1);
    expect(await doc("sse_backplane_mode", "redis")).toBe(0);
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
