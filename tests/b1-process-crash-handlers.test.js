// Cụm quan trắc — sự cố cấp TIẾN TRÌNH của API không tới được Sentry, và tiến trình KHÔNG thoát.
//
// ── LỖI (api-process-crashes-never-reach-sentry) ────────────────────────────
// src/server.ts đăng ký:
//     process.on("unhandledRejection", (err) => logger.error({ err }, "unhandledRejection"));
//     process.on("uncaughtException",  (err) => logger.error({ err }, "uncaughtException"));
// Chỉ log. Hai hệ quả, và hệ quả thứ hai nặng hơn hệ quả thứ nhất:
//
//  1) Không `flushSentry()`: sự kiện đang nằm trong bộ đệm của Sentry mất khi tiến trình đi.
//  2) NGHIÊM TRỌNG HƠN: @sentry/node-core nạp sẵn onUncaughtExceptionIntegration, và integration đó
//     chỉ chạy `onFatalError`/logAndExitProcess khi nó là listener DUY NHẤT
//     (`processWouldExit === false` khi có listener khác). Vì server.ts tự đăng ký một listener,
//     Node KHÔNG còn thoát mặc định nữa → tiến trình API CHẠY TIẾP sau một uncaughtException, ở
//     trạng thái không xác định, và probe /livez vẫn xanh nên orchestrator không restart.
//     So sánh: src/worker.ts làm ĐÚNG (captureError → flushSentry → process.exit(1)).
//
// TÁI HIỆN: `dangKyChanSuCoTienTrinh` không tồn tại; đường duy nhất là hai dòng chỉ-log kia.
import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { dangKyChanSuCoTienTrinh } = await import("../src/observability.js");

/** `process` giả: đủ on/emit, và ghi lại mã thoát thay vì giết tiến trình test. */
function tienTrinhGia() {
  const p = new EventEmitter();
  p.daThoat = [];
  p.exit = (c) => p.daThoat.push(c);
  return p;
}

function dungCu() {
  const goi = { capture: [], flush: 0 };
  return {
    goi,
    capture: (err, ctx) => goi.capture.push({ err, ctx }),
    flush: async () => { goi.flush++; },
  };
}

describe("chặn sự cố cấp tiến trình", () => {
  it("uncaughtException: báo Sentry → flush → THOÁT mã 1", async () => {
    const p = tienTrinhGia();
    const d = dungCu();
    dangKyChanSuCoTienTrinh(p, { capture: d.capture, flush: d.flush });
    p.emit("uncaughtException", new Error("bùm"));
    await new Promise((r) => setTimeout(r, 10));
    expect(d.goi.capture.length).toBe(1);
    expect(d.goi.capture[0].ctx.kind).toBe("uncaughtException");
    expect(d.goi.flush).toBe(1);
    expect(p.daThoat, "tiến trình chạy tiếp sau uncaughtException, ở trạng thái không xác định").toEqual([1]);
  });

  it("flush hỏng cũng KHÔNG được nuốt mất lần thoát", async () => {
    const p = tienTrinhGia();
    dangKyChanSuCoTienTrinh(p, { capture: () => {}, flush: async () => { throw new Error("sentry down"); } });
    p.emit("uncaughtException", new Error("bùm"));
    await new Promise((r) => setTimeout(r, 10));
    expect(p.daThoat).toEqual([1]);
  });

  it("unhandledRejection: báo Sentry + flush nhưng KHÔNG tự thoát (hành vi Node mặc định giữ nguyên)", async () => {
    const p = tienTrinhGia();
    const d = dungCu();
    dangKyChanSuCoTienTrinh(p, { capture: d.capture, flush: d.flush });
    p.emit("unhandledRejection", new Error("promise hỏng"));
    await new Promise((r) => setTimeout(r, 10));
    expect(d.goi.capture[0].ctx.kind).toBe("unhandledRejection");
    expect(d.goi.flush).toBe(1);
    expect(p.daThoat).toEqual([]);
  });

  it("lý do không phải Error vẫn lên được Sentry (reject bằng chuỗi)", async () => {
    const p = tienTrinhGia();
    const d = dungCu();
    dangKyChanSuCoTienTrinh(p, { capture: d.capture, flush: d.flush });
    p.emit("unhandledRejection", "hỏng dạng chuỗi");
    await new Promise((r) => setTimeout(r, 10));
    expect(d.goi.capture[0].err).toBeInstanceOf(Error);
    expect(String(d.goi.capture[0].err.message)).toContain("hỏng dạng chuỗi");
  });
});

describe("dây nối", () => {
  it("src/server.ts dùng CHUNG hàm này chứ không tự đăng ký listener chỉ-log", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/server.ts", import.meta.url)), "utf8");
    expect(src).toContain("dangKyChanSuCoTienTrinh");
    // Không còn listener tự viết nào cho hai sự kiện này trong server.ts.
    expect(src).not.toMatch(/process\.on\(\s*"(uncaughtException|unhandledRejection)"/);
  });

  it("src/worker.ts cũng dùng chung — không còn hai bản chép tay để trôi khỏi nhau", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/worker.ts", import.meta.url)), "utf8");
    expect(src).toContain("dangKyChanSuCoTienTrinh");
    expect(src).not.toMatch(/process\.on\(\s*"(uncaughtException|unhandledRejection)"/);
  });
});
