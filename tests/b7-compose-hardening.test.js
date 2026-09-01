/**
 * ============================================================================
 * B7 · compose prod/staging — ba mục còn hở của đường triển khai ĐANG CHẠY THẬT.
 *
 * 1. prod-compose-no-container-hardening
 *    `cap_drop` / `no-new-privileges` mới có ở `app` và `worker`. Hai service còn lại là
 *    hai KHO DỮ LIỆU (`postgres`, `redis`) — chúng chạy full capability và cho phép leo
 *    thang đặc quyền, trong khi bản k8s song sinh siết đủ (infra/k8s/postgres.yaml:42-46
 *    `allowPrivilegeEscalation: false` + `drop: ["ALL"]`). Chính chú thích của repo nói
 *    compose mới là thứ đang chạy thật.
 *
 * 2. prod-compose-no-resource-limits
 *    Trần RAM đã có ở mọi service, nhưng `grep -rn "cpus" docker-compose*.yml` trả về RỖNG:
 *    một vòng lặp thoát ly trong app/worker vẫn ăn hết CPU của VM, và Postgres — thứ phải
 *    ghi WAL đúng lúc đó — chỉ còn phần thừa.
 *
 * 3. compose-mutable-tags-and-no-log-rotation
 *    `:latest` đã hết, nhưng `postgres:16-alpine` và `redis:7-alpine` vẫn là tag DI ĐỘNG:
 *    dựng lại VM sau sự cố có thể ra một minor Postgres khác với minor đã sinh bản dump.
 *
 * TÁI HIỆN
 *   Lỗi cấu hình tĩnh, không có đầu vào để gọi — cách tái hiện lặp lại được là đọc chính
 *   file compose và khẳng định thuộc tính an toàn, đúng như tests/ic-infra-compose.test.js
 *   đang làm. Mỗi khối `it` dưới đây ĐỎ trên mã trước khi vá.
 * ============================================================================
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const FILES = ["docker-compose.prod.yml", "docker-compose.staging.yml"];

/** Cắt file compose thành từng khối service (parse bằng thụt lề — không kéo thêm thư viện YAML). */
function services(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (start < 0) throw new Error("không thấy khối `services:`");
  const out = {};
  let name = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && l.trim() !== "") break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l);
    if (m) {
      name = m[1];
      out[name] = [];
      continue;
    }
    if (name) out[name].push(l);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join("\n")]));
}
/** Bỏ dòng chú thích: phần giải thích VÌ SAO hay nhắc lại đúng cái tên xấu vừa bị loại bỏ. */
const code = (p) => read(p).replace(/^\s*#.*$/gm, "");

describe("[b7] compose prod/staging: siết cả kho dữ liệu, không chỉ app/worker", () => {
  it("prod-compose-no-container-hardening: MỌI service bỏ sạch capability + cấm leo thang", () => {
    for (const f of FILES) {
      for (const [name, body] of Object.entries(services(read(f)))) {
        expect(body, `${f} · ${name} thiếu cap_drop: ["ALL"]`).toMatch(/cap_drop:\s*\[\s*"ALL"\s*\]/);
        expect(body, `${f} · ${name} thiếu no-new-privileges`).toMatch(/security_opt:\s*\[\s*"no-new-privileges:true"\s*\]/);
      }
    }
  });

  it("prod-compose-no-resource-limits: MỌI service có trần CPU bên cạnh trần RAM", () => {
    for (const f of FILES) {
      for (const [name, body] of Object.entries(services(read(f)))) {
        // Trần RAM đã có chốt riêng ở tests/ic-infra-compose.test.js — ở đây chỉ đòi thêm trần CPU,
        // và nó phải nằm TRONG khối limits chứ không phải một khoá `cpus` lạc chỗ nào khác.
        expect(body, `${f} · ${name} không có deploy.resources.limits.cpus`).toMatch(
          /limits:\s*\n(?:\s+#.*\n|\s+memory:.*\n)*\s+cpus:\s*\S/
        );
      }
    }
  });

  it("compose-mutable-tags: image kho dữ liệu ghim theo digest, không phải tag di động", () => {
    for (const f of FILES) {
      for (const [name, body] of Object.entries(services(code(f)))) {
        const image = /^\s+image:\s*(\S+)\s*$/m.exec(body)?.[1];
        if (!image) continue; // service dựng tại chỗ (build:) — digest do chính repo quyết định
        if (/^quanly-app:/.test(image)) continue; // tag cục bộ do deploy.sh dựng/gắn
        expect(image, `${f} · ${name} dùng tag DI ĐỘNG "${image}" — dựng lại VM có thể ra bản khác`).toMatch(
          /@sha256:[0-9a-f]{64}$/
        );
      }
    }
  });
});
