/**
 * ============================================================================
 * OPS · deploy.sh — DOC-02 / INFRA-02 (rollback), INFRA-04 (cổng verify), INFRA-05 (kiểm sau deploy),
 *       INFRA-03 (migration huỷ), INFRA-09 (dọn mồ côi), DOC-06 (dump trước-deploy có --clean).
 *
 * LỖI (đọc mã ở c450a46)
 *   · Ba lệnh rollback deploy.sh IN RA (và DEPLOYMENT.md chép lại) là `docker tag … && docker compose
 *     up -d app worker` — đúng mẫu mà chính bước [5/6] đã ĐO là KHÔNG thay container (thoát 0, container
 *     vẫn chạy ảnh lỗi). `:rollback` gắn theo TAG, có thể trỏ ảnh chưa từng chạy.
 *   · deploy.sh ship BẤT KỲ commit cục bộ nào — không cổng nào nối "đã qua verify" với "lên prod".
 *   · [6/6] chỉ gọi /livez tĩnh: không kiểm CSDL, không kiểm worker, không kiểm đường public.
 *   · Không gì chặn migration DROP/RENAME làm hỏng đường lùi ảnh.
 *   · Dump trước-deploy thiếu --clean trong khi runbook bảo nạp nó như dump hằng đêm.
 *
 * CÁCH KIỂM: chạy THẬT deploy.sh với `ssh`/`git`/`curl` giả trên PATH (cùng khuôn với
 * tests/b7-deploy-image-digest.test.js), đọc log lệnh gửi sang máy chủ.
 * ============================================================================
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SHA = "1111111111111111111111111111111111111111";

const STUB_SSH = `#!/usr/bin/env bash
shift
printf '%s\\n---\\n' "$*" >> "$STUB_DIR/ssh.log"
case "$*" in
  *"image inspect"*) exit "\${STUB_ANH_RC:-0}";;
  *"pull --policy"*) exit "\${STUB_PULL_RC:-0}";;
  *readyz*) [ "\${STUB_READYZ:-ok}" = ok ] && echo '{"ok":true}' || exit 8; exit 0;;
  *livez*) echo '{"ok":true}';;
  *RestartCount*) [ "\${STUB_WORKER:-ok}" = ok ] && echo WORKER_OK || { echo "WORKER_KHONG_ON trạng thái='false 3'"; exit 1; };;
  *_prisma_migrations*) printf '%s' "\${STUB_DA_AP:-}";;
esac
exit 0
`;

const STUB_GIT = `#!/usr/bin/env bash
case "$1" in
  rev-parse) echo ${SHA}; exit 0;;
  status) printf '%s' "\${STUB_GIT_BAN:-}"; exit 0;;
  branch) exit 0;;
  ls-tree)
    case "$*" in
      *prisma/migrations/*) printf '%s\\n' prisma/migrations/20990101000000_huy prisma/migrations/migration_lock.toml;;
    esac
    exit 0;;
  show)
    case "$*" in
      *20990101000000_huy/migration.sql*)
        # STUB_SQL_FILE: SQL lớn (hàng trăm KB) không đi qua biến môi trường được (Windows trần 32K).
        if [ -n "\${STUB_SQL_FILE:-}" ]; then cat "$STUB_SQL_FILE"
        else printf '%s\\n' "\${STUB_SQL:-ALTER TABLE \\"X\\" ADD COLUMN \\"y\\" TEXT;}"; fi;;
      *) exit 128;;
    esac
    exit 0;;
esac
exit 0
`;

const STUB_CURL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/curl.log"
echo '{"ok":true}'
`;

const rac = [];
afterEach(() => {
  while (rac.length) rmSync(rac.pop(), { recursive: true, force: true });
});

function chay(args, env = {}, { dau = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ops-deploy-"));
  rac.push(dir);
  const bin = join(dir, "bin");
  const stub = join(dir, "stub");
  const verify = join(dir, "verify");
  for (const d of [bin, stub, verify]) mkdirSync(d);
  for (const [n, b] of [["ssh", STUB_SSH], ["git", STUB_GIT], ["curl", STUB_CURL]]) {
    writeFileSync(join(bin, n), b);
    chmodSync(join(bin, n), 0o755);
  }
  if (dau) writeFileSync(join(verify, `ok-${SHA}`), `sha=${SHA}\nluc=2026-09-23T00:00:00Z\n`);
  const r = spawnSync("bash", [join(ROOT, "deploy.sh"), ...args], {
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_DIR: stub, HOME: dir,
      QUANLY_VERIFY_DIR: verify, DEPLOY_CHO_WORKER_S: "0", DEPLOY_KHAN_CAP: "", ...env,
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  const log = existsSync(join(stub, "ssh.log")) ? readFileSync(join(stub, "ssh.log"), "utf8") : "";
  const curl = existsSync(join(stub, "curl.log")) ? readFileSync(join(stub, "curl.log"), "utf8") : "";
  return { code: r.status, out: `${r.stdout}${r.stderr}`, log, curl };
}

describe("INFRA-04 — cổng [0/6]: chỉ ship commit đã qua npm run verify", () => {
  it("prod KHÔNG có dấu xanh → dừng TRƯỚC khi gửi lệnh nào sang máy chủ", () => {
    const r = chay(["prod"], {}, { dau: false });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/CHƯA có dấu xanh/);
    expect(r.log, "đã kịp chạy lệnh trên máy chủ production").toBe("");
  });

  it("prod với cây làm việc BẨN → dừng", () => {
    const r = chay(["prod"], { STUB_GIT_BAN: " M src/app.ts\n" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/cây làm việc BẨN/);
    expect(r.log).toBe("");
  });

  it("prod khẩn cấp: DEPLOY_KHAN_CAP có lý do → đi tiếp và LÝ DO được ghi vào sổ phát hành", () => {
    const r = chay(["prod"], { DEPLOY_KHAN_CAP: "vá nóng lỗi đăng nhập", DEPLOY_BO_QUA_KIEM_PUBLIC: "1" }, { dau: false });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/KHẨN CẤP/);
    expect(r.log).toMatch(/RELEASES\.log/);
    expect(r.log).toContain("vá nóng lỗi đăng nhập");
  });

  it("staging KHÔNG có dấu xanh và chưa push → chỉ CẢNH BÁO, vẫn deploy (người điều phối deploy dev từ master cục bộ)", () => {
    const r = chay(["staging"], { DEPLOY_BO_QUA_KIEM_PUBLIC: "1" }, { dau: false });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/staging: chỉ cảnh báo/);
    expect(r.out).toMatch(/chưa có trên nhánh remote/);
  });

  it("prod có dấu xanh → đi hết 6 bước", () => {
    const r = chay(["prod"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/có dấu xanh/);
  });
});

describe("INFRA-05 — [6/6] kiểm CSDL, worker và đường public, không chỉ /livez", () => {
  it("gọi /readyz, soi RestartCount của worker, và curl đường public", () => {
    const r = chay(["prod"]);
    expect(r.code, r.out).toBe(0);
    expect(r.log).toMatch(/wget -qO- http:\/\/127\.0\.0\.1:3000\/readyz/);
    expect(r.log).toMatch(/RestartCount[\s\S]*worker registered/);
    expect(r.curl).toContain("https://gianguyen.cloud/livez");
  });

  it("/readyz hỏng (app không chạm được CSDL) → deploy ĐỎ", () => {
    const r = chay(["prod"], { STUB_READYZ: "hong" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/readyz/);
  });

  it("worker khởi động lại liên tục → deploy ĐỎ (healthcheck của worker tắt nên trước đây lọt)", () => {
    const r = chay(["prod"], { STUB_WORKER: "hong" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/worker hỏng/);
  });
});

describe("DOC-02 / INFRA-02 — rollback thật sự thay container", () => {
  it("`deploy.sh rollback prod <sha>`: gắn tag bất biến, --force-recreate, đối chiếu ảnh, kiểm lại", () => {
    const r = chay(["rollback", "prod", "abc1234"], { DEPLOY_BO_QUA_KIEM_PUBLIC: "1" });
    expect(r.code, r.out).toBe(0);
    expect(r.log).toMatch(/docker tag quanly-app:abc1234 quanly-app:prod && docker compose -f docker-compose\.prod\.yml up -d --no-deps --force-recreate app worker/);
    expect(r.log).toMatch(/for c in quanly-app quanly-worker/);
    expect(r.log).toMatch(/readyz/);
  });

  it("rollback về tag không tồn tại → dừng, không động vào container", () => {
    const r = chay(["rollback", "prod", "abc1234"], { STUB_ANH_RC: "1" });
    expect(r.code).not.toBe(0);
    expect(r.log).not.toMatch(/force-recreate/);
  });

  it(":rollback được gắn từ ảnh của CONTAINER ĐANG CHẠY, không từ tag", () => {
    const r = chay(["prod"]);
    expect(r.log).toMatch(/docker inspect quanly-app --format '\{\{\.Image\}\}'[\s\S]*docker tag "\$IMG" quanly-app:rollback/);
  });

  it("mọi chuỗi lùi trong deploy.sh và docs/operations/*.md kèm --force-recreate (hoặc gọi deploy.sh rollback)", () => {
    const tep = ["deploy.sh", ...readdirSync(join(ROOT, "docs/operations")).filter((f) => f.endsWith(".md")).map((f) => `docs/operations/${f}`)];
    const xau = [];
    for (const f of tep) {
      // Chỉ soi dòng LỆNH: deploy.sh bỏ dòng chú thích; tài liệu chỉ soi trong khối ``` (văn xuôi kể
      // lại lỗi cũ được phép nhắc mẫu hỏng).
      let trongKhoi = false;
      readFileSync(join(ROOT, f), "utf8").split("\n").forEach((dong, i) => {
        if (f.endsWith(".md") && /^\s*>?\s*```/.test(dong)) { trongKhoi = !trongKhoi; return; }
        const laLenh = f.endsWith(".md") ? trongKhoi : !/^\s*#/.test(dong);
        if (laLenh && /docker tag\b/.test(dong) && /\bup -d\b/.test(dong) && !/--force-recreate/.test(dong)) xau.push(`${f}:${i + 1}: ${dong.trim()}`);
      });
    }
    expect(xau, "lệnh lùi không --force-recreate báo thành công mà container vẫn chạy ảnh lỗi").toEqual([]);
  });
});

describe("INFRA-03 — migration HUỶ đang chờ", () => {
  it("prod có migration DROP chưa áp → dừng trước migrate, trừ khi CHO_PHEP_MIGRATION_HUY=1", () => {
    const sql = 'DROP TABLE "_QuoteMembers";';
    const chan = chay(["prod"], { STUB_SQL: sql });
    expect(chan.code).not.toBe(0);
    expect(chan.out).toMatch(/20990101000000_huy/);
    expect(chan.log, "đã chạy migrate dù có migration huỷ").not.toMatch(/prisma migrate deploy/);

    const cho = chay(["prod"], { STUB_SQL: sql, CHO_PHEP_MIGRATION_HUY: "1", DEPLOY_BO_QUA_KIEM_PUBLIC: "1" });
    expect(cho.code, cho.out).toBe(0);
  });

  it("migration chỉ THÊM, hoặc đã áp rồi → không chặn", () => {
    expect(chay(["prod"]).code).toBe(0);
    expect(chay(["prod"], { STUB_SQL: "DROP TABLE x;", STUB_DA_AP: "20990101000000_huy\n" }).code).toBe(0);
  });

  it("chú thích SQL nhắc DROP không bị tính", () => {
    expect(chay(["prod"], { STUB_SQL: "-- trước đây từng DROP TABLE x\nALTER TABLE a ADD COLUMN b INT;" }).code).toBe(0);
  });
});

describe("INFRA-14 — test-on-dev.sh", () => {
  function chayTod(env) {
    const dir = mkdtempSync(join(tmpdir(), "ops-tod-"));
    rac.push(dir);
    const bin = join(dir, "bin");
    const stub = join(dir, "stub");
    for (const d of [bin, stub]) mkdirSync(d);
    writeFileSync(join(bin, "ssh"), STUB_SSH_TOD);
    chmodSync(join(bin, "ssh"), 0o755);
    const r = spawnSync("bash", [join(ROOT, "test-on-dev.sh")], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_DIR: stub, ...env }, encoding: "utf8",
    });
    const log = existsSync(join(stub, "ssh.log")) ? readFileSync(join(stub, "ssh.log"), "utf8") : "";
    return { code: r.status, out: `${r.stdout}${r.stderr}`, log };
  }
  const STUB_SSH_TOD = `#!/usr/bin/env bash
shift
printf '%s\\n' "$*" >> "$STUB_DIR/ssh.log"
exit "\${STUB_RC:-0}"
`;

  it("từ chối đích production, không gửi lệnh nào", () => {
    const r = chayTod({ SSH: "coolify-ts" });
    expect(r.code).not.toBe(0);
    expect(r.log).toBe("");
  });

  it("thoát bằng ĐÚNG mã của lượt chạy trên VM (trước đây luôn 0)", () => {
    expect(chayTod({ SSH: "staging-ts", STUB_RC: "3" }).code).toBe(3);
    expect(chayTod({ SSH: "staging-ts", STUB_RC: "0" }).code).toBe(0);
  });

  it("không dùng Redis của worker đang sống, chạy trên ảnh Node của Dockerfile", () => {
    const r = chayTod({ SSH: "staging-ts" });
    expect(r.log).not.toMatch(/printenv REDIS_URL/);
    expect(r.log).toMatch(/REDIS_URL="redis:\/\/127\.0\.0\.1:6379\/0"/);
    expect(r.log).toMatch(/NODE_IMG='node:\d+[^']*@sha256:[0-9a-f]{64}'/);
  });
});

describe("INFRA-09 / DOC-06 / OBS-13", () => {
  it("dọn mồ côi phủ cả prisma/ templates/ public/ (migration đã gỡ khỏi git không được migrate)", () => {
    const r = chay(["prod"]);
    expect(r.log).toMatch(/find src shared web\/src prisma templates public -type f ! -path 'public\/app2\/\*'/);
  });

  it("dump trước-deploy mang cùng cờ --no-owner --clean --if-exists với dump hằng đêm", () => {
    const co = (s) => /pg_dump[^\n|]*--no-owner[^\n|]*--clean[^\n|]*--if-exists/.test(s);
    expect(co(readFileSync(join(ROOT, "deploy.sh"), "utf8"))).toBe(true);
    expect(co(readFileSync(join(ROOT, "scripts/backup/backup-db.sh"), "utf8"))).toBe(true);
  });

  it("nạp lại quy tắc Prometheus sau deploy (không chờ ai reload tay)", () => {
    const r = chay(["prod"]);
    expect(r.log).toMatch(/docker kill -s HUP quanly-prometheus/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// Soát chéo 2026-09-24 (nhóm g8): ops#6, ops#7, ops#8, ops#10.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** Lệnh đã gửi sang máy chủ (qua ssh giả) có chứa `dau`. */
const lenhTuXa = (log, dau) => log.split("\n---\n").find((c) => c.includes(dau)) ?? "";
const posix = (p) => p.replace(/\\/g, "/");

/** Chạy TẠI CHỖ một lệnh deploy.sh gửi sang máy chủ, sau khi thay đường dẫn máy chủ bằng thư mục tạm. */
function chayTaiCho(lenh, thayThe, { stubDocker = null, env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ops-deploy-taicho-"));
  rac.push(dir);
  let s = lenh;
  for (const [a, b] of thayThe) s = s.split(a).join(b);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  if (stubDocker) {
    writeFileSync(join(bin, "docker"), stubDocker);
    chmodSync(join(bin, "docker"), 0o755);
  }
  const r = spawnSync("bash", ["-c", s], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("ops#6 — [3c/6] không bỏ lọt DROP trong migration LỚN (pipefail + grep -q → SIGPIPE 141)", () => {
  it("DROP ở đầu một tệp SQL ~400KB → prod vẫn dừng trước migrate", () => {
    const dir = mkdtempSync(join(tmpdir(), "ops-sql-lon-"));
    rac.push(dir);
    const f = join(dir, "migration.sql");
    writeFileSync(f, 'ALTER TABLE "x" DROP COLUMN "y";\n' + "INSERT INTO t VALUES (1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');\n".repeat(10000));
    const r = chay(["prod"], { STUB_SQL_FILE: f });
    expect(r.code, "migration huỷ lọt qua chốt [3c/6] vì SIGPIPE").not.toBe(0);
    expect(r.out).toMatch(/migration HUỶ\/ĐỔI DẠNG đang chờ: 20990101000000_huy/);
    expect(r.log).not.toMatch(/prisma migrate deploy/);
  });
});

describe("ops#7 — [2c/6] chỉ so đúng các tệp install-backup.sh cài, tách 'lệch' khỏi 'không đọc được'", () => {
  const CAI = [...readFileSync(join(ROOT, "scripts/backup/install-backup.sh"), "utf8")
    .matchAll(/^install -m \d+ "\$SRC\/([a-z-]+\.sh)"/gm)].map((m) => m[1]).sort();

  function chuanBiHost(danhSach, sua = {}) {
    const bk = mkdtempSync(join(tmpdir(), "ops-bk-host-"));
    rac.push(bk);
    for (const n of danhSach) {
      writeFileSync(join(bk, n), sua[n] ?? readFileSync(join(ROOT, "scripts/backup", n)));
    }
    return bk;
  }
  function chay2c(bk) {
    const lenh = lenhTuXa(chay(["prod"]).log, "/opt/quanly");
    expect(lenh, "không thấy lệnh [2c/6] gửi sang máy chủ").not.toBe("");
    return chayTaiCho(lenh, [["cd /opt/stacks/quanly/quanly", `cd '${posix(ROOT)}'`], ["BK=/opt/quanly", `BK='${posix(bk)}'`]]);
  }

  it("install-backup.sh cài đúng 6 tệp, và install-backup.sh KHÔNG nằm trong số đó", () => {
    expect(CAI).toEqual(["backup-db.sh", "backup-objects.sh", "backup-watchdog.sh", "offhost-lib.sh", "restore-drill.sh", "restore-test.sh"]);
  });

  it("danh sách deploy.sh [2c/6] duyệt TRÙNG tập tệp install-backup.sh cài (không trôi khỏi nhau)", () => {
    const m = readFileSync(join(ROOT, "deploy.sh"), "utf8").match(/^BK_TEP="([^"]+)"/m);
    expect(m, "deploy.sh không khai BK_TEP").not.toBeNull();
    expect(m[1].split(/\s+/).sort()).toEqual(CAI);
  });

  it("host đã cài ĐÚNG bản repo → không một dòng cảnh báo nào (trước đây luôn báo THIẾU install-backup.sh)", () => {
    const r = chay2c(chuanBiHost(CAI));
    expect(r.out.trim(), r.out).toBe("");
  });

  it("một tệp khác nội dung → LỆCH đúng tệp đó; thiếu một tệp → THIẾU", () => {
    const bk = chuanBiHost(CAI.filter((n) => n !== "restore-test.sh"), { "backup-db.sh": "#!/bin/sh\necho cu\n" });
    const r = chay2c(bk);
    expect(r.out).toMatch(/^LỆCH \S*backup-db\.sh$/m);
    expect(r.out).toMatch(/^THIẾU \S*restore-test\.sh$/m);
    expect(r.out).not.toMatch(/backup-objects\.sh/);
  });

  it("host chưa từng cài bộ sao lưu → MỘT dòng, không phải 6–7 dòng THIẾU", () => {
    const r = chay2c(join(tmpdir(), "khong-ton-tai-ops-bk-" + Date.now()));
    expect(r.out.trim().split("\n")).toHaveLength(1);
    expect(r.out).toMatch(/CHƯA CÀI/);
  });
});

describe("ops#8 — [5d/6] cảnh báo khi container Prometheus cũ thiếu QUANLY_ENV, kiểm nạp cấu hình sau HUP", () => {
  const STUB_DOCKER_QS = `#!/usr/bin/env bash
case "$*" in
  "inspect "*) exit 0;;
  *"printenv QUANLY_ENV"*) [ -n "\${STUB_QENV:-}" ] && { echo "$STUB_QENV"; exit 0; }; exit 1;;
  *prometheus_config_last_reload_successful*|*"wget"*) echo "prometheus_config_last_reload_successful \${STUB_RELOAD:-1}"; exit 0;;
esac
exit 0
`;
  function chay5d(env) {
    const lenh = lenhTuXa(chay(["prod"]).log, "quanly-prometheus");
    expect(lenh).not.toBe("");
    const tam = mkdtempSync(join(tmpdir(), "ops-5d-"));
    rac.push(tam);
    return chayTaiCho(lenh, [["cd /opt/stacks/quanly/quanly", `cd '${posix(tam)}'`], ["sleep 2", "true"]], { stubDocker: STUB_DOCKER_QS, env });
  }

  it("container không có QUANLY_ENV → cảnh báo to kèm lệnh up -d, không chỉ 'đã gửi SIGHUP'", () => {
    const r = chay5d({ STUB_QENV: "" });
    expect(r.out).toMatch(/QUANLY_ENV/);
    expect(r.out).toMatch(/up -d prometheus/);
  });

  it("container có QUANLY_ENV và nạp thành công → không cảnh báo", () => {
    const r = chay5d({ STUB_QENV: "prod" });
    expect(r.out).not.toMatch(/⚠️/);
    expect(r.out).toMatch(/prometheus: đã nạp lại/);
  });

  it("nạp cấu hình HỎNG sau HUP (prometheus_config_last_reload_successful 0) → cảnh báo", () => {
    const r = chay5d({ STUB_QENV: "prod", STUB_RELOAD: "0" });
    expect(r.out).toMatch(/⚠️.*prometheus.*nạp/);
  });
});

describe("ops#10 — kéo ảnh phụ thuộc (minio quay.io) TRƯỚC migrate, lỗi kéo ảnh không bị báo là 'MIGRATE HỎNG'", () => {
  it("có bước kéo ảnh phụ thuộc riêng, đứng trước prisma migrate deploy", () => {
    const r = chay(["prod"]);
    const iPull = r.log.search(/compose -f docker-compose\.prod\.yml pull --policy missing[^\n]*minio/);
    const iMig = r.log.indexOf("prisma migrate deploy");
    expect(iPull, "không có bước kéo ảnh phụ thuộc riêng").toBeGreaterThan(-1);
    expect(iPull).toBeLessThan(iMig);
  });

  it("kéo ảnh hỏng → dừng với thông báo RIÊNG, không chạy migrate, không in hướng dẫn migrate resolve", () => {
    const r = chay(["prod"], { STUB_PULL_RC: "1" });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/KÉO ẢNH PHỤ THUỘC HỎNG/);
    expect(r.out).not.toMatch(/MIGRATE HỎNG/);
    expect(r.log).not.toMatch(/prisma migrate deploy/);
  });
});
