// Excel/PDF generation is CPU-bound. The PRIMARY path runs it in a worker thread
// (runExportJob) so it never blocks the main event loop. This inline serializer is
// the FALLBACK (used when no worker / worker fails): it runs one at a time so a
// burst can't pile up several multi-MB buffers + CPU blocks at once, with a depth
// cap that degrades to 429 instead of timing out.
import { Worker } from "node:worker_threads";
import { logger } from "./logger.js";
import { exportActiveWorkers, exportQueueDepth, exportRejectedTotal, exportDuration } from "./observability.js";

// ─── Cổng giới hạn đồng thời, CÓ TRẦN HÀNG ĐỢI ──────────────────────────────
//
// Bản trước dùng một mảng resolver KHÔNG GIỚI HẠN sau `MAX_WORKERS = 3`. Hai vấn đề thật:
//
//   1) Không có tín hiệu ngược. Request thứ 4 trở đi chỉ nằm chờ, mỗi cái ôm nguyên payload báo
//      giá trong bộ nhớ (báo giá 50 trang × 500 dòng ≈ 4MB JSON). Người dùng không nhận được
//      "hệ thống đang bận" — họ thấy treo cho tới khi proxy bỏ cuộc, còn tiến trình phình tới OOM.
//      Bộ giới hạn tần suất ở route (30/phút) không cứu được: nó tính THEO IP, mà nhiều người dùng
//      là nhiều IP.
//
//   2) Chen ngang làm VƯỢT trần. Cách trả chỗ cũ giảm biến đếm rồi mới đánh thức người chờ bằng
//      microtask; ai xin chỗ ĐỒNG BỘ trong khe đó sẽ thấy còn chỗ và chiếm luôn, xong người chờ
//      CŨNG tăng biến đếm → hai việc nặng CPU chạy cùng lúc dù trần là một.
//      Nói đúng mức độ (đã đo, xem tests/exportQueue.test.js): khe này KHÔNG với tới được từ hai
//      request HTTP khác nhau, vì microtask luôn chạy hết trước macrotask kế tiếp. Nó chỉ với tới
//      được khi hai lượt xuất cùng bắt đầu trong MỘT khối đồng bộ (vd xuất hàng loạt bằng
//      Promise.all). Là lỗi TIỀM ẨN chứ chưa phải sự cố đang xảy ra — vẫn sửa, vì tính đúng đắn
//      của một cái trần không nên phụ thuộc vào việc chỗ gọi tình cờ viết thế nào.
//
// Chốt chặn ở đây: khi trả chỗ mà ĐANG CÓ người xếp hàng thì CHUYỂN THẲNG chỗ cho họ, KHÔNG hạ
// biến đếm — nên không tồn tại khe nào để chen. Và request mới chỉ được đi thẳng khi hàng đợi
// RỖNG, nên thứ tự là FIFO và người xếp hàng không bị bỏ đói.
export type ConcurrencyGate = {
  acquire: (signal?: AbortSignal) => Promise<void>;
  release: () => void;
  active: () => number;
  pending: () => number;
};

/** Lỗi "người xin chỗ đã bỏ đi" — KHÔNG được nhầm với lỗi sinh file để rồi rơi về đường nội tuyến. */
export const abortedError = () =>
  Object.assign(new Error("Yêu cầu xuất file đã bị huỷ"), { name: "AbortError", status: 499, code: "export_aborted" });
export const isAbortedError = (e: unknown) => !!e && typeof e === "object" && (e as any).code === "export_aborted";

/**
 * Lỗi "sinh file quá hạn" — PHẢI phân biệt được với lỗi sinh file thường.
 *
 * Trước đây `generateInWorker` ném `new Error("export worker timeout")`, không mã lỗi, nên
 * `runExportJob` không tách được nó khỏi "worker sập" và cho rơi về đường NỘI TUYẾN. Với đường
 * HTTP đồng bộ đó là lựa chọn đúng (thà chậm còn hơn hỏng). Với tiến trình WORKER thì không: rơi
 * về nội tuyến sau khi đã quá hạn nghĩa là làm lại đúng việc chậm đó trên vòng lặp sự kiện, LẦN
 * NÀY KHÔNG CÓ TRẦN NÀO — chính cái trần vừa đặt bị vô hiệu. Có mã lỗi riêng thì mỗi đường gọi tự
 * chọn được cách xử lý.
 */
export const timeoutError = (tranMs: number) =>
  Object.assign(new Error(`Sinh file xuất quá hạn ${Math.round(tranMs / 1000)}s`), {
    name: "TimeoutError", status: 504, code: "export_timeout",
  });
export const isTimeoutError = (e: unknown) => !!e && typeof e === "object" && (e as any).code === "export_timeout";

type Waiter = { resolve: () => void; reject: (e: unknown) => void; detach: () => void };

/**
 * `onReject` được tiêm từ ngoài (thay vì import observability.js ngay tại đây) để cổng này không kéo
 * theo cả bộ đo đạc — test dựng gate độc lập được, và module vẫn nạp được ở nơi không có registry.
 */
export function createConcurrencyGate({ maxActive, maxPending, onReject }: { maxActive: number; maxPending: number; onReject?: () => void }): ConcurrencyGate {
  let active = 0;
  const waiters: Waiter[] = [];

  return {
    acquire(signal?: AbortSignal) {
      // Đã huỷ từ trước thì đừng chiếm chỗ: mỗi suất active là một lượt nghiến CPU sinh file.
      if (signal?.aborted) return Promise.reject(abortedError());
      // Chỉ đi thẳng khi CÒN chỗ VÀ KHÔNG ai đang xếp hàng (giữ FIFO).
      if (active < maxActive && waiters.length === 0) {
        active++;
        return Promise.resolve();
      }
      if (waiters.length >= maxPending) {
        // 503 + Retry-After: đây là "máy chủ hết công suất", không phải "bạn gửi quá nhiều" (429).
        // Trả lỗi NGAY tốt hơn nhiều so với để client treo rồi timeout ở tầng proxy.
        //
        // Đếm NGAY tại đây. Trước đó chỉ nhánh nội tuyến tăng export_rejected_total, mà nhánh ấy chỉ
        // tới được khi worker thread hỏng — nên trong vận hành bình thường mọi lượt từ chối vì quá
        // tải đều vô hình: người dùng nhận 503 còn biểu đồ vẫn phẳng.
        onReject?.();
        return Promise.reject(
          Object.assign(new Error("Hệ thống đang xuất file quá tải, vui lòng thử lại sau ít phút"), {
            status: 503,
            retryAfter: 30,
            code: "export_capacity",
          })
        );
      }
      // Người xếp hàng phải RỜI HÀNG ĐỢI được. Không có đường thoát thì khách đóng tab xong hệ thống
      // vẫn cấp chỗ và vẫn sinh ra một file không ai nhận — ăn trọn một suất công suất lẽ ra dành cho
      // người còn đang chờ.
      return new Promise<void>((resolve, reject) => {
        const w: Waiter = { resolve, reject, detach: () => {} };
        if (signal) {
          const onAbort = () => {
            const i = waiters.indexOf(w);
            if (i >= 0) waiters.splice(i, 1); // rời hàng đợi, KHÔNG đụng `active` (chưa từng cầm chỗ)
            reject(abortedError());
          };
          signal.addEventListener("abort", onAbort, { once: true });
          w.detach = () => signal.removeEventListener("abort", onAbort);
        }
        waiters.push(w);
      });
    },
    release() {
      const next = waiters.shift();
      // CHUYỂN CHỖ trực tiếp: `active` không hạ xuống, nên không có khe cho request mới chen vào.
      if (next) {
        next.detach();
        return next.resolve();
      }
      active--;
    },
    active: () => active,
    pending: () => waiters.length,
  };
}

// ─── Fallback nội tuyến (chạy tuần tự trên luồng chính) ─────────────────────
let chain = Promise.resolve();
let pending = 0;
const MAX_PENDING = 8;

export async function runExport(fn: () => any) {
  if (pending >= MAX_PENDING) {
    exportRejectedTotal.inc({ reason: "inline_queue_full" });
    throw Object.assign(new Error("Hệ thống đang bận xuất file, vui lòng thử lại sau"), { status: 429, retryAfter: 30 });
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
// Bound concurrent workers (memory + CPU on a shared box) AND the queue behind them.
const MAX_WORKERS = Math.max(1, Number(process.env.EXPORT_MAX_ACTIVE || 3));
const MAX_QUEUED = Math.max(0, Number(process.env.EXPORT_MAX_PENDING || 20));
const gate = createConcurrencyGate({
  maxActive: MAX_WORKERS,
  maxPending: MAX_QUEUED,
  onReject: () => exportRejectedTotal.inc({ reason: "gate_full" }),
});

/** Ai đó vượt trần hàng đợi (503) — KHÔNG được nuốt rồi rơi về nội tuyến. */
const isCapacityError = (e: unknown) => !!e && typeof e === "object" && (e as any).code === "export_capacity";

/**
 * TRẦN CỨNG cho MỘT lượt sinh file trong luồng worker (worker_threads).
 *
 * Đây là trần THẬT chứ không phải `Promise.race`: hết hạn thì `w.terminate()` giết luôn luồng, tức
 * công việc DỪNG hẳn và CPU được trả lại. `Promise.race` quanh một hàm async chỉ bỏ mặc lời hứa —
 * workbook vẫn dựng tiếp, vẫn ăn CPU và RAM, chỉ là không ai đọc kết quả nữa.
 *
 * Xuất khẩu ra ngoài để hạ tầng (ân hạn dừng của k8s/compose) neo được vào một con số CÓ THẬT thay
 * vì chép lại một hằng số ma. Đổi bằng EXPORT_GEN_TIMEOUT_MS khi báo giá thật sự lớn hơn mức này.
 */
export const EXPORT_GEN_TIMEOUT_MS = Math.max(1_000, Number(process.env.EXPORT_GEN_TIMEOUT_MS) || 30_000);

function generateInWorker(kind: string, quote: any, timeoutMs = EXPORT_GEN_TIMEOUT_MS) {
  return new Promise<any>((resolve, reject) => {
    let done = false;
    const w = new Worker(WORKER_URL, { workerData: { kind, quote } });
    const finish = (fn: (arg: any) => void, arg: any) => { if (done) return; done = true; clearTimeout(timer); w.terminate(); fn(arg); };
    const timer = setTimeout(() => finish(reject, timeoutError(timeoutMs)), timeoutMs);
    w.once("message", (m) => (m && m.ok) ? finish(resolve, Buffer.from(m.buffer)) : finish(reject, new Error((m && m.error) || "worker error")));
    w.once("error", (e) => finish(reject, e));
    w.once("exit", (code) => { if (!done && code !== 0) finish(reject, new Error("worker exit " + code)); });
  });
}

// Sanity-check the worker output before trusting it (xlsx = PK zip, pdf = %PDF-).
const looksValid = (kind: string, buf: any) =>
  Buffer.isBuffer(buf) && buf.length > 500 &&
  (kind === "pdf" ? buf.toString("latin1", 0, 5) === "%PDF-" : (buf[0] === 0x50 && buf[1] === 0x4b));

/**
 * Generate an export buffer, preferring a worker thread. `plainQuote` MUST be a
 * JSON-serializable quote (plain numbers/strings). On ANY worker problem (spawn
 * error, timeout, invalid output) it falls back to inline generation via
 * `inlineFn`, so exports never break — the worker is a perf optimization, not a
 * correctness dependency.
 *
 * NGOẠI LỆ DUY NHẤT: hết công suất (503). Cái đó phải ném RA NGOÀI cho người gọi.
 * Nếu nuốt rồi rơi về nội tuyến thì trần hàng đợi thành vô nghĩa — đúng lúc hệ thống quá tải
 * lại dồn thêm việc nặng CPU vào luồng chính.
 *
 * `choPhepNoiTuyen: false` TẮT hẳn đường rơi về nội tuyến. Mặc định là `true`, tức đường HTTP đồng
 * bộ (src/routes/export.routes.ts) giữ NGUYÊN hành vi cũ không đổi một ly. Chỉ tiến trình WORKER
 * (src/worker.ts) đặt `false`, và lý do rất cụ thể: ở đó đường nội tuyến KHÔNG có trần thời gian
 * nào cả, nên giữ nó lại là biến trần cứng 30s thành lời nói suông — mà toàn bộ ân hạn dừng 90s
 * của k8s/compose lại đang neo vào chính con số đó.
 */
export async function runExportJob(
  kind: string,
  plainQuote: any,
  inlineFn: () => any,
  { signal, choPhepNoiTuyen = true }: { signal?: AbortSignal; choPhepNoiTuyen?: boolean } = {}
) {
  // Xin chỗ NGOÀI try: lỗi hết công suất không được rơi vào nhánh "thử lại nội tuyến" bên dưới.
  await gate.acquire(signal);
  exportActiveWorkers.set(gate.active());
  exportQueueDepth.set(gate.pending());
  const startedAt = process.hrtime.bigint();
  try {
    let buf;
    try {
      // Chờ trong hàng đợi xong mới tới lượt — trong lúc đó client có thể đã bỏ đi. Kiểm lại NGAY
      // trước khi tiêu CPU, thay vì sinh ra một file không ai nhận.
      if (signal?.aborted) throw abortedError();
      buf = await generateInWorker(kind, plainQuote);
    } finally {
      gate.release();
      exportActiveWorkers.set(gate.active());
      exportQueueDepth.set(gate.pending());
    }
    if (looksValid(kind, buf)) {
      exportDuration.observe({ format: kind, path: "worker" }, Number(process.hrtime.bigint() - startedAt) / 1e9);
      return buf;
    }
    if (!choPhepNoiTuyen) throw new Error("Luồng xuất trả về buffer không hợp lệ");
    logger.warn({ kind }, "export worker returned invalid buffer — falling back to inline");
  } catch (e) {
    if (isCapacityError(e)) throw e;
    // Huỷ cũng KHÔNG được rơi về nội tuyến: người gọi đã bỏ đi, làm lại trên luồng chính chỉ tổ
    // chẹn event loop cho một kết quả không ai đọc.
    if (isAbortedError(e)) throw e;
    // Quá hạn thì càng KHÔNG được rơi về nội tuyến khi người gọi đã tắt đường đó: xem chú thích
    // của `timeoutError`. Với đường đồng bộ (choPhepNoiTuyen mặc định) hành vi giữ nguyên như cũ.
    if (!choPhepNoiTuyen) throw e;
    logger.warn({ kind, err: e instanceof Error ? e.message : String(e) }, "export worker failed — falling back to inline");
  }
  const out = await runExport(inlineFn);
  exportDuration.observe({ format: kind, path: "inline" }, Number(process.hrtime.bigint() - startedAt) / 1e9);
  return out;
}

/** Trạng thái cổng xuất file — dùng cho /readyz mở rộng và cho test. */
export const exportGateStats = () => ({ active: gate.active(), pending: gate.pending(), maxActive: MAX_WORKERS, maxPending: MAX_QUEUED });
