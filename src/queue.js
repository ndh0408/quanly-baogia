import { Queue, QueueEvents, Worker } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
import { logger } from "./logger.js";

let connection = null;
export function getRedis() {
  if (!config.REDIS_URL) return null;
  if (connection) return connection;
  connection = new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });
  connection.on("error", (e) => logger.error({ err: e.message }, "redis"));
  return connection;
}

export function isQueueEnabled() {
  return !!config.REDIS_URL;
}

const queues = new Map();

export function getQueue(name) {
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
};

/** Run a job synchronously if the queue isn't available; otherwise enqueue it. */
export async function runOrQueue(queueName, jobName, data, opts = {}) {
  const q = getQueue(queueName);
  if (q) return q.add(jobName, data, opts);
  // Fallback: inline execution (used when REDIS_URL not set, e.g. local dev)
  const { processors } = await import("./worker.js");
  const handler = processors[queueName]?.[jobName];
  if (!handler) {
    logger.warn({ queueName, jobName }, "no processor for job, running noop");
    return null;
  }
  return handler({ data });
}

export function createWorker(name, handler, concurrency = 4) {
  if (!isQueueEnabled()) return null;
  const w = new Worker(name, handler, { connection: getRedis(), concurrency });
  w.on("failed", (job, err) => logger.error({ job: job?.id, err: err.message }, `${name} job failed`));
  w.on("completed", (job) => logger.info({ job: job.id }, `${name} job done`));
  return w;
}

export function createQueueEvents(name) {
  if (!isQueueEnabled()) return null;
  return new QueueEvents(name, { connection: getRedis() });
}
