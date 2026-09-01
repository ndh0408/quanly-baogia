// Sentry + Prometheus integration. Both are no-ops when their env vars are unset,
// so the app boots cleanly in dev without any external services.

import { createHash, timingSafeEqual } from "node:crypto";
import { statfs } from "node:fs/promises";
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

// ── HAI SỐ SSE MÀ §18 ĐÒI ĐÍCH DANH ─────────────────────────────────────────
//
// §18 gọi tên ba số: `sse_connections`, `sse_reconnects`, `sse_events`. Repo đã có `sse_clients`
// (ĐÚNG NGHĨA `sse_connections` — số kết nối đang mở), và đổi tên nó là thay đổi PHÁ VỠ với bảng
// điều khiển + quy tắc cảnh báo đang dùng, nên giữ nguyên tên cũ; quan hệ tên được ghi ở
// docs/operations/MONITORING.md. Hai số dưới đây trước bản vá này KHÔNG TỒN TẠI (grep toàn repo rỗng).
//
// TÊN KHÔNG CÓ HẬU TỐ `_total` LÀ CÓ CHỦ Ý, không phải quên: quy ước Prometheus muốn `_total` cho
// counter, nhưng §18 chỉ đích danh hai chuỗi này và người soát sẽ grep đúng chúng. Đổi thành
// `sse_events_total` là lại đẻ ra một cặp tên-spec / tên-thật thứ hai, đúng thứ khối chú thích trên
// vừa nói là phải tránh.
export const sseReconnects = new Counter({
  name: "sse_reconnects",
  help: "Số lần một tài khoản NỐI LẠI SSE sau khi vừa rớt hết kết nối (xem SSE_RECONNECT_WINDOW_MS ở src/sse.ts)",
  registers: [registry],
});
export const sseEvents = new Counter({
  name: "sse_events",
  help: "Số KHUNG sự kiện SSE ghi thành công xuống một kết nối trong tiến trình này (keepalive KHÔNG tính)",
  // Nhãn `event` được CHUẨN HOÁ về một tập hữu hạn ở src/sse.ts (`nhanSuKien`) — `publish`/
  // `broadcast` là hàm export, nên nếu lấy thẳng tham số làm nhãn thì một chỗ gọi mới đặt tên động
  // sẽ làm nổ cardinality của Prometheus.
  labelNames: ["event"],
  registers: [registry],
});

// === SỨC KHOẺ PHỤ THUỘC: CSDL · REDIS · ĐĨA ===
//
// ── VÌ SAO PHẢI CÓ ─────────────────────────────────────────────────────────
// §28 đòi cảnh báo cho ba chế độ hỏng mà trước bản vá này KHÔNG có metric nào bắt được:
//
//   · CSDL chết   — `/readyz` biết, nhưng /readyz là một endpoint HTTP, không phải chuỗi số liệu.
//                   Prometheus không hỏi /readyz, nên "app còn sống mà CSDL chết" là mù hoàn toàn:
//                   `up` vẫn 1 (tiến trình trả /metrics bình thường), 5xx chỉ tăng khi CÓ người
//                   dùng đang bấm — ban đêm thì im.
//   · Redis chết  — quy tắc cũ (`QuanlySseBackplaneChet`) gác thêm vế
//                   `sse_backplane_mode{mode="redis"}==1`, cố ý để không kêu oan ở bản một tiến
//                   trình. Hệ quả KHÔNG cố ý: bản triển khai KHÔNG dùng backplane vẫn dùng Redis
//                   cho HÀNG ĐỢI và RATE-LIMIT — Redis chết ở đó thì mọi quy tắc im lặng.
//                   (Phiên đăng nhập KHÔNG nằm ở Redis: `connect-pg-simple` → bảng `user_sessions`
//                   trong Postgres, xem src/app.ts. Redis chết không làm ai bị đăng xuất.)
//   · Đĩa đầy     — không có metric nào. Mà docker-compose.prod.yml đã ghi rõ chế độ hỏng: đĩa đầy
//                   → Postgres không ghi nổi WAL → MẤT DỮ LIỆU. Đây là hạng nặng nhất trong thang
//                   ưu tiên của repo, và nó là thứ duy nhất báo trước được hàng ngày.
//
// ── VÌ SAO ĐO LÚC SCRAPE, KHÔNG PHẢI setInterval ───────────────────────────
// Y hệt lý lẽ ở `capNhatDoSauHangDoi` (src/queue.ts): `setInterval` sẽ chạy trong MỌI tiến trình
// test nạp module này, rò handle và đập vào CSDL/Redis dù không ai đọc số. `collect()` của
// prom-client được `registry.metrics()` AWAIT, nên đo tại đây là số luôn tươi và chỉ tốn khi có
// người scrape thật.
//
// ── KHÔNG BAO GIỜ ĐƯỢC NÉM, KHÔNG BAO GIỜ ĐƯỢC TREO ────────────────────────
// `collect()` ném là `registry.metrics()` ném là /metrics trả 500 — tức MỘT phụ thuộc chết làm mất
// TOÀN BỘ số liệu, kể cả phần không dính gì tới nó. Nên mọi phép đo dưới đây đi qua `hanCho()`:
// quá hạn hay ném đều thành `null`, và `null` được diễn giải riêng cho từng số (xem từng hàm).
// Nhận cả `0`/`false`/`off`/`no` (không phân biệt hoa thường). Vì sao không chỉ `"0"`: người vận
// hành gõ `HEALTH_METRICS=false` sẽ tưởng đã tắt, còn thực tế gauge vẫn ping CSDL mỗi lần scrape —
// một nút tắt IM LẶNG KHÔNG ĂN tệ hơn là không có nút tắt, vì nó tạo niềm tin sai.
const SUCKHOE_TAT = /^(0|false|off|no)$/i.test((process.env.HEALTH_METRICS ?? "").trim());
const SUCKHOE_TTL_MS = Number(process.env.HEALTH_METRICS_TTL_MS) || 5_000;
const SUCKHOE_HAN_MS = Number(process.env.HEALTH_METRICS_TIMEOUT_MS) || 2_000;
/** Điểm gắn của hệ tệp cần theo dõi. Trong container prod đây là lớp ghi của chính container. */
export const DISK_METRICS_PATH = process.env.DISK_METRICS_PATH || "/";

/**
 * `HEALTH_METRICS=0` phải làm năm gauge dưới đây BIẾN MẤT KHỎI /metrics, không phải chỉ chặn phép đo.
 *
 * ── LỖI ĐÃ ĐO ĐƯỢC, DO CHÍNH BẢN VÁ TRƯỚC SINH RA ──────────────────────────
 * Bản trước để `registers: [registry]` cố định rồi chỉ cho `capNhatSucKhoe()` thoát sớm khi tắt.
 * Nhưng một Gauge KHÔNG NHÃN được prom-client khởi tạo sẵn ở 0, nên registry vẫn phát nguyên văn:
 *     db_up{app="quanly-baogia",env="production"} 0
 *     redis_up{...} 0
 * (đo bằng `HEALTH_METRICS=0 node --import tsx` rồi in `registry.metrics()`). Quy tắc
 * `QuanlyCsdlKhongToiDuoc` là `db_up == 0` trong 3 phút → nó kêu CRITICAL suốt ngày đêm trong khi
 * Postgres hoàn toàn khoẻ. Và một cảnh báo kêu oan là một cảnh báo SẼ BỊ TẮT — đúng chế độ hỏng mà
 * `QuanlySseBackplaneChet` và `QuanlyRedisChet` đã phải thêm hẳn một vế `and` để tránh.
 *
 * ── VÌ SAO "KHÔNG PHÁT" ĐÚNG HƠN "PHÁT 0" ──────────────────────────────────
 * Cùng lý lẽ đã viết ở `doDia()`: không đo được thì KHÔNG PHÁT chuỗi nào, vì một con số bịa (0) đọc
 * thành "CSDL chết" / "đĩa đầy". `disk_free_bytes` thoát nạn này nhờ có NHÃN (prom-client không tạo
 * mẫu mặc định cho metric có nhãn) — tức nó đúng do tình cờ, không do thiết kế. Không đăng ký khi
 * tắt làm cả năm gauge cùng một hành vi, và hành vi đó là hành vi có chủ ý.
 *
 * Phần "mất tín hiệu" do `absent()` lo: `QuanlyKhongConTargetNao` bắt ca mất sạch target. Người
 * vận hành cố ý tắt phép đo thì nhận IM LẶNG (mất tín hiệu), không nhận BÁO ĐỘNG GIẢ — đánh đổi
 * này được ghi ở .env.example ngay tại chỗ khai HEALTH_METRICS.
 */
const DK_SUCKHOE = SUCKHOE_TAT ? [] : [registry];

export const dbUp = new Gauge({
  name: "db_up",
  help: "1 = Postgres trả lời `SELECT 1` ở lần scrape gần nhất; 0 = không trả lời (hoặc quá hạn)",
  registers: DK_SUCKHOE,
  collect() { return capNhatSucKhoe(); },
});
/**
 * Redis CÓ ĐƯỢC CẤU HÌNH hay không — TÁCH khỏi `redis_up`, đúng theo bài học của cặp
 * `sse_backplane_up` / `sse_backplane_mode` ngay phía trên.
 *
 * Không tách thì quy tắc "Redis chết" sẽ kêu suốt ở bản triển khai một tiến trình cố ý chạy KHÔNG
 * Redis (`REDIS_URL` là `.optional()` trong src/config.ts) — và một cảnh báo kêu oan là một cảnh
 * báo sẽ bị tắt. Quy tắc đúng: `redis_configured == 1 and redis_up == 0`.
 */
export const redisConfigured = new Gauge({
  name: "redis_configured",
  help: "1 = tiến trình này được cấu hình REDIS_URL (hàng đợi BullMQ/rate-limit/backplane SSE — KHÔNG giữ phiên); 0 = cố ý chạy không Redis",
  registers: DK_SUCKHOE,
  collect() { return capNhatSucKhoe(); },
});
export const redisUp = new Gauge({
  name: "redis_up",
  help: "1 = có ít nhất một kết nối Redis của tiến trình này ở trạng thái ready; 0 = không (chỉ có nghĩa khi redis_configured=1)",
  registers: DK_SUCKHOE,
  collect() { return capNhatSucKhoe(); },
});
export const diskFreeBytes = new Gauge({
  name: "disk_free_bytes",
  help: "Số byte TRỐNG cho tiến trình thường trên hệ tệp DISK_METRICS_PATH (statfs bavail × bsize)",
  labelNames: ["mountpoint"],
  registers: DK_SUCKHOE,
  collect() { return capNhatSucKhoe(); },
});
export const diskTotalBytes = new Gauge({
  name: "disk_total_bytes",
  help: "Tổng dung lượng hệ tệp DISK_METRICS_PATH (statfs blocks × bsize) — MẪU SỐ để tính tỉ lệ trống",
  labelNames: ["mountpoint"],
  registers: DK_SUCKHOE,
  collect() { return capNhatSucKhoe(); },
});

/** Chờ `p` tối đa `ms`; quá hạn HOẶC `p` ném đều trả `null`. Không bao giờ ném. */
function hanCho<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((tra) => {
    const h = setTimeout(() => tra(null), ms);
    (h as unknown as { unref?: () => void }).unref?.();
    p.then(
      (v) => { clearTimeout(h); tra(v); },
      () => { clearTimeout(h); tra(null); }
    );
  });
}

async function doCsdl(): Promise<void> {
  // `import()` ĐỘNG chứ không phải import tĩnh ở đầu file. Lý do KHÔNG phải vòng import — đã kiểm
  // lại mã: src/db.ts chỉ import TĨNH PrismaClient/PrismaPg/Pool/logger/config, còn src/sse.ts thì
  // nó nạp bằng import ĐỘNG (chỗ bắn SSE sau mỗi write), nên chẳng có vòng tĩnh nào để tránh cả.
  // (Vòng THẬT nằm ở `doRedis` ngay dưới: src/queue.ts import TĨNH file này để lấy `bullQueueDepth`.)
  //
  // Lý do thật ở đây là TÁC DỤNG PHỤ LÚC NẠP MODULE của src/db.ts: file đó dựng `new Pool(...)`,
  // `new PrismaPg(...)` rồi `new PrismaClient(...).$extends(...)` ngay ở cấp module. Import tĩnh
  // sẽ kéo nguyên khối đó — cùng @prisma/client và pg — vào MỌI tiến trình và MỌI bài test chỉ nạp
  // file này, dù chúng không bao giờ đọc /metrics. Động thì db.ts chỉ vào đồ thị module khi có
  // người scrape thật, và với `HEALTH_METRICS=0` thì không bao giờ vào.
  //
  // Cả hai tiến trình mở /metrics (src/app.ts, src/worker.ts) đều đã `import { prisma } from
  // "./db.js"` ở đầu file, nên ở đó đây LUÔN là một lượt tra bộ nhớ đệm module, không phải một
  // lượt dựng PrismaClient mới.
  const ok = await hanCho(
    (async () => {
      const { prisma } = await import("./db.js");
      await prisma.$queryRaw`SELECT 1`;
      return true;
    })(),
    SUCKHOE_HAN_MS
  );
  // Quá hạn ĐƯỢC TÍNH LÀ CHẾT, khác hẳn cách `capNhatDoSauHangDoi` xử lý độ sâu hàng đợi (ở đó
  // "không đo được" giữ giá trị cũ). Lý do: `SELECT 1` mà không xong trong 2 giây thì với người
  // dùng, CSDL đã hỏng rồi — mọi request đều đang xếp hàng sau nó.
  dbUp.set(ok ? 1 : 0);
}

async function doRedis(): Promise<void> {
  if (!config.REDIS_URL) {
    redisConfigured.set(0);
    redisUp.set(0);
    return;
  }
  redisConfigured.set(1);
  const ok = await hanCho(
    (async () => {
      const q = await import("./queue.js");
      // KHÔNG gửi lệnh PING. Kết nối của BullMQ đặt `maxRetriesPerRequest: null` (src/queue.ts),
      // tức lệnh xếp hàng VÔ HẠN khi Redis chết — mỗi lượt scrape sẽ bỏ lại một PING trong hàng đợi
      // ngoại tuyến và chúng tích lại hàng nghìn qua một đêm sự cố. `status` của ioredis là thuộc
      // tính đọc tại chỗ, không tốn gì, và nó chỉ bằng "ready" khi kết nối THẬT SỰ dùng được.
      if (q.isRateLimitRedisReady()) return true;
      const c = q.getRedis() as { status?: string } | null;
      return !!c && c.status === "ready";
    })(),
    SUCKHOE_HAN_MS
  );
  redisUp.set(ok ? 1 : 0);
}

async function doDia(): Promise<void> {
  const st = await hanCho(statfs(DISK_METRICS_PATH), SUCKHOE_HAN_MS);
  // KHÔNG đặt 0 khi không đo được. `disk_free_bytes = 0` đọc thành "đĩa đầy" và sẽ kêu báo động
  // giả trên mọi nền không có statfs. Không có số thì KHÔNG PHÁT chuỗi nào — `absent()` trung thực
  // hơn một con số bịa.
  if (!st) return;
  const bsize = Number(st.bsize);
  const tong = Number(st.blocks) * bsize;
  const trong = Number(st.bavail) * bsize;
  if (!Number.isFinite(tong) || tong <= 0 || !Number.isFinite(trong)) return;
  diskTotalBytes.set({ mountpoint: DISK_METRICS_PATH }, tong);
  diskFreeBytes.set({ mountpoint: DISK_METRICS_PATH }, trong);
}

let sucKhoeXong = 0;
let sucKhoeDangChay: Promise<void> | null = null;

/**
 * Đo lại cả ba phụ thuộc, GỘP mọi lời gọi của cùng một lượt scrape thành MỘT lượt đo.
 *
 * `registry.metrics()` gọi `get()` của mọi metric song song qua `Promise.all`, nên năm gauge ở trên
 * cùng gọi hàm này trong cùng một tick. Không gộp thì mỗi lượt scrape đo CSDL năm lần. Gộp bằng
 * promise-đang-bay (không chỉ bằng mốc thời gian) mới đúng: chúng chạy đồng thời, mốc thời gian
 * chưa kịp cập nhật thì cả năm đều thấy "cache hết hạn".
 */
export function capNhatSucKhoe(): Promise<void> {
  if (SUCKHOE_TAT) return Promise.resolve();
  if (sucKhoeDangChay) return sucKhoeDangChay;
  if (Date.now() - sucKhoeXong < SUCKHOE_TTL_MS) return Promise.resolve();
  const chay = (async () => {
    try {
      await Promise.all([doCsdl(), doRedis(), doDia()]);
    } catch {
      // Không thể tới đây (mọi phép đo đã đi qua `hanCho`), nhưng `collect()` ném là /metrics trả
      // 500 — chốt chặn cuối rẻ hơn nhiều so với hậu quả.
    } finally {
      sucKhoeXong = Date.now();
      sucKhoeDangChay = null;
    }
  })();
  sucKhoeDangChay = chay;
  return chay;
}

// === CẤU HÌNH BẮT BUỘC Ở PRODUCTION MÀ ĐANG THIẾU ===
//
// ── VÌ SAO CÓ ─────────────────────────────────────────────────────────────
// §10 đòi production PHẢI kêu khi thiếu "Redis credentials" / "storage credentials". src/config.ts
// cố ý KHÔNG `process.exit` ở đó, và lập luận của nó (config.ts, khối `if NODE_ENV === "production"`)
// đúng: làm cả ứng dụng không khởi động vì một tính năng phụ còn tệ hơn. Nhưng lập luận đó chỉ
// đứng được nếu CÓ LỚP BÙ — mà lớp bù duy nhất đang có là một dòng `console.warn` lúc khởi động,
// tức nó trôi mất sau lần cuộn log đầu tiên và KHÔNG ai đọc lại bao giờ.
//
// Hai lỗ cụ thể đã đo được:
//   · `redis_configured == 0` ở production nghĩa là QUÊN REDIS_URL — nhưng quy tắc `QuanlyRedisChet`
//     lại gác trên `redis_configured == 1`, tức nó TỰ LOẠI TRỪ đúng ca cần nó nhất.
//   · S3_* và SMTP_HOST thì không có metric nào, nên không có quy tắc nào kêu được.
//
// ── VÌ SAO KHÔNG NẰM TRONG KHỐI HEALTH_METRICS ─────────────────────────────
// Đây KHÔNG phải phép đo: nó chỉ đọc `config`, không chạm CSDL/Redis/đĩa, không tốn gì lúc scrape.
// Gộp nó vào nút tắt `HEALTH_METRICS=0` sẽ làm mất luôn tín hiệu "quên cấu hình" ở đúng nơi người
// ta tắt phép đo vì /metrics bị scrape dày — hai chuyện không liên quan gì nhau.
//
// ── VÌ SAO CHỈ PHÁT Ở PRODUCTION ──────────────────────────────────────────
// Thiếu SMTP/S3/Redis ở máy dev là chuyện bình thường và ĐÚNG. Phát ở đó thì quy tắc cảnh báo phải
// tự lọc `env="production"`, và một quy tắc kêu oan trên máy dev là quy tắc bị tắt. Chặn ngay ở
// nguồn: ngoài production, `config_missing` không có chuỗi nào — `absent()` trung thực hơn.
export const configMissing = new Gauge({
  name: "config_missing",
  help: '1 = biến bắt buộc-ở-production này CHƯA đặt (nhãn `key` = tên biến môi trường), 0 = đã đặt. CHỈ phát khi NODE_ENV=production.',
  labelNames: ["key"],
  registers: [registry],
});

/**
 * Tập biến được theo dõi. PHẢI bám sát khối cảnh báo chỉ-production trong src/config.ts — thêm một
 * `console.warn` ở đó mà quên thêm vào đây là lại có một cấu hình sót không ai quan sát được.
 *
 * S3 khai đủ BA biến chứ không chỉ `S3_ENDPOINT` như config.ts đang kiểm: `featureStatus()` coi kho
 * object là BẬT chỉ khi có cả endpoint + access key + secret key, nên "có endpoint, thiếu khoá" là
 * một cấu hình hỏng mà cảnh báo của config.ts hiện bỏ lọt.
 */
const CAUHINH_PROD: ReadonlyArray<readonly [string, unknown]> = [
  ["REDIS_URL", config.REDIS_URL],
  ["S3_ENDPOINT", config.S3_ENDPOINT],
  ["S3_ACCESS_KEY", config.S3_ACCESS_KEY],
  ["S3_SECRET_KEY", config.S3_SECRET_KEY],
  ["SMTP_HOST", config.SMTP_HOST],
  ["PII_ENC_KEY", config.PII_ENC_KEY],
];

/**
 * Đặt `config_missing` một lần lúc nạp module. Không cần đo lại theo thời gian: `config` được zod
 * đóng băng lúc khởi động và không có đường nào đổi nó lúc chạy — đổi biến môi trường bắt buộc
 * khởi động lại tiến trình, và lúc đó hàm này chạy lại.
 *
 * Tách thành hàm (thay vì vòng lặp trần) để kiểm được cả hai nhánh mà không phải nạp lại module.
 */
export function capNhatCauHinhThieu(laProd = config.NODE_ENV === "production") {
  if (!laProd) return;
  for (const [khoa, gt] of CAUHINH_PROD) configMissing.set({ key: khoa }, gt ? 0 : 1);
}
capNhatCauHinhThieu();

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
// CHƯA KIỂM CHỨNG Ở PRODUCTION: bộ số này mới chỉ được đo qua Redis cục bộ trong test. Repo NAY đã
// có định nghĩa Prometheus (infra/observability/ — service `prometheus` scrape cả app lẫn worker),
// nhưng ngăn xếp đó KHÔNG bật mặc định, nên vẫn chưa có chuỗi số liệu production nào để đối chiếu.
// Xem docs/REMAINING_RISKS.md và infra/observability/README.md.
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
