// HTTP-12 — TRUST_PROXY gánh cả đăng nhập ở production nhưng không được kiểm.
//
// · Thiếu biến ở production: cookie phiên `secure: isProd`, mà express-session chỉ phát cookie
//   Secure khi `req.secure` — sau TLS ở Cloudflare kết nối vào Node là HTTP → không Set-Cookie nào,
//   đăng nhập "thành công" rồi mọi request 401. Nay tiến trình WEB từ chối khởi động (src/server.ts);
//   worker không cần biến này nên kiểm không nằm ở config.ts.
// · 'false'/'off': `app.set("trust proxy", "false")` → proxy-addr ném "invalid IP address: false"
//   trong createApp, lỗi không nói tên biến. Nay zod từ chối kèm tên biến.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAI = (n, c = "a") => c.repeat(n);
const ENV_PROD = {
  NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@127.0.0.1:1/x", PORT: "39871",
  SESSION_SECRET: DAI(40), JWT_SECRET: DAI(41, "b"), MFA_ENC_KEY: DAI(20, "c"), APP_BASE_URL: "https://x.example",
  REDIS_URL: "", S3_ENDPOINT: "", PII_ENC_KEY: "",
};

function chay(file, env) {
  try {
    const out = execFileSync(process.execPath, ["--import", "tsx", "-e", `import(${JSON.stringify(pathToFileURL(path.join(ROOT, file)).href)})`], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
      env: { ...process.env, ...ENV_PROD, ...env },
    });
    return { ma: 0, out };
  } catch (e) {
    return { ma: e.status ?? -1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

describe("TRUST_PROXY", () => {
  it("'false' → config từ chối NGAY kèm tên biến (không phải lỗi proxy-addr mù)", () => {
    const r = chay("src/config.ts", { TRUST_PROXY: "false" });
    expect(r.ma, r.out).toBe(1);
    expect(r.out).toContain("TRUST_PROXY");
  });

  for (const hopLe of ["1", "true", "loopback", "10.0.0.0/8, 172.16.0.1", ""]) {
    it(`'${hopLe}' → config nhận`, () => {
      const r = chay("src/config.ts", { TRUST_PROXY: hopLe });
      expect(r.ma, r.out).toBe(0);
    });
  }

  it("tiến trình WEB production thiếu TRUST_PROXY → thoát 1 kèm lý do", () => {
    const r = chay("src/server.ts", { TRUST_PROXY: "" });
    expect(r.ma, r.out).toBe(1);
    expect(r.out).toMatch(/TRUST_PROXY phải đặt ở production/);
  });
});
