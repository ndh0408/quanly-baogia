// Excel/PDF generation is CPU-bound. The PRIMARY path now runs it in a worker
// thread (runExportJob) so it never blocks the main event loop. This inline
// serializer is the FALLBACK (used when no worker / worker fails): it runs one at
// a time so a burst can't pile up several multi-MB buffers + CPU blocks at once,
// with a depth cap that degrades to 429 instead of timing out.
import { Worker } from "node:worker_threads";
import { logger } from "./logger.js";

let chain = Promise.resolve();
let pending = 0;
const MAX_PENDING = 8;

export async function runExport(fn) {
  if (pending >= MAX_PENDING) {
    throw Object.assign(new Error("Hệ thống đang bận xuất file, vui lòng thử lại sau"), { status: 429 });
  }
  pending++;
  // Run after the previous job settles (success OR failure — never block the chain).
  const result = chain.then(fn, fn);
  chain = result.then(() => {}, () => {});
  try {
    return await result;
  } finally {
    pending--;
  }
}

// ─── Worker-thread generation (keeps the event loop free) ───────────────────
const WORKER_URL = new URL("./exportWorker.js", import.meta.url);
const MAX_WORKERS = 3;            // bound concurrent workers (memory + CPU on shared box)
let activeWorkers = 0;
const workerWaiters: Array<() => void> = [];
function acquireWorkerSlot() {
  if (activeWorkers < MAX_WORKERS) { activeWorkers++; return Promise.resolve(); }
  return new Promise<void>((res) => workerWaiters.push(res)).then(() => { activeWorkers++; });
}
function releaseWorkerSlot() { activeWorkers--; const w = workerWaiters.shift(); if (w) w(); }

function generateInWorker(kind, quote, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const w = new Worker(WORKER_URL, { workerData: { kind, quote } });
    const finish = (fn, arg) => { if (done) return; done = true; clearTimeout(timer); w.terminate(); fn(arg); };
    const timer = setTimeout(() => finish(reject, new Error("export worker timeout")), timeoutMs);
    w.once("message", (m) => (m && m.ok) ? finish(resolve, Buffer.from(m.buffer)) : finish(reject, new Error((m && m.error) || "worker error")));
    w.once("error", (e) => finish(reject, e));
    w.once("exit", (code) => { if (!done && code !== 0) finish(reject, new Error("worker exit " + code)); });
  });
}

// Sanity-check the worker output before trusting it (xlsx = PK zip, pdf = %PDF-).
const looksValid = (kind, buf) =>
  Buffer.isBuffer(buf) && buf.length > 500 &&
  (kind === "pdf" ? buf.toString("latin1", 0, 5) === "%PDF-" : (buf[0] === 0x50 && buf[1] === 0x4b));

/**
 * Generate an export buffer, preferring a worker thread. `plainQuote` MUST be a
 * JSON-serializable quote (plain numbers/strings). On ANY worker problem (spawn
 * error, timeout, invalid output) it falls back to inline generation via
 * `inlineFn`, so exports never break — the worker is a perf optimization, not a
 * correctness dependency.
 */
export async function runExportJob(kind, plainQuote, inlineFn) {
  try {
    await acquireWorkerSlot();
    let buf;
    try { buf = await generateInWorker(kind, plainQuote); }
    finally { releaseWorkerSlot(); }
    if (looksValid(kind, buf)) return buf;
    logger.warn({ kind }, "export worker returned invalid buffer — falling back to inline");
  } catch (e) {
    logger.warn({ kind, err: e instanceof Error ? e.message : String(e) }, "export worker failed — falling back to inline");
  }
  return runExport(inlineFn);
}
