/**
 * ============================================================================
 * OPS · quan sát — GAP1-01/OBS-08, OBS-07, OBS-09, OBS-10, OBS-11, OBS-14, OBS-16, OBS-06, OBS-15,
 *       GAP1-02, GAP1-06.
 *
 * Mỗi khối ghi rõ lỗi đã đo ở c450a46 và thứ nó chốt. Bài nào chạy được bằng hành vi (middleware,
 * logger, errorHandler, supertest) thì chạy hành vi; cấu hình hạ tầng (compose/dashboard) thì đọc tệp.
 * ============================================================================
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { readFileSync } from "node:fs";
import path from "node:path";
import pino from "pino";
import request from "supertest";
import {
  metricsMiddleware, httpRequestsTotal, httpRequestDuration, ROUTE_KHONG_DO_DO_TRE,
  ghiPhuThuoc, dependencyCallsTotal, tuyChonSentry,
} from "../src/observability.js";
import { redactConfig, logger } from "../src/logger.js";
import { errorHandler } from "../src/middleware.js";
import { createApp, conObjectPhien } from "../src/app.js";
import { mienNguoiNhan } from "../src/email.js";
import { laLoiS3BinhThuong } from "../src/storage.js";

const GOC = path.resolve(import.meta.dirname, "..");
const doc = (f) => readFileSync(path.join(GOC, f), "utf8");

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function giaTri(metric, loc) {
  return (await metric.get()).values.filter((v) => Object.entries(loc).every(([k, x]) => v.labels[k] === x));
}

/** Gọi metricsMiddleware với req/res giả rồi phát 'finish' — đúng đường thật của Express. */
function quaMiddleware({ baseUrl, routePath, method = "GET", status = 200 }) {
  const req = { method, baseUrl, route: { path: routePath } };
  const res = new EventEmitter();
  res.statusCode = status;
  metricsMiddleware(req, res, () => {});
  res.emit("finish");
}

describe("GAP1-01 / OBS-08 — SSE 30 phút và probe không làm bẩn histogram độ trễ", () => {
  it("kết thúc SSE: ĐẾM vào http_requests_total nhưng KHÔNG ghi histogram", async () => {
    const loc = { route: "/api/stream/events", status: "200", method: "GET" };
    const dem0 = (await giaTri(httpRequestsTotal, loc))[0]?.value ?? 0;
    const hist0 = (await giaTri(httpRequestDuration, loc)).find((v) => v.metricName.endsWith("_count"))?.value ?? 0;
    quaMiddleware({ baseUrl: "/api/stream", routePath: "/events" });
    expect((await giaTri(httpRequestsTotal, loc))[0].value).toBe(dem0 + 1);
    const hist1 = (await giaTri(httpRequestDuration, loc)).find((v) => v.metricName.endsWith("_count"))?.value ?? 0;
    expect(hist1, "SSE 1800s rơi vào +Inf kéo p95 lên trần 10s").toBe(hist0);
  });

  it("route nghiệp vụ VẪN ghi histogram; tập loại trừ gồm probe/scrape", async () => {
    const loc = { route: "/api/quotes/:id", status: "200", method: "GET" };
    const truoc = (await giaTri(httpRequestDuration, loc)).find((v) => v.metricName.endsWith("_count"))?.value ?? 0;
    quaMiddleware({ baseUrl: "/api/quotes", routePath: "/:id" });
    const sau = (await giaTri(httpRequestDuration, loc)).find((v) => v.metricName.endsWith("_count"))?.value ?? 0;
    expect(sau).toBe(truoc + 1);
    for (const r of ["/livez", "/readyz", "/metrics"]) expect(ROUTE_KHONG_DO_DO_TRE.has(r)).toBe(true);
  });
});

describe("OBS-07 — lỗi xảy ra TRƯỚC routing vẫn được đếm", () => {
  it("thân JSON hỏng (400 ở express.json) có mặt trong http_requests_total", async () => {
    const loc = { status: "400", method: "POST" };
    const truoc = (await giaTri(httpRequestsTotal, loc)).reduce((a, v) => a + v.value, 0);
    const r = await request(createApp()).post("/api/auth/login").set("Content-Type", "application/json").send("{hong");
    expect(r.status).toBe(400);
    const sau = (await giaTri(httpRequestsTotal, loc)).reduce((a, v) => a + v.value, 0);
    expect(sau, "metricsMiddleware đứng sau parse body → 400/413/429/lỗi kho phiên vô hình").toBe(truoc + 1);
  });
});

describe("OBS-10 — pool phiên có trần chờ kết nối", () => {
  it("connectionTimeoutMillis > 0 (node-pg mặc định 0 = chờ vô hạn)", () => {
    expect(conObjectPhien().connectionTimeoutMillis).toBeGreaterThan(0);
  });
});

describe("OBS-11 — errorHandler: 4xx là warn không stack, 5xx là error có stack", () => {
  function resGia() {
    return { headersSent: false, setHeader() {}, status() { return this; }, json() { return this; } };
  }
  const req = { id: "r1", path: "/api/quotes/9", method: "GET", session: {} };

  it("404 → warn, không stack; KHÔNG ghi mức error", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    errorHandler(Object.assign(new Error("Không tìm thấy"), { status: 404 }), req, resGia(), () => {});
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0].stack).toBeUndefined();
  });

  it("500 → error kèm stack", () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    errorHandler(new Error("nổ"), req, resGia(), () => {});
    expect(error).toHaveBeenCalled();
    expect(error.mock.calls[0][0].stack).toMatch(/nổ/);
  });
});

describe("OBS-16 — redact đủ sâu; email chỉ còn tên miền", () => {
  function ghi(obj) {
    let ra = "";
    const sink = new Writable({ write(c, _e, cb) { ra += c; cb(); } });
    pino({ redact: redactConfig }, sink).info(obj, "x");
    return ra;
  }
  it("password ở GỐC và ở độ sâu 2, token, refreshToken, mfaSecret, req.body đều bị che", () => {
    const ra = ghi({ password: "MK-GOC", a: { b: { password: "MK-SAU" } }, token: "TK-1", user: { refreshToken: "RT-1", mfaSecret: "MF-1" }, req: { body: { x: "THAN" } } });
    for (const bimat of ["MK-GOC", "MK-SAU", "TK-1", "RT-1", "MF-1", "THAN"]) expect(ra).not.toContain(bimat);
  });
  it("mienNguoiNhan chỉ giữ tên miền", () => {
    expect(mienNguoiNhan("a.b@gianguyen.vn")).toEqual(["gianguyen.vn"]);
    expect(mienNguoiNhan(["x@a.com", "y@b.com"])).toEqual(["a.com", "b.com"]);
  });
});

describe("OBS-09 — phụ thuộc ngoài có metric", () => {
  it("ghiPhuThuoc tăng dependency_calls_total theo dep/status", async () => {
    const t0 = (await giaTri(dependencyCallsTotal, { dep: "smtp", status: "error" }))[0]?.value ?? 0;
    ghiPhuThuoc("smtp", false);
    expect((await giaTri(dependencyCallsTotal, { dep: "smtp", status: "error" }))[0].value).toBe(t0 + 1);
  });
  it("404 của kho object là kết quả bình thường, không phải lỗi phụ thuộc", () => {
    expect(laLoiS3BinhThuong({ name: "NotFound", $metadata: { httpStatusCode: 404 } })).toBe(true);
    expect(laLoiS3BinhThuong({ name: "TimeoutError" })).toBe(false);
  });
  it("tài liệu không còn viện dẫn quy tắc KHÔNG tồn tại QuanlyEmailKhongGuiDuoc như đang có", () => {
    const tpl = doc("infra/observability/alertmanager.yml.tpl");
    expect(tpl).not.toMatch(/`QuanlyEmailKhongGuiDuoc` nằm trong/);
    expect(doc("infra/prometheus/alerts.yaml")).toMatch(/alert: QuanlyPhuThuocNgoaiLoi/);
  });
});

describe("OBS-14 — Sentry", () => {
  it("tracing mặc định TẮT; environment/release đọc biến riêng; transaction được che token", () => {
    vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "");
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("SENTRY_RELEASE", "abc1234");
    const o = tuyChonSentry();
    expect(o.tracesSampleRate).toBe(0);
    expect(o.environment).toBe("staging");
    expect(o.release).toBe("abc1234");
    const tk = "a".repeat(48);
    const e = o.beforeSendTransaction({ transaction: `GET /api/auth/invite/${tk}` });
    expect(e.transaction).not.toContain(tk);
  });
});

describe("OBS-06 — cảnh báo mang nhãn môi trường của CHÍNH máy", () => {
  it("prometheus.yml không còn `environment: prod` viết cứng; compose cấp QUANLY_ENV", () => {
    const prom = doc("infra/observability/prometheus.yml").split("\n").filter((d) => !/^\s*#/.test(d)).join("\n");
    expect(prom).not.toMatch(/environment:\s*prod\b/);
    expect(prom).toMatch(/environment:\s*\$\{QUANLY_ENV\}/);
    expect(doc("infra/observability/docker-compose.observability.yml")).toMatch(/QUANLY_ENV: \$\{QUANLY_ENV:-/);
  });
});

describe("OBS-15 — Loki có retention, schema không đổi", () => {
  it("compose trỏ vào loki.yaml có compactor.retention_enabled + retention_period; schema giữ y mặc định", () => {
    expect(doc("infra/observability/docker-compose.observability.yml")).toMatch(/-config\.file=\/etc\/loki\/conf\/loki\.yaml/);
    const loki = doc("infra/observability/loki.yaml");
    expect(loki).toMatch(/retention_enabled: true/);
    expect(loki).toMatch(/retention_period: \d+h/);
    expect(loki).toMatch(/from: 2020-10-24\s*\n\s*store: tsdb\s*\n\s*object_store: filesystem\s*\n\s*schema: v13/);
  });
});

describe("GAP1-02 / GAP1-06 — bảng điều khiển nói thật", () => {
  const bang = JSON.parse(doc("infra/observability/grafana/dashboards/quanly.json"));
  const exprs = bang.panels.flatMap((p) => (p.targets || []).map((t) => t.expr || ""));
  const alerts = doc("infra/prometheus/alerts.yaml");

  it("mọi biến templating đều được ít nhất một expr dùng", () => {
    for (const v of bang.templating.list) expect(exprs.some((e) => e.includes(`$${v.name}`)), `biến $${v.name} chết`).toBe(true);
  });
  it("mọi tên cảnh báo nhắc trong mô tả panel đều tồn tại trong alerts.yaml", () => {
    for (const p of bang.panels) {
      for (const ten of (p.description || "").match(/\bQuanly[A-Za-z0-9]+|\b[A-Z][a-zA-Z]+Cao\b/g) || []) {
        expect(alerts, `panel ${p.id} viện dẫn cảnh báo không tồn tại: ${ten}`).toMatch(new RegExp(`alert: ${ten}\\b`));
      }
    }
  });
  it("sse_* lọc service=app; bullmq_jobs gộp bằng max (app + worker cùng phát)", () => {
    for (const e of exprs.filter((x) => /sse_(clients|backplane_up)/.test(x))) expect(e).toMatch(/service="app"|on\(instance\)/);
    for (const e of exprs.filter((x) => /\bbullmq_jobs\b(?!_)/.test(x))) expect(e).toMatch(/max by \(queue, state\)/);
  });
  it("panel log lỗi gồm cả worker", () => {
    const p8 = bang.panels.find((p) => p.id === 8);
    expect(p8.targets[0].expr).toMatch(/quanly-\(app\|worker\)/);
  });
});
