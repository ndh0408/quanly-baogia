// docker-compose.staging.yml PHẢI có service `minio` khớp production — chốt hồi quy (ultracode
// audit 2026-09-09, finding F2-staging-prod-minio-drift).
//
// ── LỖI ──────────────────────────────────────────────────────────────────────
// MinIO được thêm vào `docker-compose.prod.yml` ở fc053c2/497eaf2 nhưng KHÔNG được thêm vào
// `docker-compose.staging.yml` — phá quy tắc "staging trước, prod sau" (docs/operations/
// DEPLOYMENT.md). Hậu quả: mọi diễn tập trên staging (kể cả 1590 test chạy qua test-on-dev.sh)
// không hề đụng tới đường payment-proof/xuất-file phụ thuộc MinIO, trong khi production đã bật nó
// thật. Toàn bộ vitest suite vẫn xanh — chính vì thế đây là TEST GAP, không phải suy diễn.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const doc = (f) => readFileSync(f, "utf8");

/** Cắt file compose thành từng khối service theo thụt lề — cùng kỹ thuật composeServices() của
 *  tests/ic-infra-compose.test.js, chép lại gọn cho file này (tránh import chéo giữa 2 bộ test). */
function composeServices(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (start < 0) throw new Error("không thấy khối `services:`");
  const out = {};
  let name = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && l.trim() !== "") break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (m) { name = m[1]; out[name] = []; continue; }
    if (name) out[name].push(l);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join("\n")]));
}

describe("docker-compose.staging.yml — service minio phải tồn tại và khớp production", () => {
  const prodSvcs = composeServices(doc("docker-compose.prod.yml"));
  const stagingSvcs = composeServices(doc("docker-compose.staging.yml"));

  it("staging có service `minio`", () => {
    expect(stagingSvcs.minio, "docker-compose.staging.yml thiếu service minio — trôi khỏi production").toBeDefined();
  });

  it("cùng image (cùng digest ghim) với production", () => {
    const img = (s) => /^\s*image:\s*(\S+)/m.exec(s)?.[1];
    expect(img(stagingSvcs.minio)).toBe(img(prodSvcs.minio));
  });

  it("cùng healthcheck ('mc ready local')", () => {
    expect(stagingSvcs.minio).toMatch(/test:\s*\["CMD",\s*"mc",\s*"ready",\s*"local"\]/);
  });

  it("cùng siết đặc quyền (cap_drop ALL + no-new-privileges)", () => {
    expect(stagingSvcs.minio).toMatch(/cap_drop:\s*\["ALL"\]/);
    expect(stagingSvcs.minio).toMatch(/security_opt:\s*\["no-new-privileges:true"\]/);
  });

  it("app + worker của staging đều depends_on minio (service_healthy) — khớp production", () => {
    for (const name of ["app", "worker"]) {
      expect(stagingSvcs[name], `${name}: thiếu depends_on minio`).toMatch(/minio:\s*\{\s*condition:\s*service_healthy\s*\}/);
    }
  });

  it("volume quanly-miniodata được khai trong khối volumes:", () => {
    expect(doc("docker-compose.staging.yml")).toMatch(/^\s*quanly-miniodata:\s*$/m);
  });
});
