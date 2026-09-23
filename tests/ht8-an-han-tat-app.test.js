// HTTP-07 / HTTP-08 — thời hạn của tiến trình WEB phải ăn khớp với proxy phía trước và nền tảng.
//
// HTTP-07: không đặt server.keepAliveTimeout → Node đóng kết nối rỗi sau 5s, trong khi
//   cloudflared/Traefik giữ tới ~90s → proxy gửi request lên socket vừa đóng → POST nhận 502 lẻ tẻ.
// HTTP-08: shutdown() cưỡng bức thoát sau 10s CỨNG, service app trong compose không khai
//   stop_grace_period (Docker 10s rồi SIGKILL), trong khi lượt lưu đo được 13,1s và trần transaction
//   60s → mỗi lần deploy cắt ngang lượt lưu lớn đang chạy.
// Thứ tự phải giữ: ân hạn nền tảng > hạn cưỡng bức SHUTDOWN_TIMEOUT_MS > DB_TX_TIMEOUT.
// Kiểm TĨNH (đọc tệp) — src/server.ts là entrypoint, nạp nó là mở cổng thật.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const doc = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const macDinh = (ten) => {
  const m = new RegExp(`${ten}:[^\\n]*\\.default\\(([\\d_]+)\\)`).exec(doc("src/config.ts"));
  expect(m, `không thấy mặc định của ${ten} trong src/config.ts`).not.toBeNull();
  return Number(m[1].replace(/_/g, ""));
};
const giay = (s) => { const m = /^(\d+)s$/.exec(s); return m ? Number(m[1]) : NaN; };

describe("HTTP-07 — keep-alive dài hơn proxy", () => {
  const src = doc("src/server.ts");
  const so = (ten) => Number((new RegExp(`${ten}\\s*=\\s*([\\d_]+)`).exec(src)?.[1] ?? "0").replace(/_/g, ""));
  it("keepAliveTimeout > 90s (cloudflared/Traefik) và headersTimeout > keepAliveTimeout", () => {
    expect(src).toMatch(/server\.keepAliveTimeout\s*=/);
    expect(src).toMatch(/server\.headersTimeout\s*=/);
    expect(so("KEEP_ALIVE_TIMEOUT_MS")).toBeGreaterThan(90_000);
    expect(so("HEADERS_TIMEOUT_MS")).toBeGreaterThan(so("KEEP_ALIVE_TIMEOUT_MS"));
  });
});

describe("HTTP-08 — ân hạn tắt tiến trình web", () => {
  const han = macDinh("SHUTDOWN_TIMEOUT_MS");

  it("hạn cưỡng bức đọc từ cấu hình, không cứng 10s", () => {
    const src = doc("src/server.ts");
    expect(src).toMatch(/config\.SHUTDOWN_TIMEOUT_MS\)\.unref\(\)/);
    expect(src, "còn setTimeout cưỡng bức 10s cứng").not.toMatch(/\},\s*10_000\)\.unref\(\)/);
  });

  it("SHUTDOWN_TIMEOUT_MS mặc định > DB_TX_TIMEOUT mặc định", () => {
    expect(han).toBeGreaterThan(macDinh("DB_TX_TIMEOUT"));
  });

  for (const f of ["docker-compose.prod.yml", "docker-compose.staging.yml"]) {
    it(`${f}: service app khai stop_grace_period > SHUTDOWN_TIMEOUT_MS`, () => {
      const y = doc(f);
      const app = y.slice(y.indexOf("\n  app:"), y.indexOf("\n  worker:"));
      const m = /^\s*stop_grace_period:\s*(\S+)\s*$/m.exec(app);
      expect(m, `${f}: app không khai stop_grace_period → Docker SIGKILL sau 10s`).not.toBeNull();
      expect(giay(m[1]) * 1000).toBeGreaterThan(han);
    });
  }

  for (const f of ["infra/k8s/app.yaml", "infra/helm/quanly/templates/app-deployment.yaml"]) {
    it(`${f}: terminationGracePeriodSeconds − 5s preStop > SHUTDOWN_TIMEOUT_MS`, () => {
      const m = /^\s*terminationGracePeriodSeconds:\s*(\d+)\s*$/m.exec(doc(f));
      expect(m).not.toBeNull();
      expect(Number(m[1]) * 1000 - 5000).toBeGreaterThan(han);
    });
  }
});
