// Cụm middleware-obs — hai lỗi trong src/config.ts.
//
// ── LỖI 1: `.or()` làm `.min(32)` của SESSION_SECRET thành VÔ HIỆU ───────────
// `SESSION_SECRET: z.string().min(32, "...").or(z.string().min(1))`
// Union thì chỉ cần MỘT nhánh khớp: "short" khớp nhánh `min(1)` → hợp lệ, `min(32)` không chặn gì.
// Tệ hơn là khi CẢ HAI nhánh trượt (chuỗi rỗng), zod v4 gộp thành `invalid_union` với thông điệp
// "Invalid input", còn thông điệp thật thì nằm trong mảng lỗi lồng bên trong — mà vòng in lỗi ở
// config.ts chỉ in `issue.message`.
// TÁI HIỆN: chạy tiến trình con nạp src/config.ts với SESSION_SECRET="" → stderr in đúng
// "SESSION_SECRET: Invalid input", không nói được là thiếu hay quá ngắn.
// HẬU QUẢ: người vận hành nhận một thông điệp lỗi vô dụng đúng lúc đang dựng môi trường; và
// dev/staging chấp nhận secret 1 ký tự, rồi config.ts gán nó sang JWT_SECRET và secretbox lấy làm
// nguyên liệu khoá AES. (Production vẫn được chặn riêng ở lớp kiểm length < 32 phía dưới.)
//
// ── LỖI 2: bảng trạng thái khởi động NÓI SAI về webhook ──────────────────────
// featureStatus() có dòng `"Webhook đi (đã ký)": !!config.WEBHOOK_SECRET`, nhưng việc ký webhook
// KHÔNG dùng biến đó: src/webhooks.ts ký bằng secret RIÊNG của từng webhook (`decryptValue(h.secret)`).
// Không mã nào khác đọc WEBHOOK_SECRET.
// TÁI HIỆN: bỏ trống WEBHOOK_SECRET → log khởi động báo "Webhook đi (đã ký): false" dù webhook vẫn
// được ký bình thường.
// HẬU QUẢ: bảng trạng thái sinh ra để hết phải đoán lại tự nó nói sai — tệ hơn một biến chết thuần.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { featureStatus } from "../src/config.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Nạp src/config.ts trong TIẾN TRÌNH CON — config đọc env và exit(1) ngay lúc nạp module. */
function napConfig(env) {
  try {
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", "-e", `import(${JSON.stringify(pathToFileURL(path.join(ROOT, "src/config.ts")).href)})`],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5432/x", ...env },
      }
    );
    return { ma: 0, out };
  } catch (e) {
    return { ma: e.status ?? -1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

describe("SESSION_SECRET — thông điệp lỗi phải nói đúng vấn đề", () => {
  it("SESSION_SECRET rỗng → thoát 1 kèm thông điệp NÊU TÊN vấn đề, không phải 'Invalid input'", () => {
    const r = napConfig({ SESSION_SECRET: "" });
    expect(r.ma).toBe(1);
    expect(r.out).toContain("SESSION_SECRET");
    expect(r.out).not.toContain("Invalid input");
  });

  it("schema KHÔNG được dùng .or() cho SESSION_SECRET (làm .min() thành vô hiệu âm thầm)", () => {
    const src = readFileSync(path.join(ROOT, "src/config.ts"), "utf8");
    const dong = src.split("\n").find((l) => l.trim().startsWith("SESSION_SECRET:"));
    expect(dong, "không tìm thấy khai báo SESSION_SECRET").toBeTruthy();
    expect(dong).not.toContain(".or(");
  });

  it("secret hợp lệ vẫn khởi động bình thường (không siết nhầm dev)", () => {
    expect(napConfig({ SESSION_SECRET: "x".repeat(40) }).ma).toBe(0);
  });
});

describe("featureStatus", () => {
  it("KHÔNG được báo trạng thái ký webhook theo WEBHOOK_SECRET (nhãn sai)", () => {
    const khoa = Object.keys(featureStatus());
    expect(khoa.filter((k) => k.toLowerCase().includes("webhook"))).toEqual([]);
  });

  it("vẫn giữ các mục có thật (không xoá nhầm cả bảng)", () => {
    const s = featureStatus();
    expect(s).toHaveProperty("Mã hoá PII khi lưu");
    expect(s).toHaveProperty("Redis (hàng đợi/rate-limit/SSE)");
    expect(s).toHaveProperty("/metrics có token bảo vệ");
  });
});
