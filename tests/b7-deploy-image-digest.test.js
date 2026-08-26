/**
 * ============================================================================
 * B7 · prod-deploy-bypasses-supply-chain — deploy phải có đường KHÔNG dựng image trên VM.
 *
 * LỖI LÀ GÌ
 *   .github/workflows/ci.yml dựng image, đẩy lên ghcr kèm `provenance: mode=max` + `sbom: true`,
 *   smoke-test theo digest rồi in ra lệnh `helm upgrade … --set image.digest=…`. Nhưng đường
 *   ĐANG CHẠY THẬT (deploy.sh) không chạm vào chuỗi đó một chút nào: nó `git archive` mã nguồn
 *   lên VM rồi `docker compose build app` NGAY TRÊN VM. Image production vì thế không có digest
 *   nào để đối chiếu, không SBOM, không provenance, và phụ thuộc npm được giải lại trên máy chủ
 *   ở thời điểm deploy — hai lượt deploy cùng một commit có thể ra hai image khác nhau.
 *
 * TÁI HIỆN
 *   Thay `ssh`/`git`/`docker` bằng stub ghi lại mọi lệnh, chạy deploy.sh và đọc log lệnh.
 *   Trên mã cũ: luôn có `compose … build app`, không bao giờ có `docker pull …@sha256:…`,
 *   và không có cách nào truyền digest vào.
 *
 * HẬU QUẢ
 *   Không chứng minh được thứ đang chạy trên production đúng là thứ CI đã dựng và quét.
 *   Rollback cũng chỉ có tag cục bộ `:rollback`, không có bản bất biến để quay về.
 *
 * PHẠM VI ĐÃ VÁ (nói thẳng): deploy.sh KHÔNG bị ép buộc phải dùng digest — VM có kéo được
 * ghcr hay không thì chưa kiểm được từ đây, và bắt buộc sẽ làm hỏng đường deploy đang chạy.
 * Bản vá thêm ĐƯỜNG digest (khi có `IMAGE_REF`) + cảnh báo rõ khi không có.
 * ============================================================================
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DIGEST_REF = "ghcr.io/ndh0408/quanly-baogia@sha256:1c1f5c0f9b3f5f3f2b7ac9dbb4f2f4b23f7c1f0e6a5d4c3b2a1908f7e6d5c4b3";

/** ssh stub: ghi lại lệnh, trả kết quả tối thiểu để deploy.sh đi hết 6 bước. */
const STUB_SSH = `#!/usr/bin/env bash
shift
printf '%s\\n' "$*" >> "$STUB_DIR/ssh.log"
case "$*" in
  *livez*) echo '{"ok":true}';;
esac
exit 0
`;
const STUB_GIT = `#!/usr/bin/env bash
case "$1" in rev-parse) echo 1111111111111111111111111111111111111111; exit 0;; esac
exit 0
`;

const rac = [];
afterEach(() => {
  while (rac.length) rmSync(rac.pop(), { recursive: true, force: true });
});

function chayDeploy(env) {
  const dir = mkdtempSync(join(tmpdir(), "b7-supply-"));
  rac.push(dir);
  const bin = join(dir, "bin");
  const stub = join(dir, "stub");
  for (const d of [bin, stub]) mkdirSync(d);
  for (const [n, b] of [
    ["ssh", STUB_SSH],
    ["git", STUB_GIT],
  ]) {
    writeFileSync(join(bin, n), b);
    chmodSync(join(bin, n), 0o755);
  }
  let code = 0;
  let out;
  try {
    out = execFileSync("bash", [join(ROOT, "deploy.sh"), "prod"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_DIR: stub, HOME: dir, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    });
  } catch (e) {
    code = e.status ?? 1;
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const logFile = join(stub, "ssh.log");
  return { code, out, log: existsSync(logFile) ? readFileSync(logFile, "utf8") : "" };
}

describe("[b7] deploy.sh: có đường triển khai theo digest do CI dựng", () => {
  it("IMAGE_REF ghim digest → kéo đúng digest đó, KHÔNG dựng image trên VM", () => {
    const { code, log } = chayDeploy({ IMAGE_REF: DIGEST_REF });
    expect(code, "deploy theo digest phải chạy trót lọt").toBe(0);
    expect(log, "không thấy lệnh kéo image theo digest").toMatch(/docker pull \S+@sha256:[0-9a-f]{64}/);
    expect(log, "vẫn dựng image ngay trên VM dù đã ghim digest").not.toMatch(/compose -f \S+ build/);
    expect(log, "image kéo về chưa được gắn tag mà compose dùng").toMatch(/docker tag \S+@sha256:[0-9a-f]{64} quanly-app:prod/);
  });

  it("IMAGE_REF là tag DI ĐỘNG (không có @sha256:) → từ chối, không deploy", () => {
    const { code, log } = chayDeploy({ IMAGE_REF: "ghcr.io/ndh0408/quanly-baogia:v1" });
    expect(code, "tag di động vẫn được nhận → không có gì bất biến để rollback về").not.toBe(0);
    expect(log, "đã kịp chạy lệnh trên máy chủ trước khi từ chối").not.toMatch(/docker (pull|tag)/);
  });

  it("không đặt IMAGE_REF → vẫn deploy được, nhưng phải nói rõ là đang dựng trên VM", () => {
    const { code, out, log } = chayDeploy({});
    expect(code, "đường deploy cũ phải giữ nguyên (VM có thể không kéo được ghcr)").toBe(0);
    expect(log, "đường cũ vẫn phải dựng image").toMatch(/compose -f \S+ build app/);
    expect(out, "không cảnh báo gì về việc bỏ qua chuỗi cung ứng của CI").toMatch(/IMAGE_REF/);
  });
});
