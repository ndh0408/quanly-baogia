// RT-06 — webhook công bố 9 sự kiện nhưng chỉ bắn 2; giao nhận không có mã để bên nhận khử trùng.
// RT-07 — chặn SSRF bỏ lọt vài dải IPv6: ::/96 (IPv4-compatible), 2002::/16 (6to4), fec0::/10,
//         64:ff9b:1::/48 (NAT64 cục bộ).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import { EventEmitter } from "node:events";

const h = vi.hoisted(() => ({ jobs: [] }));
vi.mock("../src/queue.js", () => ({
  QUEUES: { WEBHOOK: "webhook" },
  runOrQueue: async (q, name, data) => { h.jobs.push({ q, name, data }); },
}));

const { prisma } = await import("../src/db.js");
const { EVENTS, emit, assertPublicHttpUrl, deliverWebhook } = await import("../src/webhooks.js");
const { encryptValue } = await import("../src/secretbox.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Webhook" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

afterEach(() => vi.restoreAllMocks());

function tepTs(dir) {
  const ra = [];
  for (const t of readdirSync(dir)) {
    const p = join(dir, t);
    if (statSync(p).isDirectory()) ra.push(...tepTs(p));
    else if (p.endsWith(".ts")) ra.push(p);
  }
  return ra;
}

describe("RT-06: danh sách sự kiện = những gì thật sự được bắn", () => {
  it("mọi phần tử của EVENTS có ít nhất một chỗ gọi emitWebhook(\"<tên>\") trong src/", () => {
    const nguon = tepTs(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).map((f) => readFileSync(f, "utf8")).join("\n");
    const khongAiBan = EVENTS.filter((e) => !new RegExp(`emitWebhook\\(\\s*"${e.replace(".", "\\.")}"`).test(nguon));
    expect(khongAiBan, "sự kiện được công bố nhưng không bao giờ bắn — tích hợp đăng ký nó sẽ im lặng mãi").toEqual([]);
  });
});

describe.runIf(dbAvailable)("RT-06: mã giao nhận X-QLY-Delivery ổn định qua các lần thử lại", () => {
  it("emit gắn deliveryId vào job; deliverWebhook gửi nó trong header", async () => {
    const TAG = `rtwh${Date.now()}`;
    const hook = await prisma.webhook.create({ data: { url: "http://93.184.216.34/hook", events: ["quote.created"], secret: encryptValue("bi-mat-webhook-thu"), active: true } });
    try {
      h.jobs = [];
      await emit("quote.created", { id: 1, tag: TAG });
      const job = h.jobs.find((j) => j.data.webhookId === hook.id);
      expect(job?.data.deliveryId, "job không mang mã giao nhận").toMatch(/^[0-9a-f-]{36}$/);

      let headers;
      vi.spyOn(http, "request").mockImplementation((opts, cb) => {
        headers = opts.headers;
        const req = new EventEmitter();
        req.end = () => { const res = new EventEmitter(); res.statusCode = 200; cb(res); res.emit("end"); };
        req.destroy = () => {};
        return req;
      });
      await deliverWebhook(job.data);
      await deliverWebhook(job.data);   // lần thử lại của CÙNG job
      expect(headers["X-QLY-Delivery"]).toBe(job.data.deliveryId);
    } finally {
      await prisma.webhookDelivery.deleteMany({ where: { webhookId: hook.id } });
      await prisma.webhook.delete({ where: { id: hook.id } });
    }
  });
});

describe("RT-07: SSRF IPv6", () => {
  for (const ip of ["[::7f00:1]", "[2002:7f00:1::]", "[2002:a9fe:a9fe::1]", "[fec0::1]", "[64:ff9b:1::a00:1]", "[2001::1]", "[2001:db8::1]", "[ff02::1]"]) {
    it(`chặn ${ip}`, async () => {
      await expect(assertPublicHttpUrl(`http://${ip}/hook`)).rejects.toMatchObject({ status: 400 });
    });
  }
  for (const ok of ["http://[2606:4700:4700::1111]/hook", "http://[2002:5db8:d822::1]/hook", "http://93.184.216.34/hook"]) {
    it(`vẫn cho ${ok} (công khai)`, async () => {
      await expect(assertPublicHttpUrl(ok)).resolves.toBeTruthy();
    });
  }
  it("chặn cũ vẫn giữ: 127.0.0.1, ::ffff:7f00:1, 169.254.169.254", async () => {
    for (const u of ["http://127.0.0.1/", "http://[::ffff:7f00:1]/", "http://169.254.169.254/"]) {
      await expect(assertPublicHttpUrl(u)).rejects.toMatchObject({ status: 400 });
    }
  });
});
