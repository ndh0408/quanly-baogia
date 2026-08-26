// Cụm hàng đợi/worker/quan trắc — tiến trình WORKER không có endpoint /metrics nào.
//
// ── LỖI (no-bullmq-metrics-worker-unscraped) ────────────────────────────────
// `grep -nE "listen|node:http|registry" src/worker.ts` trước bản vá trả về 0 kết quả trên cả 249
// dòng: tiến trình worker nạp `src/observability.js` (nên có registry, có collectDefaultMetrics,
// và TĂNG `export_jobs_total` ở withExportMetric) nhưng KHÔNG mở cổng nào để ai đó đọc được.
// Bộ đếm sinh RA TRONG worker vì thế không bao giờ tới được Prometheus — biểu đồ xuất file chỉ
// thấy phần chạy nội tuyến trong tiến trình API, còn phần chạy thật (hàng đợi) thì vô hình.
//
// TÁI HIỆN: `taoMayChuMetrics` không tồn tại → không có cách nào scrape tiến trình worker.
//
// KHÔNG kiểm được ở đây: annotation `prometheus.io/scrape` + containerPort của
// infra/k8s/worker.yaml (file hạ tầng, ngoài tập file của nhóm này).
import { describe, it, expect, afterAll } from "vitest";

const { taoMayChuMetrics } = await import("../src/worker.js");

/** Mở máy chủ trên cổng 0 (hệ điều hành cấp cổng rảnh) rồi trả về địa chỉ gốc. */
function moMayChu(opts) {
  const srv = taoMayChuMetrics(0, opts);
  return new Promise((resolve) => {
    srv.once("listening", () => resolve({ srv, goc: `http://127.0.0.1:${srv.address().port}` }));
  });
}

const dangMo = [];
afterAll(() => { for (const s of dangMo) s.close(); });

describe("tiến trình worker phải scrape được", () => {
  it("GET /metrics trả về số liệu Prometheus SINH RA TRONG tiến trình này", async () => {
    const { srv, goc } = await moMayChu({ token: undefined, laProd: false });
    dangMo.push(srv);
    const r = await fetch(`${goc}/metrics`);
    expect(r.status).toBe(200);
    const text = await r.text();
    // `export_jobs_total` chỉ được tăng ở src/worker.ts (withExportMetric) — đúng thứ mà tiến
    // trình API không bao giờ thấy khi job chạy qua hàng đợi.
    expect(text).toContain("export_jobs_total");
    // Số liệu tiến trình (RSS/CPU/event loop lag) của chính worker cũng phải ra.
    expect(text).toContain("process_resident_memory_bytes");
  });

  it("đường dẫn khác /metrics trả 404 — không mở thêm bề mặt nào", async () => {
    const { srv, goc } = await moMayChu({ token: undefined, laProd: false });
    dangMo.push(srv);
    expect((await fetch(`${goc}/`)).status).toBe(404);
    expect((await fetch(`${goc}/livez`)).status).toBe(404);
  });

  it("có METRICS_TOKEN thì bắt buộc Bearer đúng (401 nếu thiếu/sai)", async () => {
    const { srv, goc } = await moMayChu({ token: "b1-token-worker", laProd: false });
    dangMo.push(srv);
    expect((await fetch(`${goc}/metrics`)).status).toBe(401);
    expect((await fetch(`${goc}/metrics`, { headers: { authorization: "Bearer sai" } })).status).toBe(401);
    const ok = await fetch(`${goc}/metrics`, { headers: { authorization: "Bearer b1-token-worker" } });
    expect(ok.status).toBe(200);
  });

  it("production mà KHÔNG đặt token thì đóng hẳn (404) — fail closed như /metrics của app", async () => {
    const { srv, goc } = await moMayChu({ token: undefined, laProd: true });
    dangMo.push(srv);
    expect((await fetch(`${goc}/metrics`)).status).toBe(404);
  });
});
