#!/usr/bin/env node
// §38 — MỌI SCRIPT SHELL PHẢI BẬT CHẾ ĐỘ NGHIÊM, VÀ AI BỎ `-e` PHẢI KÝ TÊN.
//
//   node scripts/ci/check-shell-strict.mjs           # liệt kê
//   node scripts/ci/check-shell-strict.mjs --check   # thoát ≠0 nếu có script chưa đạt
//
// ── VÌ SAO CẦN ──────────────────────────────────────────────────────────────
// Không có `set -e`, một lệnh hỏng giữa script vẫn để script chạy tiếp và thoát 0. Với script
// TRIỂN KHAI hay SAO LƯU thì đó là "đã xong" giả.
//
// `pipefail` còn quan trọng hơn `-e` ở repo này, và đây là chuyện ĐÃ XẢY RA THẬT:
// `scripts/db/migration-rehearsal-inner.sh` chạy `prisma migrate deploy 2>&1 | grep … | tail -3`.
// Không có pipefail thì mã thoát lấy từ `tail` — LUÔN LUÔN 0. Migration hỏng bị nuốt sạch và bài
// diễn tập báo ĐẠT. Đúng công cụ sinh ra để bắt migration hỏng lại là công cụ nuốt nó.
//
// ── VÌ SAO KHÔNG ÉP `-e` CHO TẤT CẢ ────────────────────────────────────────
// Vài script CỐ Ý chạy hết mọi bước rồi mới kết luận (bộ chạy cổng kiểm, diễn tập nhiều bước).
// Với chúng `-e` sẽ thoát ở lỗi đầu tiên và mất phần chẩn đoán — tức làm chúng TỆ ĐI.
// Nên: `-u` và `pipefail` là BẮT BUỘC với mọi script; bỏ `-e` thì phải có tên trong
// `CHO_PHEP_KHONG_E` kèm lý do — một dòng trong diff mà người review nhìn thấy.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const GOC = path.resolve(import.meta.dirname, "../..");

/** Script CỐ Ý không dùng `-e`, kèm lý do. Khoá là đường dẫn tương đối gốc repo. */
export const CHO_PHEP_KHONG_E = new Map([
  ["scripts/verify-local.sh", "bộ chạy 12 cổng: phải chạy HẾT rồi mới kết luận, `-e` sẽ thoát ở cổng đỏ đầu tiên"],
  ["scripts/ci/docker-smoke.sh", "cùng lý do: dựng image rồi bàn giao, cần in được lỗi của bước dựng"],
  ["scripts/ci/security-scan.sh", "bốn cổng bảo mật độc lập — chạy hết mới biết có mấy cổng đỏ"],
  ["scripts/backup/backup-objects.sh", "sao lưu từng đối tượng: một object hỏng không được làm hỏng cả lượt"],
  ["scripts/backup/restore-drill.sh", "diễn tập nhiều bước, cần báo cáo đầy đủ bước nào đạt bước nào không"],
  ["scripts/db/migration-rehearsal-inner.sh", "tích luỹ FAIL qua bốn bước; BƯỚC 1 và 3 tự `exit 1` khi hỏng"],
  ["scripts/db/migration-rehearsal.sh", "vỏ điều phối: phải đọc được mã thoát của script bên trong rồi dọn container, `-e` sẽ bỏ qua bước dọn"],
  ["scripts/backup/backup-db.sh", "§39: dump hỏng thì phải ĐI TIẾP tới nhánh cảnh báo và TUYỆT ĐỐI không xoá bản sao lưu cũ — `-e` thoát ngay sẽ bỏ cả hai"],
  ["scripts/backup/backup-watchdog.sh", "kiểm BA điều kiện tươi mới (CSDL / kho object / diễn tập) rồi mới cảnh báo; `-e` dừng ở điều kiện hỏng đầu tiên và giấu hai cái còn lại"],
  ["scripts/backup/restore-test.sh", "diễn tập khôi phục nhiều bước, có `trap cleanup EXIT` phải chạy được kể cả khi một phép đo hỏng"],
  ["test-on-dev.sh", "chạy bộ test trên VM dev rồi báo cáo — mục đích là THẤY hết bài đỏ, không phải dừng ở bài đầu"],
]);

const laBoQuaHopLe = (f) => CHO_PHEP_KHONG_E.has(f);

/**
 * Đọc phần đầu script, trả cờ đã bật. Hàm THUẦN.
 *
 * ⚠️ BẢN ĐẦU CỦA HÀM NÀY XANH GIẢ HOÀN TOÀN. Nó kiểm cờ bằng `chuoi.includes("e")` trên cả dòng
 * `set` — mà chuỗi "pipefail" CÓ chữ "e". Nên mọi script có `pipefail` đều bị tính là có `-e`,
 * kể cả sáu script cố ý không dùng `-e`. Cổng in ra 16/16 ✓ và không kiểm gì cả.
 * Nay chỉ soi ĐÚNG các token bắt đầu bằng `-`, và chỉ xét phần chữ cái sau dấu gạch.
 */
export function coCoNao(noiDung) {
  // Chỉ soi 40 dòng đầu: `set -e` nằm giữa thân script là chuyện khác (bật/tắt cục bộ), không
  // phải khai báo chế độ nghiêm của cả file.
  const dau = noiDung.split("\n").slice(0, 40).join("\n");
  const dongSet = [...dau.matchAll(/^\s*set\s+(.+?)\s*$/gm)].map((m) => m[1]);

  // Token dạng `-euo`, `-e`, `-u`… → gom chữ cái. Token `-o` thì cờ nằm ở token KẾ TIẾP.
  const chuCai = new Set();
  let pipefail = false;
  for (const dong of dongSet) {
    const tok = dong.split(/\s+/);
    for (let i = 0; i < tok.length; i++) {
      const t = tok[i];
      if (t === "-o") { if (tok[i + 1] === "pipefail") pipefail = true; i++; continue; }
      const m = /^-([a-zA-Z]+)$/.exec(t);
      if (!m) continue;
      for (const c of m[1]) {
        if (c === "o") { if (tok[i + 1] === "pipefail") { pipefail = true; i++; } }
        else chuCai.add(c);
      }
    }
  }
  return { e: chuCai.has("e"), u: chuCai.has("u"), pipefail };
}

export function quet(files) {
  const ra = [];
  for (const { f, sql } of files) {
    const c = coCoNao(sql);
    const thieu = [];
    if (!c.u) thieu.push("-u");
    if (!c.pipefail) thieu.push("pipefail");
    if (!c.e && !laBoQuaHopLe(f)) thieu.push("-e (hoặc khai vào CHO_PHEP_KHONG_E kèm lý do)");
    ra.push({ f, ...c, thieu });
  }
  return ra;
}

function main() {
  const files = execFileSync("git", ["ls-files", "*.sh"], { cwd: GOC, encoding: "utf8" })
    .split("\n").filter(Boolean)
    .map((f) => ({ f, sql: readFileSync(path.join(GOC, f), "utf8") }));
  const kq = quet(files);
  const xau = kq.filter((k) => k.thieu.length);

  if (!process.argv.includes("--check")) {
    for (const k of kq) {
      const co = [k.e ? "e" : "·", k.u ? "u" : "·", k.pipefail ? "pipefail" : "·"].join(" ");
      console.log(`${k.thieu.length ? "✖" : "✓"} ${k.f.padEnd(46)} ${co}${CHO_PHEP_KHONG_E.has(k.f) ? "  (miễn -e)" : ""}`);
    }
    console.log(`\nTỔNG: ${kq.length} script, ${xau.length} chưa đạt.`);
    return;
  }

  if (xau.length) {
    console.error(`✖ ${xau.length} script shell chưa bật đủ chế độ nghiêm:`);
    for (const k of xau) console.error(`    ${k.f}  →  thiếu ${k.thieu.join(", ")}`);
    process.exit(1);
  }
  // Khai thừa cũng là lỗi: script đã đổi tên/thêm `-e` mà dòng miễn ở lại thì lần sau một script
  // MỚI trùng tên được miễn im lặng.
  const co = new Set(kq.map((k) => k.f));
  const thua = [...CHO_PHEP_KHONG_E.keys()].filter((k) => !co.has(k) || kq.find((x) => x.f === k)?.e);
  if (thua.length) {
    console.error(`✖ CHO_PHEP_KHONG_E thừa (script không còn, hoặc nay ĐÃ có -e): ${thua.join(", ")}`);
    process.exit(1);
  }
  console.log(`✓ ${kq.length} script shell — đều có -u + pipefail; ${CHO_PHEP_KHONG_E.size} script miễn -e kèm lý do`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
