/**
 * ============================================================================
 * OPS · quan sát — soát chéo ops#9 và ops#11 (P3), đợt 2026-09-24.
 *
 * LỖI ops#9 (đọc mã ở 9bc2cf7)
 *   prom-client KHÔNG phát chuỗi nào cho Counter có nhãn cho tới lần `.inc()` đầu, nên
 *   `bullmq_jobs_failed_total{queue="email"}` / `dependency_calls_total{dep="smtp",status="error"}` xuất
 *   hiện lần đầu với giá trị 1 — `increase(…[15m])` trên chuỗi mới xuất hiện = 0. Lỗi ĐẦU TIÊN sau mỗi
 *   lần khởi động (tức sau mỗi deploy) không kích QuanlyJobNenThatBai / QuanlyPhuThuocNgoaiLoi.
 *   Sửa: khởi tạo mọi tổ hợp nhãn về 0 lúc khởi động (tập nhãn hữu hạn → cardinality không đổi).
 *
 * LỖI ops#11
 *   Secret `heartbeat_url` lấy từ biến HEARTBEAT_URL; compose đòi biến phải ĐƯỢC ĐỊNH NGHĨA. `.env` prod
 *   không có dòng này → lần đầu `up -d` lại ngăn quan sát thì alertmanager bị dựng lại rồi không start
 *   được — mất mọi cảnh báo. KHÔNG thêm vào .env.example (tests/env-example.test.js cấm biến chết); sửa
 *   bằng tài liệu + bước kiểm dừng TRƯỚC khi container cũ bị gỡ (cách A của phản biện).
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
// Redis db RIÊNG của luồng này (không đụng db của file test khác).
const REDIS_TEST_URL = "redis://127.0.0.1:6379/28";
const REDIS_URL_GOC = process.env.REDIS_URL;

let obs;
let q;
beforeAll(async () => {
  process.env.REDIS_URL = REDIS_TEST_URL;
  obs = await import("../src/observability.js");
  q = await import("../src/queue.js");
});
afterAll(() => {
  if (REDIS_URL_GOC === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = REDIS_URL_GOC;
});

describe("ops#9 — counter theo sự kiện có sẵn chuỗi 0 ngay lúc khởi động", () => {
  it("dependency_calls_total: đủ 3 dep × 2 status ở giá trị 0 ngay sau khi nạp module", async () => {
    const text = await obs.registry.metrics();
    for (const dep of ["smtp", "telegram", "s3"]) {
      for (const status of ["ok", "error"]) {
        expect(text, `thiếu chuỗi ${dep}/${status} — lỗi đầu tiên sau khởi động sẽ không kích cảnh báo`)
          .toMatch(new RegExp(`^dependency_calls_total\\{dep="${dep}",status="${status}"[^}]*\\} 0$`, "m"));
      }
    }
  });

  it("bullmq_jobs_failed_total{queue} có chuỗi 0 ngay khi createWorker dựng worker của hàng đợi đó", async () => {
    const w = q.createWorker("g8-kiem-dem-hong", async () => {}, 1);
    try {
      expect(w, "hàng đợi phải bật (REDIS_URL đã đặt)").not.toBeNull();
      const text = await obs.registry.metrics();
      expect(text).toMatch(/^bullmq_jobs_failed_total\{queue="g8-kiem-dem-hong"[^}]*\} 0$/m);
    } finally {
      await w?.close();
    }
  });
});

describe("ops#11 — HEARTBEAT_URL phải có dòng trong .env trước khi up -d ngăn quan sát", () => {
  it("MONITORING.md kiểm `^HEARTBEAT_URL=` TRƯỚC lệnh up -d, và nêu nguyên văn lỗi của compose", () => {
    const md = readFileSync(join(ROOT, "docs/operations/MONITORING.md"), "utf8");
    const iKiem = md.indexOf("grep -q '^HEARTBEAT_URL=' .env");
    const iUp = md.indexOf("-f infra/observability/docker-compose.observability.yml up -d", iKiem);
    expect(iKiem, "thiếu bước kiểm dòng HEARTBEAT_URL= trong .env").toBeGreaterThan(-1);
    expect(iUp).toBeGreaterThan(iKiem);
    expect(md).toMatch(/required by secret\s+"heartbeat_url" is not set/);
  });

  it("infra/observability/README.md nói rõ dòng phải CÓ (để trống được), không chỉ 'trống = …'", () => {
    const md = readFileSync(join(ROOT, "infra/observability/README.md"), "utf8");
    expect(md).toMatch(/Dòng `HEARTBEAT_URL=` phải CÓ trong `\.env`/);
  });
});
