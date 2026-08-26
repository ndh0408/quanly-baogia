// Cụm hàng đợi/quan trắc — `exportGateStats` là MÃ CHẾT, và /metrics không có MẪU SỐ công suất.
//
// ── LỖI (queue-dead-code-and-readyz-blind, phần chưa đóng) ─────────────────
// `export const exportGateStats = ...` (src/exportQueue.ts) tự nhận là "dùng cho /readyz mở rộng và
// cho test", nhưng grep toàn bộ src/ không có một chỗ gọi nào — chỉ test gọi. Song song đó,
// /metrics phát `export_active_workers` và `export_queue_depth` nhưng KHÔNG phát trần của chúng
// (EXPORT_MAX_ACTIVE / EXPORT_MAX_PENDING, đọc từ biến môi trường). Nghĩa là nhìn số liệu KHÔNG
// biết "20 đang xếp hàng" là đầy hay mới 10% — muốn đặt cảnh báo bão hoà thì phải chép cứng con số
// cấu hình vào quy tắc cảnh báo, và nó lệch ngay lần đầu ai đó chỉnh biến môi trường.
//
// TÁI HIỆN: scrape /metrics — không có gauge trần nào.
import { describe, it, expect } from "vitest";
import request from "supertest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { exportGateStats } from "../src/exportQueue.js";

/**
 * Đọc giá trị một gauge từ thân text/plain của /metrics.
 * `registry.setDefaultLabels` gắn {app,env} vào MỌI dòng, nên phải cắt phần nhãn trước khi so tên.
 */
function docGauge(text, ten) {
  for (const dong of text.split("\n")) {
    if (dong.startsWith("#") || !dong.trim()) continue;
    const cach = dong.indexOf(" ");
    if (cach < 0) continue;
    const khoa = dong.slice(0, cach);
    const nhan = khoa.indexOf("{");
    if ((nhan >= 0 ? khoa.slice(0, nhan) : khoa) !== ten) continue;
    return Number(dong.slice(cach + 1).trim());
  }
  return null;
}

describe("/metrics — công suất cổng xuất file", () => {
  it("phát cả TRẦN, không chỉ giá trị hiện tại", async () => {
    const r = await request(createApp()).get("/metrics");
    expect(r.status).toBe(200);
    const s = exportGateStats();
    expect(docGauge(r.text, "export_max_active_workers"), "thiếu mẫu số: không tính được tỉ lệ bão hoà").toBe(s.maxActive);
    expect(docGauge(r.text, "export_max_queue_depth")).toBe(s.maxPending);
    // Giá trị hiện tại vẫn còn nguyên (không phá số liệu cũ).
    expect(docGauge(r.text, "export_active_workers")).toBe(s.active);
    expect(docGauge(r.text, "export_queue_depth")).toBe(s.pending);
  });
});

describe("mã chết", () => {
  it("exportGateStats có ít nhất một chỗ gọi THẬT trong src/", () => {
    const root = fileURLToPath(new URL("../src", import.meta.url));
    const walk = (d) => readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const goi = walk(root).filter((p) => /\.(ts|js)$/.test(p) && !p.endsWith("exportQueue.ts") &&
      readFileSync(p, "utf8").includes("exportGateStats"));
    const trongChinhFile = readFileSync(join(root, "exportQueue.ts"), "utf8")
      .split("\n").filter((l) => l.includes("exportGateStats(")).length;
    expect(goi.length + trongChinhFile, "exportGateStats không được gọi ở đâu trong src/").toBeGreaterThan(0);
  });
});
