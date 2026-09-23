// RT-02 / FILE-08 / RT-03 — tải file xuất NỀN qua app, và Redis chậm một nhịp không làm client bỏ chờ.
//
// ── RT-02/FILE-08 ────────────────────────────────────────────────────────────
// Worker ký URL tải bằng `presignDownload` → URL mang host của S3_ENDPOINT. Ở production kho object
// chỉ nằm trong mạng docker `internal` (`http://minio:9000`, không publish cổng 9000), nên trình
// duyệt nhận "File đã sẵn sàng" rồi không phân giải được máy chủ. Đường xuất nền là lối thoát DUY
// NHẤT cho báo giá quá 20.000 dòng. Nay: GET /api/jobs/export/:id trả `returnvalue.url` là đường
// CÙNG ORIGIN `/api/jobs/export/:id/file`, và đường đó stream file từ kho qua app, gác quyền y hệt.
//
// ── RT-03 ────────────────────────────────────────────────────────────────────
// getState quá trần QUEUE_ADD_TIMEOUT_MS → route trả state "unknown"; client coi "unknown" là job
// đã bị dọn và bỏ chờ. Nay trả 503 + code `job_state_timeout` để client hỏi lại.
process.env.QUEUE_ADD_TIMEOUT_MS = "150";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";

const jobs = new Map();
const hangDoiGia = { getJob: async (id) => jobs.get(String(id)) };
vi.mock("../src/queue.js", async (importOriginal) => {
  const that = await importOriginal();
  return { ...that, isQueueEnabled: () => true, getQueue: () => hangDoiGia };
});

const { prisma } = await import("../src/db.js");
const { putObject, deleteObject } = await import("../src/storage.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
const storageAvailable = !!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);
if (!storageAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng chưa cấu hình kho object");

const TAG = `xntai${Date.now()}`;
const PWD = "Test1234!a";
const KHOA = `exports/${TAG}-1.xlsx`;
const NOI_DUNG = Buffer.from("PK\u0003\u0004 noi dung gia lap cua file xlsx");

function jobGia(id, requestedBy, returnvalue, getState = async () => "completed") {
  return { id, name: "xlsx", data: { quoteId: 1, requestedBy }, returnvalue, progress: 100, failedReason: null, attemptsMade: 1, timestamp: Date.now(), finishedOn: Date.now(), getState };
}

describe.runIf(dbAvailable && storageAvailable)("xuất nền: đường tải cùng origin qua app", () => {
  let app, chu, nguoiKhac, uChu;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    uChu = await prisma.user.create({ data: { username: `${TAG}-chu`, displayName: `${TAG} chu`, role: "manager", passwordHash: await bcrypt.hash(PWD, 4) } });
    const uKhac = await prisma.user.create({ data: { username: `${TAG}-khac`, displayName: `${TAG} khac`, role: "manager", passwordHash: await bcrypt.hash(PWD, 4) } });
    chu = agentWithCsrf(app);
    nguoiKhac = agentWithCsrf(app);
    expect((await chu.post("/api/auth/login").send({ username: uChu.username, password: PWD })).status).toBe(200);
    expect((await nguoiKhac.post("/api/auth/login").send({ username: uKhac.username, password: PWD })).status).toBe(200);

    await putObject({ key: KHOA, body: NOI_DUNG, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    // Job kiểu CŨ (còn nằm trong Redis từ trước bản vá): có `url` đã ký trỏ vào kho nội bộ.
    jobs.set("101", jobGia("101", uChu.id, { key: KHOA, size: NOI_DUNG.length, url: "http://minio:9000/quanly/exports/x?X-Amz-Signature=abc" }));
    // Job kiểu MỚI: worker trả filename.
    jobs.set("102", jobGia("102", uChu.id, { key: KHOA, size: NOI_DUNG.length, filename: "KH01_Bao_gia_0923.xlsx" }));
    // returnvalue trỏ ra ngoài exports/ — không được phát.
    jobs.set("103", jobGia("103", uChu.id, { key: "payment-proofs/p1/x.jpg", size: 1 }));
    // Redis chậm đúng lúc hỏi trạng thái.
    jobs.set("104", jobGia("104", uChu.id, null, () => new Promise(() => {})));
  });

  afterAll(async () => {
    await deleteObject(KHOA).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("GET /api/jobs/export/:id trả url CÙNG ORIGIN, không phải URL đã ký của kho", async () => {
    for (const id of ["101", "102"]) {
      const r = await chu.get(`/api/jobs/export/${id}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.returnvalue.url).toBe(`/api/jobs/export/${id}/file`);
      expect(JSON.stringify(r.body)).not.toMatch(/X-Amz-|minio:9000|127\.0\.0\.1:9000/);
    }
  });

  it("GET …/file phát ĐÚNG byte của object, tên file theo returnvalue.filename", async () => {
    const r = await chu.get("/api/jobs/export/102/file").buffer(true).parse((res, cb) => {
      const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c)));
    });
    expect(r.status).toBe(200);
    expect(Buffer.compare(r.body, NOI_DUNG)).toBe(0);
    expect(r.headers["content-disposition"]).toBe('attachment; filename="KH01_Bao_gia_0923.xlsx"');
    expect(r.headers["content-type"]).toMatch(/spreadsheetml/);
  });

  it("job cũ không có filename → lấy tên theo khoá, vẫn tải được", async () => {
    const r = await chu.get("/api/jobs/export/101/file");
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"]).toBe(`attachment; filename="${TAG}-1.xlsx"`);
  });

  it("người KHÔNG xếp job và không có quote:read:all → 403 ở cả đường tải", async () => {
    expect((await nguoiKhac.get("/api/jobs/export/102")).status).toBe(403);
    expect((await nguoiKhac.get("/api/jobs/export/102/file")).status).toBe(403);
  });

  it("returnvalue trỏ ra ngoài exports/ → 404, không phát chứng từ", async () => {
    expect((await chu.get("/api/jobs/export/103/file")).status).toBe(404);
  });

  it("RT-03: getState quá trần → 503 job_state_timeout, KHÔNG phải state 'unknown'", async () => {
    const r = await chu.get("/api/jobs/export/104");
    expect(r.status, JSON.stringify(r.body)).toBe(503);
    expect(r.body.code).toBe("job_state_timeout");
    expect(r.headers["retry-after"]).toBe("2");
  });
});
