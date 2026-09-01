/**
 * ============================================================================
 * W3 · chú thích compose mô tả SAI cơ chế hạ quyền của ảnh postgres/redis.
 *
 * LỖI LÀ GÌ
 *   docker-compose.prod.yml và docker-compose.staging.yml siết capability cho postgres/redis,
 *   và chú thích đi kèm giải thích "vì sao 5 capability này" bằng một cơ chế KHÔNG có thật:
 *     • postgres: chú thích ghi `su-exec postgres`. Entrypoint thật của postgres:16-alpine gọi
 *       `exec gosu postgres "$BASH_SOURCE" "$@"` (gosu 1.19, ELF thật; `/usr/local/bin/su-exec`
 *       trong ảnh chỉ là symlink trỏ về gosu và entrypoint không gọi tên đó).
 *     • redis: chú thích ghi `su-exec redis`. Ảnh redis:7-alpine KHÔNG có gosu lẫn su-exec; nó
 *       hạ quyền bằng `exec /usr/bin/setpriv --reuid redis --regid redis --clear-groups`.
 *   Chú thích còn ghi "CHƯA DIỄN TẬP ĐƯỢC … deploy staging trước thì lỗi lộ ra ngay", trong khi
 *   bước [5/6] của deploy.sh chỉ `docker compose up -d app worker` — không bao giờ dựng lại
 *   postgres/redis.
 *
 * TÁI HIỆN (2026-08-27, docker 29.3.1 / compose v5.1.1, ảnh đúng digest đang ghim)
 *   docker cp <ctn>:/usr/local/bin/docker-entrypoint.sh  → postgres dòng 343 `exec gosu postgres`,
 *   redis dòng 13 `exec /usr/bin/setpriv --reuid redis …`.
 *   Diễn tập `docker compose -f docker-compose.staging.yml up -d postgres redis`: cả hai healthy.
 *   Đối chứng: bỏ hết capability → postgres `error: failed switching to 'postgres': operation not
 *   permitted`; redis chỉ có SETUID → `setpriv: setresgid failed: Operation not permitted`.
 *
 * PHẠM VI BẢN VÁ: CHỈ chú thích + tài liệu. `docker compose config` dựng ra từ hai file này
 * giống hệt bản trước khi sửa (đã đối chiếu), nên hành vi runtime không đổi. Test này là chốt
 * chặn để chú thích không trôi ngược về mô tả sai.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..");
const FILES = ["docker-compose.prod.yml", "docker-compose.staging.yml"];
const read = (f) => readFileSync(join(ROOT, f), "utf8");

/** Lấy khối chú thích của một service (từ dòng `  <ten>:` tới `cap_drop`). */
function khoiChuThich(text, service) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === `  ${service}:`);
  expect(start, `khong tim thay service ${service}`).toBeGreaterThan(-1);
  const end = lines.findIndex((l, i) => i > start && l.includes("security_opt:"));
  return lines.slice(start, end + 1).join("\n");
}

describe("W3 · chú thích compose phải khớp cơ chế thật của ảnh", () => {
  for (const f of FILES) {
    it(`${f}: khối postgres nói gosu, không nói su-exec`, () => {
      const khoi = khoiChuThich(read(f), "postgres");
      expect(khoi).toMatch(/gosu/);
      // su-exec chỉ được nhắc để nói rõ nó KHÔNG phải cơ chế, kèm chữ "symlink".
      if (/su-exec/.test(khoi)) expect(khoi).toMatch(/symlink/);
      expect(khoi).not.toMatch(/rồi mới `su-exec postgres` hạ quyền/);
    });

    it(`${f}: khối redis nói setpriv, không nói su-exec`, () => {
      const khoi = khoiChuThich(read(f), "redis");
      expect(khoi).toMatch(/setpriv/);
      expect(khoi).not.toMatch(/su-exec redis/);
    });

    it(`${f}: tập capability vẫn đúng bộ đã diễn tập được`, () => {
      const doc = parse(read(f));
      for (const svc of ["postgres", "redis"]) {
        expect(doc.services[svc].cap_drop).toEqual(["ALL"]);
        expect([...doc.services[svc].cap_add].sort()).toEqual([
          "CHOWN",
          "DAC_OVERRIDE",
          "FOWNER",
          "SETGID",
          "SETUID",
        ]);
        expect(doc.services[svc].security_opt).toEqual(["no-new-privileges:true"]);
      }
    });
  }

  it("deploy.sh bước [5/6] thật sự chỉ recreate app + worker", () => {
    const sh = read("deploy.sh");
    expect(sh).toMatch(/\[5\/6\] Recreate app \+ worker/);
    expect(sh).toMatch(/docker compose -f \$COMPOSE up -d --force-recreate app worker/);
    // không có lượt `up -d` nào kéo theo postgres/redis
    expect(sh).not.toMatch(/up -d[^\n]*postgres/);
    expect(sh).not.toMatch(/up -d[^\n]*redis/);
  });

  // ── LỖI ĐÃ ĐO, KHÔNG PHẢI LO XA ──────────────────────────────────────────
  // `docker compose up -d` với service có khối `build:` không so ảnh mà tag đang trỏ tới với ảnh
  // container đang chạy. Trên staging ngày 2026-09-01, sau BA lượt deploy liên tiếp thì
  // `quanly-app:staging` trỏ ảnh 0c1aa87b4bbc còn container vẫn chạy 954ee4fafcdf. Lệnh thoát 0,
  // deploy.sh in "✅ now running <sha>", RELEASES.log ghi digest mới — mà mã chạy vẫn là mã cũ.
  // Bước verify /livez không bắt được vì app CŨ cũng trả 200.
  it("deploy.sh ÉP recreate và ĐỐI CHIẾU ảnh đang chạy — không tin lời Compose", () => {
    const sh = read("deploy.sh");
    expect(sh, "thiếu --force-recreate: Compose sẽ bỏ qua ảnh mới và báo thành công")
      .toMatch(/up -d --force-recreate app worker/);
    expect(sh, "thiếu bước đối chiếu ảnh đang chạy với ảnh vừa dựng")
      .toMatch(/\[5c\/6\] Đối chiếu ảnh đang chạy/);
    expect(sh, "bước đối chiếu phải soi CẢ app lẫn worker")
      .toMatch(/for c in quanly-app quanly-worker/);
  });

  it("DEPLOYMENT.md có bước diễn tập tay cho postgres/redis", () => {
    const md = read("docs/operations/DEPLOYMENT.md");
    expect(md).toMatch(/## Diễn tập thay đổi postgres\/redis/);
    expect(md).toMatch(/docker compose -f docker-compose\.staging\.yml up -d postgres redis/);
    expect(md).toMatch(/ready to accept connections/);
    expect(md).toMatch(/setpriv: setresgid failed/);
  });
});
