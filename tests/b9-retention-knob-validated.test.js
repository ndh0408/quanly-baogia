/**
 * ============================================================================
 * NÚT XOÁ NHẬT KÝ KIỂM TOÁN phải đi qua lớp kiểm — `retain-audit-days-unvalidated`.
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────
 * src/retention.ts đọc thẳng `Number(process.env.RETAIN_AUDIT_DAYS) || 730`. Dạng đó nuốt hai
 * loại sai cấu hình theo hai kiểu KHÁC NHAU:
 *   · "abc" → NaN → falsy → rơi về 730. Sai cấu hình thành im lặng.
 *   · "-5"  → TRUTHY, đi thẳng vào `days(-5)` = mốc trong TƯƠNG LAI, và
 *     `deleteMany({ createdAt: { lt: mốc } })` khi ấy xoá SẠCH nhật ký kiểm toán.
 * Job prune chạy TỰ ĐỘNG hằng ngày — không ai bấm nút, không có bước xác nhận.
 *
 * ── BẢN VÁ ──────────────────────────────────────────────────────────────────
 * Khai trong schema của src/config.ts (`.int().positive()`, riêng RETAIN_EXPORT_DAYS là
 * `.nonnegative()` vì 0 = tắt là giá trị hợp lệ), và src/retention.ts đọc qua `config`.
 * Gõ sai = chết ngay lúc khởi động kèm tên biến.
 * ============================================================================
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";

const GOC = { ...process.env };
beforeEach(() => { process.env = { ...GOC }; });
afterEach(() => { process.env = { ...GOC }; vi.resetModules(); });

/** Bỏ mọi dòng chú thích — phép kiểm dưới đây nói về MÃ CHẠY, không về văn bản giải thích. */
const boChuThich = (src) =>
  src.split("\n").filter((d) => !d.trim().startsWith("//") && !d.trim().startsWith("*")).join("\n");

/**
 * Nạp lại src/config.ts với env đã dựng sẵn; trả về lỗi nếu schema từ chối.
 *
 * `config.ts` phân tích env NGAY LÚC NẠP MODULE và `process.exit(1)` khi hỏng, nên không gọi thẳng
 * được trong tiến trình test. Thay vào đó chạy nó ở TIẾN TRÌNH CON — vừa đo được đúng hành vi
 * "chết lúc khởi động", vừa không kéo cả tiến trình vitest theo.
 */
function napConfig(env) {
  const { spawnSync } = require("node:child_process");
  const r = spawnSync(
    "npx",
    ["tsx", "-e", 'import("./src/config.js").then(m => console.log("CFG:" + JSON.stringify(m.config)))'],
    { encoding: "utf8", env: { ...GOC, ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)])) }, timeout: 60000 },
  );
  const ra = String(r.stdout || "") + String(r.stderr || "");
  const m = /CFG:(\{.*\})/.exec(ra);
  if (r.status === 0 && m) return { ok: true, config: JSON.parse(m[1]) };
  return { ok: false, loi: ra };
}

describe("retention: src/retention.ts KHÔNG được đọc thẳng process.env", () => {
  it("bốn nút vòng đời dữ liệu đều lấy từ `config`, không phải process.env", () => {
    const src = boChuThich(readFileSync("src/retention.ts", "utf8"));
    for (const ten of ["RETAIN_AUDIT_DAYS", "RETAIN_LOGIN_DAYS", "RETAIN_WEBHOOK_DAYS", "RETAIN_VERSION_KEEP", "RETAIN_EXPORT_DAYS"]) {
      expect(src, `${ten} vẫn đọc thẳng process.env — bỏ qua lớp kiểm của config.ts`)
        .not.toContain(`process.env.${ten}`);
      expect(src, `${ten} không thấy lấy từ config`).toContain(`config.${ten}`);
    }
  });

  it("cả năm nút đều được khai trong schema của config.ts", () => {
    const src = readFileSync("src/config.ts", "utf8");
    for (const ten of ["RETAIN_AUDIT_DAYS", "RETAIN_LOGIN_DAYS", "RETAIN_WEBHOOK_DAYS", "RETAIN_VERSION_KEEP", "RETAIN_EXPORT_DAYS"]) {
      expect(src, `${ten} chưa có trong schema → gõ sai vẫn qua`).toMatch(new RegExp(`${ten}:\\s*numEnv`));
    }
  });
});

describe("config từ chối giá trị phá dữ liệu", () => {
  it("RETAIN_AUDIT_DAYS ÂM → chết lúc khởi động, KHÔNG im lặng xoá sạch nhật ký", async () => {
    const r = await napConfig({ RETAIN_AUDIT_DAYS: "-5" });
    expect(r.ok, "giá trị âm vẫn được nhận — days(-5) cho mốc TƯƠNG LAI, xoá sạch AuditEvent").toBe(false);
    expect(r.loi).toMatch(/RETAIN_AUDIT_DAYS/);
  });

  it("RETAIN_AUDIT_DAYS = 0 cũng bị từ chối (giữ 0 ngày = xoá mọi thứ)", async () => {
    const r = await napConfig({ RETAIN_AUDIT_DAYS: "0" });
    expect(r.ok).toBe(false);
  });

  it("RETAIN_AUDIT_DAYS chữ → chết kèm TÊN BIẾN, không lặng lẽ rơi về mặc định", async () => {
    const r = await napConfig({ RETAIN_AUDIT_DAYS: "ba trăm" });
    expect(r.ok).toBe(false);
    expect(r.loi).toMatch(/RETAIN_AUDIT_DAYS/);
  });

  it("RETAIN_EXPORT_DAYS ÂM bị từ chối", async () => {
    const r = await napConfig({ RETAIN_EXPORT_DAYS: "-1" });
    expect(r.ok).toBe(false);
  });

  // ── KHÔNG ĐƯỢC PHÁ CẤU HÌNH ĐANG CHẠY ─────────────────────────────────────
  it("RETAIN_EXPORT_DAYS = 0 là HỢP LỆ — 0 nghĩa là TẮT, không phải sai", async () => {
    const r = await napConfig({ RETAIN_EXPORT_DAYS: "0" });
    expect(r.ok, "0 bị từ chối thì mặc định 'tắt dọn file xuất' không đặt tường minh được").toBe(true);
    expect(r.config.RETAIN_EXPORT_DAYS).toBe(0);
  });

  it("không đặt gì → dùng đúng mặc định cũ, không đổi hành vi", async () => {
    const r = await napConfig({});
    expect(r.ok).toBe(true);
    expect(r.config.RETAIN_AUDIT_DAYS).toBe(730);
    expect(r.config.RETAIN_LOGIN_DAYS).toBe(365);
    expect(r.config.RETAIN_WEBHOOK_DAYS).toBe(90);
    expect(r.config.RETAIN_VERSION_KEEP).toBe(100);
    expect(r.config.RETAIN_EXPORT_DAYS).toBe(0);
  });

  it("giá trị hợp lệ đi qua nguyên vẹn", async () => {
    const r = await napConfig({ RETAIN_AUDIT_DAYS: "1095", RETAIN_EXPORT_DAYS: "30" });
    expect(r.ok).toBe(true);
    expect(r.config.RETAIN_AUDIT_DAYS).toBe(1095);
    expect(r.config.RETAIN_EXPORT_DAYS).toBe(30);
  });
});
