import { Queue, QueueEvents, Worker } from "bullmq";
import type { Job, Processor } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";

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
  const q = new Queue(name, { connection: getRedis(), defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  } });
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

export function createWorker(name: string, handler: Processor, concurrency = 4) {
  if (!isQueueEnabled()) return null;
  const w = new Worker(name, handler, { connection: getRedis(), concurrency });
  w.on("failed", (job: Job | undefined, err: Error) => logger.error({ job: job?.id, err: err.message }, `${name} job failed`));
  w.on("completed", (job: Job) => logger.info({ job: job.id }, `${name} job done`));
  return w;
}

export function createQueueEvents(name: string) {
  if (!isQueueEnabled()) return null;
  return new QueueEvents(name, { connection: getRedis() });
}
