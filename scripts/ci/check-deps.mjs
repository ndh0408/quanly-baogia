#!/usr/bin/env node
// §37 — PHỤ THUỘC PHẢI CÓ NGƯỜI DÙNG.
//
//   node scripts/ci/check-deps.mjs           # bảng phân loại
//   node scripts/ci/check-deps.mjs --check   # thoát ≠0 nếu có gói không ai dùng mà chưa khai
//
// ── VÌ SAO ──────────────────────────────────────────────────────────────────
// Mỗi gói runtime thừa là bề mặt tấn công thừa, thời gian `npm ci` thừa, và một mục nữa trong SBOM
// mà ai đó sẽ phải soát khi có CVE. `tests/ch3-npm-manifest.test.js` đã gác chiều DEV
// (devDependency không ai dùng); chiều RUNTIME thì chưa có gì gác.
//
// ── BA CÁCH DÙNG MÀ BỘ DÒ NGÂY THƠ SẼ BỎ SÓT ───────────────────────────────
// Bản nháp đầu tiên của bộ dò này báo `dotenv` và `pino-pretty` là "không ai dùng". Cả hai đều SAI,
// và mỗi cái sai theo một kiểu riêng — nên chúng nằm ngay đây làm ví dụ:
//
//   1. IMPORT CHỈ ĐỂ LẤY TÁC DỤNG PHỤ:  `import "dotenv/config"` (src/config.ts)
//      Không có `from`, không gán vào biến nào. Regex đòi `from "x"` sẽ trượt.
//   2. GỌI TÊN BẰNG CHUỖI:  `target: "pino-pretty"` (src/logger.ts) — pino nạp transport theo TÊN
//      lúc chạy. Không có `import` nào cả.
//   3. GỌI QUA BINARY trong npm script: `prisma migrate deploy`, `vitest run`…
//
// Bỏ sót ba kiểu này thì cổng báo động giả, và một cổng hay báo động giả sẽ bị tắt.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const GOC = path.resolve(import.meta.dirname, "../..");
const BO_QUA_THU_MUC = new Set(["node_modules", "dist", ".git", "coverage", "_bmad", "_bmad-output", ".claude", "public"]);

/** Gói runtime CỐ Ý giữ dù không thấy dấu vết trực tiếp, kèm lý do. */
export const CHO_PHEP = new Map([
  // (trống — mọi gói runtime hiện tại đều dò ra được. Thêm ở đây khi thật sự cần, kèm lý do.)
]);

function moiNguon(goc = GOC) {
  const ra = [];
  (function di(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (BO_QUA_THU_MUC.has(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) di(f);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) ra.push(f);
    }
  })(goc);
  return ra;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Gói `ten` có được dùng ở đâu không. Hàm THUẦN — nhận sẵn nội dung.
 * Trả về nhãn CÁCH dùng, hoặc null.
 */
export function cachDung(ten, maNguon, npmScripts, cauHinh) {
  const t = escRe(ten);
  // 1. import/require thường: `from "x"`, `require("x")`, `import("x")`, kể cả subpath `x/y`.
  if (new RegExp(`(?:from|require\\(|import\\()\\s*["']${t}(?:/[^"']*)?["']`).test(maNguon)) return "import";
  // 2. import chỉ lấy tác dụng phụ: `import "x"` / `import "x/config"`.
  if (new RegExp(`import\\s+["']${t}(?:/[^"']*)?["']`).test(maNguon)) return "import (tác dụng phụ)";
  // 3. gọi tên bằng chuỗi lúc chạy (transport của pino, adapter…).
  if (new RegExp(`["']${t}["']`).test(maNguon)) return "gọi theo tên (chuỗi)";
  // 4. binary trong npm script — cả tên đầy đủ lẫn tên đã bỏ scope.
  const bin = ten.replace(/^@[^/]+\//, "");
  if (new RegExp(`\\b${escRe(bin)}\\b`).test(npmScripts)) return "binary trong npm script";
  // 5. nhắc trong file cấu hình (Dockerfile, compose, eslint…).
  if (new RegExp(`\\b${escRe(bin)}\\b`).test(cauHinh)) return "nhắc trong cấu hình";
  return null;
}

function main() {
  const pkg = JSON.parse(readFileSync(path.join(GOC, "package.json"), "utf8"));
  const deps = Object.keys(pkg.dependencies || {});
  const maNguon = moiNguon().map((f) => readFileSync(f, "utf8")).join("\n");
  const npmScripts = JSON.stringify(pkg.scripts || {});
  const cauHinh = ["Dockerfile", "docker-compose.yml", "docker-compose.prod.yml", "docker-compose.staging.yml"]
    .map((f) => { try { return readFileSync(path.join(GOC, f), "utf8"); } catch { return ""; } }).join("\n");

  const kq = deps.map((d) => ({ ten: d, cach: cachDung(d, maNguon, npmScripts, cauHinh) }));
  const chet = kq.filter((k) => !k.cach && !CHO_PHEP.has(k.ten));

  if (!process.argv.includes("--check")) {
    for (const k of kq.sort((a, b) => a.ten.localeCompare(b.ten))) {
      console.log(`${k.cach ? "✓" : "✖"} ${k.ten.padEnd(30)} ${k.cach || (CHO_PHEP.get(k.ten) ? "miễn: " + CHO_PHEP.get(k.ten) : "KHÔNG THẤY DÙNG")}`);
    }
    console.log(`\nTỔNG: ${deps.length} phụ thuộc runtime, ${chet.length} không thấy dùng.`);
    return;
  }

  if (chet.length) {
    console.error(`✖ ${chet.length} phụ thuộc RUNTIME không thấy ai dùng: ${chet.map((c) => c.ten).join(", ")}`);
    console.error("  Mỗi gói thừa = bề mặt tấn công thừa + một mục nữa trong SBOM phải soát khi có CVE.");
    console.error("  Nếu THẬT SỰ cần giữ: thêm vào CHO_PHEP trong scripts/ci/check-deps.mjs kèm lý do.");
    process.exit(1);
  }
  // Bảo hiểm: bộ dò hỏng thì `kq` rỗng và cổng xanh vô nghĩa.
  if (deps.length < 10) { console.error(`✖ chỉ đọc được ${deps.length} phụ thuộc — bộ dò hỏng?`); process.exit(1); }
  console.log(`✓ ${deps.length} phụ thuộc runtime — đều tìm được nơi dùng`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
