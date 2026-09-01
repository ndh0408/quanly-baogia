// `.env.example` KHÔNG được lệch khỏi `src/config.ts`.
//
// ── VẤN ĐỀ CÓ THẬT ĐÃ DẪN TỚI BỘ TEST NÀY ───────────────────────────────────
// config.ts THOÁT NGAY ở production khi thiếu `JWT_SECRET` hoặc `MFA_ENC_KEY`. Trước khi sửa,
// `.env.example` KHÔNG hề nhắc tới hai biến đó, cũng không nhắc REDIS_URL, S3_*, SMTP_*,
// SENTRY_DSN, METRICS_TOKEN, WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, RETAIN_*, DB_POOL_MAX.
// Nghĩa là: người vận hành làm ĐÚNG THEO `.env.example` sẽ dựng ra một `.env` mà production
// KHÔNG KHỞI ĐỘNG ĐƯỢC, và thông điệp lỗi chỉ nói tên biến chứ không nói phải lấy giá trị ở đâu.
//
// Tài liệu lệch khỏi mã nguồn là chuyện chắc chắn xảy ra nếu chỉ dựa vào trí nhớ. Đây là chốt tự
// động: thêm biến vào schema mà quên ghi vào `.env.example` là ĐỎ, kèm đúng tên biến còn thiếu.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const configSrc = readFileSync(path.join(ROOT, "src/config.ts"), "utf8");
const envExample = readFileSync(path.join(ROOT, ".env.example"), "utf8");

/** Tên khoá khai trong `const schema = z.object({ ... })`. */
function bienTrongSchema() {
  const start = configSrc.indexOf("z.object({");
  expect(start, "không tìm thấy khối z.object({ trong src/config.ts").toBeGreaterThan(-1);
  const end = configSrc.indexOf("\n});", start);
  const block = configSrc.slice(start, end);
  return [...block.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
}

/** Tên biến xuất hiện trong `.env.example`, kể cả dòng đã comment (`# FOO=`). */
function bienTrongEnvExample() {
  return new Set([...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

describe(".env.example ↔ src/config.ts", () => {
  it("MỌI biến trong schema đều có mặt trong .env.example", () => {
    const schema = bienTrongSchema();
    expect(schema.length).toBeGreaterThan(20); // chốt: bộ trích xuất thật sự tìm thấy schema
    const coTrongExample = bienTrongEnvExample();
    const thieu = schema.filter((k) => !coTrongExample.has(k));
    expect(
      thieu,
      `Thiếu trong .env.example: ${thieu.join(", ")}.\n` +
        `Thêm biến vào src/config.ts thì PHẢI ghi kèm vào .env.example — người vận hành dựng .env từ file đó.`
    ).toEqual([]);
  });

  it("mọi biến .env.example đọc thật sự được mã nguồn dùng (không có biến chết)", () => {
    const declaredInExample = [...bienTrongEnvExample()];
    // Biến chỉ dùng cho seed/script, không đi qua config.ts.
    const NGOAI_LE = new Set(["ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_DISPLAY_NAME"]);

    // Quét toàn bộ mã nguồn tìm chỗ đọc process.env.<TÊN>.
    const files = [];
    const walk = (dir) => {
      for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|js|mjs)$/.test(e.name)) files.push(p);
      }
    };
    for (const d of ["src", "scripts", "prisma", "shared"]) {
      try { walk(path.join(ROOT, d)); } catch { /* thư mục có thể không tồn tại */ }
    }
    const allSrc = files.map((f) => readFileSync(f, "utf8")).join("\n");

    const chet = declaredInExample.filter(
      (k) => !NGOAI_LE.has(k) && !allSrc.includes(`process.env.${k}`) && !allSrc.includes(`${k}:`)
    );
    expect(
      chet,
      `Có trong .env.example nhưng KHÔNG mã nào đọc: ${chet.join(", ")}.\n` +
        `Biến chết dẫn người vận hành đi cấu hình một thứ không có tác dụng gì.`
    ).toEqual([]);
  });

  it("KHÔNG được lọt bí mật thật vào .env.example", () => {
    // Giá trị có nội dung thật (khác chuỗi rỗng / placeholder) trên một dòng KHÔNG comment.
    const dongCoGiaTri = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=(.+)$/gm)]
      .map((m) => ({ key: m[1], val: m[2].trim() }))
      .filter(({ val }) => val && val !== '""' && val !== "''");

    const AN_TOAN = /CHANGE_ME|localhost|127\.0\.0\.1|example\.com|gianguyen\.cloud|^(true|false|\d+)$|^"?(development|production|test|info|admin|auto)"?$|Quản trị viên|noreply@/i;
    const nghiNgo = dongCoGiaTri.filter(({ val }) => !AN_TOAN.test(val));
    expect(nghiNgo.map((x) => x.key), `Giá trị đáng ngờ (có thể là bí mật thật) trong .env.example`).toEqual([]);
  });
});
