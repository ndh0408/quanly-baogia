/**
 * ============================================================================
 * CỤM ha-tang-trienkhai — "job xuất trong tiến trình worker KHÔNG có trần thời gian".
 *
 * LỖI LÀ GÌ
 *   src/worker.ts trước đây KHÔNG import exportQueue.js. Processor QUEUES.EXPORT gọi thẳng
 *   `buildQuoteBuffer` / `renderQuotePdf` — hàm async thuần, không worker_threads, không setTimeout;
 *   `putObject` không đặt requestTimeout; BullMQ v4+ bỏ hẳn job timeout; `workerOptionsFor`
 *   (src/queue.ts) chỉ đặt lockDuration/stalledInterval. Tức KHÔNG CÓ TRẦN NÀO CẢ.
 *
 *   Trong khi đó ân hạn dừng 90s ở infra/k8s/worker.yaml, infra/helm/quanly/values.yaml và hai file
 *   compose đều tự xưng là "3× trần cứng 30s của generateInWorker" — một hằng số nằm ở module mà
 *   worker không dùng. Con số 90 neo vào hư không.
 *
 * HỆ QUẢ THẬT
 *   Báo giá lớn dựng workbook mất vài phút → deploy gửi SIGTERM → `Worker.close()` chờ job → hết
 *   90s → SIGKILL. Khoá BullMQ giữ tới EXPORT_JOB_LOCK_MS (300s) mới trả job về hàng chờ. Bị cắt
 *   HAI lần (deploy rồi rollback — deploy.sh hướng dẫn rollback bằng một lượt `up -d` nữa) là chạm
 *   maxStalledCount mặc định = 1 → BullMQ đánh hỏng VĨNH VIỄN. Người dùng bấm Xuất, chờ, không bao
 *   giờ nhận file, cũng không có lỗi nào nói cho họ biết.
 *
 * BẢN VÁ
 *   `sinhFileXuat` (src/worker.ts) đi qua `runExportJob(..., { choPhepNoiTuyen: false })`:
 *   sinh file trong worker_threads, hết hạn thì `terminate()` GIẾT luồng (trần THẬT, khác
 *   `Promise.race` chỉ bỏ mặc lời hứa), và KHÔNG rơi về đường nội tuyến — đường đó không có trần,
 *   giữ lại là vô hiệu hoá đúng cái trần vừa đặt. Quá hạn ném `UnrecoverableError` để BullMQ hỏng
 *   NGAY thay vì lặp `attempts: 3` lượt nghiến CPU y hệt nhau.
 *
 * CÁCH TÁI HIỆN Ở ĐÂY
 *   Giả lập `node:worker_threads` bằng một Worker KHÔNG BAO GIỜ trả lời (đúng hình dạng "báo giá
 *   quá lớn, dựng mãi không xong"), hạ EXPORT_GEN_TIMEOUT_MS xuống sàn 1s, rồi đo hành vi thật.
 * ============================================================================
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Worker giả: dựng xong thì im lặng vĩnh viễn — không message, không error, không exit.
// Đúng hình dạng của một lượt sinh file chạy lâu hơn trần.
class WorkerCam {
  constructor() { this.daGiet = false; WorkerCam.daDung.push(this); }
  once() { /* không sự kiện nào được bắn */ }
  terminate() { this.daGiet = true; }
}
WorkerCam.daDung = [];
vi.mock("node:worker_threads", () => ({ Worker: WorkerCam }));

let eq, sinhFileXuat, UnrecoverableError;
const TRAN_CU = process.env.EXPORT_GEN_TIMEOUT_MS;

beforeAll(async () => {
  // Sàn của EXPORT_GEN_TIMEOUT_MS là 1_000 (Math.max) — đặt thấp hơn cũng bị kẹp lên 1s.
  process.env.EXPORT_GEN_TIMEOUT_MS = "1000";
  vi.resetModules();
  eq = await import("../src/exportQueue.js");
  ({ sinhFileXuat } = await import("../src/worker.js"));
  ({ UnrecoverableError } = await import("bullmq"));
});
afterAll(() => {
  if (TRAN_CU === undefined) delete process.env.EXPORT_GEN_TIMEOUT_MS;
  else process.env.EXPORT_GEN_TIMEOUT_MS = TRAN_CU;
});

describe("[ht3] trần sinh file của job xuất nền", () => {
  it("EXPORT_GEN_TIMEOUT_MS là hằng số xuất khẩu — hạ tầng neo được vào số CÓ THẬT", () => {
    expect(eq.EXPORT_GEN_TIMEOUT_MS).toBe(1000);
  });

  it("quá hạn ở đường WORKER: ném lỗi export_timeout và KHÔNG rơi về sinh file nội tuyến", async () => {
    WorkerCam.daDung.length = 0;
    let goiNoiTuyen = 0;
    const noiTuyen = () => { goiNoiTuyen++; return Buffer.alloc(0); };

    await expect(eq.runExportJob("xlsx", { id: 1 }, noiTuyen, { choPhepNoiTuyen: false }))
      .rejects.toMatchObject({ code: "export_timeout" });

    // Đây là điểm mấu chốt: rơi về nội tuyến sau khi quá hạn = làm lại đúng việc chậm đó trên vòng
    // lặp sự kiện, LẦN NÀY KHÔNG TRẦN — trần vừa đặt bị vô hiệu ngay lần quá hạn đầu tiên.
    expect(goiNoiTuyen, "đã rơi về đường nội tuyến — đường KHÔNG có trần thời gian").toBe(0);
    // Trần THẬT: luồng bị giết, CPU/RAM được trả lại (khác Promise.race chỉ bỏ mặc lời hứa).
    expect(WorkerCam.daDung.at(-1).daGiet, "luồng worker không bị terminate() — công việc vẫn chạy tiếp").toBe(true);
  });

  it("đường ĐỒNG BỘ giữ NGUYÊN hành vi cũ: quá hạn thì vẫn rơi về nội tuyến", async () => {
    let goiNoiTuyen = 0;
    const noiTuyen = () => { goiNoiTuyen++; return Buffer.from("du-phong"); };
    const ra = await eq.runExportJob("xlsx", { id: 1 }, noiTuyen);   // không truyền choPhepNoiTuyen
    expect(goiNoiTuyen, "đường đồng bộ mất đường lui — đây là hành vi cũ phải giữ").toBe(1);
    expect(ra.toString()).toBe("du-phong");
  });

  it("sinhFileXuat đổi quá hạn thành UnrecoverableError — BullMQ hỏng NGAY, không lặp attempts", async () => {
    const loi = await sinhFileXuat("xlsx", { id: 1 }, () => Buffer.alloc(0)).catch((e) => e);
    expect(loi).toBeInstanceOf(UnrecoverableError);
    // Thông điệp phải đọc được ở GET /api/jobs/:queue/:id (failedReason) và chỉ đúng nút vặn.
    expect(loi.message).toMatch(/quá lớn/);
    expect(loi.message).toMatch(/EXPORT_GEN_TIMEOUT_MS/);
  });
});
