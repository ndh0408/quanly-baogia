#!/usr/bin/env node
// Sinh CHANGELOG.md TỪ LỊCH SỬ GIT. In ra stdout.
//
//   node scripts/ci/gen-changelog.mjs > CHANGELOG.md
//   node scripts/ci/gen-changelog.mjs --check    # exit≠0 nếu CHANGELOG.md đã lệch khỏi lịch sử
//
// ── VÌ SAO SINH CHỨ KHÔNG VIẾT TAY ──────────────────────────────────────────
// §34 của MASTER PROMPT: "Không ghi số liệu dễ stale bằng tay… Nếu cần stats: generate bằng script
// hoặc bỏ. Không ghi statement mà CI không verify." Một CHANGELOG chép tay lệch khỏi lịch sử ngay
// commit thứ ba, và khi đã lệch thì không ai biết bản nào đúng — tệ hơn là không có.
//
// Hệ thống KHÔNG đánh phiên bản semver (công cụ nội bộ, triển khai theo commit), nên gom theo NGÀY
// chứ không theo tag. "Phiên bản" của một bản triển khai là git SHA của nó.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const GOC = path.resolve(import.meta.dirname, "../..");

export function dungChangelog(dongLog) {
  const rows = dongLog.filter(Boolean).map((l) => l.split("|", 3));
  if (!rows.length) throw new Error("git log không trả về commit nào");
  const theoNgay = new Map();
  for (const [h, d, s] of rows) {
    if (!theoNgay.has(d)) theoNgay.set(d, []);
    theoNgay.get(d).push([h, s]);
  }
  const dau = rows[rows.length - 1][1], cuoi = rows[0][1];
  const head =
`# Nhật ký thay đổi

> **File này SINH TỪ LỊCH SỬ GIT, không viết tay.** Dựng lại:
> \`\`\`bash
> node scripts/ci/gen-changelog.mjs > CHANGELOG.md
> \`\`\`
> Vì sao không viết tay: §34 của quy ước dự án cấm ghi số liệu dễ trôi mà không có gì sinh ra
> chúng. Một CHANGELOG chép tay sẽ lệch khỏi lịch sử ngay commit thứ ba, và không ai biết bản nào
> đúng. Ở đây lịch sử git là nguồn duy nhất.

Hệ thống **không đánh phiên bản theo semver** — nó là công cụ nội bộ, triển khai theo commit chứ
không phát hành gói. Nên nhật ký gom **theo ngày**, và "phiên bản" của một bản triển khai chính là
git SHA của nó (xem [docs/operations/DEPLOYMENT.md](docs/operations/DEPLOYMENT.md)).

**${rows.length} commit**, từ ${dau} tới ${cuoi}.

---

`;
  const than = [...theoNgay].map(([d, items]) =>
    `## ${d}\n\n${items.map(([h, s]) => `- \`${h}\` ${s}`).join("\n")}\n`).join("\n");
  return head + than;
}

function main() {
  const log = execFileSync("git", ["log", "--pretty=%h|%ad|%s", "--date=short", "--no-merges"],
    { cwd: GOC, encoding: "utf8", maxBuffer: 32 << 20 }).trim().split("\n");
  const ra = dungChangelog(log);
  if (!process.argv.includes("--check")) { process.stdout.write(ra); return; }

  const hienCo = readFileSync(path.join(GOC, "CHANGELOG.md"), "utf8");
  if (hienCo.trim() !== ra.trim()) {
    console.error("✖ CHANGELOG.md đã lệch khỏi lịch sử git.");
    console.error("  Sinh lại:  node scripts/ci/gen-changelog.mjs > CHANGELOG.md");
    process.exit(1);
  }
  console.log(`✓ CHANGELOG.md khớp lịch sử git (${log.length} commit)`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
