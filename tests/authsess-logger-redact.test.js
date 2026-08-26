/**
 * CỤM auth-session — TOKEN ĐẶT LẠI MẬT KHẨU / MỜI LỌT NGUYÊN VĂN VÀO NHẬT KÝ (src/logger.ts).
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────────────────
 * Serializer của pino-http (src/app.ts) ghi `url: req.url` cho MỌI request, và customLogLevel trả
 * "info" cho 2xx → mọi URL đều được ghi ở mức mặc định của production. Danh sách `redact` trong
 * src/logger.ts chỉ che req.headers.cookie / authorization / *.password* — KHÔNG có req.url.
 * Mà GET /api/auth/invite/:token đặt token NGAY TRONG ĐƯỜNG DẪN (web/src/lib/api.ts gọi đúng vậy).
 *
 * ── TÁI HIỆN ────────────────────────────────────────────────────────────────────────────
 * Cho pino ghi một bản ghi có req.url = "/api/auth/invite/<token thật>" và đọc dòng JSON ra: token
 * nằm nguyên văn trong đó.
 *
 * ── HẬU QUẢ ─────────────────────────────────────────────────────────────────────────────
 * Token này CHIẾM ĐƯỢC TÀI KHOẢN: nó là đầu vào duy nhất của POST /api/auth/accept-invite, sống 2
 * giờ (đặt lại mật khẩu) hoặc 7 ngày (lời mời). Nó đang nằm ở một tầng lưu trữ KHÁC với CSDL, với
 * vòng đời và quyền đọc khác hẳn — và sẽ theo sang mọi hệ log tập trung/Sentry gắn thêm sau này.
 */
import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import * as loggerModule from "../src/logger.js";

// Dựng lại một logger dùng ĐÚNG cấu hình che của ứng dụng, nhưng ghi vào bộ nhớ để đọc được.
function ghiThu(obj) {
  let out = "";
  const sink = new Writable({ write(c, _e, cb) { out += c.toString(); cb(); } });
  const cfg = loggerModule.redactConfig ?? { paths: [] };
  const log = pino({ level: "info", redact: cfg }, sink);
  // pino-http gắn serializer req ở tầng child — mô phỏng đúng hình dạng bản ghi thật.
  log.child({}, { serializers: { req: (r) => ({ method: r.method, url: r.url, id: r.id }) } })
     .info({ ...obj }, "request completed");
  return JSON.parse(out.trim().split("\n").pop());
}

const TOKEN = "asx0123456789abcdef0123456789abcdef0123456789abcd";

describe("che bí mật trong nhật ký", () => {
  it("token trong ĐƯỜNG DẪN /api/auth/invite/:token không lọt vào log", () => {
    const rec = ghiThu({ req: { method: "GET", url: `/api/auth/invite/${TOKEN}`, id: "r1" } });
    expect(rec.req.url).not.toContain(TOKEN);
    expect(rec.req.url).toContain("/api/auth/invite/"); // vẫn đọc được là endpoint nào
  });

  it("token trong CHUỖI TRUY VẤN ?token=… cũng không lọt vào log", () => {
    const rec = ghiThu({ req: { method: "GET", url: `/onboard?token=${TOKEN}&x=1`, id: "r2" } });
    expect(rec.req.url).not.toContain(TOKEN);
    expect(rec.req.url).toContain("x=1");
  });

  it("URL bình thường KHÔNG bị đụng tới", () => {
    const rec = ghiThu({ req: { method: "GET", url: "/api/quotes?page=2&status=draft", id: "r3" } });
    expect(rec.req.url).toBe("/api/quotes?page=2&status=draft");
  });

  it("các đường che sẵn có vẫn bị GỠ HẲN khỏi bản ghi", () => {
    const rec = ghiThu({
      req: { method: "POST", url: "/api/auth/login", id: "r4", headers: { cookie: "qly.sid=abc", authorization: "Bearer xyz" } },
      body: { password: "sieu-bi-mat", newPassword: "x", oldPassword: "y", passwordHash: "z" },
    });
    const s = JSON.stringify(rec);
    expect(s).not.toContain("sieu-bi-mat");
    expect(s).not.toContain("qly.sid=abc");
    expect(s).not.toContain("Bearer xyz");
  });
});
