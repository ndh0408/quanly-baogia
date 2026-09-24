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
//
// ── CHIỀU NGƯỢC: PHỤ THUỘC "MA" (audit 2026-09-22, DEP-03) ────────────────────
// Gói được IMPORT mà KHÔNG khai trong package.json — nó chỉ có mặt vì một gói khác kéo nó vào và npm
// hoist lên node_modules/. `jszip` là ví dụ thật: src/xlsxStitcher.ts và src/services/contractDocx.ts
// import nó trên ĐÚNG đường xuất Excel/hợp đồng, nhưng nó chỉ tồn tại nhờ exceljs. exceljs đổi cây
// phụ thuộc là xuất Excel hỏng lúc chạy, và tsc không bắt được. Luật:
//   · src/ và shared/  → mọi gói import phải nằm trong `dependencies` (image production chỉ có chúng);
//   · scripts/ và tests/ → trong `dependencies` ∪ `devDependencies`.
// (web/ có package.json riêng, không soát ở đây.)
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

const BUILTIN = new Set(builtinModules);

/** Tên GÓI của mọi bare import trong một đoạn mã (bỏ đường dẫn tương đối, `node:`, builtin). Hàm THUẦN. */
export function goiDuocImport(maNguon) {
  const ra = new Set();
  // Bỏ chú thích trước khi dò: chú thích hay trích mẫu `from "x"` làm ví dụ (chính tệp này cũng vậy).
  maNguon = maNguon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const re = /(?:^|[^\w.$])(?:import\s+(?:type\s+)?(?:[\w*${}\s,]+\s+from\s+)?|export\s+[\w*${}\s,]+\s+from\s+|require\(\s*|import\(\s*)["']([^"'./][^"']*)["']/g;
  for (const m of maNguon.matchAll(re)) {
    const spec = m[1];
    if (spec.startsWith("node:") || spec.startsWith("#")) continue;
    const ten = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (BUILTIN.has(ten) || !/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(ten)) continue;
    ra.add(ten);
  }
  return ra;
}

/**
 * Gói DEV mà src/ được phép import, kèm lý do. Chỉ hợp lệ khi lời gọi nằm trong nhánh KHÔNG BAO GIỜ
 * chạy ở image production — và gói vẫn phải được khai (ở devDependencies).
 */
export const DEV_DUOC_PHEP_TRONG_SRC = new Map([
  ["tsx", "src/exportWorker.js + src/importWorker.js chỉ `import(\"tsx/esm/api\")` khi chạy TỪ NGUỒN .ts (dev/test), trong try/catch; image production chạy dist/ nên không bao giờ tới nhánh đó"],
]);

/** Lượt import gói KHÔNG khai. `tepTheoThuMuc` = [{ tep: đường dẫn tương đối gốc repo, noiDung }]. Hàm THUẦN. */
export function timGoiMa(tepTheoThuMuc, pkg) {
  const deps = new Set(Object.keys(pkg.dependencies || {}));
  const tatCa = new Set([...deps, ...Object.keys(pkg.devDependencies || {})]);
  const loi = [];
  for (const { tep, noiDung } of tepTheoThuMuc) {
    const runtime = /^(src|shared)\//.test(tep);
    for (const g of goiDuocImport(noiDung)) {
      const hopLe = runtime ? deps.has(g) || (DEV_DUOC_PHEP_TRONG_SRC.has(g) && tatCa.has(g)) : tatCa.has(g);
      if (!hopLe) loi.push({ tep, goi: g, can: runtime ? "dependencies" : "dependencies/devDependencies" });
    }
  }
  return loi;
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
  const tepSoat = ["src", "shared", "scripts", "tests"].flatMap((d) => {
    try { return moiNguon(path.join(GOC, d)); } catch { return []; }
  }).map((f) => ({ tep: path.relative(GOC, f).split(path.sep).join("/"), noiDung: readFileSync(f, "utf8") }));
  const ma = timGoiMa(tepSoat, pkg);

  if (!process.argv.includes("--check")) {
    for (const k of kq.sort((a, b) => a.ten.localeCompare(b.ten))) {
      console.log(`${k.cach ? "✓" : "✖"} ${k.ten.padEnd(30)} ${k.cach || (CHO_PHEP.get(k.ten) ? "miễn: " + CHO_PHEP.get(k.ten) : "KHÔNG THẤY DÙNG")}`);
    }
    console.log(`\nTỔNG: ${deps.length} phụ thuộc runtime, ${chet.length} không thấy dùng.`);
    return;
  }

  if (ma.length) {
    console.error(`✖ ${ma.length} lượt import gói KHÔNG khai trong package.json (phụ thuộc "ma" — chỉ có nhờ gói khác kéo vào):`);
    for (const m of ma.slice(0, 30)) console.error(`    ${m.tep} → "${m.goi}" (phải nằm trong ${m.can})`);
    process.exit(1);
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

// So bằng `pathToFileURL`, KHÔNG ghép chuỗi `file://${argv[1]}` (audit 2026-09-22, DEP-02): trên Windows
// argv[1] là `D:\QuanLY\…` còn import.meta.url là `file:///D:/QuanLY/…` — hai chuỗi không bao giờ bằng
// nhau, main() không chạy, script thoát 0 với stdout RỖNG và verify-local in ✓. Máy Windows lại là
// nơi DUY NHẤT cổng thật sự chạy. tests/ops-ci-guard-windows.test.js chốt lớp lỗi này.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
