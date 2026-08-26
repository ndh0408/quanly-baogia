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

  it("router con mount dưới /api/search phải cho nhãn /api/search, không phải /", async () => {
    const { req, res, ketThuc } = gia({ baseUrl: "/api/search", routePath: "/", method: "MWOBSA" });
    metricsMiddleware(req, res, () => {});
    ketThuc();
    expect(await nhanRoute("MWOBSA")).toEqual(["/api/search"]);
  });

  it("route có tham số vẫn giữ nguyên dạng pattern (không phình cardinality)", async () => {
    const { req, res, ketThuc } = gia({ baseUrl: "/api/quotes", routePath: "/:id", method: "MWOBSB" });
    metricsMiddleware(req, res, () => {});
    ketThuc();
    expect(await nhanRoute("MWOBSB")).toEqual(["/api/quotes/:id"]);
  });

  it("request không khớp handler nào vẫn có nhãn (không rỗng)", async () => {
    const { req, res, ketThuc } = gia({ baseUrl: "", routePath: undefined, method: "MWOBSC", status: 404 });
    metricsMiddleware(req, res, () => {});
    ketThuc();
    expect(await nhanRoute("MWOBSC")).toEqual(["unknown"]);
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
