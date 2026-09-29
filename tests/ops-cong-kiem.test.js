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
  // Hạn cưỡng bức nay là SHUTDOWN_TIMEOUT_MS (HTTP-08, mặc định trong src/config.ts) — gộp với INFRA-10.
  const tat = Number(/SHUTDOWN_TIMEOUT_MS:[^\n]*\.default\(([\d_]+)\)/.exec(doc("src/config.ts"))?.[1].replace(/_/g, ""));
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

// Lớp `apk add` của stage runtime bị Docker CACHE theo chuỗi lệnh; ảnh nền ghim digest nên nó không
// bao giờ tự dựng lại → bản vá của kho alpine không tới image (2026-09-29: libexpat 2.8.4-r0,
// CVE-2026-93990, trong khi kho đã có 2.8.5-r0; trivy [D3] đỏ). Sàn `>=` đổi chuỗi lệnh — mọi cache,
// kể cả của VM, buộc dựng lại — và apk tự từ chối bản thấp hơn. Chú thích đầy đủ ở Dockerfile.
describe("INFRA-11 — stage runtime ghi SÀN cho gói OS đã có bản vá", () => {
  const df = doc("Dockerfile");
  const runtime = df.slice(df.search(/^FROM \S+ AS runtime\s*$/m));
  // Khối RUN apk add đầu tiên của stage runtime, kể cả các dòng tiếp nối bằng `\`.
  const apk = /^RUN apk add(?:[^\n]*\\\r?\n)*[^\n]*/m.exec(runtime)?.[0] ?? "";
  // So phiên bản kiểu apk "2.8.5-r0": từng số của phần chính, rồi số bản dựng -rN.
  const so = (v) => v.split(/[.-]r?/).map(Number);
  const soSanh = (a, b) => {
    const x = so(a), y = so(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };

  it("tìm thấy lệnh apk add của stage runtime (các bài dưới không lạc chỗ)", () => {
    expect(apk).toMatch(/font-dejavu/);
    expect(apk).toMatch(/addgroup/);
  });
  it("libexpat >= 2.8.5-r0 (CVE-2026-93990) — fontconfig ← font-dejavu kéo nó vào", () => {
    const m = /'libexpat>=(\d[\d.]*-r\d+)'/.exec(apk);
    expect(m, "stage runtime không ghi sàn libexpat — lớp apk dựng từ cache vẫn mang 2.8.4-r0").not.toBeNull();
    expect(soSanh(m[1], "2.8.5-r0")).toBeGreaterThanOrEqual(0);
  });
  it("mọi ràng buộc phiên bản nằm trong nháy đơn — shell đọc `>` trần là CHUYỂN HƯỚNG, sàn biến mất", () => {
    expect(apk.replace(/'[^']*'/g, "").match(/\S*[<>=~]\S*/g) ?? []).toEqual([]);
  });
  it("bộ so phiên bản phân biệt đúng chỗ cần phân biệt", () => {
    expect(soSanh("2.8.4-r0", "2.8.5-r0")).toBeLessThan(0);
    expect(soSanh("2.8.5-r1", "2.8.5-r0")).toBeGreaterThan(0);
    expect(soSanh("2.10.0-r0", "2.8.5-r0")).toBeGreaterThan(0);
  });
});

describe("INFRA-08 — CronJob backup (k8s) không bị NetworkPolicy của chính repo chặn", () => {
  it("pod template của quanly-db-backup mang nhãn app: quanly mà postgres-allow-app-only cho vào", () => {
    const cron = doc("infra/k8s/backup-cronjob.yaml");
    expect(doc("infra/k8s/networkpolicy.yaml")).toMatch(/matchLabels: \{ app: quanly \}/);
    expect(cron).toMatch(/template:\s*\n(?:\s*#.*\n)*\s*metadata:\s*\n\s*labels: \{ app: quanly, component: db-backup \}/);
  });
});
