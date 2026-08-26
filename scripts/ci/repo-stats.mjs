// repo-stats.mjs — SINH các con số mà README công bố, và đối chiếu chúng ở CI.
//
// ── VÌ SAO CÓ FILE NÀY ──────────────────────────────────────────────────────
// README từng ghi bằng tay: "391 commits · ~22,000 LOC TypeScript · 29 Prisma models · 34 test
// files", và ngay bên dưới bảng Stack lại ghi "Prisma 7 (28 models)". Hai con số model MÂU THUẪN
// NHAU trong cùng một file. Kiểm lại mã nguồn: 29 model, 40 file test, và "otplib" trong bảng Stack
// thực ra là `speakeasy`. Không con số nào trong đó sai vào lúc được viết — chúng chỉ đơn giản là
// trôi, vì không có gì buộc chúng đúng.
//
// Cách chữa giống hệt cách đã dùng cho số endpoint: SINH TỪ MÃ NGUỒN, và cho CI đỏ khi lệch.
//
//   node scripts/ci/repo-stats.mjs           # in bảng
//   node scripts/ci/repo-stats.mjs --check   # đối chiếu README, lệch → exit 1
//
// CỐ Ý KHÔNG đếm: số commit (repo hay được clone nông — `git rev-list --count HEAD` trả 56 trên
// một bản clone của chính repo này, trong khi README ghi 391) và tổng số dòng mã (đổi mỗi lần
// commit, không nói lên điều gì về hệ thống). Con số nào không kiểm chứng được thì đừng công bố.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/ci/<file> → lùi HAI cấp về gốc repo.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const doc = (p) => readFileSync(join(ROOT, p), "utf8");

function demModelPrisma() {
  return (doc("prisma/schema.prisma").match(/^model\s+\w+/gm) || []).length;
}

function demFileTest() {
  return readdirSync(join(ROOT, "tests")).filter((f) => f.endsWith(".test.js")).length;
}

function demMigration() {
  const d = join(ROOT, "prisma/migrations");
  return readdirSync(d).filter((f) => statSync(join(d, f)).isDirectory()).length;
}

function demEndpoint() {
  // Dùng LẠI bộ sinh danh sách endpoint, không cài lại logic lần hai.
  const out = doc("docs/product/ROLES_PERMISSIONS.md").match(/toàn bộ (\d+) endpoint/);
  return out ? Number(out[1]) : null;
}

export const stats = {
  "Prisma models": demModelPrisma(),
  "Migrations": demMigration(),
  "File test (tests/*.test.js)": demFileTest(),
  "HTTP endpoints": demEndpoint(),
};

const check = process.argv.includes("--check");

if (!check) {
  const rong = Math.max(...Object.keys(stats).map((k) => k.length));
  for (const [k, v] of Object.entries(stats)) console.log(`${k.padEnd(rong)}  ${v}`);
  process.exit(0);
}

// ── Đối chiếu README ────────────────────────────────────────────────────────
const readme = doc("README.md");
const loi = [];

const phaiKhop = [
  { nhan: "Prisma models", re: /(\d+)\s+Prisma models/, thuc: stats["Prisma models"] },
  { nhan: "file test", re: /(\d+)\s+test files/, thuc: stats["File test (tests/*.test.js)"] },
];
for (const { nhan, re, thuc } of phaiKhop) {
  const m = readme.match(re);
  if (!m) {
    loi.push(`README không còn công bố "${nhan}" — bỏ mục này khỏi repo-stats.mjs hoặc thêm lại vào README.`);
    continue;
  }
  if (Number(m[1]) !== thuc) loi.push(`${nhan}: README ghi ${m[1]}, mã nguồn có ${thuc}`);
}

// Bảng Stack từng ghi số model KHÁC với dòng tóm tắt phía trên. Chặn hẳn kiểu mâu thuẫn nội bộ đó.
const trongStack = readme.match(/Prisma[*\s]+\d+[*\s]*\((\d+)\s+models\)/);
if (trongStack && Number(trongStack[1]) !== stats["Prisma models"]) {
  loi.push(`Bảng Stack ghi ${trongStack[1]} model, mã nguồn có ${stats["Prisma models"]} (và mâu thuẫn với dòng tóm tắt)`);
}

// Thư viện TOTP: README từng ghi "otplib" trong khi mã dùng `speakeasy`.
const totpThuc = doc("package.json").includes('"speakeasy"') ? "speakeasy" : "otplib";
const totpDoc = /otplib/i.test(readme) ? "otplib" : /speakeasy/i.test(readme) ? "speakeasy" : null;
if (totpDoc && totpDoc !== totpThuc) {
  loi.push(`Thư viện TOTP: README ghi "${totpDoc}", package.json dùng "${totpThuc}"`);
}

if (loi.length) {
  console.error("✖ README LỆCH SO VỚI MÃ NGUỒN:");
  for (const l of loi) console.error("  - " + l);
  console.error("\n  Sinh lại số đúng: node scripts/ci/repo-stats.mjs");
  process.exit(1);
}
console.log(`✓ số liệu README khớp mã nguồn (${Object.entries(stats).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ")})`);
