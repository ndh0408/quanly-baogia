// RT-12 — ân hạn dừng worker 150s không phủ HAI job xuất cỡ tối đa chạy song song; job bị giết thì
//         lượt chạy lại đẻ thêm object mồ côi (khoá `exports/<số>-<Date.now()>`).
// RT-13 — log của xepViecCoHan nói "BỎ việc này" trong khi lệnh add vẫn nằm trong hàng đợi offline
//         của ioredis và có thể chạy khi Redis hồi phục.
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ keys: [] }));
vi.mock("../src/db.js", () => ({
  prisma: { quote: { findFirst: async () => ({ id: 1, quoteNumber: "BG-RT12", subtotal: 0, vat: 0, total: 0, vatPercent: 0, company: {}, sheets: [] }) } },
}));
vi.mock("../src/exportQueue.js", () => ({
  runExportJob: async () => Buffer.from("PK-gia-lap"),
  isTimeoutError: () => false,
  EXPORT_GEN_TIMEOUT_MS: 30_000,
  EXPORT_GEN_TIMEOUT_NEN_MS: 90_000,
}));
vi.mock("../src/storage.js", () => ({
  isStorageEnabled: () => true,
  putObject: async ({ key }) => { h.keys.push(key); return { key }; },
}));

const { workerOptionsFor, QUEUES, xepViecCoHan } = await import("../src/queue.js");
const { processors } = await import("../src/worker.js");
const { logger } = await import("../src/logger.js");

describe("RT-12", () => {
  it("mặc định chỉ MỘT job xuất chạy cùng lúc trong một worker", () => {
    expect(workerOptionsFor(QUEUES.EXPORT, 4).concurrency).toBe(1);
  });

  it("khoá object theo job.id: chạy lại cùng job GHI ĐÈ đúng khoá, không đẻ object mới", async () => {
    h.keys = [];
    for (const dinhDang of ["xlsx", "pdf"]) {
      await processors[QUEUES.EXPORT][dinhDang]({ id: "77", data: { quoteId: 1, requestedBy: 1 } });
      await new Promise((r) => setTimeout(r, 3));
      await processors[QUEUES.EXPORT][dinhDang]({ id: "77", data: { quoteId: 1, requestedBy: 1 } });
    }
    expect(h.keys).toEqual(["exports/BG-RT12-77.xlsx", "exports/BG-RT12-77.xlsx", "exports/BG-RT12-77.pdf", "exports/BG-RT12-77.pdf"]);
  });
});

describe("RT-13", () => {
  it("quá hạn chờ: log KHÔNG nói đã bỏ việc — lệnh có thể vẫn chạy khi Redis hồi phục", async () => {
    const loi = vi.spyOn(logger, "error").mockImplementation(() => {});
    const kq = await xepViecCoHan(() => new Promise(() => {}), { queueName: "email", jobName: "send" }, 20);
    expect(kq).toBeNull();
    const msg = String(loi.mock.calls[0]?.[1] ?? "");
    expect(msg, "log nói đã BỎ việc trong khi lệnh vẫn nằm trong hàng đợi offline").not.toMatch(/BỎ việc/);
    expect(msg).toMatch(/có thể VẪN được thực hiện/);
    loi.mockRestore();
  });
});
