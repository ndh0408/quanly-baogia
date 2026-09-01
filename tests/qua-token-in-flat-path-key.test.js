/**
 * ============================================================================
 * TOKEN MỜI / ĐẶT LẠI MẬT KHẨU VẪN RA LOG VÀ SANG SENTRY — qua một khoá KHÁC.
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────
 * Đợt vá trước đóng đường `req.url`: thêm `"req.url"` vào `redactConfig.paths` (src/logger.ts) và
 * che `event.request.url` trong `scrubSentryEvent` (src/observability.ts). Chú thích ở cả hai chỗ
 * tuyên bố đó là chốt CUỐI trước khi dữ liệu rời hạ tầng.
 *
 * Không phải. Trình xử lý lỗi ghi một khoá `path` PHẲNG, ở GỐC đối tượng log:
 *   src/middleware.ts:239  logger.error({ reqId, path: req.path, method, status, err, stack }, …)
 *   src/middleware.ts:245  captureError(err, { reqId, path: req.path, method, userId })
 * `"req.url"` là đường DẪN LỒNG — nó không phủ khoá `path` ở gốc. Còn `scrubSentryEvent` chỉ xoá
 * ba khoá nội dung ["data","payload","body"] trong `extra`, nên `extra.path` đi thẳng.
 *
 * ── VÌ SAO ĐÁNG COI LÀ BẢO MẬT ──────────────────────────────────────────────
 * Token nằm NGAY TRONG ĐƯỜNG DẪN: GET /api/auth/invite/:token (src/routes/auth.routes.ts:261).
 * Nó là đầu vào DUY NHẤT của POST /api/auth/accept-invite — ai đọc được là ĐẶT LẠI ĐƯỢC MẬT KHẨU,
 * tức chiếm tài khoản. Bất kỳ 5xx nào trên route đó đẩy token nguyên văn vào stdout container và
 * sang Sentry — hai tầng lưu trữ có vòng đời và quyền đọc khác hẳn CSDL.
 *
 * ── BẢN VÁ ──────────────────────────────────────────────────────────────────
 * Vá ở đúng nơi chú thích cũ tuyên bố là chốt dùng chung, để lời hứa "chỗ gọi thêm sau không phải
 * nhớ" thành thật:
 *   · logger.ts   — thêm "path"/"req.path" vào redact, và censor CHE (maskUrlSecrets) thay vì xoá.
 *   · observability.ts — quét MỌI giá trị chuỗi trong `extra` qua maskUrlSecrets, không chỉ ba khoá.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import pino from "pino";
import { redactConfig, maskUrlSecrets } from "../src/logger.js";
import { scrubSentryEvent } from "../src/observability.js";

const TOKEN = "9f3c1d2e4b5a67890123456789abcdef0123456789abcdef";
const DUONG_MOI = `/api/auth/invite/${TOKEN}`;
const DUONG_RESET = `/api/auth/reset/${TOKEN}`;

/** Dựng lại ĐÚNG logger của app (cùng redactConfig) nhưng ghi vào bộ nhớ để đọc được. */
function bat() {
  const ra = [];
  return { lg: pino({ redact: redactConfig }, { write: (s) => ra.push(s) }), doc: () => ra.join("") };
}

describe("token trong khoá `path` phẳng không được ra log", () => {
  it("logger.error({ path }) — đúng hình dạng src/middleware.ts:239", () => {
    const { lg, doc } = bat();
    lg.error({ reqId: "r1", path: DUONG_MOI, method: "GET", status: 500 }, "request failed");
    expect(doc()).not.toContain(TOKEN);
    expect(doc()).toContain("[da-che]");
    expect(doc()).toContain("/api/auth/invite/");   // vẫn biết request nào đã chạy
  });

  it("đường đặt lại mật khẩu cũng vậy", () => {
    const { lg, doc } = bat();
    lg.error({ reqId: "r2", path: DUONG_RESET, status: 500 }, "request failed");
    expect(doc()).not.toContain(TOKEN);
  });

  it("khoá `req.path` (serializer) cũng được che", () => {
    const { lg, doc } = bat();
    lg.info({ req: { path: DUONG_MOI, method: "GET" } }, "req");
    expect(doc()).not.toContain(TOKEN);
  });

  it("KHÔNG che nhầm: đường dẫn thường vẫn còn nguyên để đọc log", () => {
    const { lg, doc } = bat();
    lg.error({ path: "/api/quotes/12/hn", status: 500 }, "request failed");
    expect(doc()).toContain("/api/quotes/12/hn");
  });

  it("req.url vẫn được che như cũ — không hồi quy đợt vá trước", () => {
    const { lg, doc } = bat();
    lg.info({ req: { url: DUONG_MOI } }, "req");
    expect(doc()).not.toContain(TOKEN);
  });
});

describe("token không được sang Sentry qua extra.path", () => {
  it("extra.path — đúng hình dạng src/middleware.ts:245", () => {
    const ev = scrubSentryEvent({ extra: { reqId: "r1", path: DUONG_MOI, method: "GET", userId: 7 } });
    expect(String(ev.extra.path)).not.toContain(TOKEN);
    expect(String(ev.extra.path)).toContain("[da-che]");
    // Định danh truy vết PHẢI còn — che không được biến Sentry thành vô dụng.
    expect(ev.extra.reqId).toBe("r1");
    expect(ev.extra.userId).toBe(7);
  });

  it("chỗ gọi thêm SAU NÀY đặt tên khoá gì cũng được che", () => {
    // Đây là điểm mấu chốt: bản trước liệt kê ba khoá cứng nên một khoá mới là một lỗ mới.
    const ev = scrubSentryEvent({ extra: { duongDanMoiTinh: DUONG_MOI, ghiChu: `xem ${DUONG_RESET}` } });
    expect(JSON.stringify(ev.extra)).not.toContain(TOKEN);
  });

  it("vẫn xoá ba khoá nội dung và che request.url — không hồi quy đợt vá trước", () => {
    const ev = scrubSentryEvent({
      request: { url: DUONG_MOI, headers: { cookie: "a=b", authorization: "Bearer x" } },
      extra: { data: { khach: "PII" }, payload: { x: 1 }, body: "y", queue: "export" },
    });
    expect(ev.extra.data).toBeUndefined();
    expect(ev.extra.payload).toBeUndefined();
    expect(ev.extra.body).toBeUndefined();
    expect(ev.extra.queue).toBe("export");
    expect(ev.request.url).not.toContain(TOKEN);
    expect(ev.request.headers.cookie).toBeUndefined();
    expect(ev.request.headers.authorization).toBeUndefined();
  });

  it("maskUrlSecrets vô hại với chuỗi không phải URL", () => {
    expect(maskUrlSecrets("Không tìm thấy báo giá")).toBe("Không tìm thấy báo giá");
  });
});
