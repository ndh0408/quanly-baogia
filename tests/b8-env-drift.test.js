// Chiều NGƯỢC của tests/env-example.test.js.
//
// tests/env-example.test.js chỉ đi theo MỘT chiều: mọi khoá trong `z.object({...})` của
// src/config.ts phải có mặt trong .env.example. Chiều đó bỏ lọt đúng lớp biến nguy hiểm nhất:
// biến mà mã nguồn đọc THẲNG qua `process.env`, không đi qua schema — nó vừa không được kiểm
// lúc khởi động, vừa không được ghi ở .env.example, nên người vận hành không có cách nào biết
// nó tồn tại.
//
// Ví dụ đã đo lúc viết bài test này: `PII_ENC_KEY_OLD` (src/piiBox.ts:58 `const before =
// process.env.PII_ENC_KEY_OLD || "";` và src/tools/piiRotate.ts:39) là KHOÁ GIẢI MÃ CŨ của toàn
// bộ PII trong cửa sổ xoay khoá — mất nó là mất dữ liệu — mà `grep -c PII_ENC_KEY_OLD
// src/config.ts` = 0 và .env.example cũng không có dòng nào.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envExample = readFileSync(path.join(ROOT, ".env.example"), "utf8");
const configSrc = readFileSync(path.join(ROOT, "src/config.ts"), "utf8");

function fileTs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) fileTs(p, out);
    else if (/\.(ts|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Tên biến xuất hiện trong .env.example, kể cả dòng đã comment (`# FOO=`). */
const bienTrongEnvExample = () =>
  new Set([...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

/** Khoá khai trong `const schema = z.object({ ... })` của src/config.ts. */
function bienTrongSchema() {
  const start = configSrc.indexOf("z.object({");
  const end = configSrc.indexOf("\n});", start);
  return new Set([...configSrc.slice(start, end).matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]));
}

describe("src/ ↔ .env.example (chiều ngược)", () => {
  it("mọi biến đọc thẳng qua process.env trong src/ đều có trong schema HOẶC .env.example", () => {
    const src = fileTs(path.join(ROOT, "src")).map((f) => readFileSync(f, "utf8")).join("\n");
    const doc = new Set(
      [...src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g), ...src.matchAll(/process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g)]
        .map((m) => m[1])
    );
    expect(doc.size, "bộ quét không tìm thấy biến nào — regex hỏng").toBeGreaterThan(20);

    const schema = bienTrongSchema();
    const example = bienTrongEnvExample();
    const thieu = [...doc].filter((k) => !schema.has(k) && !example.has(k)).sort();
    expect(
      thieu,
      `Mã nguồn đọc thẳng process.env cho các biến sau mà KHÔNG khai ở src/config.ts, cũng KHÔNG ghi ở .env.example:\n` +
        `  ${thieu.join(", ")}\n` +
        `Biến không ở cả hai nơi = không được kiểm lúc khởi động VÀ người vận hành không biết nó tồn tại.\n` +
        `Đưa vào schema config.ts (nếu cần kiểm giá trị) hoặc ít nhất ghi một dòng có chú thích ở .env.example.`
    ).toEqual([]);
  });

  it(".env.example KHÔNG mô tả WEBHOOK_SECRET như một lớp bảo vệ đang chạy", () => {
    // src/config.ts:74-77 đã ghi rõ `[KHÔNG DÙNG]` — webhook đi được ký bằng secret RIÊNG của từng
    // webhook (Webhook.secret). Nhưng người vận hành đọc .env.example chứ không đọc config.ts, và ở
    // đó vẫn viết "Ký webhook ĐI. Không đặt → không ký" — tức mời người ta đặt một giá trị rồi tin
    // là đã bật một lớp bảo vệ không tồn tại.
    const khoi = envExample
      .split(/\n/)
      .map((l, i, all) => (l.startsWith("# WEBHOOK_SECRET=") || l.startsWith("WEBHOOK_SECRET=") ? all.slice(Math.max(0, i - 4), i + 1).join("\n") : null))
      .find(Boolean);
    expect(khoi, "không tìm thấy dòng WEBHOOK_SECRET trong .env.example").toBeTruthy();
    expect(khoi).toMatch(/KHÔNG DÙNG/);
    expect(khoi).not.toMatch(/Ký webhook ĐI\. Không đặt/);
  });
});
