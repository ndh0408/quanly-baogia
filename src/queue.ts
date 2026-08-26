import { Queue, Worker } from "bullmq";
import type { Job, JobsOptions, Processor, WorkerOptions } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { bullQueueDepth } from "./observability.js";

let connection: any = null;
export function getRedis() {
  if (!config.REDIS_URL) return null;
  if (connection) return connection;
  connection = new (IORedis as any)(config.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });
  connection.on("error", (e: Error) => logger.error({ err: e.message }, "redis"));
  return connection;
}

// Kết nối RIÊNG cho rate-limiter, cấu hình NGƯỢC HẲN với kết nối của BullMQ.
//
// Vì sao phải tách: kết nối trên đặt `maxRetriesPerRequest: null` — BullMQ CẦN thế, vì một job đã
// nhận thì phải cố hoàn tất, thà đợi còn hơn mất. Nhưng rate-limiter chạy TRÊN ĐƯỜNG XỬ LÝ CỦA MỌI
// REQUEST. Dùng chung kết nối "thử lại vô hạn" nghĩa là Redis chết → mọi lệnh xếp hàng vô thời hạn →
// mọi request HTTP treo cho tới khi proxy bỏ cuộc. Đo được trên DEV: dừng Redis thì đăng nhập và API
// đều trả 524 (Cloudflare timeout), trong khi container vẫn "running" và /readyz vẫn báo khoẻ.
//
// Ở đây thì ngược lại: thà TRƯỢT NHANH còn hơn đợi. `enableOfflineQueue: false` để lệnh lỗi ngay
// thay vì xếp hàng; `commandTimeout` chặn lệnh treo; `maxRetriesPerRequest: 1` để không nhân thời
// gian chờ lên nhiều lần.
let rlConnection: any = null;
export function getRateLimitRedis() {
  if (!config.REDIS_URL) return null;
  if (rlConnection) return rlConnection;
  rlConnection = new (IORedis as any)(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    commandTimeout: 1000,
    connectTimeout: 1000,
    retryStrategy: (times: number) => Math.min(times * 500, 5000),
  });
  rlConnection.on("error", (e: Error) => logger.warn({ err: e.message }, "redis (rate limit)"));
  return rlConnection;
}

/** Redis dành cho rate-limit có đang sẵn sàng không (dùng để bỏ qua limiter khi Redis chết). */
export function isRateLimitRedisReady() {
  return !!rlConnection && rlConnection.status === "ready";
}

export function isQueueEnabled() {
  return !!config.REDIS_URL;
}

const queues = new Map();

export function getQueue(name: string) {
  if (!isQueueEnabled()) return null;
  if (queues.has(name)) return queues.get(name);
  const q = new Queue(name, { connection: getRedis(), defaultJobOptions: jobOptionsFor(name) });
  queues.set(name, q);
  return q;
}

export const QUEUES = {
  EXPORT: "export",
  EMAIL: "email",
  WEBHOOK: "webhook",
  NOTIFY: "notify",
  MAINTENANCE: "maintenance", // repeatable: prune bảng append-only (retention)
};

/** Run a job synchronously if the queue isn't available; otherwise enqueue it. */
export async function runOrQueue(queueName: string, jobName: string, data: any, opts: Record<string, any> = {}) {
  const q = getQueue(queueName);
  if (q) return q.add(jobName, data, opts);
  // Fallback: inline execution (used when REDIS_URL not set, e.g. local dev)
  const { processors } = await import("./worker.js");
  const handler = (processors as unknown as Record<string, Record<string, (job: { data: any }) => any>>)[queueName]?.[jobName];
  if (!handler) {
    logger.warn({ queueName, jobName }, "no processor for job, running noop");
    return null;
  }
  return handler({ data });
}

// ─── Đo độ sâu hàng đợi ─────────────────────────────────────────────────────
//
// Gọi ĐÚNG LÚC SCRAPE (từ handler /metrics) thay vì bằng `setInterval`. Hai lý do:
//   • setInterval trong `createApp` sẽ chạy mãi trong MỌI tiến trình test gọi createApp() — rò
//     handle và đập vào Redis dù chẳng ai đọc số liệu.
//   • Số liệu lấy tại thời điểm scrape thì luôn tươi; interval chỉ thêm một lớp trễ.
//
// TIMEOUT LÀ BẮT BUỘC, KHÔNG PHẢI TRANG TRÍ. Kết nối của BullMQ đặt `maxRetriesPerRequest: null`
// (dòng 12 — BullMQ yêu cầu thế), tức lệnh xếp hàng VÔ HẠN khi Redis chết. Không có `Promise.race`
// ở đây thì Redis chết sẽ làm /metrics treo, và /metrics treo lâu hơn scrape_timeout của Prometheus
// là mất luôn cả những số liệu KHÔNG dính Redis.
const QUEUE_DEPTH_TIMEOUT_MS = Number(process.env.QUEUE_DEPTH_TIMEOUT_MS) || 2000;

/**
 * Cập nhật gauge `bullmq_jobs` cho mọi hàng đợi trong QUEUES.
 * KHÔNG BAO GIỜ ném: /metrics phải trả được số liệu còn lại kể cả khi Redis hỏng.
 * Trả về `false` khi không lấy được số (chưa có Redis, hoặc quá hạn) — dùng cho test/chẩn đoán.
 */
export async function capNhatDoSauHangDoi(): Promise<boolean> {
  if (!isQueueEnabled()) return false;
  const quaHan = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("getJobCounts quá hạn")), QUEUE_DEPTH_TIMEOUT_MS).unref?.()
  );
  try {
    await Promise.race([
      Promise.all(
        Object.values(QUEUES).map(async (ten) => {
          const q = getQueue(ten);
          if (!q) return;
          const counts: Record<string, number> = await q.getJobCounts();
          for (const [state, n] of Object.entries(counts)) {
            bullQueueDepth.set({ queue: ten, state }, Number(n) || 0);
          }
        })
      ),
      quaHan,
    ]);
    return true;
  } catch (e) {
    // Không đặt gauge về 0: "không đo được" KHÁC "hàng đợi rỗng", và một số 0 bịa ra sẽ làm cảnh báo
    // im lặng đúng lúc Redis chết. Giá trị cũ ở lại, còn `up`/scrape error là tín hiệu thật.
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "không đọc được độ sâu hàng đợi BullMQ");
    return false;
  }
}

// ─── Tuỳ chọn job THEO TỪNG HÀNG ĐỢI ────────────────────────────────────────
//
// Trước đây cả 5 hàng đợi dùng CHUNG một `defaultJobOptions` với trần thuần theo SỐ LƯỢNG
// (`removeOnComplete: 1000`). Hai hệ quả thật:
//
//   • Không có trần theo TUỔI. Hàng đợi ít việc (maintenance chạy 1 lần/ngày) giữ bản ghi job tới
//     hàng năm trong một Redis đặt maxmemory 256mb + `noeviction` — mà Redis chạm trần là TỪ CHỐI
//     GHI, tức cả hệ hàng đợi đứng chứ không riêng hàng đợi nào.
//   • Backoff exponential KHÔNG jitter. SMTP/webhook đích sập rồi sống lại thì mọi job hỏng thức
//     dậy CÙNG một mốc và đấm dịch vụ vừa hồi phục thêm lần nữa.
//
// CỐ Ý GIỮ NGUYÊN `attempts: 3` ở mọi hàng đợi: đó là hành vi đang chạy production, và bản rà soát
// đã xác nhận việc chạy lại là an toàn (pruneOldRecords idempotent, webhooks tự ghi đè attempts).
// Ở đây chỉ thêm trần theo tuổi và jitter — không đổi số lần thử lại.
const H = 3600;
const D = 86_400;
const BASE_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 7 * D, count: 1000 },
  removeOnFail: { age: 30 * D, count: 5000 },
};
// Dịch vụ NGOÀI: thêm jitter để đợt thử lại tản ra thay vì dội cùng lúc.
const EXTERNAL_JOB_OPTS: JobsOptions = {
  ...BASE_JOB_OPTS,
  backoff: { type: "exponential", delay: 2000, jitter: 0.5 },
  removeOnComplete: { age: 1 * D, count: 500 },
  removeOnFail: { age: 7 * D, count: 1000 },
};

/**
 * BẢN SAO SÂU của bảng hằng số. Trả thẳng đối tượng module-level theo THAM CHIẾU là cái bẫy im lặng:
 * `jobOptionsFor(x).attempts = 5` ở một chỗ gọi bất kỳ sẽ đổi số lần thử lại của MỌI hàng đợi dựng
 * sau đó (ba hàng đợi email/webhook/notify vốn dùng CHUNG một thể hiện, và spread nông còn để chúng
 * dùng chung luôn đối tượng `backoff` với bộ mặc định). Không lỗi, không log — chỉ sai âm thầm.
 */
const cloneOpts = (o: JobsOptions): JobsOptions => structuredClone(o);

export function jobOptionsFor(name: string): JobsOptions {
  switch (name) {
    // Link tải file xuất chỉ sống 24h nên bản ghi job hết giá trị rất nhanh; giữ ngắn để
    // returnvalue (khoá + URL đã ký) không nằm lại trong Redis lâu hơn mức có ích.
    case QUEUES.EXPORT:
      return { ...cloneOpts(BASE_JOB_OPTS), removeOnComplete: { age: 6 * H, count: 200 }, removeOnFail: { age: 2 * D, count: 500 } };
    case QUEUES.EMAIL:
    case QUEUES.WEBHOOK:
    case QUEUES.NOTIFY:
      return cloneOpts(EXTERNAL_JOB_OPTS);
    // Repeatable 1 lần/ngày: trần theo số lượng gần như không bao giờ chạm, phải chặn theo tuổi.
    case QUEUES.MAINTENANCE:
      return { ...cloneOpts(BASE_JOB_OPTS), removeOnComplete: { age: 30 * D, count: 60 }, removeOnFail: { age: 90 * D, count: 60 } };
    default:
      return cloneOpts(BASE_JOB_OPTS);
  }
}

// ─── Tuỳ chọn WORKER theo từng hàng đợi ─────────────────────────────────────
//
// Processor xuất file gọi thẳng buildQuoteBuffer/renderQuotePdf TRÊN vòng lặp sự kiện của tiến
// trình worker. BullMQ mặc định khoá job 30s và gia hạn bằng TIMER mỗi 15s — timer đó không chạy
// được khi vòng lặp đang bị chẹn. Báo giá lớn chẹn quá 30s → khoá hết hạn → job bị coi là "stalled",
// đánh hỏng rồi dựng lại DÙ FILE ĐÃ SINH XONG: client thấy failed, bấm lại, CPU đốt gấp đôi.
//
// Đánh đổi của lockDuration dài: worker chết thật thì job của nó bị giữ khoá tới 5 phút mới được
// nhận lại. Chấp nhận được — thà chậm hồi phục còn hơn liên tục làm lại việc đã xong.
const EXPORT_LOCK_MS = Number(process.env.EXPORT_JOB_LOCK_MS) || 300_000;
// CHỈ HẠ ĐƯỢC, KHÔNG NÂNG ĐƯỢC. Giá trị cuối là `min(concurrency, EXPORT_WORKER_CONCURRENCY)`, mà
// `concurrency` do src/worker.ts truyền vào từ WORKER_CONCURRENCY (mặc định 4). Đặt biến này = 8 vẫn
// cho ra 4 — muốn NÂNG thông lượng xuất file thì phải nâng WORKER_CONCURRENCY. Cố ý giữ trần trên như
// vậy: đây là việc nặng CPU trong MỘT tiến trình, nới rộng chỉ làm mọi job cùng chậm và cùng chẹn.
const EXPORT_WORKER_CONCURRENCY = Number(process.env.EXPORT_WORKER_CONCURRENCY) || 2;

export function workerOptionsFor(name: string, concurrency = 4): Partial<WorkerOptions> & { concurrency: number } {
  if (name === QUEUES.EXPORT) {
    return {
      // Việc nặng CPU trong MỘT tiến trình: chạy 4 job cùng lúc chỉ làm cả 4 cùng chậm và cùng chẹn.
      concurrency: Math.max(1, Math.min(concurrency, EXPORT_WORKER_CONCURRENCY)),
      lockDuration: EXPORT_LOCK_MS,
      stalledInterval: 60_000,
    };
  }
  return { concurrency };
}

export function createWorker(name: string, handler: Processor, concurrency = 4) {
  if (!isQueueEnabled()) return null;
  const w = new Worker(name, handler, { connection: getRedis(), ...workerOptionsFor(name, concurrency) });
  w.on("failed", (job: Job | undefined, err: Error) => logger.error({ job: job?.id, err: err.message }, `${name} job failed`));
  w.on("completed", (job: Job) => logger.info({ job: job.id }, `${name} job done`));
  return w;
}
