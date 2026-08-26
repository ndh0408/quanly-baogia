// Cụm hàng đợi/SSE/quan trắc — cổng kiểm "bản gương có đủ object không" TỰ VÔ HIỆU.
//
// ── LỖI (object-mirror-count-check-silently-skipped) ────────────────────────
// scripts/backup/backup-objects.sh bước [2/5]:
//   REMOTE_N="$(mc ls --recursive "q/$BUCKET" 2>/dev/null | grep -c . || echo 0)"
// `grep -c .` khi không có dòng nào IN RA "0" RỒI THOÁT VỚI MÃ 1, nên `|| echo 0` chạy thêm và
// REMOTE_N thành chuỗi HAI DÒNG "0\n0". `[ "$REMOTE_N" -gt 0 ]` gặp chuỗi đó thì báo
// "integer expression expected" và trả mã 2 — tức ĐIỀU KIỆN SAI, nhánh cảnh báo KHÔNG chạy. Script
// không có `set -e` nên nó đi tiếp và in "✓ backup object OK".
// Tệ hơn: `2>/dev/null` nuốt luôn thông báo lỗi của `mc`, nên `mc ls` HỎNG cũng cho ra đúng tình
// huống trên — cổng kiểm tính đầy đủ của bản sao lưu tự tắt đúng lúc cần nhất.
// HẬU QUẢ: bản gương thiếu ẢNH CHỨNG TỪ THANH TOÁN mà báo cáo vẫn xanh.
//
// CÁCH KIỂM: trích NGUYÊN VĂN khối bước [2/5] từ file script THẬT rồi chạy bằng bash với `mc` giả.
// Không chép lại đoạn mã vào test — nếu ai đó sửa script, test này đọc bản mới.
// KHÔNG KIỂM CHỨNG ĐƯỢC ở đây: phần còn lại của script cần `docker` (máy này không có daemon).
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve("scripts/backup/backup-objects.sh");

/** Cắt lấy đúng phần thân của bước [2/5] trong script thật (giữa mốc [2/5] và mốc [3/5]). */
function trichBuoc2() {
  const dong = readFileSync(SCRIPT, "utf8").split("\n");
  const dau = dong.findIndex((l) => l.includes('[2/5]'));
  const cuoi = dong.findIndex((l) => l.includes('[3/5]'));
  expect(dau, "không tìm thấy mốc [2/5] trong backup-objects.sh").toBeGreaterThan(-1);
  expect(cuoi).toBeGreaterThan(dau);
  return dong.slice(dau + 1, cuoi).join("\n");
}

/**
 * Chạy khối đó với `mc` giả.
 * @param mcOut   những gì `mc ls` in ra stdout
 * @param mcRc    mã thoát của `mc ls`
 * @param soFile  số file có sẵn trong thư mục gương
 */
function chay({ mcOut = "", mcRc = 0, soFile = 0 }) {
  const thuMuc = mkdtempSync(path.join(tmpdir(), "hq3-obj-"));
  const guong = path.join(thuMuc, "objects");
  mkdirSync(guong, { recursive: true });
  for (let i = 0; i < soFile; i++) writeFileSync(path.join(guong, `f${i}`), "x");

  const kichBan = `set -uo pipefail
BUCKET="quanly"
MIRROR_DIR=${JSON.stringify(guong)}
alert() { echo "ALERT:$1"; }
mc() { printf '%b' ${JSON.stringify(mcOut)}; return ${mcRc}; }  # %b để \\n trong chuỗi JSON thành xuống dòng thật
${trichBuoc2()}
echo "DI_TIEP"
`;
  const f = path.join(thuMuc, "buoc2.sh");
  writeFileSync(f, kichBan);
  // spawnSync chứ không phải execFileSync: cần stderr CẢ KHI script thoát 0 — chính ở nhánh "thành
  // công" mới lộ ra thông báo "integer expression expected" của phép so sánh hỏng.
  const r = spawnSync("bash", [f], { encoding: "utf8" });
  return { rc: r.status, out: String(r.stdout || ""), err: String(r.stderr || "") };
}

describe("backup-objects.sh bước [2/5] — đối chiếu số lượng object", () => {
  it("`mc ls` HỎNG thì phải cảnh báo và DỪNG, không được đi tiếp báo OK", () => {
    const r = chay({ mcOut: "", mcRc: 1, soFile: 0 });
    expect(r.out, "script vẫn chạy tiếp sau khi mc ls hỏng").not.toContain("DI_TIEP");
    expect(r.out).toContain("ALERT:");
    expect(r.rc).toBe(1);
  });

  it("bản gương THIẾU object thì cảnh báo và DỪNG", () => {
    const r = chay({ mcOut: "a\nb\nc\n", mcRc: 0, soFile: 1 });
    expect(r.out).toContain("ALERT:");
    expect(r.out).not.toContain("DI_TIEP");
    expect(r.rc).toBe(1);
  });

  it("bucket RỖNG là hợp lệ: đi tiếp, và KHÔNG được có lỗi so sánh số nguyên nào", () => {
    const r = chay({ mcOut: "", mcRc: 0, soFile: 0 });
    expect(r.out).toContain("DI_TIEP");
    expect(r.out).not.toContain("ALERT:");
    expect(r.err).not.toMatch(/integer expression expected/);
  });

  it("bản gương ĐỦ object thì đi tiếp bình thường", () => {
    const r = chay({ mcOut: "a\nb\n", mcRc: 0, soFile: 2 });
    expect(r.out).toContain("DI_TIEP");
    expect(r.out).not.toContain("ALERT:");
  });
});
