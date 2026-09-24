/**
 * OPS · DEP-11 — script bench không được ghi/xoá trên CSDL thật.
 *
 * LỖI (c450a46): scripts/bench/quote-save-bench.mjs nạp dist/db.js (dotenv đọc `.env`) rồi tạo và
 * `deleteMany` cứng dữ liệu, không kiểm DATABASE_URL trỏ đi đâu — `.env` còn trỏ production là bench
 * chạy trên production.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { kiemHaTangBench } from "../scripts/bench/chan-ha-tang.mjs";

const GOC = path.resolve(import.meta.dirname, "..");

describe("chốt hạ tầng của bench", () => {
  it("chỉ nhận máy cục bộ + CSDL test/bench", () => {
    expect(kiemHaTangBench("postgresql://u:p@127.0.0.1:5432/quanly_test?schema=public")).toBeNull();
    expect(kiemHaTangBench("postgresql://u:p@localhost:5432/quanly_bench")).toBeNull();
    expect(kiemHaTangBench("postgresql://u:p@10.0.0.5:5432/quanly_test")).toMatch(/không phải máy cục bộ/);
    expect(kiemHaTangBench("postgresql://u:p@127.0.0.1:5432/quanly")).toMatch(/không có chữ test/);
    expect(kiemHaTangBench("")).toMatch(/trống/);
  });

  it("chạy bench với DATABASE_URL trỏ máy lạ → thoát 1 TRƯỚC khi nạp dist/ hay kết nối", () => {
    const r = spawnSync(process.execPath, [path.join(GOC, "scripts/bench/quote-save-bench.mjs")], {
      cwd: GOC,
      env: { ...process.env, DATABASE_URL: "postgresql://quanly:x@prod.example:5432/quanly", BENCH_CHO_PHEP_HA_TANG_LA: "" },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/bench chỉ chạy trên CSDL test cục bộ/);
  });
});
