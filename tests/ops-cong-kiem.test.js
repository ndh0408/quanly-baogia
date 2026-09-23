/**
 * OPS · cổng kiểm và công cụ — DOC-11, GAP1-08, INFRA-10, INFRA-11.
 *
 * DOC-11: check-line-refs viết `/^[}\])];,]+$/` — lớp ký tự đóng ở `]` thứ hai, nên `}`, `});`, `]`
 *   KHÔNG bị bắt; AGENTS/CONTRIBUTING khai cổng bắt "tham chiếu trỏ vào `}` lẻ" mà nó chưa từng bắt.
 *   Sửa regex lộ ngay 13 tham chiếu trôi (đã sửa về tên hàm/hằng).
 * GAP1-08: rc-qa.mjs coi 404 là đạt khi mong 200, và bỏ qua 403 khi đo hiệu năng.
 * INFRA-10: app không khai stop_grace_period (Docker SIGKILL sau 10s = đúng lưới tắt 10s của app).
 * INFRA-11: không đường nào đang chạy quét lỗ hổng của IMAGE.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dongVoNghia } from "../scripts/ci/check-line-refs.mjs";

const GOC = path.resolve(import.meta.dirname, "..");
const doc = (f) => readFileSync(path.join(GOC, f), "utf8");

describe("DOC-11 — dongVoNghia bắt dòng chỉ có dấu đóng", () => {
  for (const d of ["}", "  });", "]", ")", "];", "]],", "  )  "]) {
    it(`"${d}" là đích KHÔNG THỂ (cổng đỏ)`, () => {
      expect(dongVoNghia(d)?.muc).toBe("cung");
    });
  }
  it("dòng mã thật không bị bắt", () => {
    expect(dongVoNghia("const x = f(1);")).toBeNull();
  });
});

describe("GAP1-08 — rc-qa.mjs không chấm đạt quá dễ", () => {
  const src = doc("scripts/dev/rc-qa.mjs");
  it("không còn luật ngầm 'mong 200 thì 404 cũng được'", () => {
    expect(src).not.toMatch(/want\[i\] === 200 && g === 404/);
  });
  it("measure() coi MỌI mã không-2xx (kể cả 403) là lỗi", () => {
    expect(src).not.toMatch(/!r\.ok && r\.status !== 403/);
    expect(src).toMatch(/if \(!r\.ok\) return \{ path, error: r\.status \}/);
  });
});

describe("INFRA-10 — ân hạn dừng của app bao được lưới tắt cưỡng bức", () => {
  const tat = Number(/const THOI_HAN_TAT_MS = ([\d_]+);/.exec(doc("src/server.ts"))?.[1].replace(/_/g, ""));
  for (const f of ["docker-compose.prod.yml", "docker-compose.staging.yml"]) {
    it(`${f}: app.stop_grace_period ≥ lưới tắt + 5s`, () => {
      const s = doc(f);
      const i = s.search(/^ {2}app:\s*$/m);
      const khoi = s.slice(i, i + s.slice(i + 1).search(/^ {2}[a-z]/m) + 1);
      const m = /^\s*stop_grace_period:\s*(\d+)s\s*$/m.exec(khoi);
      expect(m, `${f}: service app không khai stop_grace_period → SIGKILL sau 10s`).not.toBeNull();
      expect(Number(m[1]) * 1000).toBeGreaterThanOrEqual(tat + 5000);
    });
  }
});

describe("INFRA-11 — docker-smoke quét lỗ hổng của image", () => {
  it("có bước trivy image làm cổng (exit-code 1) trên gói OS + phụ thuộc ứng dụng", () => {
    const s = doc("scripts/ci/docker-smoke.sh");
    expect(s).toMatch(/trivy image[^\n]*\\\n[^\n]*--ignorefile \.trivyignore\.yaml[^\n]*\\\n[^\n]*--exit-code 1/);
  });
});

describe("INFRA-08 — CronJob backup (k8s) không bị NetworkPolicy của chính repo chặn", () => {
  it("pod template của quanly-db-backup mang nhãn app: quanly mà postgres-allow-app-only cho vào", () => {
    const cron = doc("infra/k8s/backup-cronjob.yaml");
    expect(doc("infra/k8s/networkpolicy.yaml")).toMatch(/matchLabels: \{ app: quanly \}/);
    expect(cron).toMatch(/template:\s*\n(?:\s*#.*\n)*\s*metadata:\s*\n\s*labels: \{ app: quanly, component: db-backup \}/);
  });
});
