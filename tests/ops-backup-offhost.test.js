/**
 * ============================================================================
 * OPS · INFRA-01 / DOC-01 — bước OFF-HOST của bộ sao lưu không được IM LẶNG.
 *
 * LỖI (đo trên production 2026-09-22)
 *   /etc/quanly-backup.env không có NAS_*, và backup-db.sh chỉ có MỘT nhánh
 *   `if [ -n NAS_SHARE ] && [ -n NAS_USER ]` không có `else`: bỏ qua off-host mà không in một chữ,
 *   vẫn "✓ backup OK". Mọi bản dump + toàn bộ kho chứng từ nằm trên cùng một máy, và không tín hiệu
 *   nào nói ra điều đó. Đường off-host DUY NHẤT là NAS trong LAN, bản thô.
 *
 * HÀNH VI ĐÚNG (chủ repo chốt 2026-09-23)
 *   · CHƯA cấu hình đích ngoài → job vẫn exit 0, KHÔNG gửi Telegram mỗi đêm, nhưng in cảnh báo
 *     OFFHOST-CHUA-CAU-HINH vào log và ghi `backup_offhost_configured{scope="host"} 0` vào tệp trạng
 *     thái (app phơi ra /metrics để dashboard thấy).
 *   · Đích rclone PHẢI là remote kiểu crypt — không thì TỪ CHỐI đẩy bản thô, cảnh báo, exit ≠ 0.
 *   · Đã cấu hình mà đẩy hỏng → cảnh báo + exit ≠ 0, NHƯNG bản local vẫn được đánh dấu thành công.
 *   · Watchdog chỉ coi off-host là sự cố khi ĐÃ cấu hình.
 *
 * CÁCH KIỂM: chạy THẬT script với `docker` và `curl` giả trên PATH (cùng khuôn với
 * tests/b7-backup-nas-secret.test.js) — không grep chuỗi mã nguồn.
 * ============================================================================
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apDungTrangThaiSaoLuu, backupLastSuccess, backupOffhostConfigured } from "../src/observability.js";

const ROOT = join(import.meta.dirname, "..");

const STUB_DOCKER = `#!/usr/bin/env bash
n=$(cat "$STUB_DIR/counter" 2>/dev/null || echo 0); n=$((n+1)); printf '%s' "$n" > "$STUB_DIR/counter"
printf '%s\\0' "$@" > "$STUB_DIR/call-$n.argv"
case "$1" in
  inspect) case "$*" in *quanly-minio*) echo quanly_internal;; esac; exit 0;;
  exec)
    case "$*" in
      *"printenv POSTGRES_USER"*) echo quanly; exit 0;;
      *"printenv POSTGRES_DB"*)   echo quanly; exit 0;;
      *pg_dump*) head -c 200000 /dev/urandom | base64; exit 0;;
      *"quanly-app printenv S3_ENDPOINT"*)   echo "http://minio:9000"; exit 0;;
      *"quanly-app printenv S3_ACCESS_KEY"*) echo "ak-tu-app"; exit 0;;
      *"quanly-app printenv S3_SECRET_KEY"*) echo "sk-tu-app"; exit 0;;
      *"quanly-app printenv"*) exit 1;;
    esac
    exit 0;;
  run)
    case "$*" in
      *rclone*listremotes*) printf '%b' "\${STUB_RCLONE_REMOTES:-}"; exit 0;;
      *rclone*copyto*|*rclone*" copy "*) exit "\${STUB_RCLONE_COPY_RC:-0}";;
      *rclone*cryptcheck*) exit 0;;
      *"version info"*) exit 1;;
    esac
    cat >/dev/null 2>&1; exit 0;;
esac
exit 0
`;

const STUB_CURL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/curl.log"
exit 0
`;

const rac = [];
afterEach(() => {
  while (rac.length) rmSync(rac.pop(), { recursive: true, force: true });
});

function chuanBi() {
  const dir = mkdtempSync(join(tmpdir(), "ops-offhost-"));
  rac.push(dir);
  const bin = join(dir, "bin");
  const stub = join(dir, "stub");
  const backups = join(dir, "backups");
  const status = join(dir, "status");
  for (const d of [bin, stub, backups]) mkdirSync(d);
  writeFileSync(join(bin, "docker"), STUB_DOCKER);
  writeFileSync(join(bin, "curl"), STUB_CURL);
  chmodSync(join(bin, "docker"), 0o755);
  chmodSync(join(bin, "curl"), 0o755);
  const rcloneConf = join(dir, "rclone.conf");
  writeFileSync(rcloneConf, "[quanly-offsite]\ntype = crypt\n");
  return { dir, bin, stub, backups, status, rcloneConf };
}

function chay(script, sb, themEnv = {}) {
  const env = {
    ...process.env,
    PATH: `${sb.bin}:${process.env.PATH}`,
    STUB_DIR: sb.stub,
    BACKUP_DIR: sb.backups,
    BACKUP_STATUS_DIR: sb.status,
    PG_CONTAINER: "quanly-postgres",
    TELEGRAM_BOT_TOKEN: "tok",
    TELEGRAM_ALERT_CHAT: "chat",
    ...themEnv,
  };
  // Không để biến off-host của máy chạy test lọt vào.
  for (const k of ["NAS_SHARE", "NAS_USER", "NAS_PASS", "OFFHOST_RCLONE_REMOTE", "S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"]) {
    if (!(k in themEnv)) delete env[k];
  }
  const r = spawnSync("bash", [join(ROOT, script)], { env, encoding: "utf8" });
  const curl = existsSync(join(sb.stub, "curl.log")) ? readFileSync(join(sb.stub, "curl.log"), "utf8") : "";
  return { rc: r.status, out: String(r.stdout || ""), err: String(r.stderr || ""), curl };
}

const trangThai = (sb) => readFileSync(join(sb.status, "quanly_backup.prom"), "utf8");

function cacLuotDockerRun(stubDir) {
  return readdirSync(stubDir)
    .filter((f) => f.endsWith(".argv"))
    .map((f) => readFileSync(join(stubDir, f), "utf8").split("\0").slice(0, -1))
    .filter((a) => a[0] === "run");
}

describe("backup-db.sh — off-host", () => {
  it("CHƯA cấu hình: exit 0, cảnh báo OFFHOST-CHUA-CAU-HINH vào log, KHÔNG gửi Telegram, metric = 0", () => {
    const sb = chuanBi();
    const r = chay("scripts/backup/backup-db.sh", sb);
    expect(r.rc, r.err).toBe(0);
    expect(r.err, "thiếu off-host mà script im lặng — đúng lỗi audit đo được trên production").toContain("OFFHOST-CHUA-CAU-HINH");
    expect(r.curl, "không được spam Telegram mỗi đêm cho chuyện đã biết").toBe("");
    expect(existsSync(join(sb.backups, ".db-last-success"))).toBe(true);
    expect(existsSync(join(sb.backups, ".offhost-db-last-success"))).toBe(false);
    const t = trangThai(sb);
    expect(t).toMatch(/^backup_offhost_configured\{scope="host"\} 0$/m);
    expect(t).toMatch(/^backup_last_success_timestamp_seconds\{kind="db"\} [1-9]\d+$/m);
    expect(t).toMatch(/^backup_last_success_timestamp_seconds\{kind="offhost_db"\} 0$/m);
  });

  it("rclone remote kiểu crypt: đẩy + đối chiếu, ghi dấu off-host, metric = 1, cấu hình mount read-only", () => {
    const sb = chuanBi();
    const r = chay("scripts/backup/backup-db.sh", sb, {
      OFFHOST_RCLONE_REMOTE: "quanly-offsite:",
      OFFHOST_RCLONE_CONFIG: sb.rcloneConf,
      STUB_RCLONE_REMOTES: "goc:            s3\\nquanly-offsite: crypt\\n",
    });
    expect(r.rc, r.err).toBe(0);
    expect(r.err).not.toContain("OFFHOST-CHUA-CAU-HINH");
    expect(existsSync(join(sb.backups, ".offhost-db-last-success"))).toBe(true);
    expect(trangThai(sb)).toMatch(/^backup_offhost_configured\{scope="host"\} 1$/m);
    const rclone = cacLuotDockerRun(sb.stub).filter((a) => a.some((x) => x.includes("rclone/rclone")));
    const lenh = rclone.map((a) => a[a.indexOf("--config") + 2]);
    expect(lenh).toEqual(expect.arrayContaining(["listremotes", "copyto", "cryptcheck"]));
    for (const a of rclone) {
      expect(a.join(" ")).toContain(":/cfg/rclone.conf:ro");
      expect(a.some((x) => x === "-e" || x.startsWith("--env")), "bí mật rclone không được đi qua -e").toBe(false);
      expect(a.join(" ")).toMatch(/rclone\/rclone:[\d.]+@sha256:[0-9a-f]{64}/);
    }
  });

  it("remote KHÔNG phải crypt: từ chối đẩy bản thô, cảnh báo Telegram, exit ≠ 0 — nhưng bản local vẫn được đánh dấu", () => {
    const sb = chuanBi();
    const r = chay("scripts/backup/backup-db.sh", sb, {
      OFFHOST_RCLONE_REMOTE: "quanly-offsite:",
      OFFHOST_RCLONE_CONFIG: sb.rcloneConf,
      STUB_RCLONE_REMOTES: "quanly-offsite: s3\\n",
    });
    expect(r.rc).not.toBe(0);
    expect(r.err).toMatch(/không phải kiểu crypt/);
    expect(r.curl).toContain("sendMessage");
    const rclone = cacLuotDockerRun(sb.stub).filter((a) => a.some((x) => x.includes("rclone/rclone")));
    expect(rclone.some((a) => a.includes("copyto")), "đã đẩy dump THÔ lên remote không mã hoá").toBe(false);
    expect(existsSync(join(sb.backups, ".offhost-db-last-success"))).toBe(false);
    expect(existsSync(join(sb.backups, ".db-last-success")), "hỏng off-host không được xoá dấu backup local").toBe(true);
  });

  it("đã cấu hình mà đẩy HỎNG: cảnh báo + exit ≠ 0, không ghi dấu off-host", () => {
    const sb = chuanBi();
    const r = chay("scripts/backup/backup-db.sh", sb, {
      OFFHOST_RCLONE_REMOTE: "quanly-offsite:",
      OFFHOST_RCLONE_CONFIG: sb.rcloneConf,
      STUB_RCLONE_REMOTES: "quanly-offsite: crypt\\n",
      STUB_RCLONE_COPY_RC: "1",
    });
    expect(r.rc).not.toBe(0);
    expect(r.curl).toContain("sendMessage");
    expect(existsSync(join(sb.backups, ".offhost-db-last-success"))).toBe(false);
    expect(existsSync(join(sb.backups, ".db-last-success"))).toBe(true);
  });
});

describe("backup-objects.sh — kho object", () => {
  it("S3_* không có trong tệp env: đọc từ container app rồi sao lưu, không thoát sớm", () => {
    const sb = chuanBi();
    const r = chay("scripts/backup/backup-objects.sh", sb);
    expect(r.rc, r.err + r.out).toBe(0);
    expect(r.err).not.toMatch(/thiếu S3_ENDPOINT/);
    expect(r.err).toContain("OFFHOST-CHUA-CAU-HINH");
    expect(r.curl).toBe("");
    const mc = cacLuotDockerRun(sb.stub).filter((a) => a.some((x) => x.includes("minio/mc")));
    expect(mc.length).toBeGreaterThan(0);
    for (const a of mc) expect(a.join(" "), "ảnh mc phải kéo từ quay.io theo digest (Docker Hub đã gỡ)").toMatch(/quay\.io\/minio\/mc:[^@\s]+@sha256:[0-9a-f]{64}/);
    expect(trangThai(sb)).toMatch(/^backup_last_success_timestamp_seconds\{kind="objects"\} [1-9]\d+$/m);
  });
});

describe("backup-watchdog.sh — off-host", () => {
  function tuoi(sb) {
    const now = String(Math.floor(Date.now() / 1000));
    for (const k of ["db", "objects", "drill"]) writeFileSync(join(sb.backups, `.${k}-last-success`), now);
  }

  it("CHƯA cấu hình: không coi là sự cố (exit 0, không Telegram) nhưng vẫn nói ra", () => {
    const sb = chuanBi();
    tuoi(sb);
    const r = chay("scripts/backup/backup-watchdog.sh", sb);
    expect(r.rc, r.err).toBe(0);
    expect(r.curl).toBe("");
    expect(r.out + r.err).toMatch(/off-host: CHƯA cấu hình/);
    expect(trangThai(sb)).toMatch(/^backup_offhost_configured\{scope="host"\} 0$/m);
  });

  it("ĐÃ cấu hình mà chưa từng đẩy được: sự cố → Telegram + exit 1", () => {
    const sb = chuanBi();
    tuoi(sb);
    const r = chay("scripts/backup/backup-watchdog.sh", sb, { OFFHOST_RCLONE_REMOTE: "quanly-offsite:" });
    expect(r.rc).toBe(1);
    expect(r.curl).toContain("sendMessage");
    expect(r.err).toMatch(/OFF-HOST \(db\)/);
  });
});

describe("apDungTrangThaiSaoLuu — app phơi tệp trạng thái ra /metrics", () => {
  it("chỉ nhận đúng dạng và đúng tập kind; thiếu tệp thì KHÔNG có chuỗi nào", async () => {
    apDungTrangThaiSaoLuu([
      'backup_last_success_timestamp_seconds{kind="db"} 1790000000',
      'backup_last_success_timestamp_seconds{kind="la-hoac"} 5',
      'backup_last_success_timestamp_seconds{kind="objects"} 0',
      'backup_offhost_configured{scope="host"} 0',
      "rac vo nghia",
    ].join("\n"));
    const ls = (await backupLastSuccess.get()).values.map((v) => [v.labels.kind, v.value]);
    expect(ls).toEqual([["db", 1790000000], ["objects", 0]]);
    expect((await backupOffhostConfigured.get()).values.map((v) => v.value)).toEqual([0]);

    apDungTrangThaiSaoLuu(null);
    expect((await backupLastSuccess.get()).values).toEqual([]);
    expect((await backupOffhostConfigured.get()).values, "thiếu tệp mà vẫn phát 0 = báo 'chưa cấu hình' bịa").toEqual([]);
  });
});
