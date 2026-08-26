// Cụm hàng đợi/SSE/quan trắc — xuất NỀN không có chống trùng (no-job-idempotency…).
//
// ── LỖI: `q.add(format, {...})` không mang khoá chống trùng nào ──────────────
// src/routes/jobs.routes.ts đẩy job xuất file mà không truyền `jobId` lẫn `deduplication`. Nút
// "Xuất" trên giao diện không bị vô hiệu trong lúc chờ, mà route chỉ trả 202 rồi để client poll —
// nên nhấn hai lần (hoặc mạng chậm khiến người dùng nhấn lại) tạo HAI job y hệt nhau: hai lần đọc
// cả báo giá kèm mọi sheet/dòng, hai lần sinh file, hai object rác trong kho.
// TÁI HIỆN: POST cùng một /api/quotes/:id/export hai lần liên tiếp → hàng đợi có 2 job, và hai
// jobId khác nhau.
// HẬU QUẢ: gấp đôi CPU của tiến trình worker (việc nặng nhất trong hệ) cho một kết quả duy nhất.
//
// VÌ SAO DÙNG `deduplication: { id, ttl }` CHỨ KHÔNG PHẢI `jobId`: `jobId` trùng thì BullMQ bỏ qua
// lượt add SUỐT thời gian job còn được giữ lại (removeOnComplete của hàng đợi export là 6 GIỜ).
// Nghĩa là sửa báo giá xong xuất lại trong cùng buổi làm việc sẽ nhận về ĐƯỜNG TẢI CŨ — mất dữ liệu
// dưới góc nhìn người dùng. `deduplication` có TTL nên cửa sổ gộp bị chặn đúng bằng thời gian một
// cú nhấn lặp, không đụng tới lượt xuất lại hợp lệ.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

// DB Redis RIÊNG (index 14) để không đụng tiến trình/agent khác trên cùng máy.
const REDIS_TEST_URL = "redis://127.0.0.1:6379/14";

vi.mock("../src/storage.js", () => ({ isStorageEnabled: () => true }));

let app, hangDoi, getRedis, prisma;
// Trả lại process.env nguyên trạng — xem ghi chú cùng lý do ở tests/hq3-bullmq-metrics.test.js.
const REDIS_URL_GOC = process.env.REDIS_URL;

beforeAll(async () => {
  process.env.REDIS_URL = REDIS_TEST_URL;
  ({ prisma } = await import("../src/db.js"));
  vi.spyOn(prisma.quote, "findFirst").mockResolvedValue({ id: 4242, createdById: 1, members: [] });

  const q = await import("../src/queue.js");
  ({ getRedis } = q);
  hangDoi = q.getQueue(q.QUEUES.EXPORT);
  await hangDoi.obliterate({ force: true }).catch(() => {});

  const { default: jobsRoutes } = await import("../src/routes/jobs.routes.js");
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: 1, role: "admin" }; next(); });
  app.use("/api", jobsRoutes);
});

afterAll(async () => {
  if (REDIS_URL_GOC === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = REDIS_URL_GOC;
  vi.restoreAllMocks();
  try { await hangDoi?.obliterate({ force: true }); } catch { /* ignore */ }
  try { await hangDoi?.close(); } catch { /* ignore */ }
  try { getRedis()?.disconnect(); } catch { /* ignore */ }
});

describe("POST /api/quotes/:id/export — chống nhấn trùng", () => {
  it("hai lượt POST liên tiếp giống hệt nhau chỉ tạo MỘT job", async () => {
    await hangDoi.obliterate({ force: true });
    const a = await request(app).post("/api/quotes/4242/export").send({ format: "xlsx" });
    const b = await request(app).post("/api/quotes/4242/export").send({ format: "xlsx" });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(b.body.jobId, "jobId phải trỏ về đúng job đang chạy để client poll không lạc").toBe(a.body.jobId);
    const counts = await hangDoi.getJobCounts();
    expect(counts.waiting + counts.active + counts.delayed).toBe(1);
  });

  it("KHÁC định dạng thì KHÔNG bị gộp (xlsx và pdf là hai kết quả khác nhau)", async () => {
    await hangDoi.obliterate({ force: true });
    const a = await request(app).post("/api/quotes/4242/export").send({ format: "xlsx" });
    const b = await request(app).post("/api/quotes/4242/export").send({ format: "pdf" });
    expect(b.body.jobId).not.toBe(a.body.jobId);
    const counts = await hangDoi.getJobCounts();
    expect(counts.waiting + counts.active + counts.delayed).toBe(2);
  });
});
