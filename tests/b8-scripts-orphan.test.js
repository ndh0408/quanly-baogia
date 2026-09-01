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

/**
 * Mọi nơi được coi là ĐƯỜNG CHẠY hợp lệ.
 *
 * ⚠️ `scripts/verify-local.sh` PHẢI có trong danh sách này, và nó là mục QUAN TRỌNG NHẤT: GitHub
 * Actions KHÔNG bật trên tài khoản của repo này, nên `.github/workflows/*` là nơi một script có thể
 * được "gọi" mà KHÔNG AI CHẠY. Trước đây danh sách chỉ có workflow + tài liệu, nên một script chỉ
 * xuất hiện ở ci.yml vẫn được tính là còn sống — đúng ca đã xảy ra thật với `smoke-dist.sh`.
 *
 * Vẫn GIỮ workflow và tài liệu trong danh sách: mục đích của cổng này là bắt script CHẾT HẲN
 * (không ai nhắc tới ở đâu), không phải phân xử đường chạy nào mới đáng tin. Việc phân xử đó nằm
 * ở bảng "Cổng chỉ sống trong ci.yml" của AGENTS.md.
 */
function noiGoi() {
  const files = [
    "package.json",
    "README.md",
    "AGENTS.md",
    "scripts/verify-local.sh",
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
