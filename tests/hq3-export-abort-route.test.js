// Cụm hàng đợi/SSE/quan trắc — route xuất file KHÔNG hề tạo tín hiệu huỷ.
//
// ── LỖI: khả năng huỷ đã có ở cổng, nhưng KHÔNG AI BẤM ──────────────────────
// src/exportQueue.ts đã nhận `acquire(signal)` và `runExportJob(kind, quote, inlineFn, { signal })`,
// nhưng src/routes/export.routes.ts gọi `runExportJob("xlsx", plain(quote), () => …)` với BA tham
// số — không AbortController, không hạn chót. Nghĩa là toàn bộ đường huỷ là mã chết ở production:
// khách bấm xuất rồi đóng tab, hệ thống vẫn xếp hàng, vẫn được cấp chỗ, vẫn nghiến CPU sinh một file
// không ai nhận, ăn trọn một suất trong `maxActive` (3) lẫn `maxPending` (20).
// TÁI HIỆN: gọi route bằng socket thật rồi ngắt socket → tín hiệu mà route truyền xuống runExportJob
// phải chuyển sang `aborted`. Trước khi vá, tín hiệu đó là `undefined`.
// HẬU QUẢ: người còn ở lại chờ lâu hơn hoặc bị 503 oan, trong khi máy bận sinh file cho người đã đi.
//
// LỖI KÈM: không có HẠN CHÓT. Một lượt xuất kẹt trong hàng đợi có thể giữ chỗ vô thời hạn.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";

// Hạn chót ngắn để kiểm được trong test — route đọc biến này lúc nạp module.
process.env.EXPORT_REQUEST_DEADLINE_MS = "400";

// Ghi lại tín hiệu mà route truyền xuống; giữ promise treo để mô phỏng lượt xuất đang chờ/đang chạy.
const daNhan = [];
vi.mock("../src/exportQueue.js", () => ({
  isAbortedError: (e) => !!e && typeof e === "object" && e.code === "export_aborted",
  runExportJob: (kind, _quote, _inlineFn, opts) => {
    const signal = opts?.signal;
    daNhan.push({ kind, signal });
    return new Promise((resolve, reject) => {
      if (!signal) return; // treo mãi — đúng hành vi khi KHÔNG có tín hiệu huỷ
      if (signal.aborted) return reject(new Error("aborted"));
      signal.addEventListener("abort", () => reject(Object.assign(new Error("huỷ"), { code: "export_aborted" })), { once: true });
    });
  },
}));
vi.mock("../src/audit.js", () => ({ audit: async () => {} }));

let server, cong, prisma;

beforeAll(async () => {
  ({ prisma } = await import("../src/db.js"));
  vi.spyOn(prisma.quote, "findFirst").mockResolvedValue({
    id: 4242, quoteNumber: "HQ3-ABORT", createdById: 1, members: [], company: null, sheets: [],
  });
  const { default: exportRoutes } = await import("../src/routes/export.routes.js");
  const app = express();
  // Phiên giả: route thật vẫn chạy qua requireAuth + requirePermission(quote:export) + canOnQuote.
  app.use((req, _res, next) => { req.session = { userId: 1, role: "admin" }; next(); });
  app.use("/api/export", exportRoutes);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  cong = server.address().port;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise((r) => server.close(r));
});

/** Gửi request rồi NGẮT socket khi máy chủ đã bắt đầu xử lý. */
function goiRoiNgat(duongDan) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: cong, path: duongDan, method: "GET" });
    req.on("error", () => {});
    req.end();
    setTimeout(() => { req.destroy(); resolve(); }, 120);
  });
}

const cho = (ms) => new Promise((r) => setTimeout(r, ms));

describe("route xuất file — tín hiệu huỷ", () => {
  it("client ngắt kết nối thì tín hiệu truyền xuống runExportJob phải chuyển sang aborted", async () => {
    daNhan.length = 0;
    await goiRoiNgat("/api/export/4242.xlsx");
    await cho(150);
    expect(daNhan.length, "route chưa gọi tới runExportJob").toBe(1);
    expect(daNhan[0].signal, "route không truyền AbortSignal nào xuống").toBeInstanceOf(AbortSignal);
    expect(daNhan[0].signal.aborted).toBe(true);
  });

  it("có HẠN CHÓT: request không bị ngắt vẫn tự huỷ khi quá hạn thay vì giữ chỗ vô thời hạn", async () => {
    daNhan.length = 0;
    const req = http.request({ host: "127.0.0.1", port: cong, path: "/api/export/4242.pdf", method: "GET" });
    req.on("error", () => {});
    req.end();
    await cho(120);
    expect(daNhan.length).toBe(1);
    const sig = daNhan[0].signal;
    expect(sig).toBeInstanceOf(AbortSignal);
    expect(sig.aborted, "chưa tới hạn mà đã huỷ").toBe(false);
    await cho(500); // vượt EXPORT_REQUEST_DEADLINE_MS = 400ms
    expect(sig.aborted, "quá hạn rồi mà không có hạn chót nào bấm huỷ").toBe(true);
    req.destroy();
  });
});
