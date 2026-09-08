// PII_ENC_KEY, KHI ĐÃ ĐẶT ở production, phải mạnh NGANG SESSION_SECRET/JWT_SECRET — chốt hồi quy
// (ultracode audit 2026-09-09, finding PII-3).
//
// ── LỖI ──────────────────────────────────────────────────────────────────────
// Schema ở src/config.ts chỉ đòi PII_ENC_KEY ≥16 ký tự cho MỌI môi trường — cùng ngưỡng SESSION_
// SECRET/JWT_SECRET ĐÃ TỪNG dùng trước khi bị siết lên 32 cho production. Đây là bí mật hậu quả
// nặng nhất khi mất/yếu trong cả hệ ("MẤT KHOÁ = MẤT DỮ LIỆU VĨNH VIỄN", SECURITY_MODEL.md) mà lại
// có ngưỡng kiểm YẾU HƠN. KHÔNG chặn khi THIẾU (đó là lựa chọn tự nhận có cảnh báo — xem
// SECURITY_MODEL.md), chỉ chặn khi CÓ ĐẶT nhưng yếu hoặc trùng bí mật khác.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAI = (n) => "a".repeat(n);

/** Nạp src/config.ts trong TIẾN TRÌNH CON — config đọc env rồi exit(1) ngay lúc nạp module. */
function napConfig(env) {
  try {
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", "-e", `import(${JSON.stringify(pathToFileURL(path.join(ROOT, "src/config.ts")).href)})`],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env, NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@localhost:5432/x",
          SESSION_SECRET: DAI(40), JWT_SECRET: DAI(41), MFA_ENC_KEY: DAI(20), APP_BASE_URL: "https://x.example",
          ...env,
        },
      }
    );
    return { ma: 0, out };
  } catch (e) {
    return { ma: e.status ?? -1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

describe("PII_ENC_KEY (khi đã đặt) phải đủ mạnh ở production", () => {
  it("KHÔNG đặt PII_ENC_KEY → vẫn khởi động (đúng chủ đích: cảnh báo, không chặn)", () => {
    const r = napConfig({ PII_ENC_KEY: "" });
    expect(r.ma, r.out).toBe(0);
  });

  it("đặt nhưng CHỈ 20 ký tự (qua ngưỡng schema 16, dưới ngưỡng production 32) → THOÁT NGAY", () => {
    const r = napConfig({ PII_ENC_KEY: DAI(20) });
    expect(r.ma, "20 ký tự qua được zod .min(16) nhưng phải bị chặn ở ngưỡng production 32").toBe(1);
    expect(r.out).toContain("PII_ENC_KEY");
  });

  it("đặt đủ dài (32) nhưng TRÙNG SESSION_SECRET → THOÁT NGAY", () => {
    const chung = DAI(40);
    const r = napConfig({ PII_ENC_KEY: chung, SESSION_SECRET: chung });
    expect(r.ma, "trùng bí mật khác thì rò một khoá là rò cả hai").toBe(1);
    expect(r.out).toContain("PII_ENC_KEY");
  });

  it("đặt đủ dài (32) nhưng TRÙNG MFA_ENC_KEY → THOÁT NGAY", () => {
    const chung = DAI(32);
    const r = napConfig({ PII_ENC_KEY: chung, MFA_ENC_KEY: chung });
    expect(r.ma).toBe(1);
    expect(r.out).toContain("PII_ENC_KEY");
  });

  it("đặt ≥32 ký tự và KHÁC mọi bí mật khác → khởi động bình thường", () => {
    const r = napConfig({ PII_ENC_KEY: DAI(64) });
    expect(r.ma, r.out).toBe(0);
  });

  it("KHÔNG áp ngưỡng 32 ở môi trường KHÁC production (dev/test vẫn chỉ cần 16 — không siết quá tay)", () => {
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", "-e", `import(${JSON.stringify(pathToFileURL(path.join(ROOT, "src/config.ts")).href)})`],
      {
        cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5432/x", PII_ENC_KEY: DAI(20) },
      }
    );
    expect(out).toBeDefined(); // không ném = exit 0
  });
});
