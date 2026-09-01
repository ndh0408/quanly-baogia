// Cụm hàng đợi/SSE/quan trắc — độ sâu hàng đợi BullMQ KHÔNG có số liệu nào.
//
// ── LỖI: 5 hàng đợi BullMQ chạy hoàn toàn trong bóng tối ─────────────────────
// `grep -rn getJobCounts src/` không ra kết quả nào. Gauge `export_queue_depth` (observability.ts)
// CHỈ đo cổng worker-thread ĐỒNG BỘ của src/exportQueue.ts (`gate.pending()`) — nó không liên quan
// gì tới hàng đợi BullMQ. Nghĩa là: job xuất file/email/webhook/notify/maintenance chất đống trong
// Redis mà /metrics không hề nói lên một chữ.
// TÁI HIỆN: đẩy một job vào hàng đợi `export` rồi scrape /metrics — không có dòng `bullmq_jobs` nào.
// HẬU QUẢ: worker chết hoặc chậm thì không ai biết cho tới khi người dùng báo "bấm xuất mãi không
// thấy file"; cũng không có tín hiệu nào để đặt cảnh báo hay để chỉnh số lượng worker.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

// DB Redis RIÊNG (index 13) để không đụng dữ liệu của tiến trình/agent khác trên cùng máy.
const REDIS_TEST_URL = "redis://127.0.0.1:6379/13";

let createApp, QUEUES, getQueue, getRedis, hangDoi;
// Vitest có thể DÙNG LẠI tiến trình worker cho nhiều file test, nên `process.env` phải được TRẢ LẠI
// nguyên trạng: để REDIS_URL sót lại là bật hàng đợi cho file test khác (runOrQueue chuyển từ chạy
// nội tuyến sang xếp hàng) — một kiểu đỏ ngẫu nhiên rất khó lần ra.
const REDIS_URL_GOC = process.env.REDIS_URL;

beforeAll(async () => {
  process.env.REDIS_URL = REDIS_TEST_URL;
  const q = await import("../src/queue.js");
  ({ QUEUES, getQueue, getRedis } = q);
  ({ createApp } = await import("../src/app.js"));
  hangDoi = getQueue(QUEUES.EXPORT);
  await hangDoi.obliterate({ force: true }).catch(() => {});
});

afterAll(async () => {
  if (REDIS_URL_GOC === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = REDIS_URL_GOC;
  try { await hangDoi?.obliterate({ force: true }); } catch { /* Redis đã đóng */ }
  try { await hangDoi?.close(); } catch { /* ignore */ }
  try { getRedis()?.disconnect(); } catch { /* ignore */ }
});

/** Đọc giá trị `bullmq_jobs{queue=…,state=…}` từ thân text/plain của /metrics. */
function docGauge(text, queue, state) {
  for (const dong of text.split("\n")) {
    if (!dong.startsWith("bullmq_jobs{")) continue;
    if (!dong.includes(`queue="${queue}"`)) continue;
    if (!dong.includes(`state="${state}"`)) continue;
    return Number(dong.slice(dong.lastIndexOf("}") + 1).trim());
  }
  return null;
}

describe("/metrics — độ sâu hàng đợi BullMQ", () => {
  it("job đang chờ trong hàng đợi export phải hiện ra ở gauge bullmq_jobs", async () => {
    const job = await hangDoi.add("xlsx", { quoteId: 999_001, requestedBy: 1 });
    try {
      const r = await request(createApp()).get("/metrics");
      expect(r.status).toBe(200);
      expect(docGauge(r.text, "export", "waiting")).toBe(1);
    } finally {
      await job.remove().catch(() => {});
    }
  });

  it("mọi hàng đợi đã khai báo đều có mặt, kể cả khi rỗng (0 khác với 'không có số liệu')", async () => {
    const r = await request(createApp()).get("/metrics");
    for (const ten of Object.values(QUEUES)) {
      expect(docGauge(r.text, ten, "waiting"), `thiếu gauge cho hàng đợi ${ten}`).not.toBeNull();
    }
  });
});
