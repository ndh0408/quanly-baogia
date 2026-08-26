// Worker process. Run via `npm run worker` in its own container.
// Pulls jobs from BullMQ queues and executes them off the request thread.

import http from "node:http";
import type { Worker, Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { prisma } from "./db.js";
import { createWorker, getQueue, QUEUES, isQueueEnabled } from "./queue.js";
import { pruneOldRecords } from "./retention.js";
import { buildQuoteBuffer } from "./excel.js";
import { renderQuotePdf } from "./pdf.js";
import { runExportJob, isTimeoutError, EXPORT_GEN_TIMEOUT_MS } from "./exportQueue.js";
import { putObject, presignDownload, isStorageEnabled } from "./storage.js";
import { sendEmail } from "./email.js";
import { sendTelegram } from "./telegram.js";
import { initSentry, captureError, flushSentry, exportJobsTotal, registry, khopTokenBearer, dangKyChanSuCoTienTrinh } from "./observability.js";

// ─── /metrics của TIẾN TRÌNH WORKER ─────────────────────────────────────────
//
// Trước bản vá, `grep -nE "listen|node:http|registry" src/worker.ts` không ra một dòng nào: worker
// nạp observability.js (nên có registry, có collectDefaultMetrics và TĂNG `export_jobs_total` ở
// `withExportMetric` bên dưới) nhưng KHÔNG mở cổng nào để đọc số đó. Mọi job chạy qua hàng đợi vì
// thế vô hình với Prometheus; số duy nhất lên được biểu đồ là phần chạy nội tuyến trong tiến trình
// API — đúng phần KHÔNG phải đường chạy chính.
//
// Cổng mặc định 9091 (Prometheus quy ước dải 909x cho exporter phụ). Đặt WORKER_METRICS_PORT=0 để
// tắt hẳn — trong dev/CI, nơi mở thêm một cổng chỉ tổ va nhau.
//
// CHƯA XONG PHÍA HẠ TẦNG: infra/k8s/worker.yaml vẫn chưa khai containerPort lẫn annotation
// `prometheus.io/scrape` (khác app-deployment.yaml), và prod hiện chạy docker-compose không có
// Prometheus nào. Hai file đó nằm ngoài tập file của nhóm này — xem docs/REMAINING_RISKS.md.
export const WORKER_METRICS_PORT = Number(process.env.WORKER_METRICS_PORT ?? 9091);

/**
 * Máy chủ HTTP tí hon chỉ phục vụ GET /metrics.
 *
 * Gác y hệt /metrics của app (src/app.ts): production mà không có METRICS_TOKEN thì TRẢ 404 (fail
 * closed — số liệu lộ tên route, lưu lượng và tỉ lệ lỗi); có token thì bắt buộc Bearer đúng, so ở
 * thời gian không đổi. `token`/`laProd` nhận từ ngoài được để test kiểm cả hai nhánh mà không phải
 * giả lập cả module config.
 *
 * `cong = 0` là để hệ điều hành cấp một cổng rảnh (dùng trong test).
 */
export function taoMayChuMetrics(
  cong: number = WORKER_METRICS_PORT,
  { token = config.METRICS_TOKEN, laProd = config.NODE_ENV === "production" }: { token?: string; laProd?: boolean } = {}
) {
  const srv = http.createServer((req, res) => {
    void (async () => {
      const duong = (req.url || "").split("?")[0];
      if (duong !== "/metrics") { res.statusCode = 404; return res.end(); }
      if (laProd && !token) { res.statusCode = 404; return res.end(); }
      if (token && !khopTokenBearer(req.headers.authorization, token)) { res.statusCode = 401; return res.end(); }
      try {
        res.setHeader("Content-Type", registry.contentType);
        res.end(await registry.metrics());
      } catch (e) {
        logger.warn({ err: e instanceof Error ? e.message : String(e) }, "không kết xuất được /metrics của worker");
        res.statusCode = 500;
        res.end();
      }
    })();
  });
  // KHÔNG để lỗi cổng giết tiến trình worker: số liệu là thứ phụ, job mới là việc chính. Cổng bị
  // chiếm (hai worker cùng máy) phải thành một dòng log, không phải một lần restart.
  srv.on("error", (e) => logger.warn({ err: e.message, cong }, "không mở được cổng /metrics của worker"));
  srv.listen(cong);
  return srv;
}

// Increment the export_jobs_total metric around a generator (counts both the
// worker path and the inline fallback path in queue.js, so the metric is real).
async function withExportMetric(format: string, fn: () => Promise<any>) {
  try {
    const result = await fn();
    exportJobsTotal.inc({ format, status: "success" });
    return result;
  } catch (err) {
    exportJobsTotal.inc({ format, status: "error" });
    throw err;
  }
}

/**
 * Sinh file cho MỘT job xuất nền — qua luồng worker, CÓ TRẦN THỜI GIAN THẬT.
 *
 * ── VÌ SAO KHÔNG GỌI THẲNG buildQuoteBuffer/renderQuotePdf NỮA ───────────────
 * Bản trước gọi thẳng, ngay trên vòng lặp sự kiện của tiến trình worker. Ba hệ quả đã kiểm lại
 * bằng cách đọc mã, không suy đoán:
 *
 *   1) KHÔNG CÓ TRẦN THỜI GIAN NÀO. `buildQuoteBuffer` là hàm async thuần (không worker_threads,
 *      không setTimeout), `putObject` không đặt requestTimeout, BullMQ v4+ bỏ hẳn job timeout, và
 *      `workerOptionsFor` (src/queue.ts) chỉ đặt lockDuration/stalledInterval. Thế mà ân hạn dừng
 *      90s ở infra/k8s/worker.yaml, infra/helm/quanly/values.yaml và hai file compose đều tự xưng
 *      là neo vào "trần cứng 30s của generateInWorker" — trong khi src/worker.ts trước đây thậm
 *      chí KHÔNG import exportQueue.js. Con số 90 neo vào hư không.
 *
 *   2) Hậu quả cụ thể: báo giá lớn (đường xuất không chặn số item, xem docs/REMAINING_RISKS.md)
 *      dựng workbook mất vài phút → deploy gửi SIGTERM → `Worker.close()` chờ job → hết 90s →
 *      SIGKILL. Khoá BullMQ giữ tới EXPORT_JOB_LOCK_MS (300s) mới trả job về hàng chờ. Bị cắt HAI
 *      lần (deploy rồi rollback — chính deploy.sh hướng dẫn rollback bằng một lượt `up -d` nữa) là
 *      chạm maxStalledCount mặc định = 1: BullMQ đánh hỏng VĨNH VIỄN. Người dùng bấm Xuất, chờ,
 *      không bao giờ nhận file, cũng không có lỗi nào nói cho họ biết.
 *
 *   3) Nó CHẸN vòng lặp sự kiện của worker, nên timer gia hạn khoá của BullMQ không chạy được —
 *      đúng thứ mà chú thích ở src/queue.ts phải nâng lockDuration lên 5 phút để bù. Đưa việc sinh
 *      file sang luồng riêng là gỡ đúng gốc chứ không bù thêm nữa.
 *
 * ── TRẦN NÀY LÀ TRẦN THẬT ────────────────────────────────────────────────────
 * `generateInWorker` hết hạn thì `w.terminate()` GIẾT luồng: công việc dừng hẳn, CPU và RAM được
 * trả lại. Khác hẳn `Promise.race`, thứ chỉ bỏ mặc lời hứa còn workbook vẫn dựng tiếp.
 *
 * `choPhepNoiTuyen: false` là phần bắt buộc: mặc định `runExportJob` rơi về sinh file NỘI TUYẾN
 * khi luồng lỗi, mà đường nội tuyến không có trần — giữ nó lại thì trần vừa đặt bị vô hiệu ngay ở
 * lần quá hạn đầu tiên. Đường HTTP ĐỒNG BỘ (src/routes/export.routes.ts) KHÔNG đổi: nó vẫn dùng
 * mặc định `true` và giữ nguyên đường rơi về nội tuyến như trước.
 *
 * Quá hạn ném `UnrecoverableError` để BullMQ hỏng NGAY, không thử lại: `attempts: 3` nghĩa là ba
 * lượt nghiến CPU y hệt nhau cho cùng một kết quả quá hạn. Thà báo lỗi rõ cho người dùng đọc được
 * ở GET /api/jobs/:queue/:id (`failedReason`) — thứ mà đường cũ không hề có.
 */
export async function sinhFileXuat(kind: "xlsx" | "pdf", quote: any, noiTuyen: () => any) {
  try {
    return await runExportJob(kind, JSON.parse(JSON.stringify(quote)), noiTuyen, { choPhepNoiTuyen: false });
  } catch (e) {
    if (isTimeoutError(e)) {
      const giay = Math.round(EXPORT_GEN_TIMEOUT_MS / 1000);
      throw new UnrecoverableError(
        `Báo giá quá lớn: sinh file vượt trần ${giay}s. Nâng EXPORT_GEN_TIMEOUT_MS (và ân hạn dừng của worker) nếu đây là báo giá hợp lệ.`
      );
    }
    throw e;
  }
}

// ─── TRẦN KÍCH THƯỚC cho đường xuất NỀN ─────────────────────────────────────
//
// Đường xuất ĐỒNG BỘ đã có trần từ trước: src/routes/export.routes.ts kiểm `MAX_EXPORT_SHEETS`
// (100) / `MAX_EXPORT_ITEMS` (20 000) rồi trả 413. Đường xuất NỀN thì KHÔNG có phép kiểm kích
// thước nào — route enqueue (src/routes/jobs.routes.ts) chưa từng đọc báo giá nên không biết nó to
// cỡ nào, còn processor thì nạp xong là lao thẳng vào sinh file. Trần duy nhất là trần THỜI GIAN
// 30s của generateInWorker, tức báo giá khổng lồ vẫn đốt trọn 30s CPU một luồng rồi mới hỏng — và
// người dùng bấm lại thì đốt tiếp.
//
// HAI CON SỐ NÀY CHÉP TỪ export.routes.ts CÓ CHỦ Ý: hai đường xuất phải từ chối CÙNG một tập báo
// giá, nếu không người dùng bị "xuất trực tiếp thì báo quá lớn, xuất nền thì chờ mãi rồi lỗi khác".
// Không import chéo được vì hằng số bên đó không export (và file đó không thuộc tập sửa của nhóm
// này); đổi bên nào thì phải đổi bên kia.
const MAX_EXPORT_SHEETS = 100;
const MAX_EXPORT_ITEMS = 20_000;

/**
 * Chặn báo giá vượt trần TRƯỚC khi tiêu CPU.
 *
 * Ném `UnrecoverableError` chứ không phải Error thường: kích thước báo giá không đổi giữa các lần
 * thử, nên `attempts: 3` chỉ là ba lượt từ chối y hệt nhau. Thông điệp đi thẳng vào `failedReason`
 * mà GET /api/jobs/:queue/:id trả về, nên người dùng đọc được cách thoát (tách bớt trang).
 */
function chanBaoGiaQuaLon(quote: any) {
  const soSheet = quote?.sheets?.length || 0;
  const soDong = (quote?.sheets || []).reduce((n: number, s: any) => n + (s?.items?.length || 0), 0);
  if (soSheet > MAX_EXPORT_SHEETS || soDong > MAX_EXPORT_ITEMS) {
    throw new UnrecoverableError(
      `Báo giá quá lớn để xuất (${soSheet} trang / ${soDong} dòng; trần ${MAX_EXPORT_SHEETS} trang / ${MAX_EXPORT_ITEMS} dòng). Hãy tách bớt trang rồi xuất lại.`
    );
  }
}

// === Processors map. Used both by the worker process AND by the inline
// fallback in queue.js when REDIS_URL is not set (local dev).
export const processors = {
  [QUEUES.EXPORT]: {
    "xlsx": (job: any) => withExportMetric("xlsx", async () => {
      const { quoteId, requestedBy } = job.data;
      const quote = await prisma.quote.findFirst({
        where: { id: quoteId },
        include: {
          company: true,
          sheets: {
            orderBy: { order: "asc" },
            include: { template: true, items: { orderBy: { order: "asc" } } },
          },
        },
      });
      if (!quote) throw new Error("Không tìm thấy báo giá");
      chanBaoGiaQuaLon(quote);
      const buf = await sinhFileXuat("xlsx", quote, () => buildQuoteBuffer(quote));
      if (isStorageEnabled()) {
        const key = `exports/${quote.quoteNumber}-${Date.now()}.xlsx`;
        await putObject({
          key, body: buf,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          metadata: { quoteId: String(quoteId), requestedBy: String(requestedBy || "") },
        } as any);
        const url = await presignDownload(key, { expiresIn: 24 * 3600 });
        return { key, url, size: buf.length };
      }
      // KHÔNG nhét file vào giá trị trả về của job.
      //
      // BullMQ lưu returnvalue TRONG REDIS và giữ lại tới `removeOnComplete: 1000` job đã xong.
      // Một file .xlsx 5MB thành ~6,7MB base64; 1000 job như thế là ~6,7GB trong một Redis đặt
      // maxmemory 256mb. Với `noeviction` (đúng cấu hình prod) Redis sẽ TỪ CHỐI GHI — toàn bộ hệ
      // hàng đợi đứng, không chỉ riêng việc xuất file.
      //
      // Đường xuất NỀN tồn tại để trả về một ĐƯỜNG TẢI. Không có kho object thì nó không có gì để
      // trả — nói thẳng, thay vì âm thầm nhồi Redis. Route enqueue đã chặn sớm hơn; đây là chốt cuối.
      throw new Error("Xuất nền cần kho object (S3_*). Chưa cấu hình — dùng chức năng xuất trực tiếp.");
    }),
    "pdf": (job: any) => withExportMetric("pdf", async () => {
      const { quoteId, requestedBy } = job.data;
      const quote = await prisma.quote.findFirst({
        where: { id: quoteId },
        include: {
          company: true,
          sheets: { orderBy: { order: "asc" }, include: { template: true, items: { orderBy: { order: "asc" } } } },
        },
      });
      if (!quote) throw new Error("Không tìm thấy báo giá");
      chanBaoGiaQuaLon(quote);
      const pdfQuote = {
        ...quote,
        subtotal: Number(quote.subtotal),
        vat: Number(quote.vat),
        total: Number(quote.total),
        vatPercent: Number(quote.vatPercent),
      };
      const buf: any = await sinhFileXuat("pdf", pdfQuote, () => renderQuotePdf(pdfQuote));
      if (isStorageEnabled()) {
        const key = `exports/${quote.quoteNumber}-${Date.now()}.pdf`;
        await putObject({
          key, body: buf, contentType: "application/pdf",
          metadata: { quoteId: String(quoteId), requestedBy: String(requestedBy || "") },
        } as any);
        const url = await presignDownload(key, { expiresIn: 24 * 3600 });
        return { key, url, size: buf.length };
      }
      // KHÔNG nhét file vào giá trị trả về của job.
      //
      // BullMQ lưu returnvalue TRONG REDIS và giữ lại tới `removeOnComplete: 1000` job đã xong.
      // Một file .xlsx 5MB thành ~6,7MB base64; 1000 job như thế là ~6,7GB trong một Redis đặt
      // maxmemory 256mb. Với `noeviction` (đúng cấu hình prod) Redis sẽ TỪ CHỐI GHI — toàn bộ hệ
      // hàng đợi đứng, không chỉ riêng việc xuất file.
      //
      // Đường xuất NỀN tồn tại để trả về một ĐƯỜNG TẢI. Không có kho object thì nó không có gì để
      // trả — nói thẳng, thay vì âm thầm nhồi Redis. Route enqueue đã chặn sớm hơn; đây là chốt cuối.
      throw new Error("Xuất nền cần kho object (S3_*). Chưa cấu hình — dùng chức năng xuất trực tiếp.");
    }),
  },
  [QUEUES.EMAIL]: {
    "send": async (job: any) => sendEmail(job.data),
  },
  [QUEUES.WEBHOOK]: {
    "deliver": async (job: any) => {
      // Lazy import to avoid worker boot dependency cycles
      const { deliverWebhook } = await import("./webhooks.js");
      return deliverWebhook(job.data);
    },
  },
  [QUEUES.NOTIFY]: {
    "telegram": async (job: any) => sendTelegram(job.data),
  },
  [QUEUES.MAINTENANCE]: {
    "prune": async () => pruneOldRecords(),
  },
};

// === Standalone worker mode: spin up processors against Redis-backed queues
// ROBUST entry-check: tsx nạp worker.TS dù lệnh trỏ worker.JS (resolve .js→.ts) → so sánh phải BỎ
// đuôi .js/.ts, nếu không khối worker bị SKIP → thoát ngay, không nghe job. (Hoặc ép WORKER_MODE=true.)
const _entryUrl = process.argv[1] ? `file://${process.argv[1].replaceAll("\\", "/")}` : "";
const _stripExt = (s: string) => s.replace(/\.[cm]?[jt]s$/, "");
if (_stripExt(import.meta.url) === _stripExt(_entryUrl) || process.env.WORKER_MODE === "true") {
  // Worker errors were previously invisible — initialize Sentry here too so a
  // failing export/email/webhook/telegram job is reported, not just logged.
  initSentry();

  if (!isQueueEnabled()) {
    logger.error("REDIS_URL not set — worker has nothing to subscribe to");
    process.exit(1);
  }
  logger.info({ env: config.NODE_ENV }, "Worker starting");

  // Mở /metrics của chính tiến trình này (0 = tắt). Xem khối chú thích ở `taoMayChuMetrics`.
  const mayChuMetrics = WORKER_METRICS_PORT > 0 ? taoMayChuMetrics(WORKER_METRICS_PORT) : null;
  if (mayChuMetrics) logger.info({ cong: WORKER_METRICS_PORT }, "worker /metrics đang lắng nghe");

  const workers: Worker[] = [];
  for (const [queueName, jobs] of Object.entries(processors)) {
    const w = createWorker(queueName, async (job: Job) => {
      const handler = (jobs as unknown as Record<string, (job: any) => any>)[job.name];
      if (!handler) throw new Error(`Không xử lý được công việc (${queueName}/${job.name})`);
      try {
        return await handler(job);
      } catch (err) {
        // Report the failure to Sentry with job context, then rethrow so BullMQ
        // marks the job failed and applies its retry/backoff policy.
        captureError(err, { queue: queueName, jobName: job.name, jobId: job.id, data: job.data });
        logger.error({ queue: queueName, jobName: job.name, jobId: job.id, err: err instanceof Error ? err.message : String(err) }, "job failed");
        throw err;
      }
    }, Number(process.env.WORKER_CONCURRENCY || 4));
    if (w) workers.push(w);
    logger.info({ queue: queueName, jobs: Object.keys(jobs) }, "worker registered");
  }

  // Đăng ký job retention LẶP LẠI hằng ngày 03:00 (prune bảng append-only). Repeatable dedupe theo pattern
  // nên gọi lại lúc khởi động worker là idempotent (không tạo trùng).
  (async () => {
    const mq = getQueue(QUEUES.MAINTENANCE);
    if (mq) {
      await mq.add("prune", {}, { repeat: { pattern: "0 3 * * *" } });
      logger.info("retention prune scheduled (daily 03:00)");
    }
  })().catch((e) => logger.warn({ err: e instanceof Error ? e.message : String(e) }, "không đăng ký được prune lặp"));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Worker shutting down");
    // Đóng cổng metrics NGAY: nó không giữ dữ liệu nghiệp vụ nào, mà một kết nối keep-alive của
    // Prometheus còn mở là đủ giữ tiến trình sống qua mốc ân hạn.
    mayChuMetrics?.close();
    try {
      await Promise.all(workers.map((w) => w.close()));
    } finally {
      await flushSentry();
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Sự cố cấp tiến trình (worker trước đây chết ÊM khi có throw ngoài dự tính). Dùng CHUNG chốt với
  // src/server.ts thay vì chép lại: hai bản chép tay đã trôi khỏi nhau đúng một lần rồi — bản của
  // worker báo Sentry và thoát, bản của server chỉ log. Xem src/observability.ts.
  dangKyChanSuCoTienTrinh();
}
