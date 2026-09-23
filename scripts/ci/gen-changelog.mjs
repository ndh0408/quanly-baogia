#!/usr/bin/env node
// Sinh CHANGELOG.md TỪ LỊCH SỬ GIT. In ra stdout.
//
//   node scripts/ci/gen-changelog.mjs --write    # ghi thẳng CHANGELOG.md (npm run changelog)
//   node scripts/ci/gen-changelog.mjs > CHANGELOG.md
//   node scripts/ci/gen-changelog.mjs --check    # exit≠0 nếu CHANGELOG.md đã lệch khỏi lịch sử
//
// `--write` có vì cách chuyển hướng `> CHANGELOG.md` đã từng XOÁ TRẮNG tệp (commit 0065eab,
// 2026-09-16): trên Windows guard cũ không gọi main(), stdout rỗng, và `>` cắt tệp về 0 byte.
// Ghi bằng chính node thì không phụ thuộc shell (PowerShell `>` còn đổi mã hoá sang UTF-16).
//
// ── VÌ SAO SINH CHỨ KHÔNG VIẾT TAY ──────────────────────────────────────────
// §34 của MASTER PROMPT: "Không ghi số liệu dễ stale bằng tay… Nếu cần stats: generate bằng script
// hoặc bỏ. Không ghi statement mà CI không verify." Một CHANGELOG chép tay lệch khỏi lịch sử ngay
// commit thứ ba, và khi đã lệch thì không ai biết bản nào đúng — tệ hơn là không có.
//
// Hệ thống KHÔNG đánh phiên bản semver (công cụ nội bộ, triển khai theo commit), nên gom theo NGÀY
// chứ không theo tag. "Phiên bản" của một bản triển khai là git SHA của nó.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
> npm run changelog      # = node scripts/ci/gen-changelog.mjs --write
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

/** Hàm THUẦN của `--check`: đối chiếu nội dung CHANGELOG với các dòng lịch sử (`sha|ngày|tiêu đề`). */
export function kiemChangelog(hienCo, log) {
  const that = new Map(log.map((l) => { const [h, , s2] = l.split("|", 3); return [h, s2]; }));
  const bia = [];
  const lech = [];
  for (const m of hienCo.matchAll(/^- `([0-9a-f]{7,40})` (.*)$/gm)) {
    const [, sha, tieuDe] = m;
    if (!that.has(sha)) { bia.push(sha); continue; }
    if (that.get(sha) !== tieuDe) lech.push(`${sha}: ghi "${tieuDe}" ≠ thật "${that.get(sha)}"`);
  }
  const coTrongFile = new Set([...hienCo.matchAll(/^- `([0-9a-f]{7,40})`/gm)].map((m) => m[1]));
  return { bia, lech, coTrongFile, thieu: log.length - coTrongFile.size };
}

function main() {
  const log = execFileSync("git", ["log", "--pretty=%h|%ad|%s", "--date=short", "--no-merges"],
    { cwd: GOC, encoding: "utf8", maxBuffer: 32 << 20 }).trim().split("\n");
  const ra = dungChangelog(log);
  if (process.argv.includes("--write")) {
    writeFileSync(path.join(GOC, "CHANGELOG.md"), ra);
    console.log(`✓ đã ghi CHANGELOG.md (${log.length} commit)`);
    return;
  }
  if (!process.argv.includes("--check")) { process.stdout.write(ra); return; }

  // ── `--check` KIỂM "KHÔNG BỊA", KHÔNG KIỂM "KHỚP TUYỆT ĐỐI" ──────────────
  // Bản đầu của cổng này so `hienCo.trim() !== ra.trim()`. Sai về mặt thiết kế: CHÍNH commit thêm
  // CHANGELOG.md cũng là một commit, nên file vừa sinh đã lệch ngay khi commit xong — cổng đỏ
  // vĩnh viễn và người ta sẽ tắt nó.
  //
  // Điều thật sự cần chốt là CHANGELOG không chứa dòng BỊA: mọi mục `- \`sha\` tiêu đề` phải ứng
  // với một commit CÓ THẬT và tiêu đề phải khớp NGUYÊN VĂN. Việc file đi sau lịch sử vài commit là
  // bình thường — nó được sinh lại lúc phát hành, không phải mỗi lần commit.
  const { bia, lech, coTrongFile, thieu } = kiemChangelog(readFileSync(path.join(GOC, "CHANGELOG.md"), "utf8"), log);

  // Tệp RỖNG (hoặc mất hết mục) không "bịa" gì — bản cũ vì thế coi 0/N là ĐẠT, và không bắt được
  // chính sự cố xoá trắng tệp ở commit 0065eab. Không có mục nào = hỏng, không phải "đi sau".
  if (coTrongFile.size === 0) {
    console.error("✖ CHANGELOG.md không có mục commit nào (rỗng hoặc bị xoá trắng). Sinh lại: npm run changelog");
    process.exit(1);
  }

  if (bia.length || lech.length) {
    if (bia.length) console.error(`✖ CHANGELOG.md có ${bia.length} commit KHÔNG TỒN TẠI: ${bia.join(", ")}`);
    for (const l of lech) console.error(`✖ tiêu đề bị sửa tay — ${l}`);
    console.error("  Sinh lại:  npm run changelog");
    process.exit(1);
  }
  console.log(`✓ CHANGELOG.md: ${coTrongFile.size}/${log.length} commit, không mục nào bịa` +
    (thieu > 0 ? ` (đi sau ${thieu} commit — sinh lại khi phát hành)` : ""));
}

// So bằng `pathToFileURL`, KHÔNG ghép chuỗi `file://${argv[1]}` (audit 2026-09-22, DEP-02): trên Windows
// argv[1] là `D:\QuanLY\…` còn import.meta.url là `file:///D:/QuanLY/…` — hai chuỗi không bao giờ bằng
// nhau, main() không chạy, script thoát 0 với stdout RỖNG và verify-local in ✓. Máy Windows lại là
// nơi DUY NHẤT cổng thật sự chạy. tests/ops-ci-guard-windows.test.js chốt lớp lỗi này.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
