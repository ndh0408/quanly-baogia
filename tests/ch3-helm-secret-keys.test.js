// Cụm cấu-hình-dọn-rác — khoá trong `secrets:` của Helm phải là khoá ứng dụng THẬT SỰ đọc.
//
// ── VẤN ĐỀ CÓ THẬT ─────────────────────────────────────────────────────────
// `infra/helm/quanly/values.yaml` khai `STRIPE_SECRET_KEY` và `STRIPE_WEBHOOK_SECRET`. Repo
// KHÔNG có tích hợp Stripe: không phụ thuộc `stripe`, không mã nào đọc hai biến đó, `src/config.ts`
// không khai chúng trong schema. Nhưng `templates/secret.yaml:12` là
// `{{- range $k, $v := .Values.secrets }}` — nghĩa là MỌI khoá ở đây được đẩy nguyên vào Secret của
// k8s rồi vào biến môi trường của pod.
//
// HẬU QUẢ: file mẫu mời người vận hành đi lấy khoá bí mật Stripe thật rồi nhét vào cụm production
// cho một tính năng không tồn tại — bí mật thừa nằm trong etcd và trong mọi bản sao lưu chart, đổi
// lấy đúng con số không. Đây cùng loại lỗi với biến chết trong `.env.example`, và `.env.example` đã
// có chốt tự động (tests/env-example.test.js) trong khi Helm thì chưa.
//
// Luật dưới đây tổng quát: khoá nào ứng dụng không đọc VÀ chart cũng không dùng thì không được
// đứng trong bảng bí mật.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHART = path.join(ROOT, "infra/helm/quanly");
const valuesSrc = readFileSync(path.join(CHART, "values.yaml"), "utf8");

/**
 * Khoá con của khối `secrets:` ở cấp gốc values.yaml.
 * Tự viết thay vì kéo thêm gói YAML: chỉ cần các dòng thụt đúng 2 dấu cách ngay dưới `secrets:`.
 */
function khoaTrongSecrets() {
  const lines = valuesSrc.split("\n");
  const i = lines.findIndex((l) => /^secrets:\s*$/.test(l));
  expect(i, "không tìm thấy khối `secrets:` ở cấp gốc values.yaml").toBeGreaterThan(-1);
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (/^\S/.test(l)) break; // hết khối (sang khoá cấp gốc kế tiếp)
    const m = l.match(/^ {2}([A-Z][A-Z0-9_]*):/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Toàn bộ mã ứng dụng — nơi duy nhất một biến môi trường có thể được đọc. */
function nguonUngDung() {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist"].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|mjs|cjs)$/.test(e.name)) files.push(p);
    }
  };
  for (const d of ["src", "scripts", "prisma", "shared"]) {
    try {
      walk(path.join(ROOT, d));
    } catch {
      /* thư mục có thể không tồn tại */
    }
  }
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

/** Template của chart — một khoá có thể chỉ phục vụ chính chart (vd ghép chuỗi kết nối). */
function nguonTemplate() {
  const dir = path.join(CHART, "templates");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}

describe("Helm values.yaml — bảng `secrets:` không chứa khoá chết", () => {
  it("mọi khoá đều được ứng dụng đọc, hoặc được chính chart dùng", () => {
    const khoa = khoaTrongSecrets();
    expect(khoa.length, "bộ trích xuất không thấy khoá nào — luật này sẽ luôn xanh giả").toBeGreaterThan(5);

    const app = nguonUngDung();
    const tpl = nguonTemplate();

    const chet = khoa.filter(
      (k) =>
        // đọc qua schema của src/config.ts (`  TEN_BIEN:`) …
        !new RegExp(`^\\s{2}${k}:`, "m").test(app) &&
        // … hoặc đọc thẳng process.env …
        !app.includes(`process.env.${k}`) &&
        // … hoặc chính chart dùng (vd _helpers.tpl ghép DATABASE_URL / REDIS_URL).
        !tpl.includes(k)
    );

    expect(
      chet,
      `Khoá trong values.yaml \`secrets:\` mà KHÔNG ai đọc: ${chet.join(", ")}.\n` +
        `templates/secret.yaml đẩy MỌI khoá ở đây vào Secret k8s rồi vào env của pod — khoá chết là ` +
        `lời mời người vận hành nạp bí mật thật cho một tính năng không tồn tại.`
    ).toEqual([]);
  });
});
