// Cụm queue-storage — hook `postinstall` của package.json (codex-security-336mb-postinstall).
//
// LỖI: package.json khai `"postinstall": "node scripts/patch-codex-security-9router.mjs"`. Script đó
//   dài 503 dòng và dòng đầu thân của nó là `if (process.platform !== "win32") { process.exit(0) }` —
//   tức trên Linux (CI, mọi tầng của Dockerfile, máy chủ production) nó KHÔNG làm gì cả. Nó chỉ vá
//   cấu hình router cục bộ cho máy Windows của tác giả.
//
// TÁI HIỆN: `npm ci` bất kỳ trên Linux đều gọi hook này. Nó còn chắn ngang cả tầng `deps` của
//   Dockerfile — npm chạy postinstall kể cả với `--omit=dev`, nên tầng đó buộc phải `COPY scripts`
//   chỉ để hook có file mà chạy rồi thoát 0.
//
// HẬU QUẢ: một hook cài đặt vô nghĩa nằm trên đường build production, đúng chỗ đã từng làm gãy
//   `npm ci` nguyên lượt (xem docs/archive/audits/SECURITY_AUDIT_2026-08.md NEW-008). Bản vá router
//   thuộc về dotfile cá nhân của máy dev, không thuộc manifest dùng chung.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

describe("package.json — hook cài đặt", () => {
  it("KHÔNG có postinstall gọi bản vá chỉ-chạy-trên-Windows", () => {
    expect(pkg.scripts.postinstall ?? "").not.toMatch(/patch-codex-security/);
  });

  it("các script quét bảo mật chạy tay vẫn giữ nguyên (gọi binary theo tên, không cần hook)", () => {
    expect(pkg.scripts["security:scan"]).toBe("codex-security scan .");
    expect(pkg.scripts["security:scan:deep"]).toBe("codex-security scan . --mode deep");
  });

  it("hook `prepare` của husky KHÔNG bị đụng tới", () => {
    expect(pkg.scripts.prepare).toBe("husky || true");
  });
});
