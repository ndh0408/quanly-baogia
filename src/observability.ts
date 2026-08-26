// Sentry + Prometheus integration. Both are no-ops when their env vars are unset,
// so the app boots cleanly in dev without any external services.

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
export const quoteOpsTotal = new Counter({
  name: "quote_operations_total",
  help: "Quote lifecycle events (create/approve/reject/send)",
  labelNames: ["op", "status"],
  registers: [registry],
});
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
