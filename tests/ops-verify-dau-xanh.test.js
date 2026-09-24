/**
 * ============================================================================
 * OPS · verify-local.sh — DẤU XANH chỉ ghi khi cổng thật sự CHẠY ĐỦ, trên ĐÚNG commit.
 * Soát chéo ops#3 (P2) và ops#5 (P3), đợt 2026-09-24.
 *
 * LỖI ops#3 (đọc mã ở 9bc2cf7)
 *   Docker Desktop tắt → [11/13] in vàng "bỏ qua smoke image" mà không đặt do=1; [13/13]
 *   security-scan.sh tự lùi về SBOM (bỏ gitleaks/trivy/semgrep) rồi thoát 0; [12/13] thiếu playwright
 *   cũng bỏ vàng. Cuối lượt vẫn "✅ TẤT CẢ CỔNG XANH" và ghi ok-<sha> → `deploy.sh prod` nhận dấu mà
 *   không cần DEPLOY_KHAN_CAP, trái chính giao kèo ở chú thích ("chạy ĐỦ … smoke image, smoke UI,
 *   quét bảo mật").
 *
 * LỖI ops#5
 *   Dấu gắn với HEAD + trạng thái cây ở CUỐI lượt: verify bắt đầu ở A, giữa chừng ai đó commit B (hoặc
 *   cây bẩn lúc đầu rồi bị stash) → cuối lượt cây sạch → ghi ok-B, dù B chưa từng qua đủ 13 bước.
 *
 * CÁCH KIỂM: cắt NGUYÊN khối cuối của verify-local.sh (từ `if [ "$do" -eq 0 ]` tới `exit "$do"`) và
 * chạy nó THẬT trong một repo git tạm với trạng thái đặt trước — tức kiểm chính mã quyết định ghi dấu,
 * không chép lại logic. Kèm vài chốt tĩnh cho các nhánh bỏ qua (không dựng lại 13 bước được).
 * ============================================================================
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = readFileSync(join(ROOT, "scripts/verify-local.sh"), "utf8");
const code = SRC.replace(/^\s*#.*$/gm, "");

function khoiCuoi() {
  const i = SRC.lastIndexOf('\nif [ "$do" -eq 0 ]; then');
  const j = SRC.lastIndexOf('exit "$do"');
  expect(i, "không tìm thấy khối ghi dấu xanh ở cuối verify-local.sh").toBeGreaterThan(0);
  return SRC.slice(i, j + 'exit "$do"'.length);
}

const rac = [];
afterEach(() => {
  while (rac.length) rmSync(rac.pop(), { recursive: true, force: true });
});

const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8" });

function repoTam() {
  const dir = mkdtempSync(join(tmpdir(), "ops-verify-dau-"));
  rac.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "a.txt"), "1\n");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-q", "-m", "A");
  return dir;
}

/** Chạy khối cuối với trạng thái đặt trước; `truoc` là bash chạy SAU khi chụp trạng thái lúc đầu. */
function chayKhoiCuoi(dir, { boQua = [], truoc = "", banDau = null } = {}) {
  const dau = join(dir, "dau");
  const mang = boQua.map((x) => `'${x}'`).join(" ");
  const prelude = [
    "set -uo pipefail",
    "do=0; NHANH=0",
    `BO_QUA=(${mang})`,
    'SHA_DAU="$(git rev-parse HEAD 2>/dev/null)"',
    banDau === null ? 'BAN_DAU="$(git status --porcelain 2>/dev/null)"' : `BAN_DAU='${banDau}'`,
    truoc,
  ].join("\n");
  const r = spawnSync("bash", ["-c", `${prelude}\n${khoiCuoi()}`], {
    cwd: dir,
    env: { ...process.env, QUANLY_VERIFY_DIR: dau },
    encoding: "utf8",
  });
  const dauXanh = existsSync(dau) ? readdirSync(dau).filter((f) => f.startsWith("ok-")) : [];
  return { rc: r.status, out: `${r.stdout}${r.stderr}`, dauXanh };
}

describe("ops#3 — bước bị BỎ QUA (docker/playwright không có) thì KHÔNG ghi dấu xanh", () => {
  it("chuẩn: đủ cổng, cây sạch, HEAD không đổi → ghi ok-<sha đầu lượt>", () => {
    const dir = repoTam();
    const sha = git(dir, "rev-parse", "HEAD").stdout.trim();
    const r = chayKhoiCuoi(dir);
    expect(r.rc, r.out).toBe(0);
    expect(r.dauXanh).toEqual([`ok-${sha}`]);
  });

  it("có bước bị bỏ qua → KHÔNG có tệp ok-*, và nói rõ bước nào chưa chạy", () => {
    const dir = repoTam();
    const r = chayKhoiCuoi(dir, { boQua: ["[11] smoke image — docker không chạy"] });
    expect(r.dauXanh, "docker tắt mà vẫn ghi dấu xanh → deploy.sh prod nhận commit chưa qua smoke image/quét bảo mật").toEqual([]);
    expect(r.out).toMatch(/KHÔNG ghi dấu xanh/);
    expect(r.out).toMatch(/\[11\] smoke image/);
  });

  it("[11] không có docker và [12] không có playwright đều ghi vào BO_QUA", () => {
    const s11 = code.slice(code.indexOf('buoc "[11/13]'), code.indexOf('buoc "[11/13] Bỏ qua'));
    expect(s11).toMatch(/else[\s\S]*BO_QUA\+=\(/);
    const s12 = code.slice(code.indexOf('buoc "[12/13]'), code.indexOf('buoc "[12/13] Bỏ qua'));
    expect(s12).toMatch(/else[\s\S]*BO_QUA\+=\(/);
  });

  it("[13] ghi BO_QUA khi docker không chạy (security-scan.sh tự lùi về chỉ SBOM mà vẫn thoát 0)", () => {
    const s13 = code.slice(code.indexOf('buoc "[13/13]'), code.indexOf("bash scripts/ci/security-scan.sh"));
    expect(s13).toMatch(/docker info[\s\S]*BO_QUA\+=\(/);
  });
});

describe("ops#5 — dấu xanh gắn với commit và cây LÚC BẮT ĐẦU", () => {
  it("HEAD đổi giữa lượt (A → B) → KHÔNG ghi dấu cho B (cũng không cho A)", () => {
    const dir = repoTam();
    const r = chayKhoiCuoi(dir, {
      truoc: `echo 2 > a.txt; git commit -qam B`,
    });
    expect(r.dauXanh, "B chưa từng qua đủ các bước").toEqual([]);
    expect(r.out).toMatch(/HEAD đổi/);
  });

  it("cây BẨN lúc bắt đầu rồi bị stash giữa chừng → KHÔNG ghi dấu", () => {
    const dir = repoTam();
    writeFileSync(join(dir, "a.txt"), "ban\n");
    const r = chayKhoiCuoi(dir, { truoc: "git stash -q" });
    expect(r.dauXanh, "các bước đầu đã kiểm A + thay đổi chưa commit, không phải thứ git archive A ship").toEqual([]);
    expect(r.out).toMatch(/BẨN lúc bắt đầu/);
  });

  it("SHA_DAU / BAN_DAU được chụp TRƯỚC bước đầu tiên", () => {
    const iSha = code.indexOf('SHA_DAU="$(git rev-parse HEAD');
    const iBan = code.indexOf('BAN_DAU="$(git status --porcelain');
    const iBuoc = code.indexOf('buoc "[0/13]');
    expect(iSha).toBeGreaterThan(0);
    expect(iBan).toBeGreaterThan(0);
    expect(iSha).toBeLessThan(iBuoc);
    expect(iBan).toBeLessThan(iBuoc);
  });
});
