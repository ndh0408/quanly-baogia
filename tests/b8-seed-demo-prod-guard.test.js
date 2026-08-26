// prisma/seed-demo.js phải TỪ CHỐI chạy ở production, không chỉ đòi một cờ.
//
// ── ĐO TRƯỚC KHI VIẾT ────────────────────────────────────────────────────────
// Chốt duy nhất của seed demo là `ALLOW_DEMO_SEED=1`. Nó KHÔNG hề nhìn NODE_ENV, trong khi script
// phá huỷ tương đương thì có: scripts/migration/pii-backfill.mjs:47-50 đòi
// `NODE_ENV === "production" && ALLOW_PII_BACKFILL_PROD !== "true"` mới dừng.
// Nghĩa là trên VM production, một lệnh `ALLOW_DEMO_SEED=1 DEMO_PASSWORD=... node
// prisma/seed-demo.js` chạy trót lọt — và prisma/seed-demo.js dùng client RAW (không có extension
// soft-delete), nên `deleteMany` ở phần "dọn dữ liệu demo cũ" là XOÁ THẬT.
//
// Bài test chạy script như một TIẾN TRÌNH THẬT (không import) vì chốt nằm ở đường thoát
// process.exit(1). DATABASE_URL trỏ vào cổng chết để nếu chốt hỏng thì cũng không đụng CSDL nào.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED = path.join(ROOT, "prisma/seed-demo.js");

const chay = (env) =>
  spawnSync(process.execPath, [SEED], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://none:none@127.0.0.1:1/none",
      DEMO_PASSWORD: "khong-phai-mat-khau-that-1234",
      ...env,
    },
  });

describe("prisma/seed-demo.js — chốt production", () => {
  it("NODE_ENV=production + ALLOW_DEMO_SEED=1 → TỪ CHỐI, nói rõ vì production", () => {
    const r = chay({ NODE_ENV: "production", ALLOW_DEMO_SEED: "1" });
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(1);
    expect(`${r.stderr}${r.stdout}`).toMatch(/production/i);
    // Không được chạm tới phần dọn dữ liệu.
    expect(`${r.stdout}`).not.toMatch(/Đã dọn dữ liệu demo cũ/);
  });

  it("có cờ vượt rào tường minh thì đi tiếp (chỉ dừng ở lỗi KẾT NỐI, không dừng ở chốt)", () => {
    const r = chay({ NODE_ENV: "production", ALLOW_DEMO_SEED: "1", ALLOW_DEMO_SEED_PROD: "true" });
    expect(r.status).toBe(1); // CSDL trỏ vào cổng chết
    expect(`${r.stderr}${r.stdout}`).not.toMatch(/Từ chối seed demo/);
  });

  it("ngoài production, thiếu ALLOW_DEMO_SEED vẫn bị chặn như cũ (không nới lỏng gì)", () => {
    const r = chay({ NODE_ENV: "development", ALLOW_DEMO_SEED: "" });
    expect(r.status).toBe(1);
    expect(`${r.stderr}`).toMatch(/ALLOW_DEMO_SEED/);
  });
});
