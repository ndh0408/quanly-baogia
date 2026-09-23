/**
 * ============================================================================
 * OPS · restore-drill.sh — soát chéo ops#1 (P1) và ops#2 (P2), đợt 2026-09-24.
 *
 * LỖI ops#1 (đọc mã ở 9bc2cf7)
 *   HTTP-12 thêm `src/server.ts:25`: NODE_ENV=production mà thiếu TRUST_PROXY thì process.exit(1).
 *   Cùng đợt đã vá smoke-dist.sh / smoke-image.sh / ci.yml, nhưng KHÔNG vá restore-drill.sh: khối
 *   ENVFILE dựng container smoke ở bước [7/7] không có TRUST_PROXY. Drill lấy IMAGE từ container app
 *   đang chạy, nên chỉ cần image mới lên prod là bước [7/7] hỏng CHẮC CHẮN mỗi Chủ nhật → Telegram,
 *   exit 1, `.drill-last-success` không bao giờ được ghi → watchdog báo mỗi 6h, mãi mãi.
 *
 * LỖI ops#2
 *   Mẫu /etc/quanly-backup.env (INFRA-01) bảo "để TRỐNG S3_* thì script tự đọc từ quanly-app", nhưng
 *   chỉ backup-objects.sh làm vậy. restore-drill.sh chỉ đọc S3_* của tệp env → bước [4/7] và [6/7]
 *   alert "S3_* chưa cấu hình" → FAILED mỗi tuần, dù TRUST_PROXY đã vá. Vế phụ: install-backup.sh với
 *   INSTALL_SKIP_DRILL=1 chạy watchdog ngay khi drill "CHƯA TỪNG" → Telegram ngay lúc cài, rồi mỗi 6h
 *   tới Chủ nhật.
 *
 * CÁCH KIỂM: chạy THẬT restore-drill.sh / backup-watchdog.sh với `docker` và `curl` giả trên PATH
 * (cùng khuôn với tests/ops-backup-offhost.test.js). `docker run -d` giả BẮT CHƯỚC đúng chốt của
 * src/server.ts (NODE_ENV=production + thiếu TRUST_PROXY → container chết ngay) — và một bài riêng
 * khoá rằng chốt đó vẫn còn trong server.ts, để giả lập không trôi khỏi thực tế.
 * ============================================================================
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const STUB_DOCKER = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/docker.log"
case "$1" in
  inspect)
    case "$*" in
      *"{{.Config.Image}}"*) echo "quanly-app:prod"; exit 0;;
      *"{{.State.Running}}"*) cat "$STUB_DIR/smoke-running" 2>/dev/null || echo false; exit 0;;
      *Networks*) echo quanly_internal; exit 0;;
    esac
    exit 0;;
  exec)
    case "$*" in
      *"printenv POSTGRES_USER"*) echo quanly; exit 0;;
      *"printenv POSTGRES_DB"*) echo quanly; exit 0;;
      *"printenv POSTGRES_PASSWORD"*) echo pgpw; exit 0;;
      *"quanly-app printenv S3_ENDPOINT"*)   echo "http://minio:9000"; exit 0;;
      *"quanly-app printenv S3_ACCESS_KEY"*) echo "ak-tu-app"; exit 0;;
      *"quanly-app printenv S3_SECRET_KEY"*) echo "sk-tu-app"; exit 0;;
      *"quanly-app printenv S3_BUCKET"*)     echo "quanly"; exit 0;;
      *"quanly-app printenv"*) exit 1;;
      *pg_database_size*) echo 10; exit 0;;
      *"df -Pm"*) printf 'Filesystem 1M-blocks Used Available Capacity Mounted\\n/dev/x 100000 1000 90000 2%% /d\\n'; exit 0;;
      *'"User"'*) echo 3; exit 0;;
      *'"Quote"'*) echo 7; exit 0;;
      *"exec -i"*) cat >/dev/null; exit 0;;
      *smoke-cid*livez*|*smoke-cid*readyz*)
        [ "$(cat "$STUB_DIR/smoke-running" 2>/dev/null)" = true ] && exit 0 || exit 1;;
      *smoke-cid*node*) echo "status 401"; exit 0;;
    esac
    exit 0;;
  run)
    if [ "$2" = "-d" ]; then
      # Container smoke: chép lại env-file rồi BẮT CHƯỚC chốt HTTP-12 của src/server.ts.
      prev=""; ef=""
      for a in "$@"; do [ "$prev" = "--env-file" ] && ef="$a"; prev="$a"; done
      cp "$ef" "$STUB_DIR/smoke.env"
      if grep -q '^NODE_ENV=production$' "$ef" && ! grep -q '^TRUST_PROXY=.' "$ef"; then
        echo false > "$STUB_DIR/smoke-running"
      else
        echo true > "$STUB_DIR/smoke-running"
      fi
      echo smoke-cid; exit 0
    fi
    case "$*" in
      *" cat q/"*)
        k="\${@: -1}"; k="\${k#q/*/}"; cat "$BACKUP_DIR/objects/$k"; exit 0;;
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
  const dir = mkdtempSync(join(tmpdir(), "ops-drill-"));
  rac.push(dir);
  const bin = join(dir, "bin");
  const stub = join(dir, "stub");
  const backups = join(dir, "backups");
  const status = join(dir, "status");
  for (const d of [bin, stub, backups, join(backups, "objects", "proofs")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(bin, "docker"), STUB_DOCKER);
  writeFileSync(join(bin, "curl"), STUB_CURL);
  chmodSync(join(bin, "docker"), 0o755);
  chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(join(backups, "quanly-2026-09-24-020000.sql.gz"), gzipSync("SELECT 1;\n"));
  const noiDung = "chung-tu-mau";
  writeFileSync(join(backups, "objects", "proofs", "a.jpg"), noiDung);
  const sha = createHash("sha256").update(noiDung).digest("hex");
  writeFileSync(join(backups, "objects-manifest-2026-09-24-023000.tsv"), `proofs/a.jpg\t${noiDung.length}\t${sha}\n`);
  writeFileSync(join(backups, ".objects-last-success"), String(Math.floor(Date.now() / 1000)));
  return { dir, bin, stub, backups, status };
}

function chay(script, sb, themEnv = {}) {
  const env = {
    ...process.env,
    PATH: `${sb.bin}:${process.env.PATH}`,
    STUB_DIR: sb.stub,
    // Dấu "/": sha256sum của GNU thêm "\" vào đầu dòng khi đường dẫn có "\" (đường dẫn Windows).
    BACKUP_DIR: sb.backups.replace(/\\/g, "/"),
    BACKUP_STATUS_DIR: sb.status,
    PG_CONTAINER: "quanly-postgres",
    PII_ENC_KEY: "khoa-pii-dien-tap-16+",
    TELEGRAM_BOT_TOKEN: "tok",
    TELEGRAM_ALERT_CHAT: "chat",
    DRILL_SMOKE_WAIT_S: "4",
    ...themEnv,
  };
  for (const k of ["NAS_SHARE", "NAS_USER", "NAS_PASS", "OFFHOST_RCLONE_REMOTE", "S3_ENDPOINT", "S3_ACCESS_KEY",
    "S3_SECRET_KEY", "S3_BUCKET", "TRUST_PROXY", "APP_CONTAINER", "DRILL_RESTORE_BUCKET", "WATCHDOG_MAX_DRILL_DAYS"]) {
    if (!(k in themEnv)) delete env[k];
  }
  const r = spawnSync("bash", [join(ROOT, script)], { env, encoding: "utf8", timeout: 60_000 });
  const doc = (f) => (existsSync(join(sb.stub, f)) ? readFileSync(join(sb.stub, f), "utf8") : "");
  return { rc: r.status, out: String(r.stdout || ""), err: String(r.stderr || ""), curl: doc("curl.log"), smokeEnv: doc("smoke.env") };
}

describe("ops#1 — container smoke của diễn tập mang TRUST_PROXY (HTTP-12)", () => {
  it("giả lập docker còn bám đúng chốt của src/server.ts (production + thiếu TRUST_PROXY → exit 1)", () => {
    const s = readFileSync(join(ROOT, "src/server.ts"), "utf8");
    expect(s).toMatch(/NODE_ENV\s*===\s*"production"\s*&&\s*!config\.TRUST_PROXY[\s\S]{0,400}process\.exit\(1\)/);
  });

  it("drill đủ khoá (S3 trong tệp env): bước [7/7] LÊN được, PASS, ghi .drill-last-success, KHÔNG Telegram", () => {
    const sb = chuanBi();
    const r = chay("scripts/backup/restore-drill.sh", sb, {
      S3_ENDPOINT: "http://minio:9000", S3_ACCESS_KEY: "ak", S3_SECRET_KEY: "sk", S3_BUCKET: "quanly",
    });
    expect(r.smokeEnv, "container smoke không được dựng").toMatch(/^NODE_ENV=production$/m);
    expect(r.smokeEnv, "ENVFILE thiếu TRUST_PROXY → server.ts thoát 1 → drill đỏ mỗi Chủ nhật").toMatch(/^TRUST_PROXY=1$/m);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(r.curl, "diễn tập đạt mà vẫn gửi Telegram").toBe("");
    expect(existsSync(join(sb.backups, ".drill-last-success"))).toBe(true);
  });

  it("mọi script khởi động app ở NODE_ENV=production đều đặt TRUST_PROXY", () => {
    for (const f of ["scripts/backup/restore-drill.sh", "scripts/ci/smoke-image.sh", "scripts/ci/smoke-dist.sh"]) {
      const code = readFileSync(join(ROOT, f), "utf8").replace(/^\s*#.*$/gm, "");
      expect(code, f).toMatch(/NODE_ENV=production/);
      expect(code, `${f} khởi động app production mà không có TRUST_PROXY`).toMatch(/TRUST_PROXY[=:]/);
    }
  });
});

describe("ops#2 — S3_* để trống trong tệp env: diễn tập đọc từ container app như backup-objects.sh", () => {
  it("không alert 'S3_* chưa cấu hình', ENVFILE mang khoá của app, bucket tạm suy từ bucket của app, PASS", () => {
    const sb = chuanBi();
    const r = chay("scripts/backup/restore-drill.sh", sb);
    expect(r.err).not.toMatch(/S3_\* chưa cấu hình/);
    expect(r.smokeEnv).toMatch(/^S3_ENDPOINT=http:\/\/minio:9000$/m);
    expect(r.smokeEnv).toMatch(/^S3_ACCESS_KEY=ak-tu-app$/m);
    const docker = readFileSync(join(sb.stub, "docker.log"), "utf8");
    expect(docker, "bucket tạm phải là <bucket-của-app>-restore-drill").toMatch(/S3_BUCKET=quanly-restore-drill/);
    expect(r.rc, r.out + r.err).toBe(0);
    expect(r.curl).toBe("");
    expect(existsSync(join(sb.backups, ".drill-last-success"))).toBe(true);
  });

  it("tệp env có S3_* thì tệp env THẮNG (không hỏi app)", () => {
    const sb = chuanBi();
    const r = chay("scripts/backup/restore-drill.sh", sb, {
      S3_ENDPOINT: "http://minio:9000", S3_ACCESS_KEY: "ak-rieng", S3_SECRET_KEY: "sk-rieng",
    });
    expect(r.smokeEnv).toMatch(/^S3_ACCESS_KEY=ak-rieng$/m);
    const docker = readFileSync(join(sb.stub, "docker.log"), "utf8");
    expect(docker).not.toMatch(/quanly-app printenv S3_ACCESS_KEY/);
  });
});

describe("ops#2 (vế phụ) — watchdog không báo 'diễn tập CHƯA TỪNG' ngay sau khi cài", () => {
  function tuoi(sb) {
    const now = String(Math.floor(Date.now() / 1000));
    for (const k of ["db", "objects"]) writeFileSync(join(sb.backups, `.${k}-last-success`), now);
  }

  it("mới cài (mốc .installed-at trong hạn WATCHDOG_MAX_DRILL_DAYS): drill chưa chạy KHÔNG phải sự cố", () => {
    const sb = chuanBi();
    tuoi(sb);
    writeFileSync(join(sb.backups, ".installed-at"), String(Math.floor(Date.now() / 1000) - 3600));
    const r = chay("scripts/backup/backup-watchdog.sh", sb);
    expect(r.rc, r.err).toBe(0);
    expect(r.curl, "Telegram 'CHƯA TỪNG' nổ ngay lúc cài và lặp mỗi 6h tới Chủ nhật").toBe("");
    expect(r.out + r.err).toMatch(/diễn tập.*chưa chạy/i);
  });

  it("đã quá hạn kể từ lúc cài mà drill vẫn chưa từng đạt → vẫn là sự cố", () => {
    const sb = chuanBi();
    tuoi(sb);
    writeFileSync(join(sb.backups, ".installed-at"), String(Math.floor(Date.now() / 1000) - 9 * 86400));
    const r = chay("scripts/backup/backup-watchdog.sh", sb);
    expect(r.rc).toBe(1);
    expect(r.err).toMatch(/DIỄN TẬP KHÔI PHỤC: CHƯA TỪNG/);
  });

  it("không có mốc cài (host cũ) → giữ hành vi cũ: CHƯA TỪNG là sự cố", () => {
    const sb = chuanBi();
    tuoi(sb);
    const r = chay("scripts/backup/backup-watchdog.sh", sb);
    expect(r.rc).toBe(1);
    expect(r.err).toMatch(/DIỄN TẬP KHÔI PHỤC: CHƯA TỪNG/);
  });

  it("install-backup.sh ghi mốc .installed-at MỘT lần (không ghi đè — cài lại không kéo dài ân hạn mãi)", () => {
    const s = readFileSync(join(ROOT, "scripts/backup/install-backup.sh"), "utf8").replace(/^\s*#.*$/gm, "");
    expect(s).toMatch(/\[ -f "[^"\n]*\/\.installed-at" \] \|\| date \+%s > "[^"\n]*\/\.installed-at"/);
  });
});
