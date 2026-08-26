/**
 * ============================================================================
 * B7 · restore-drill-fills-production-volume — chốt chỗ trống đĩa phải FAIL-CLOSED.
 *
 * LỖI LÀ GÌ
 *   restore-test.sh và restore-drill.sh nạp bản dump vào một CSDL TẠM nằm trong CHÍNH
 *   volume của Postgres production. Trước khi nạp, cả hai đo cỡ CSDL rồi đòi volume còn
 *   ≥ 2× cỡ đó (sàn 500MB). Nhưng phép đo đó nuốt mọi lỗi:
 *       PGDB="$(docker exec … printenv POSTGRES_DB 2>/dev/null)"        # không `|| exit`
 *       DB_MB="$(… psql … pg_database_size('$PGDB') … 2>/dev/null | tr -cd '0-9')"
 *   PGDB rỗng / psql lỗi / sai quyền → DB_MB thành CHUỖI RỖNG → `${DB_MB:-0} * 2` = 0 →
 *   ngưỡng tụt xuống đúng sàn 500MB, KHÔNG một dòng cảnh báo nào. Với CSDL 50GB và volume
 *   còn 600MB, điều kiện vẫn qua và script đi thẳng tới `CREATE DATABASE` rồi nạp dump.
 *
 * TÁI HIỆN
 *   Thay `docker` bằng stub: `printenv POSTGRES_DB` thất bại, `pg_database_size` thất bại,
 *   `df` báo volume còn 600MB. Chạy THẬT hai script rồi xem chúng có gọi `CREATE DATABASE`
 *   hay không. Trên mã cũ: có gọi. Sau khi vá: dừng trước đó.
 *
 * HẬU QUẢ
 *   Đúng thứ mà tên mục nêu: diễn tập tự làm đầy volume production lúc 3h sáng Chủ nhật —
 *   Postgres ngừng ghi được, do chính bộ máy dựng ra để bảo vệ nó gây ra.
 * ============================================================================
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** Stub `docker`: mô phỏng đúng tình huống "không đo được cỡ CSDL, nhưng volume vẫn còn 600MB". */
const STUB_DOCKER = `#!/usr/bin/env bash
n=$(cat "$STUB_DIR/counter" 2>/dev/null || echo 0); n=$((n+1)); printf '%s' "$n" > "$STUB_DIR/counter"
printf '%s\\0' "$@" > "$STUB_DIR/call-$n.argv"
case "$1" in
  exec|"-i")
    case "$*" in
      *"printenv POSTGRES_USER"*)     echo quanly; exit 0;;
      *"printenv POSTGRES_DB"*)       exit 1;;          # không đọc được tên CSDL
      *"printenv POSTGRES_PASSWORD"*) echo pw; exit 0;;
      *pg_database_size*)             exit 1;;          # psql lỗi → DB_MB rỗng
      *"df -Pm"*) printf 'Filesystem 1M-blocks Used Available Use%%%% Mounted on\\n/dev/vda1 100000 99400 600 100%%%% /var/lib/postgresql/data\\n'; exit 0;;
    esac
    exit 0;;
  inspect) echo internal; exit 0;;
esac
exit 0
`;

const rac = [];
afterEach(() => {
  while (rac.length) rmSync(rac.pop(), { recursive: true, force: true });
});

function chay(script) {
  const dir = mkdtempSync(join(tmpdir(), "b7-restore-"));
  rac.push(dir);
  const bin = join(dir, "bin");
  const stub = join(dir, "stub");
  const backups = join(dir, "backups");
  for (const d of [bin, stub, backups]) mkdirSync(d);
  const docker = join(bin, "docker");
  writeFileSync(docker, STUB_DOCKER);
  chmodSync(docker, 0o755);
  // Một "bản dump" để script có thứ để chọn. Nội dung không quan trọng: bài test dừng
  // trước bước nạp, và nếu KHÔNG dừng thì `CREATE DATABASE` đã được gọi rồi.
  writeFileSync(join(backups, "quanly-2026-08-26-020000.sql.gz"), "khong-phai-gzip-that");

  let code = 0;
  try {
    execFileSync("bash", [join(ROOT, script)], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        STUB_DIR: stub,
        BACKUP_DIR: backups,
        PG_CONTAINER: "quanly-postgres",
        TELEGRAM_BOT_TOKEN: "",
        TELEGRAM_ALERT_CHAT: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    });
  } catch (e) {
    code = e.status ?? 1;
  }
  const goi = readdirSync(stub)
    .filter((f) => f.endsWith(".argv"))
    .map((f) => readFileSync(join(stub, f), "utf8").split("\0").join(" "));
  return { code, goi };
}

describe("[b7] diễn tập khôi phục: không đo được cỡ CSDL thì phải DỪNG", () => {
  for (const script of ["scripts/backup/restore-test.sh", "scripts/backup/restore-drill.sh"]) {
    it(`${script}: pg_database_size lỗi → không được tạo CSDL tạm trong volume production`, () => {
      const { code, goi } = chay(script);
      const taoDb = goi.filter((g) => g.includes("CREATE DATABASE"));
      expect(
        taoDb,
        "chốt chỗ trống FAIL-OPEN: không đo được cỡ CSDL mà vẫn nạp dump vào volume production"
      ).toEqual([]);
      expect(code, "script phải thoát khác 0 khi không đo được điều kiện an toàn").not.toBe(0);
    });
  }
});
