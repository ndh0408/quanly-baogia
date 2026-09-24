/**
 * ============================================================================
 * OPS · backup-objects.sh — chốt chỗ trống đĩa TÍNH THEO CỠ PHẦN SẮP CHÉP. Soát chéo ops#4 (P2).
 *
 * LỖI (đọc mã ở 9bc2cf7)
 *   INFRA-01 cho job tự đọc khoá S3 từ quanly-app, và install-backup.sh nay luôn chạy nó lúc cài →
 *   lượt đầu `mc mirror` chép TOÀN BỘ bucket xuống /opt/quanly-backups/objects, CÙNG đĩa với pgdata và
 *   miniodata. Chốt duy nhất là "còn ≥ 500MB lúc bắt đầu". Bucket 6GB mà đĩa còn 4GB: mirror ghi tới
 *   khi đầy đĩa → Postgres không ghi được WAL → app 5xx. (`mc` chạy bằng root nên còn lấn được vào 5%
 *   dự trữ của ext4 mà Postgres không dùng được.) backup-db.sh có tính NEED = 2× cỡ dump; kho object
 *   thì không.
 *
 * HÀNH VI ĐÚNG
 *   Trước khi mirror: liệt kê bucket, cộng cỡ các object CHƯA có trong bản gương (đúng cho cả lượt
 *   đầu lẫn lượt đêm), đòi chỗ trống ≥ phần đó + OBJ_DISK_RESERVE_MB (mặc định 1024). Không đủ → alert
 *   + exit 1, KHÔNG mirror. Không có gì mới để chép thì giữ sàn cũ 500MB (không báo động giả).
 *
 * CÁCH KIỂM: cắt NGUYÊN khối chốt đĩa trong script thật rồi chạy với `mc`/`df` giả (cùng kỹ thuật
 * tests/hq3-backup-object-count.test.js).
 * ============================================================================
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve("scripts/backup/backup-objects.sh");
const SRC = readFileSync(SCRIPT, "utf8");
const MB = 1024 * 1024;

function trichKhoi() {
  const dong = SRC.split("\n");
  const dau = dong.findIndex((l) => l.includes("CHỖ TRỐNG ĐĨA (soát chéo ops#4)"));
  const cuoi = dong.findIndex((l) => l.includes('echo "▶ [0/5]'));
  expect(dau, "không tìm thấy khối chốt chỗ trống đĩa (ops#4) trong backup-objects.sh").toBeGreaterThan(-1);
  expect(cuoi).toBeGreaterThan(dau);
  return dong.slice(dau, cuoi).join("\n");
}

const rac = [];
afterEach(() => {
  while (rac.length) rmSync(rac.pop(), { recursive: true, force: true });
});

/**
 * @param bucket   [{key, size}] object đang có trong bucket
 * @param guong    khoá đã có trong bản gương
 * @param availMb  cột Available của df (MB)
 */
function chay({ bucket = [], guong = [], availMb, mcRc = 0, env = "" }) {
  const dir = mkdtempSync(path.join(tmpdir(), "ops-obj-dia-"));
  rac.push(dir);
  const mirror = path.join(dir, "objects");
  mkdirSync(mirror, { recursive: true });
  for (const k of guong) {
    mkdirSync(path.dirname(path.join(mirror, k)), { recursive: true });
    writeFileSync(path.join(mirror, k), "x");
  }
  const mcOut = bucket.map(({ key, size }) => JSON.stringify({ status: "success", type: "file", lastModified: "2026-09-24T00:00:00Z", size, key, etag: "e" })).join("\n") + (bucket.length ? "\n" : "");
  const kichBan = `set -uo pipefail
BUCKET="quanly"
BACKUP_DIR=${JSON.stringify(dir.replace(/\\/g, "/"))}
MIRROR_DIR=${JSON.stringify(mirror.replace(/\\/g, "/"))}
${env}
alert() { echo "ALERT:$1"; }
mc() { printf '%b' ${JSON.stringify(mcOut)}; return ${mcRc}; }
df() { printf 'Filesystem 1048576-blocks Used Available Capacity Mounted on\\n/dev/sda1 100000 1 ${availMb} 50%% /\\n'; }
${trichKhoi()}
echo "DI_TIEP"
`;
  const f = path.join(dir, "khoi.sh");
  writeFileSync(f, kichBan);
  const r = spawnSync("bash", [f], { encoding: "utf8" });
  return { rc: r.status, out: String(r.stdout || ""), err: String(r.stderr || "") };
}

describe("ops#4 — backup-objects.sh không được mirror khi đĩa không đủ chỗ cho phần sắp chép", () => {
  it("lượt đầu: bucket 3000MB, đĩa còn 2000MB → alert + DỪNG, không mirror", () => {
    const r = chay({ bucket: [{ key: "exports/a.xlsx", size: 3000 * MB }], availMb: 2000 });
    expect(r.out, "mirror sẽ làm đầy đĩa chung với Postgres").not.toContain("DI_TIEP");
    expect(r.rc).not.toBe(0);
    expect(r.out).toMatch(/ALERT:.*3000MB/);
  });

  it("lượt đêm: bucket lớn nhưng gương đã có gần hết, phần mới nhỏ → đi tiếp", () => {
    const r = chay({
      bucket: [{ key: "exports/cu.xlsx", size: 3000 * MB }, { key: "uploads/moi.jpg", size: 10 * MB }],
      guong: ["exports/cu.xlsx"],
      availMb: 2000,
    });
    expect(r.out, r.out + r.err).toContain("DI_TIEP");
    expect(r.out).not.toContain("ALERT");
  });

  it("phần mới + dự trữ vượt chỗ trống → dừng (dự trữ mặc định 1024MB)", () => {
    const r = chay({ bucket: [{ key: "uploads/moi.jpg", size: 1500 * MB }], availMb: 2000 });
    expect(r.out).not.toContain("DI_TIEP");
    const noi = chay({ bucket: [{ key: "uploads/moi.jpg", size: 1500 * MB }], availMb: 2000, env: "OBJ_DISK_RESERVE_MB=200" });
    expect(noi.out, "OBJ_DISK_RESERVE_MB phải chỉnh được").toContain("DI_TIEP");
  });

  it("không có gì mới để chép: giữ sàn cũ 500MB — 600MB thì đi tiếp, 400MB thì dừng", () => {
    expect(chay({ bucket: [], availMb: 600 }).out).toContain("DI_TIEP");
    expect(chay({ bucket: [{ key: "a", size: 5 }], guong: ["a"], availMb: 600 }).out).toContain("DI_TIEP");
    const r = chay({ bucket: [], availMb: 400 });
    expect(r.out).not.toContain("DI_TIEP");
    expect(r.out).toMatch(/ALERT:/);
  });

  it("`mc ls` hỏng → alert + DỪNG (không đo được thì không đoán)", () => {
    const r = chay({ bucket: [], availMb: 90000, mcRc: 1 });
    expect(r.out).not.toContain("DI_TIEP");
    expect(r.out).toMatch(/ALERT:/);
  });

  it("khối chốt đứng TRƯỚC `mc mirror`, và chốt cũ chỉ-500MB không còn là chốt duy nhất", () => {
    expect(SRC.indexOf("CHỖ TRỐNG ĐĨA (soát chéo ops#4)")).toBeLessThan(SRC.indexOf("mc mirror --quiet"));
    expect(SRC).not.toMatch(/if \[ "\$\{AVAIL_MB:-0\}" -lt 500 \]; then/);
  });
});
