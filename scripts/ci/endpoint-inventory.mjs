#!/usr/bin/env node
// Liệt kê MỌI endpoint HTTP từ mã nguồn — nguồn sự thật duy nhất về số lượng endpoint.
//
// Vì sao cần: README từng ghi "141 HTTP endpoints" trong khi AUTHZ_MATRIX.md ghi "133". Cả hai đều
// đếm tay nên cả hai đều có thể sai, và không ai biết cái nào. Con số đếm tay lệch âm thầm mỗi lần
// thêm route — mà một endpoint không nằm trong ma trận phân quyền là một endpoint chưa ai soát.
//
//   node scripts/ci/endpoint-inventory.mjs            # bảng cho người đọc
//   node scripts/ci/endpoint-inventory.mjs --json     # JSON cho công cụ
//   node scripts/ci/endpoint-inventory.mjs --check    # đối chiếu AUTHZ_MATRIX.md, khác là exit 1 (CI)
//
// Giới hạn có chủ đích: đây là bộ phân tích theo mẫu, không phải trình biên dịch TS. Nó KHÔNG chạy
// mã (chạy mã lúc kiểm kê là tự chuốc lấy side effect). Đổi lại, mọi lối khai báo route bất thường
// sẽ hiện ra ở cảnh báo "router import mà chưa gắn" thay vì âm thầm biến mất.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/ci/<file> → lùi HAI cấp về gốc repo.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const METHODS = ["get", "post", "put", "delete", "patch", "all"];

/** Bóc literal đường dẫn đầu tiên sau dấu `(` — chịu được khai báo xuống dòng và mảng đường dẫn. */
function firstPathArg(text, fromIndex) {
  let i = fromIndex;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "/" && text[i + 1] === "/") { const nl = text.indexOf("\n", i); i = nl < 0 ? text.length : nl + 1; continue; }
    if (ch === "/" && text[i + 1] === "*") { const e = text.indexOf("*/", i); i = e < 0 ? text.length : e + 2; continue; }
    break;
  }
  // Dạng mảng: app.get(["/app", "/app/*"], …)
  if (text[i] === "[") {
    const end = text.indexOf("]", i);
    if (end < 0) return null;
    const paths = [...text.slice(i + 1, end).matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1]);
    return paths.length ? paths : null;
  }
  const q = text[i];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  const end = text.indexOf(q, i + 1);
  if (end < 0) return null;
  return [text.slice(i + 1, end)];
}

/** Mọi lời gọi `<obj>.<method>(` trong một file, kèm literal đường dẫn. */
function extractRoutes(text, objName) {
  const out = [];
  const re = new RegExp(`\\b${objName}\\.(${METHODS.join("|")})\\s*\\(`, "g");
  for (const m of text.matchAll(re)) {
    const paths = firstPathArg(text, m.index + m[0].length);
    if (!paths) continue; // vd app.use(fn): middleware không đường dẫn — không phải endpoint
    for (const p of paths) out.push({ method: m[1].toUpperCase(), path: p });
  }
  return out;
}

const joinPath = (prefix, sub) => (prefix.replace(/\/+$/, "") + (sub === "/" ? "" : sub)) || "/";

const appSrc = readFileSync(join(ROOT, "src/app.ts"), "utf8");

// Bản đồ gắn router + bản đồ import.
const mounts = [...appSrc.matchAll(/app\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)]
  .map((m) => ({ prefix: m[1], varName: m[2] }));
const imports = new Map(
  [...appSrc.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+["'`]\.\/routes\/([\w.-]+)\.js["'`]/g)]
    .map((m) => [m[1], `src/routes/${m[2]}.ts`])
);

const rows = [];

// Endpoint khai báo THẲNG trên app (/metrics, /livez, /readyz, /api/health, route phục vụ SPA).
// Dễ bị bỏ sót vì không nằm trong src/routes/.
for (const r of extractRoutes(appSrc, "app")) {
  rows.push({ ...r, source: "src/app.ts", mount: "" });
}

// Endpoint trong từng router. Nhiều router có thể gắn CÙNG prefix (importRoutes + quotesRoutes đều ở
// /api/quotes) và một router có thể gắn ở gốc /api (jobsRoutes) — lặp theo `mounts` xử lý đúng cả hai.
for (const { prefix, varName } of mounts) {
  const file = imports.get(varName);
  if (!file) continue; // app.use("/api/", bearerAuth): middleware, không phải router
  for (const r of extractRoutes(readFileSync(join(ROOT, file), "utf8"), "router")) {
    rows.push({ method: r.method, path: joinPath(prefix, r.path), source: file, mount: prefix });
  }
}

const mountedVars = new Set(mounts.map((m) => m.varName));
const unmounted = [...imports.keys()].filter((v) => !mountedVars.has(v));

rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

const args = process.argv.slice(2);

if (args.includes("--json")) {
  console.log(JSON.stringify({ total: rows.length, unmounted, endpoints: rows }, null, 2));
  process.exit(0);
}

if (args.includes("--check")) {
  let bad = false;
  // Đối chiếu MỌI nơi công bố con số. Chỉ canh ma trận là chưa đủ: README từng ghi 141 trong khi ma
  // trận ghi 133 và mã nguồn có 138 — ba nguồn, ba con số, không ai biết cái nào đúng.
  const sources = [
    { file: "AUTHZ_MATRIX.md", re: /toàn bộ\s+(\d+)\s+endpoint/i },
    { file: "README.md", re: /(\d+)\s+HTTP endpoints/i },
  ];
  for (const { file, re } of sources) {
    const m = readFileSync(join(ROOT, file), "utf8").match(re);
    if (!m) {
      console.error(`✖ Không tìm thấy số endpoint công bố trong ${file}`);
      bad = true;
    } else if (Number(m[1]) !== rows.length) {
      console.error(`✖ LỆCH SỐ ENDPOINT: mã nguồn có ${rows.length}, ${file} ghi ${m[1]}.`);
      bad = true;
    }
  }
  if (bad) {
    console.error("  Thêm/xoá route thì PHẢI cập nhật ma trận — endpoint ngoài ma trận là endpoint chưa ai soát quyền.");
  }
  if (unmounted.length) {
    console.error(`✖ Router được import nhưng không gắn vào app: ${unmounted.join(", ")}`);
    bad = true;
  }
  if (bad) process.exit(1);
  console.log(`✓ ${rows.length} endpoint — khớp AUTHZ_MATRIX.md + README.md`);
  process.exit(0);
}

const byMount = new Map();
for (const r of rows) {
  const k = r.mount || "(khai báo thẳng trên app)";
  byMount.set(k, (byMount.get(k) || 0) + 1);
}
for (const r of rows) console.log(`${r.method.padEnd(7)} ${r.path.padEnd(52)} ${r.source}`);
console.log("\n── theo prefix ──");
for (const [k, v] of [...byMount].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(4)}  ${k}`);
console.log(`\nTỔNG: ${rows.length} endpoint`);
if (unmounted.length) console.log(`⚠️  router import mà chưa gắn: ${unmounted.join(", ")}`);
