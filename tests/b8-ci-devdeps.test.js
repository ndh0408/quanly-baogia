// Job `security` của CI không được kéo devDependencies về.
//
// ── ĐO TRƯỚC KHI VIẾT ────────────────────────────────────────────────────────
// `@openai/codex-security` là devDependency, và cây nó kéo theo nặng 342 MB đo trên chính máy này:
//   du -sh node_modules/@openai/*  →  336M @openai/codex-linux-x64, 6.3M @openai/codex-security,
//   100K @openai/codex-sdk, 24K @openai/codex
// package-lock.json đánh dấu cả bốn là `"dev": true`, tức KHÔNG gói production nào chạm tới chúng.
// Job `security` chỉ làm đúng một việc sau bước cài: `npm audit --omit=dev`. Nó cài devDependencies
// để rồi audit bỏ qua devDependencies.
//
// Đây là NỬA làm được của mục "codex-security 336MB": nửa còn lại (job `test`) vẫn phải cài devDeps
// thật vì cần vitest/eslint/tsc, và `npm ci` không bỏ được đúng MỘT gói.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** Văn bản của một job (từ `  <ten>:` tới job kế tiếp cùng mức thụt). */
function job(ten) {
  const i = ci.indexOf(`\n  ${ten}:\n`);
  expect(i, `không tìm thấy job ${ten}`).toBeGreaterThan(-1);
  const sau = ci.slice(i + 1);
  const ke = sau.search(/\n {2}[a-z][\w-]*:\n/);
  return ke < 0 ? sau : sau.slice(0, ke);
}

describe("CI: phạm vi cài đặt phụ thuộc", () => {
  it("job `security` cài KHÔNG kèm devDependencies", () => {
    const lenhCi = [...job("security").matchAll(/run: (npm ci[^\n]*)/g)].map((m) => m[1].trim());
    expect(lenhCi.length, "job security không còn bước npm ci nào — kiểm lại bài test").toBeGreaterThan(0);
    for (const l of lenhCi) {
      expect(l, `Job security chạy \`${l}\`: nó chỉ cần lockfile cho \`npm audit --omit=dev\`, ` + `mà devDependencies ở repo này nặng 342 MB (@openai/codex-*).`).toMatch(/--omit=dev/);
    }
  });

  it("job `test` VẪN cài devDependencies (vitest/eslint/tsc nằm ở đó)", () => {
    const lenhCi = [...job("test").matchAll(/run: (npm ci[^\n]*)/g)].map((m) => m[1].trim());
    expect(lenhCi.length).toBeGreaterThan(0);
    for (const l of lenhCi) expect(l).not.toMatch(/--omit=dev/);
  });
});
