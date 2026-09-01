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
 *
 * ── VÌ SAO CHẠY QUA TIẾN TRÌNH CON ──────────────────────────────────────────────────────
 * Bản trước của bài test này tự dựng một `pino()` MỚI từ `redactConfig` rồi kiểm cái nó vừa dựng.
 * Như vậy nó chỉ chứng minh "cấu hình che này che được", KHÔNG chứng minh `logger` mà cả ứng dụng
 * đang dùng có gắn cấu hình đó — đổi `redact: redactConfig` ở src/logger.ts thành thứ khác thì mọi
 * case vẫn xanh. Ở đây ta ghi bằng CHÍNH `logger` được export, và đọc lại đúng byte nó in ra.
 * Phải là tiến trình con vì ngoài production pino gắn transport pino-pretty chạy ở worker thread —
 * đầu ra đi thẳng ra fd 1, không chặn lại được trong tiến trình test. Đặt NODE_ENV=production để
 * logger ghi JSON thẳng ra stdout, đúng hình dạng chạy thật.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOKEN = "asx0123456789abcdef0123456789abcdef0123456789abcd";

const BAN_GHI = [
  { req: { method: "GET", url: `/api/auth/invite/${TOKEN}`, id: "r1" } },
  { req: { method: "GET", url: `/onboard?token=${TOKEN}&x=1`, id: "r2" } },
  { req: { method: "GET", url: "/api/quotes?page=2&status=draft", id: "r3" } },
  {
    req: { method: "POST", url: "/api/auth/login", id: "r4", headers: { cookie: "qly.sid=abc", authorization: "Bearer xyz" } },
    body: { password: "sieu-bi-mat", newPassword: "x", oldPassword: "y", passwordHash: "z" },
  },
];

/** Chạy logger THẬT trong tiến trình con và trả về các dòng JSON nó in ra, theo đúng thứ tự BAN_GHI. */
function ghiBangLoggerThat() {
  const loggerPath = fileURLToPath(new URL("../src/logger.ts", import.meta.url));

  // KHÔNG dùng await ở mức cao nhất: tsx -e biên dịch sang CJS, top-level await là lỗi biên dịch.
  const code = `
    import(${JSON.stringify(pathToFileURL(loggerPath).href)}).then(({ logger }) => {
      // pino-http gắn serializer req ở tầng child — mô phỏng đúng hình dạng bản ghi thật (src/app.ts).
      const ghi = logger.child({}, { serializers: { req: (r) => ({ method: r.method, url: r.url, id: r.id, headers: r.headers }) } });
      for (const rec of JSON.parse(process.env.BAN_GHI)) ghi.info(rec, "request completed");
      logger.flush && logger.flush();
      setTimeout(() => {}, 50);
    });
  `;
  const out = execFileSync(process.execPath, ["--import", "tsx", "-e", code], {
    // production → pino KHÔNG gắn transport pino-pretty, JSON đi thẳng ra stdout tiến trình này.
    env: { ...process.env, NODE_ENV: "production", LOG_LEVEL: "info", BAN_GHI: JSON.stringify(BAN_GHI) },
    encoding: "utf8",
  });
  return out
    .trim()
    .split("\n")
    .filter((d) => d.startsWith("{"))
    .map((d) => JSON.parse(d));
}

describe("che bí mật trong nhật ký", () => {
  let dong;
  beforeAll(() => {
    dong = ghiBangLoggerThat();
    // Nếu số dòng không khớp thì mọi assert dưới đây vô nghĩa — chặn ngay tại đây.
    expect(dong.length).toBe(BAN_GHI.length);
  }, 60_000);

  it("token trong ĐƯỜNG DẪN /api/auth/invite/:token không lọt vào log", () => {
    expect(dong[0].req.url).not.toContain(TOKEN);
    expect(dong[0].req.url).toContain("/api/auth/invite/"); // vẫn đọc được là endpoint nào
  });

  it("token trong CHUỖI TRUY VẤN ?token=… cũng không lọt vào log", () => {
    expect(dong[1].req.url).not.toContain(TOKEN);
    expect(dong[1].req.url).toContain("x=1");
  });

  it("URL bình thường KHÔNG bị đụng tới", () => {
    expect(dong[2].req.url).toBe("/api/quotes?page=2&status=draft");
  });

  it("các đường che sẵn có vẫn bị GỠ HẲN khỏi bản ghi", () => {
    const s = JSON.stringify(dong[3]);
    expect(s).not.toContain("sieu-bi-mat");
    expect(s).not.toContain("qly.sid=abc");
    expect(s).not.toContain("Bearer xyz");
  });
});
