// Sentry + Prometheus integration. Both are no-ops when their env vars are unset,
// so the app boots cleanly in dev without any external services.

import { createHash, timingSafeEqual } from "node:crypto";
import * as Sentry from "@sentry/node";
import type { Request, Response, NextFunction } from "express";
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from "prom-client";
import { config } from "./config.js";
import { logger, maskUrlSecrets } from "./logger.js";

// === Sentry ===
let sentryReady = false;

/**
 * Bộ lọc chạy trên MỌI sự kiện trước khi rời máy: cắt bỏ thứ không được phép rời khỏi hạ tầng công ty.
 *
 * VÌ SAO CÓ `extra`: `captureError` đóng gói ngữ cảnh vào `extra`, và chỗ gọi ở worker nhét NGUYÊN
 * `job.data` vào đó. Với hàng đợi webhook, `job.data.payload` là đối tượng nghiệp vụ thật (khách
 * hàng / báo giá) — mà `deliverWebhook` ném lỗi mỗi lần đích không trả 2xx, tức nhánh này chạy
 * thường xuyên chứ không hiếm. Lọc ở ĐÂY chứ không chỉ ở chỗ gọi, vì chỗ gọi mới thêm sau này sẽ
 * lại quên; định danh (queue/jobId/reqId…) vẫn giữ nên Sentry không mất giá trị truy vết.
 *
 * Tách thành hàm export để test được — `beforeSend` nằm trong Sentry.init thì chỉ chạy khi có DSN.
 */
const KHOA_NOI_DUNG = ["data", "payload", "body"] as const;
export function scrubSentryEvent<T extends { request?: { headers?: Record<string, unknown>; url?: string; query_string?: unknown }; extra?: Record<string, unknown> }>(event: T): T {
  if (event?.request?.headers) {
    delete event.request.headers.cookie;
    delete event.request.headers.authorization;
  }
  // URL PHẢI ĐƯỢC CHE Ở ĐÂY NỮA, không chỉ ở `redact` của pino.
  //
  // Chốt che URL đặt trong src/logger.ts phủ mọi thứ đi qua pino — nhưng Sentry KHÔNG đi qua pino:
  // tích hợp HTTP của nó tự đọc request và gắn `request.url` / `request.query_string` vào sự kiện.
  // Mà token mời/đặt-lại nằm NGAY TRONG ĐƯỜNG DẪN (GET /api/auth/invite/:token) và nó CHIẾM ĐƯỢC
  // TÀI KHOẢN. `beforeSend` là chốt CUỐI trước khi dữ liệu rời hạ tầng công ty sang một dịch vụ
  // ngoài — không che ở đây thì token nằm nguyên văn trên Sentry, với vòng đời và quyền đọc hoàn
  // toàn khác CSDL. Dùng CHUNG maskUrlSecrets với logger để hai đường không lệch pha.
  if (event?.request?.url) event.request.url = maskUrlSecrets(event.request.url);
  // `query_string` của Sentry có thể là CHUỖI trần ("token=…&x=1") hoặc ĐỐI TƯỢNG {khoá: giá trị};
  // chỉ đụng vào dạng chuỗi, vì ghi đè dạng đối tượng bằng một chuỗi sẽ làm hỏng kiểu Sentry mong
  // đợi. Chuỗi đó không có dấu "?" mở đầu, mà maskUrlSecrets chỉ nhận diện tham số đứng sau "?"
  // hoặc "&" — thêm tạm dấu "?" rồi cắt đi để dùng LẠI đúng hàm đó thay vì chép một regex thứ hai
  // rồi để nó trôi khỏi bản gốc.
  if (typeof event?.request?.query_string === "string") {
    event.request.query_string = maskUrlSecrets("?" + event.request.query_string).slice(1);
  }
  if (event?.extra) {
    for (const k of KHOA_NOI_DUNG) delete event.extra[k];
    // CHE MỌI CHUỖI CÒN LẠI TRONG `extra`, không chỉ ba khoá nội dung ở trên.
    //
    // Bản trước chỉ che `request.url` và xoá ba khoá nội dung, rồi tự nhận rằng "lọc ở beforeSend
    // nên chỗ gọi mới thêm sau sẽ không phải nhớ". SAI: `captureError` ở trình xử lý lỗi truyền
    // `{ reqId, path: req.path, method, userId }`, mà `path` không nằm trong KHOA_NOI_DUNG và
    // không đi qua maskUrlSecrets. ĐÃ ĐO: token mời 48 hex trong `GET /api/auth/invite/:token`
    // sang tới Sentry nguyên văn — đúng thứ mà chú thích ngay phía trên nói là đã chặn.
    //
    // Quét toàn bộ giá trị chuỗi thì lời hứa đó mới thành thật: chỗ gọi thêm sau này đặt tên khoá
    // gì cũng được che. maskUrlSecrets vô hại với chuỗi không phải URL (nó chỉ viết lại đoạn
    // /invite/… , /reset/… và các tham số token=…), nên quét rộng không làm hỏng dữ liệu truy vết.
    for (const [k, v] of Object.entries(event.extra)) {
      if (typeof v === "string") event.extra[k] = maskUrlSecrets(v);
    }
  }
  return event;
}
export function initSentry() {
  if (!process.env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: config.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE || 0),
    beforeSend: (event) => scrubSentryEvent(event) as typeof event,
  });
  sentryReady = true;
  logger.info("Sentry initialized");
  return true;
}

export function captureError(err: unknown, ctx?: Record<string, unknown>) {
  if (!sentryReady) return;
  try {
    Sentry.captureException(err, ctx ? { extra: ctx } : undefined);
  } catch {}
}

/** Flush buffered Sentry events before the process exits (worker shutdown / crash). */
export async function flushSentry(timeoutMs = 2000) {
  if (!sentryReady) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {}
}

/**
 * Đăng ký chốt chặn sự cố cấp TIẾN TRÌNH: báo Sentry, đẩy bộ đệm đi, rồi THOÁT khi cần.
 *
 * ── VÌ SAO KHÔNG ĐỂ MỖI ENTRYPOINT TỰ VIẾT ──────────────────────────────────
 * src/worker.ts làm đúng (captureError → flushSentry → exit 1) còn src/server.ts thì chỉ
 * `logger.error(...)`. Hai bản chép tay đã trôi khỏi nhau đúng như vậy.
 *
 * ── VÌ SAO "CHỈ LOG" LÀ NGUY HIỂM, KHÔNG PHẢI CHỈ THIẾU SÓT ──────────────────
 * @sentry/node-core nạp sẵn `onUncaughtExceptionIntegration`. Integration đó chỉ chạy
 * `onFatalError`/`logAndExitProcess` khi nó là listener DUY NHẤT của sự kiện
 * (`processWouldExit === false` ngay khi có listener khác). Nên việc entrypoint tự đăng ký một
 * listener KHÔNG chỉ bỏ lỡ phần flush — nó còn TẮT LUÔN hành vi thoát mặc định của Node. Tiến
 * trình API chạy tiếp sau một uncaughtException, ở trạng thái không xác định, trong khi /livez vẫn
 * xanh nên orchestrator không hề restart nó.
 *
 * `unhandledRejection` KHÔNG tự thoát: hành vi mặc định của Node với rejection chưa xử lý phụ
 * thuộc cờ chạy, và tự ý giết tiến trình web vì một promise lạc là đổi hành vi vận hành. Chỉ báo
 * và flush.
 *
 * Các phụ thuộc nhận qua tham số để test kiểm được đúng chuỗi báo → flush → thoát mà không cần DSN
 * thật và không giết tiến trình chạy test.
 */
export function dangKyChanSuCoTienTrinh(
  proc: NodeJS.EventEmitter & { exit: (ma: number) => void } = process,
  {
    capture = captureError,
    flush = flushSentry,
  }: { capture?: (err: unknown, ctx?: Record<string, unknown>) => void; flush?: (ms?: number) => Promise<void> } = {}
) {
  const chuanHoa = (v: unknown) => (v instanceof Error ? v : new Error(String(v)));

  proc.on("unhandledRejection", (reason: unknown) => {
    const err = chuanHoa(reason);
    logger.error({ err: err.message }, "unhandledRejection");
    capture(err, { kind: "unhandledRejection" });
    void flush().catch(() => {});
  });

  proc.on("uncaughtException", (err: unknown) => {
    const e = chuanHoa(err);
    logger.error({ err: e.message, stack: e.stack }, "uncaughtException — thoát");
    capture(e, { kind: "uncaughtException" });
    // flush hỏng KHÔNG được nuốt mất lần thoát: thà mất sự kiện Sentry còn hơn để một tiến trình
    // đã hỏng ở lại phục vụ request.
    void flush().catch(() => {}).finally(() => proc.exit(1));
  });
}

/**
 * So một header `Authorization: Bearer <token>` với bí mật mong đợi, THỜI GIAN KHÔNG ĐỔI.
 *
 * `!==` thoát ngay ở byte đầu khác nhau, tức là một kênh phụ đo được; so hai digest SHA-256 (luôn
 * cùng độ dài) bằng timingSafeEqual thì không.
 *
 * ĐẶT Ở ĐÂY vì nay CÓ HAI tiến trình cần đúng cổng này: /metrics của app (src/app.ts) và /metrics
 * của tiến trình worker (src/worker.ts). Trước bản vá hàm nằm riêng trong app.ts; chép sang worker
 * là để hai bản trôi khỏi nhau — sửa một chỗ, chỗ kia lặng lẽ giữ lỗi cũ.
 */
export function khopTokenBearer(authHeader: string | undefined, expected: string) {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader || "");
  if (!m) return false;
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// === Prometheus ===
export const registry = new Registry();
registry.setDefaultLabels({ app: "quanly-baogia", env: config.NODE_ENV });
collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "HTTP requests by method/route/status",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});
export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});
// GỠ `quoteOpsTotal` (quote_operations_total): khai báo xong rồi KHÔNG có chỗ nào `.inc()` —
// grep toàn repo chỉ ra đúng một dòng, chính dòng khai báo. Một Counter không ai tăng vẫn được
// /metrics phát ra với giá trị 0 vĩnh viễn, và 0 ở đây đọc thành "không có báo giá nào được tạo/
// duyệt/gửi" — sai lệch nguy hiểm hơn hẳn việc không có số liệu đó. Cần đo lại thì khai lại KÈM
// chỗ tăng, đừng khai trước rồi để đó.
export const exportJobsTotal = new Counter({
  name: "export_jobs_total",
  help: "Export jobs by format and status",
  labelNames: ["format", "status"],
  registers: [registry],
});
export const sseClients = new Gauge({
  name: "sse_clients",
  help: "Number of connected SSE clients",
  registers: [registry],
});

// Backplane Redis của SSE hỏng thì realtime CHẾT ÊM: không lỗi nào tới người dùng, không endpoint
// nào đổi trạng thái (/readyz chỉ hỏi Postgres), chỉ còn một dòng log warn lẫn trong luồng khởi
// động. Hai số này là cách duy nhất để biết trước khi có người báo "thông báo không hiện nữa".
export const sseBackplaneUp = new Gauge({
  name: "sse_backplane_up",
  help: "1 = backplane Redis của SSE đang chạy, 0 = đã rơi về in-memory (mất realtime giữa các instance)",
  registers: [registry],
});
/**
 * CHẾ ĐỘ đang chạy của đường phát realtime — TÁCH khỏi `sse_backplane_up`.
 *
 * Vì sao phải tách: `sse_backplane_up` từng được `.set(1)` cả ở nhánh KHÔNG có REDIS_URL, với lý lẽ
 * "chạy một tiến trình là cấu hình hợp lệ". Lý lẽ đó không được gì bảo đảm: infra/k8s/app.yaml khai
 * `replicas: 2`, `REDIS_URL` là `.optional()` trong src/config.ts và thiếu nó ở production chỉ sinh
 * một `console.warn`, còn infra/helm/quanly/values.yaml để sẵn `REDIS_URL: ""`. Tức tổ hợp "nhiều
 * replica + không Redis" là dựng được, và đó CHÍNH LÀ cấu hình hỏng mà gauge này sinh ra để bắt —
 * nhưng nó lại báo 1. Một gauge nói dối đúng trong tình huống nó phải kêu thì tệ hơn không có.
 *
 * Nay `sse_backplane_up` chỉ nói về backplane REDIS (1 = đang chạy, 0 = không), còn gauge này nói
 * hệ đang ở chế độ nào. Quy tắc cảnh báo đúng:
 *     sse_backplane_mode{mode="redis"} == 1  và  sse_backplane_up == 0
 * — nó im lặng với bản triển khai một tiến trình cố ý không dùng Redis, và kêu đúng lúc backplane
 * chết hoặc bị cấu hình thiếu ở nơi có nhiều instance.
 */
export const sseBackplaneMode = new Gauge({
  name: "sse_backplane_mode",
  help: '1 ở chế độ đang chạy: mode="redis" (có backplane) hoặc mode="local" (một tiến trình, không backplane)',
  labelNames: ["mode"],
  registers: [registry],
});
export const sseBackplaneErrors = new Counter({
  name: "sse_backplane_errors_total",
  help: "Số lần PUBLISH sự kiện SSE qua Redis thất bại",
  labelNames: ["op"],
  registers: [registry],
});

// === Cổng xuất file (Excel/PDF) ===
// Không có mấy số này thì quá tải xuất file là một hộp đen: người dùng báo "chậm", còn hệ thống
// không nói được là đang bận bao nhiêu, xếp hàng bao sâu, hay đã từ chối bao nhiêu lượt.
export const exportActiveWorkers = new Gauge({
  name: "export_active_workers",
  help: "Số worker thread đang sinh file xuất",
  registers: [registry],
});
export const exportQueueDepth = new Gauge({
  name: "export_queue_depth",
  help: "Số yêu cầu xuất file đang xếp hàng chờ tới lượt",
  registers: [registry],
});
// TRẦN của cổng xuất file — MẪU SỐ để tính tỉ lệ bão hoà.
//
// Không có hai số này thì `export_active_workers` / `export_queue_depth` là số trần trụi: nhìn
// "20 đang xếp hàng" không biết là đầy hay mới 10%. Muốn đặt cảnh báo thì phải chép cứng
// EXPORT_MAX_ACTIVE / EXPORT_MAX_PENDING vào quy tắc cảnh báo, rồi nó lệch âm thầm ngay lần đầu ai
// đó chỉnh biến môi trường. Phát cả mẫu số thì cảnh báo viết được là
// `export_queue_depth / export_max_queue_depth > 0.8` và luôn đúng.
export const exportMaxActiveWorkers = new Gauge({
  name: "export_max_active_workers",
  help: "Trần số worker thread sinh file chạy đồng thời (EXPORT_MAX_ACTIVE)",
  registers: [registry],
});
export const exportMaxQueueDepth = new Gauge({
  name: "export_max_queue_depth",
  help: "Trần số yêu cầu xuất file được phép xếp hàng (EXPORT_MAX_PENDING); vượt là 503",
  registers: [registry],
});
export const exportRejectedTotal = new Counter({
  name: "export_rejected_total",
  help: "Số lượt xuất file bị từ chối vì hết công suất",
  labelNames: ["reason"],
  registers: [registry],
});
export const exportDuration = new Histogram({
  name: "export_duration_seconds",
  help: "Thời gian sinh file xuất, tách theo đường worker/nội tuyến",
  labelNames: ["format", "path"],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

// === Độ sâu hàng đợi BullMQ ===
//
// `export_queue_depth` ở trên CHỈ đo cổng worker-thread ĐỒNG BỘ trong src/exportQueue.ts — nó
// không biết gì về 5 hàng đợi BullMQ. Trước gauge này, job xuất file/email/webhook chất đống trong
// Redis mà /metrics im lặng hoàn toàn: worker chết thì dấu hiệu đầu tiên là người dùng gọi điện.
//
// Nhãn `state` lấy đúng tên trạng thái của BullMQ (waiting/active/delayed/failed/…), là tập HỮU HẠN
// và cố định nên cardinality bị chặn ở (số hàng đợi × số trạng thái).
//
// CHƯA KIỂM CHỨNG Ở PRODUCTION: bộ số này mới chỉ được đo qua Redis cục bộ trong test. Prod hiện
// chạy docker-compose và KHÔNG có Prometheus nào scrape — xem docs/REMAINING_RISKS.md.
export const bullQueueDepth = new Gauge({
  name: "bullmq_jobs",
  help: "Số job trong mỗi hàng đợi BullMQ, tách theo trạng thái",
  labelNames: ["queue", "state"],
  registers: [registry],
});

/**
 * Express middleware that records request latency. Mount AFTER routing so that
 * req.route is populated; for routes that don't match any handler we tag as "unknown".
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const dur = Number(process.hrtime.bigint() - start) / 1e9;
    // `||` chốt ở vế đầu: có req.route.path là nhánh ghép baseUrl không bao giờ chạy — mà trong một
    // Router con, req.route.path là đường dẫn TƯƠNG ĐỐI ("/"), nên /api/search, /api/audit,
    // /api/webhooks… bị gộp chung nhãn "/". Ghép tường minh; vẫn là pattern nên cardinality không tăng.
    const tho = req.route?.path ? (req.baseUrl || "") + req.route.path : (req.baseUrl || "unknown");
    // Router mount tại "/api/search" với handler "/" ghép ra "/api/search/" — bỏ gạch chéo cuối để
    // không sinh HAI nhãn cho cùng một endpoint khi router khác khai "/api/search" trực tiếp.
    const route = tho.length > 1 ? tho.replace(/\/+$/, "") : tho;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, dur);
  });
  next();
}
