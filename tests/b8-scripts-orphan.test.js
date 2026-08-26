// Script trong scripts/ci/ và scripts/dev/ phải có ĐƯỜNG CHẠY, không được mồ côi.
//
// ── ĐO TRƯỚC KHI VIẾT ────────────────────────────────────────────────────────
// scripts/dev/rc-qa.mjs không có nơi nào gọi: `grep -rn "rc-qa" .` (trừ node_modules/.git) chỉ ra
// ba dòng — chính nó (scripts/dev/rc-qa.mjs:9, dòng hướng dẫn chạy), một chú thích ở
// prisma/seed-demo.js:23, và một dòng trong .gitleaks.toml:27. Không npm script, không bước CI,
// không tài liệu vận hành nào.
//
// Script mồ côi không phải chuyện thẩm mỹ: không ai chạy thì không ai biết nó hỏng, và nó vẫn được
// `git archive` chở lên máy chủ mỗi lần deploy (deploy.sh). Bài test này chỉ phủ HAI thư mục đó —
// đủ hẹp để không đỏ oan, đủ để chặn "viết script rồi quên nối".
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Mọi nơi được coi là ĐƯỜNG CHẠY hợp lệ: npm script, workflow CI, hoặc tài liệu vào cửa. */
function noiGoi() {
  const files = [
    "package.json",
    "README.md",
    "AGENTS.md",
    ...readdirSync(path.join(ROOT, ".github/workflows")).map((f) => `.github/workflows/${f}`),
  ].filter((f) => existsSync(path.join(ROOT, f)));
  return files.map((f) => readFileSync(path.join(ROOT, f), "utf8")).join("\n");
}

describe("scripts/{ci,dev}: không script nào mồ côi", () => {
  it("mỗi script đều được npm script / workflow CI / tài liệu gọi tên", () => {
    const goi = noiGoi();
    const moCoi = [];
    for (const thuMuc of ["scripts/ci", "scripts/dev"]) {
      for (const ten of readdirSync(path.join(ROOT, thuMuc))) {
        if (!/\.(mjs|js|sh)$/.test(ten)) continue;
        if (!goi.includes(`${thuMuc}/${ten}`)) moCoi.push(`${thuMuc}/${ten}`);
      }
    }
    expect(
      moCoi,
      `Script không có đường chạy: ${moCoi.join(", ")}.\n` +
        `Nối vào một npm script, một bước trong .github/workflows/, hoặc README/AGENTS — hoặc xoá đi.`
    ).toEqual([]);
  });
});
