// RT-08 — PUBLISH qua Redis trả 0 người nhận thì phải phát cục bộ, không mất sự kiện im lặng.
//
// `pub.publish()` resolve với SỐ subscriber. Khi riêng kết nối SUBSCRIBE hỏng (đang nối lại, bị
// CLIENT KILL, rớt idle) lệnh PUBLISH vẫn thành công và trả 0 — bản trước chỉ rơi về localPublish
// khi lệnh NÉM lỗi, nên sự kiện mất (kể cả với client nối vào chính instance này) và gauge vẫn báo
// khoẻ. Cùng mock ioredis với tests/b1-sse-backplane-fallback.test.js.
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

const h = vi.hoisted(() => ({ soNguoiNhan: 0 }));
vi.mock("ioredis", () => {
  class FakeRedis {
    constructor() { this.handlers = {}; }
    on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
    async subscribe() { return 1; }
    publish() { return Promise.resolve(h.soNguoiNhan); }
  }
  return { default: FakeRedis };
});
vi.mock("../src/config.js", () => ({ config: { REDIS_URL: "redis://rt08-fake:6379", NODE_ENV: "test" } }));

const sse = await import("../src/sse.js");
await new Promise((r) => setTimeout(r, 20));

function giaKetNoi() {
  const req = new EventEmitter();
  const ghi = [];
  const res = {
    headers: {}, setHeader() {}, flushHeaders() {}, status() { return this; }, json() { return this; },
    write(s) { ghi.push(String(s)); return true; }, end() { queueMicrotask(() => req.emit("close")); }, destroy() { this.end(); },
    writableLength: 0,
  };
  return { req, res, ghi };
}

describe("RT-08: publish trả 0 → phát cục bộ", () => {
  it("publish tới người dùng: client cục bộ vẫn nhận ĐÚNG MỘT lần", async () => {
    expect(sse.backplaneDangDung(), "bài phải chạy trên đường Redis").toBe(true);
    const c = giaKetNoi();
    sse.attach(c.req, c.res, 980_001);
    h.soNguoiNhan = 0;
    sse.publish(980_001, "notification", { title: "x" });
    await new Promise((r) => setTimeout(r, 20));
    expect(c.ghi.filter((s) => s.includes("event: notification")).length, "sự kiện mất im lặng khi không subscriber nào nhận").toBe(1);
    sse.detachUser(980_001);
  });

  it("broadcast: 0 người nhận → phát cục bộ; ≥1 người nhận → KHÔNG phát cục bộ (tránh trùng)", async () => {
    const c = giaKetNoi();
    sse.attach(c.req, c.res, 980_002);
    h.soNguoiNhan = 0;
    sse.broadcast("changed", { entity: "quote", action: "update" });
    await new Promise((r) => setTimeout(r, 20));
    expect(c.ghi.filter((s) => s.includes("event: changed")).length).toBe(1);
    h.soNguoiNhan = 1;
    sse.broadcast("changed", { entity: "quote", action: "update" });
    await new Promise((r) => setTimeout(r, 20));
    expect(c.ghi.filter((s) => s.includes("event: changed")).length, "subscriber (giả) đã nhận thì không được phát trùng").toBe(1);
    sse.detachUser(980_002);
  });
});
