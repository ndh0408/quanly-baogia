// Cụm middleware-obs — hai lỗi trong src/observability.ts.
//
// ── LỖI 1: nhãn `route` của Prometheus nuốt mất tiền tố mount ────────────────
// `const route = req.route?.path || req.baseUrl + (req.route?.path || "") || "unknown";`
// Toán tử `||` chốt ngay ở vế đầu: hễ request KHỚP một handler thì `req.route.path` truthy,
// nên nhánh ghép `req.baseUrl` KHÔNG BAO GIỜ chạy. Trong một Router con, `req.route.path` là
// đường dẫn TƯƠNG ĐỐI ("/"), nên GET /api/search, GET /api/audit, GET /api/webhooks… đều được
// ghi cùng một nhãn `route="/"`.
// TÁI HIỆN: gọi metricsMiddleware với req.baseUrl="/api/search", req.route.path="/" rồi đọc
// registry → nhãn route là "/" thay vì "/api/search".
// HẬU QUẢ: histogram độ trễ và bộ đếm request của những endpoint hoàn toàn khác nhau bị gộp
// làm một; số liệu vô dụng đúng lúc cần chẩn đoán chậm.
//
// ── LỖI 2: beforeSend của Sentry không dọn `extra` ───────────────────────────
// beforeSend chỉ xoá cookie/authorization trong `event.request.headers`. Nhưng captureError
// đóng gói ngữ cảnh vào `extra` (observability.ts: `Sentry.captureException(err, { extra: ctx })`),
// và src/worker.ts nhét NGUYÊN `job.data` vào đó. Với hàng đợi webhook, job.data chứa payload
// nghiệp vụ (khách hàng / báo giá) — mà deliverWebhook ném lỗi mỗi lần đích không trả 2xx.
// TÁI HIỆN: dựng một event có extra.data = {tên khách, số tiền} rồi cho đi qua bộ lọc.
// HẬU QUẢ: dữ liệu khách hàng thật rời khỏi hạ tầng công ty sang dịch vụ bên thứ ba, không
// có dòng audit nào.
import { describe, it, expect, beforeEach } from "vitest";
import { metricsMiddleware, registry, httpRequestsTotal, scrubSentryEvent } from "../src/observability.js";

/** req/res tối thiểu cho metricsMiddleware: chỉ cần res.on("finish"). */
function gia({ baseUrl, routePath, method = "GET", status = 200 }) {
  const finish = [];
  const req = { method, baseUrl, route: routePath === undefined ? undefined : { path: routePath } };
  const res = { statusCode: status, on: (ev, fn) => { if (ev === "finish") finish.push(fn); } };
  return { req, res, ketThuc: () => finish.forEach((f) => f()) };
}

async function nhanRoute(method) {
  const all = await registry.getMetricsAsJSON();
  const m = all.find((x) => x.name === "http_requests_total");
  return (m?.values || []).filter((v) => v.labels.method === method).map((v) => v.labels.route);
}

describe("metricsMiddleware — nhãn route", () => {
  beforeEach(() => { httpRequestsTotal.reset(); });

  // `reset()` ở trên xoá SẠCH registry trước MỖI bài — filter theo "GET" (method thật) là đủ để
  // cô lập kết quả trong từng bài, không cần method giả "MWOBSx" như bản trước (bản trước cần
  // method giả vì khi đó `method` được ghi NGUYÊN VĂN; sau bản vá H6 mọi method không hợp lệ đều
  // gộp về "other" nên dùng method giả sẽ làm ba bài này tự đụng nhãn lẫn nhau).
  it("router con mount dưới /api/search phải cho nhãn /api/search, không phải /", async () => {
    const { req, res, ketThuc } = gia({ baseUrl: "/api/search", routePath: "/", method: "GET" });
    metricsMiddleware(req, res, () => {});
    ketThuc();
    expect(await nhanRoute("GET")).toEqual(["/api/search"]);
  });

  it("route có tham số vẫn giữ nguyên dạng pattern (không phình cardinality)", async () => {
    const { req, res, ketThuc } = gia({ baseUrl: "/api/quotes", routePath: "/:id", method: "GET" });
    metricsMiddleware(req, res, () => {});
    ketThuc();
    expect(await nhanRoute("GET")).toEqual(["/api/quotes/:id"]);
  });

  it("request không khớp handler nào vẫn có nhãn (không rỗng)", async () => {
    const { req, res, ketThuc } = gia({ baseUrl: "", routePath: undefined, method: "GET", status: 404 });
    metricsMiddleware(req, res, () => {});
    ketThuc();
    expect(await nhanRoute("GET")).toEqual(["unknown"]);
  });
});

// ── H6 (ultracode audit 2026-09-09 / PERF-DOS-01) ────────────────────────────────────────────────
// Nhãn `method` PHẢI là tập hữu hạn — trước bản vá, `req.method` (do CLIENT tự đặt, không qua bất
// kỳ allowlist nào, và middleware này mount TOÀN CỤC nên chạy cả trên request CHƯA đăng nhập) được
// ghi NGUYÊN VĂN vào registry Prometheus. Registry KHÔNG BAO GIỜ co lại — một kẻ ẩn danh gửi N
// request với N chuỗi "method" tuỳ ý là N chuỗi nhãn mới vĩnh viễn, phình bộ nhớ tiến trình app.
describe("metricsMiddleware — nhãn method PHẢI hữu hạn (H6)", () => {
  beforeEach(() => { httpRequestsTotal.reset(); });

  it("method HTTP chuẩn (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) giữ nguyên nhãn", async () => {
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      httpRequestsTotal.reset();
      const { req, res, ketThuc } = gia({ baseUrl: "/api/x", routePath: "/", method: m });
      metricsMiddleware(req, res, () => {});
      ketThuc();
      expect(await nhanRoute(m), `method ${m} phải giữ nguyên nhãn`).toEqual(["/api/x"]);
    }
  });

  it("method KHÔNG chuẩn (do client tự đặt tuỳ ý) phải gộp về 'other', KHÔNG được ghi nguyên văn", async () => {
    // Trước bản vá: bài này lẽ ra phải THẤY nhãn "MWOBS-LA"/"TRACE"/"FOOBAR" xuất hiện y nguyên
    // trong registry (đúng cách audit chứng minh lỗ hổng) — sau bản vá, không method lạ nào được
    // ghi nguyên văn nữa, tất cả rơi về đúng MỘT nhãn "other".
    for (const m of ["MWOBS-LA", "TRACE", "FOOBAR", "connect", "get"]) {
      httpRequestsTotal.reset();
      const { req, res, ketThuc } = gia({ baseUrl: "/api/x", routePath: "/", method: m });
      metricsMiddleware(req, res, () => {});
      ketThuc();
      expect(await nhanRoute(m), `method lạ "${m}" không được lọt nguyên văn vào registry`).toEqual([]);
      expect(await nhanRoute("other"), `method lạ "${m}" phải gộp về nhãn 'other'`).toEqual(["/api/x"]);
    }
  });

  it("1000 method khác nhau chỉ tạo ĐÚNG MỘT chuỗi nhãn 'other' — không phình cardinality", async () => {
    for (let i = 0; i < 1000; i++) {
      const { req, res, ketThuc } = gia({ baseUrl: "/api/x", routePath: "/", method: `RANDOM-METHOD-${i}` });
      metricsMiddleware(req, res, () => {});
      ketThuc();
    }
    const all = await registry.getMetricsAsJSON();
    const m = all.find((x) => x.name === "http_requests_total");
    const nhanMethodDocDuoc = new Set((m?.values || []).map((v) => v.labels.method));
    expect([...nhanMethodDocDuoc]).toEqual(["other"]);
  });
});

describe("scrubSentryEvent — không để nội dung nghiệp vụ lọt sang Sentry", () => {
  it("xoá extra.data / extra.payload / extra.body", () => {
    const ev = scrubSentryEvent({
      extra: {
        queue: "webhook",
        jobId: "42",
        data: { webhookId: 1, event: "quote.approved", payload: { customer: "Công ty ABC", total: "125000000" } },
        payload: { cccd: "079xxxxxxxxx" },
        body: "chuỗi thân request",
      },
    });
    expect(ev.extra.data).toBeUndefined();
    expect(ev.extra.payload).toBeUndefined();
    expect(ev.extra.body).toBeUndefined();
    // Định danh phục vụ truy vết thì PHẢI giữ — xoá hết là mất luôn giá trị của Sentry.
    expect(ev.extra.queue).toBe("webhook");
    expect(ev.extra.jobId).toBe("42");
  });

  it("vẫn xoá cookie/authorization trong headers như trước", () => {
    const ev = scrubSentryEvent({ request: { headers: { cookie: "qly.sid=abc", authorization: "Bearer x", "user-agent": "vitest" } } });
    expect(ev.request.headers.cookie).toBeUndefined();
    expect(ev.request.headers.authorization).toBeUndefined();
    expect(ev.request.headers["user-agent"]).toBe("vitest");
  });

  it("event rỗng / thiếu trường không làm bộ lọc ném lỗi", () => {
    expect(() => scrubSentryEvent({})).not.toThrow();
    expect(scrubSentryEvent({}).extra).toBeUndefined();
  });
});
