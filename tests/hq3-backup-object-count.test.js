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
 *
 * ĐÃ ĐỔI MÔ HÌNH so với bản đầu: trước đây `mc` giả in ra những dòng trần ("a\nb\nc") và thư mục
 * gương chứa file tên f0/f1/… — hai bên KHÔNG liên quan gì tới nhau, nên chỉ so được SỐ ĐẾM. Cổng
 * thật nay so THÀNH VIÊN (xem chú thích trong script), nên `mc` giả phải in đúng dạng `--json` mà
 * script gọi, và bản gương phải chứa đúng những KHOÁ đó.
 *
 * @param khoaBucket  khoá object ĐANG CÓ trong bucket
 * @param khoaGuong   khoá có mặt trong thư mục gương (mặc định = giống bucket)
 * @param mcRc        mã thoát của `mc ls`
 */
function chay({ khoaBucket = [], khoaGuong = null, mcRc = 0 }) {
  const thuMuc = mkdtempSync(path.join(tmpdir(), "hq3-obj-"));
  const guong = path.join(thuMuc, "objects");
  mkdirSync(guong, { recursive: true });
  for (const k of (khoaGuong ?? khoaBucket)) {
    const f = path.join(guong, k);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, "x");
  }
  // Đúng dạng `mc ls --recursive --json` thật: mỗi dòng một object, khoá nằm ở trường "key".
  const mcOut = khoaBucket.map((k) => JSON.stringify({ status: "success", type: "file", size: 1, key: k })).join("\n") + (khoaBucket.length ? "\n" : "");

  const kichBan = `set -uo pipefail
BUCKET="quanly"
MIRROR_DIR=${JSON.stringify(guong)}
alert() { echo "ALERT:$1"; }
mc() { printf '%b' ${JSON.stringify(mcOut)}; return ${mcRc}; }
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

describe("backup-objects.sh bước [2/5] — đối chiếu bucket ↔ bản gương", () => {
  it("`mc ls` HỎNG thì phải cảnh báo và DỪNG, không được đi tiếp báo OK", () => {
    const r = chay({ khoaBucket: [], mcRc: 1 });
    expect(r.out, "script vẫn chạy tiếp sau khi mc ls hỏng").not.toContain("DI_TIEP");
    expect(r.out).toContain("ALERT:");
    expect(r.rc).toBe(1);
  });

  it("bản gương THIẾU object thì cảnh báo và DỪNG", () => {
    const r = chay({ khoaBucket: ["uploads/a.png", "uploads/b.png", "exports/c.xlsx"], khoaGuong: ["uploads/a.png"] });
    expect(r.out).toContain("ALERT:");
    expect(r.out).not.toContain("DI_TIEP");
    expect(r.rc).toBe(1);
  });

  it("bucket RỖNG là hợp lệ: đi tiếp, và KHÔNG được có lỗi so sánh số nguyên nào", () => {
    const r = chay({ khoaBucket: [] });
    expect(r.out).toContain("DI_TIEP");
    expect(r.out).not.toContain("ALERT:");
    expect(r.err).not.toMatch(/integer expression expected/);
  });

  it("bản gương ĐỦ object thì đi tiếp bình thường", () => {
    const r = chay({ khoaBucket: ["uploads/a.png", "payment-proofs/p1/x.png"] });
    expect(r.out).toContain("DI_TIEP");
    expect(r.out).not.toContain("ALERT:");
  });

  // ── CA QUYẾT ĐỊNH: GƯƠNG CỘNG DỒN ─────────────────────────────────────────
  // Bước [1/5] gương CỘNG DỒN (`mc mirror` không `--remove`, cố ý). Nên sau khi retention bắt đầu
  // xoá object khỏi bucket, số tệp trong gương LỚN HƠN số object trong bucket — vĩnh viễn.
  // Cổng so SỐ ĐẾM (`[ "$LOCAL_N" -lt "$REMOTE_N" ]`) khi đó KHÔNG BAO GIỜ đúng nữa: bản gương
  // thiếu bao nhiêu cũng được, nó vẫn báo OK. Đây chính là ca mà bản trước cho đi lọt.
  it("gương CỘNG DỒN (nhiều tệp hơn bucket) mà VẪN thiếu một object → phải cảnh báo", () => {
    const r = chay({
      khoaBucket: ["uploads/moi-1.png", "uploads/moi-2.png"],
      // Gương giữ 3 tệp cũ đã bị retention xoá khỏi bucket, và CÓ 1 trong 2 tệp mới → LOCAL_N (4) > REMOTE_N (2).
      khoaGuong: ["exports/cu-1.xlsx", "exports/cu-2.xlsx", "exports/cu-3.xlsx", "uploads/moi-1.png"],
    });
    expect(r.out, "cổng so SỐ ĐẾM đã cho lọt: gương thiếu uploads/moi-2.png mà vẫn báo OK").toContain("ALERT:");
    expect(r.out).not.toContain("DI_TIEP");
    expect(r.rc).toBe(1);
  });

  it("cảnh báo phải NÊU TÊN object thiếu, không chỉ nói một con số", () => {
    const r = chay({ khoaBucket: ["payment-proofs/p9/chung-tu.png"], khoaGuong: [] });
    expect(r.out).toContain("payment-proofs/p9/chung-tu.png");
  });

  it("gương cộng dồn ĐỦ object của bucket → đi tiếp, không báo động giả", () => {
    const r = chay({
      khoaBucket: ["uploads/a.png"],
      khoaGuong: ["uploads/a.png", "exports/da-bi-retention-xoa.xlsx"],
    });
    expect(r.out).toContain("DI_TIEP");
    expect(r.out).not.toContain("ALERT:");
  });
});
