// Cụm hàng đợi/worker — đường xuất NỀN không có trần KÍCH THƯỚC nào.
//
// ── LỖI (no-job-idempotency-no-async-export-limit, phần (c) còn mở) ─────────
// Đường xuất ĐỒNG BỘ chặn sớm: src/routes/export.routes.ts:76-80 `MAX_EXPORT_SHEETS = 100`,
// `MAX_EXPORT_ITEMS = 20_000` → 413. Đường xuất NỀN thì không: đọc trọn route enqueue
// (src/routes/jobs.routes.ts:31-96) không có một phép kiểm kích thước nào, và processor trong
// src/worker.ts nạp báo giá rồi lao thẳng vào sinh file. Trần duy nhất là trần THỜI GIAN 30s ở
// generateInWorker — nghĩa là một báo giá khổng lồ vẫn đốt trọn 30s CPU của luồng worker (×3 luồng)
// rồi mới hỏng, mỗi lần người dùng bấm Xuất.
//
// TÁI HIỆN: chạy processor `export/xlsx` với báo giá 200 sheet — trước bản vá nó chạy tới cùng và
// trả về {key,url,size} như thường.
//
// KHÔNG kiểm được ở đây: trần 10 lượt/phút của asyncExportLimiter — `createLimiter` trả middleware
// rỗng khi NODE_ENV=test (chú thích sẵn ở src/routes/jobs.routes.ts:22-24).
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ quote: null, daSinhFile: 0 }));

vi.mock("../src/db.js", () => ({
  prisma: { quote: { findFirst: async () => h.quote } },
}));
vi.mock("../src/exportQueue.js", () => ({
  runExportJob: async () => { h.daSinhFile++; return Buffer.from("PK-gia-lap"); },
  isTimeoutError: () => false,
  EXPORT_GEN_TIMEOUT_MS: 30_000,
}));
vi.mock("../src/storage.js", () => ({
  isStorageEnabled: () => true,
  putObject: async () => ({ key: "k" }),
  presignDownload: async () => "https://vi-du/tai-ve",
}));

const { processors } = await import("../src/worker.js");
const { QUEUES } = await import("../src/queue.js");

/** Báo giá giả: `soSheet` sheet, mỗi sheet `moiSheet` dòng. */
function baoGia(soSheet, moiSheet) {
  return {
    id: 1, quoteNumber: "BG-B1", subtotal: 0, vat: 0, total: 0, vatPercent: 0,
    company: {},
    sheets: Array.from({ length: soSheet }, (_, i) => ({
      id: i + 1, order: i, name: `S${i}`, template: {},
      items: Array.from({ length: moiSheet }, (_, j) => ({ id: j, order: j })),
    })),
  };
}

describe("processor xuất nền — trần kích thước như đường đồng bộ", () => {
  it("báo giá quá NHIỀU SHEET bị từ chối trước khi tiêu một giây CPU nào", async () => {
    h.quote = baoGia(200, 1);
    h.daSinhFile = 0;
    await expect(processors[QUEUES.EXPORT].xlsx({ data: { quoteId: 1, requestedBy: 1 } }))
      .rejects.toThrow(/quá lớn/i);
    expect(h.daSinhFile, "đã lao vào sinh file dù báo giá vượt trần").toBe(0);
  });

  it("báo giá quá NHIỀU DÒNG cũng bị từ chối (pdf cùng một chốt)", async () => {
    h.quote = baoGia(30, 1_000); // 30 000 dòng > 20 000
    h.daSinhFile = 0;
    await expect(processors[QUEUES.EXPORT].pdf({ data: { quoteId: 1, requestedBy: 1 } }))
      .rejects.toThrow(/quá lớn/i);
    expect(h.daSinhFile).toBe(0);
  });

  it("lỗi vượt trần KHÔNG được thử lại: 3 lượt nghiến CPU cho cùng một kết quả là vô ích", async () => {
    h.quote = baoGia(200, 1);
    const { UnrecoverableError } = await import("bullmq");
    await expect(processors[QUEUES.EXPORT].xlsx({ data: { quoteId: 1, requestedBy: 1 } }))
      .rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("báo giá bình thường KHÔNG bị đụng tới (không phá hành vi nghiệp vụ)", async () => {
    h.quote = baoGia(50, 200); // 10 000 dòng — đúng cỡ "báo giá lớn" mô tả trong mã
    h.daSinhFile = 0;
    const r = await processors[QUEUES.EXPORT].xlsx({ data: { quoteId: 1, requestedBy: 1 } });
    expect(r.url).toBe("https://vi-du/tai-ve");
    expect(h.daSinhFile).toBe(1);
  });
});
