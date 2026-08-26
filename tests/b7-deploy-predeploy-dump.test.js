/**
 * ============================================================================
 * B7 · backup-files-world-readable — bản dump TRƯỚC MỖI LƯỢT DEPLOY cũng phải 0600.
 *
 * LỖI LÀ GÌ
 *   scripts/backup/* đã siết (umask 077 + chmod 600 + `install -d -m 0700`), nhưng còn MỘT
 *   đường sinh dump PII nữa nằm ngoài thư mục đó: bước [1/6] của deploy.sh chạy
 *       ssh … "mkdir -p ~/quanly-backups && docker exec quanly-postgres pg_dump … | gzip > …"
 *   Lệnh đó chạy trong shell đăng nhập của máy chủ với umask mặc định 0022 → file ra 0644 và
 *   thư mục ra 0755. Cùng nội dung CCCD / số tài khoản / lương mà backup-db.sh viết hẳn một
 *   đoạn giải thích để siết, và nó sinh ra MỖI LẦN deploy.
 *
 * TÁI HIỆN
 *   Thay `ssh` bằng stub chạy chuỗi lệnh ngay tại chỗ dưới umask 022 (đúng như một phiên ssh
 *   thật), `git`/`docker` cũng là stub. Chạy `deploy.sh prod`, rồi ĐO chế độ thật của file và
 *   thư mục sinh ra. Trên mã cũ: 0644 / 0755.
 *
 * HẬU QUẢ
 *   Bất kỳ tài khoản nào trên VM production đọc được toàn bộ hồ sơ nhân sự, và bản dump đó
 *   nằm lại đó vĩnh viễn (deploy.sh không dọn).
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, readdirSync, statSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** `ssh <host> <cmd>`: chỉ THỰC THI bước backup; mọi bước sau đó trả lỗi để deploy dừng lại
 *  (test này chỉ quan tâm bước [1/6], và không được đụng gì ngoài thư mục tạm). */
const STUB_SSH = `#!/usr/bin/env bash
shift
cmd="$*"
printf '%s\\n---\\n' "$cmd" >> "$STUB_DIR/ssh.log"
case "$cmd" in
  *pg_dump*) umask 022; bash -c "$cmd"; exit $?;;
esac
exit 1
`;

const STUB_GIT = `#!/usr/bin/env bash
case "$1" in
  rev-parse) echo 1111111111111111111111111111111111111111; exit 0;;
esac
exit 0
`;

const STUB_DOCKER = `#!/usr/bin/env bash
case "$1 $2" in
  "exec quanly-postgres") head -c 40000 /dev/urandom | base64; exit 0;;
esac
exit 0
`;

let sb;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "b7-deploy-"));
  const bin = join(dir, "bin");
  const stub = join(dir, "stub");
  const home = join(dir, "home");
  for (const d of [bin, stub, home]) mkdirSync(d);
  for (const [name, body] of [
    ["ssh", STUB_SSH],
    ["git", STUB_GIT],
    ["docker", STUB_DOCKER],
  ]) {
    const p = join(bin, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  }
  try {
    execFileSync("bash", [join(ROOT, "deploy.sh"), "prod"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_DIR: stub, HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    });
  } catch {
    /* deploy dừng ở bước [2/6] là chủ ý — bước [1/6] đã chạy xong */
  }
  sb = { dir, home };
});
afterAll(() => {
  if (sb) rmSync(sb.dir, { recursive: true, force: true });
});

describe("[b7] deploy.sh bước [1/6]: bản dump tiền-deploy không được ai-cũng-đọc", () => {
  it("file predeploy-*.sql.gz ra 0600 và thư mục chứa ra 0700", () => {
    const thuMuc = join(sb.home, "quanly-backups");
    const dumps = readdirSync(thuMuc).filter((f) => f.startsWith("predeploy-") && f.endsWith(".sql.gz"));
    expect(dumps.length, "bước backup tiền-deploy không sinh file nào — bài test đã lạc chỗ").toBe(1);

    const modeFile = statSync(join(thuMuc, dumps[0])).mode & 0o777;
    expect(
      (modeFile & 0o077).toString(8),
      `dump PII tiền-deploy ra chế độ 0${modeFile.toString(8)} — nhóm/others vẫn đọc được`
    ).toBe("0");

    const modeDir = statSync(thuMuc).mode & 0o777;
    expect(
      (modeDir & 0o077).toString(8),
      `thư mục chứa dump ra chế độ 0${modeDir.toString(8)} — phải 0700 như scripts/backup/install-backup.sh`
    ).toBe("0");
  });
});
