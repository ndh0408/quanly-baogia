// Cụm quote-concurrency — DB_TX_MAX_WAIT / DB_TX_TIMEOUT không đi qua lớp kiểm cấu hình.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `src/db.ts` đọc THẲNG `Number(process.env.DB_TX_TIMEOUT) || 60_000`. Không khai ở `src/config.ts`
// nên KHÔNG có lớp kiểm nào lúc khởi động, và không có trong `.env.example` nên người vận hành
// không biết nó tồn tại, càng không biết ĐƠN VỊ là mili-giây.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// `DB_TX_TIMEOUT=5` (người đọc chữ "timeout" tưởng là 5 GIÂY) → 5 mili-giây → MỌI `$transaction`
// trong repo (lưu báo giá, tạo báo giá, nhập Excel, snapshot phiên bản, /pay, saveHn) chết P2028
// ngay lập tức. `DB_TX_TIMEOUT=-1` cũng lọt vì số âm là truthy nên `||` không đỡ.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Ứng dụng khởi động BÌNH THƯỜNG rồi đứng ở chế độ CHỈ-ĐỌC: mọi lần bấm Lưu trả 500 "Lỗi server".
// Đúng thứ mà chú thích ở src/config.ts:92 nói phải chặn ("DB_POOL_MAX=abc lặng lẽ thành 20").
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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
        env: { ...process.env, NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5432/x", ...env },
      }
    );
    return { ma: 0, out };
  } catch (e) {
    return { ma: e.status ?? -1, out: `${e.stdout || ""}${e.stderr || ""}` };
  }
}

describe("DB_TX_MAX_WAIT / DB_TX_TIMEOUT phải đi qua lớp kiểm lúc khởi động", () => {
  it("DB_TX_TIMEOUT=5 (nhầm giây với mili-giây) → THOÁT NGAY, nêu tên biến", () => {
    const r = napConfig({ DB_TX_TIMEOUT: "5" });
    expect(r.ma, "5ms làm mọi $transaction chết P2028 — phải chặn lúc khởi động, không để chạy").toBe(1);
    expect(r.out).toContain("DB_TX_TIMEOUT");
  });

  it("DB_TX_TIMEOUT=-1 → THOÁT NGAY (số âm lọt qua `Number(x) || mặc_định`)", () => {
    const r = napConfig({ DB_TX_TIMEOUT: "-1" });
    expect(r.ma).toBe(1);
    expect(r.out).toContain("DB_TX_TIMEOUT");
  });

  it("DB_TX_MAX_WAIT=abc → THOÁT NGAY, nêu tên biến", () => {
    const r = napConfig({ DB_TX_MAX_WAIT: "abc" });
    expect(r.ma).toBe(1);
    expect(r.out).toContain("DB_TX_MAX_WAIT");
  });

  it("giá trị hợp lệ vẫn khởi động được (không siết quá tay)", () => {
    expect(napConfig({ DB_TX_MAX_WAIT: "8000", DB_TX_TIMEOUT: "30000" }).ma).toBe(0);
  });

  it("bỏ trống (dòng `DB_TX_TIMEOUT=` trong .env) = CHƯA ĐẶT, không phải số 0", () => {
    expect(napConfig({ DB_TX_MAX_WAIT: "", DB_TX_TIMEOUT: "" }).ma).toBe(0);
  });

  it(".env.example tài liệu hoá cả hai biến KÈM đơn vị mili-giây", () => {
    const envExample = readFileSync(path.join(ROOT, ".env.example"), "utf8");
    for (const k of ["DB_TX_MAX_WAIT", "DB_TX_TIMEOUT"]) {
      expect(envExample, `${k} phải có trong .env.example`).toMatch(new RegExp(`^#?\\s*${k}=`, "m"));
    }
    // Đơn vị là cái làm người vận hành đặt sai; phải nói ra chữ.
    expect(envExample, "phải ghi rõ đơn vị mili-giây cho hai biến timeout").toMatch(/mili-giây|milli|ms\b/i);
  });

  it("biến hạ tầng khác mà mã nguồn đọc thẳng process.env cũng phải có trong .env.example", () => {
    const envExample = readFileSync(path.join(ROOT, ".env.example"), "utf8");
    for (const k of ["RETAIN_EXPORT_DAYS", "EXPORT_JOB_LOCK_MS", "EXPORT_WORKER_CONCURRENCY"]) {
      expect(envExample, `${k} được mã nguồn đọc nhưng .env.example không nhắc tới`).toMatch(new RegExp(`^#?\\s*${k}=`, "m"));
    }
  });
});
