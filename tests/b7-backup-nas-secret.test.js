/**
 * ============================================================================
 * B7 · nas-password-in-process-table — mật khẩu NAS KHÔNG được đi vào Config.Env
 * của container tạm.
 *
 * LỖI LÀ GÌ
 *   scripts/backup/backup-db.sh và backup-objects.sh đẩy bản sao lưu lên NAS bằng một
 *   container `alpine` dùng một lần. Bản trước nội suy mật khẩu vào CHUỖI LỆNH (argv) →
 *   `ps aux` trên host đọc được. Bản vá đổi sang `docker run -e NAS_PASS` (cờ không kèm
 *   giá trị): argv sạch, nhưng docker CLI khi đó ĐỌC giá trị từ môi trường của chính nó
 *   rồi NẠP vào `Config.Env` của container. Nghĩa là trong suốt cửa sổ 02:00/02:30,
 *   `docker inspect <container>` và /proc/<pid>/environ bên trong container vẫn trả về
 *   mật khẩu NAS nguyên văn — đúng đường lộ mà mục rủi ro này nêu tên.
 *
 * TÁI HIỆN
 *   Không grep chuỗi. Bài test thay `docker` bằng một stub ghi lại argv + môi trường của
 *   chính tiến trình docker, chạy THẬT script sao lưu, rồi DỰNG LẠI `Config.Env` đúng theo
 *   ngữ nghĩa của docker: `-e NAME=VAL` → VAL, `-e NAME` (không kèm giá trị) → lấy từ
 *   môi trường của docker CLI. Nếu mật khẩu nằm trong tập đó thì `docker inspect` đọc được.
 *
 * HẬU QUẢ
 *   Mật khẩu NAS mở được TOÀN BỘ kho sao lưu off-host: mất nó là mất luôn bản sao cuối
 *   cùng còn lại sau một sự cố trên host (xoá nhầm, mã hoá tống tiền).
 * ============================================================================
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const MAT_KHAU = "nas-pass-CHUOI-RIENG-9f3a1c";

/** Stub `docker`: ghi lại từng lượt gọi (argv NUL-separated + env NUL-separated) rồi giả lập
 *  đúng những gì script cần để đi tiếp (printenv / pg_dump / mc / run). */
const STUB_DOCKER = `#!/usr/bin/env bash
n=$(cat "$STUB_DIR/counter" 2>/dev/null || echo 0); n=$((n+1)); printf '%s' "$n" > "$STUB_DIR/counter"
printf '%s\\0' "$@" > "$STUB_DIR/call-$n.argv"
env -0 > "$STUB_DIR/call-$n.env"
case "$1" in
  exec)
    case "$*" in
      *"printenv POSTGRES_USER"*) echo quanly; exit 0;;
      *"printenv POSTGRES_DB"*)   echo quanly; exit 0;;
      *pg_dump*) head -c 200000 /dev/urandom | base64; exit 0;;
    esac
    exit 0;;
  run) cat >/dev/null 2>&1; exit 0;;
esac
exit 0
`;

function chuanBi() {
  const dir = mkdtempSync(join(tmpdir(), "b7-nas-"));
  const bin = join(dir, "bin");
  const stub = join(dir, "stub");
  const backups = join(dir, "backups");
  mkdirSync(bin);
  mkdirSync(stub);
  mkdirSync(backups);
  const docker = join(bin, "docker");
  writeFileSync(docker, STUB_DOCKER);
  chmodSync(docker, 0o755);
  return { dir, bin, stub, backups };
}

/** Đọc lại toàn bộ lượt gọi stub đã ghi. */
function cacLuotGoi(stubDir) {
  return readdirSync(stubDir)
    .filter((f) => f.endsWith(".argv"))
    .map((f) => Number(f.slice(5, -5)))
    .sort((a, b) => a - b)
    .map((n) => ({
      argv: readFileSync(join(stubDir, `call-${n}.argv`), "utf8").split("\0").slice(0, -1),
      env: Object.fromEntries(
        readFileSync(join(stubDir, `call-${n}.env`), "utf8")
          .split("\0")
          .filter(Boolean)
          .map((kv) => {
            const i = kv.indexOf("=");
            return [kv.slice(0, i), kv.slice(i + 1)];
          })
      ),
    }));
}

/**
 * Dựng lại `Config.Env` mà docker daemon sẽ gắn vào container — đúng ngữ nghĩa của cờ `-e`:
 *   `-e NAME=VAL` → VAL;  `-e NAME` → giá trị lấy từ MÔI TRƯỜNG CỦA DOCKER CLI.
 * Đây chính là thứ `docker inspect` in ra và /proc/<pid>/environ trong container đọc được.
 */
function configEnv(luot) {
  const out = {};
  for (let i = 0; i < luot.argv.length; i++) {
    const a = luot.argv[i];
    let spec = null;
    if (a === "-e" || a === "--env") spec = luot.argv[++i];
    else if (a.startsWith("--env=")) spec = a.slice(6);
    else if (a.startsWith("-e") && a.length > 2) spec = a.slice(2);
    if (spec == null) continue;
    const j = spec.indexOf("=");
    if (j >= 0) out[spec.slice(0, j)] = spec.slice(j + 1);
    else if (Object.hasOwn(luot.env, spec)) out[spec] = luot.env[spec];
  }
  return out;
}

const rac = [];
afterEach(() => {
  while (rac.length) rmSync(rac.pop(), { recursive: true, force: true });
});

/** Chạy một script sao lưu với stub docker, trả về các lượt `docker run` đã ghi nhận. */
function chayVaLayDockerRun(script, themEnv) {
  const sb = chuanBi();
  rac.push(sb.dir);
  execFileSync("bash", [join(ROOT, script)], {
    env: {
      ...process.env,
      PATH: `${sb.bin}:${process.env.PATH}`,
      STUB_DIR: sb.stub,
      BACKUP_DIR: sb.backups,
      PG_CONTAINER: "quanly-postgres",
      NAS_SHARE: "//192.168.1.100/QuanlyBackup",
      NAS_USER: "backup-user",
      NAS_PASS: MAT_KHAU,
      NAS_SUBDIR: "db",
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_ALERT_CHAT: "",
      ...themEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const runs = cacLuotGoi(sb.stub).filter((l) => l.argv[0] === "run");
  expect(runs.length, `${script} không gọi \`docker run\` nào — bài test đã lạc chỗ`).toBeGreaterThan(0);
  return runs;
}

function khongLoMatKhau(runs, script) {
  for (const r of runs) {
    // 1) argv: đường lộ qua `ps aux` trên host (đã vá từ trước — giữ chốt để không tái phát).
    expect(r.argv.join(" "), `${script}: mật khẩu NAS hiện nguyên văn trong argv của docker`).not.toContain(MAT_KHAU);
    // 2) Config.Env: đường lộ qua `docker inspect` + /proc/<pid>/environ TRONG container.
    const env = configEnv(r);
    expect(
      Object.entries(env).filter(([, v]) => v === MAT_KHAU),
      `${script}: docker run nạp mật khẩu NAS vào Config.Env: ${JSON.stringify(env)}`
    ).toEqual([]);
  }
}

describe("[b7] sao lưu off-host: mật khẩu NAS không lọt vào container tạm", () => {
  it("backup-db.sh: docker inspect / environ của container tạm KHÔNG chứa NAS_PASS", () => {
    khongLoMatKhau(chayVaLayDockerRun("scripts/backup/backup-db.sh", {}), "backup-db.sh");
  });

  it("backup-objects.sh: cùng chốt cho đường sao lưu ảnh chứng từ", () => {
    const runs = chayVaLayDockerRun("scripts/backup/backup-objects.sh", {
      S3_ENDPOINT: "https://s3.example.com",
      S3_ACCESS_KEY: "ak-test",
      S3_SECRET_KEY: "sk-test",
      S3_BUCKET: "quanly",
      NAS_SUBDIR: "objects",
    });
    khongLoMatKhau(runs, "backup-objects.sh");
  });
});
