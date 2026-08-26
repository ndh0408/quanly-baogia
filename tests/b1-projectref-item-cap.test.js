// Cụm nhân sự/dự án — ĐƯỜNG LÙI của buildProjectRef kéo QuoteItem KHÔNG CÓ TRẦN.
//
// ── LỖI (projectref-recomputes-from-items, phần chưa đóng) ──────────────────
// Đường NHANH đã đúng: chỉ `select` cột `subtotal` đã materialize, không include items. Nhưng
// đường LÙI thì `prisma.quoteItem.findMany({ where: { sheetId: { in: [...canTinhLai] } } })` —
// KHÔNG có `take`. Và điều kiện vào đường lùi là MẶC ĐỊNH trên CSDL chưa backfill: chú thích ngay
// trong file thừa nhận mọi sheet lưu trước migration 20260625000003 mang subtotal 0 VĨNH VIỄN (báo
// giá converted bất biến, không bao giờ được lưu lại để cột được ghi), và
// prisma/backfill-sheet-subtotal.mjs không được nối vào bất kỳ đường chạy nào (package.json không
// có script, deploy.sh chỉ chạy `prisma migrate deploy`).
// Quy mô: số sheet vào đường lùi = số dòng đang hiển thị (tới MAX_PAGE_SIZE = 500), mỗi sheet tới
// 1000 dòng (src/validators.ts) → nửa triệu hàng nạp vào RAM tiến trình API cho MỘT lượt mở trang
// Nhân sự.
//
// TÁI HIỆN: soi đối số thật của quoteItem.findMany — trước bản vá không có `take`.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ quotes: [], items: [], itemArgs: [] }));

vi.mock("../src/db.js", () => ({
  prisma: {
    quote: { findMany: async () => h.quotes },
    quoteItem: {
      findMany: async (args) => {
        h.itemArgs.push(args);
        const loc = h.items.filter((i) => args.where.sheetId.in.includes(i.sheetId));
        return args.take != null ? loc.slice(0, args.take) : loc;
      },
    },
  },
}));

const { buildProjectRef } = await import("../src/services/projectRef.js");

const dong = (sheetId, order, unitPrice) => ({
  sheetId, order, kind: "item", quantity: 1, quantityExact: false, unitPrice, days: null,
});

beforeEach(() => { h.quotes = []; h.items = []; h.itemArgs = []; });

describe("buildProjectRef — đường lùi phải có trần", () => {
  it("truy vấn items CÓ `take` (không nạp nửa triệu hàng vào RAM)", async () => {
    h.quotes = [{
      quoteNumber: "BG-1", projectCode: "DA-1", projectVersion: 1, subtotal: 0,
      sheets: [{ id: 1, order: 0, name: "s", signedAt: null, invoiceNo: null, paidAt: null, poNumber: null, subtotal: 0, groupSubtotal: false }],
    }];
    h.items = [dong(1, 0, 1000)];
    const out = await buildProjectRef(["DA-1"]);
    expect(h.itemArgs.length).toBe(1);
    expect(typeof h.itemArgs[0].take, "quoteItem.findMany không có trần").toBe("number");
    expect(h.itemArgs[0].take).toBeGreaterThan(0);
    // Hành vi nghiệp vụ GIỮ NGUYÊN: sheet chưa backfill vẫn được tính lại đúng số tiền.
    expect(out.get("DA-1").preTaxAmount).toBe(1000);
  });

  it("chạm trần: sheet nạp THIẾU không được gán một con số SAI", async () => {
    // Sheet cuối trong dải bị cắt giữa chừng. Tính tổng trên phần đã nạp là ra một số TIỀN SAI
    // (thiếu dòng) — tệ hơn hẳn con số 0 cũ, vì 0 nhìn là biết chưa có dữ liệu còn số thiếu thì
    // không ai nhận ra. Phải bỏ hẳn sheet đó khỏi lượt tính lại.
    const { MAX_TINH_LAI_ITEMS } = await import("../src/services/projectRef.js");
    h.quotes = [{
      quoteNumber: "BG-2", projectCode: "DA-2", projectVersion: 1, subtotal: 0,
      sheets: [
        { id: 1, order: 0, name: "a", signedAt: null, invoiceNo: null, paidAt: null, poNumber: null, subtotal: 0, groupSubtotal: false },
        { id: 2, order: 1, name: "b", signedAt: null, invoiceNo: null, paidAt: null, poNumber: null, subtotal: 0, groupSubtotal: false },
      ],
    }];
    // sheet 1 đủ dòng để lấp trọn trần; sheet 2 vì thế bị cắt cụt.
    h.items = [
      ...Array.from({ length: MAX_TINH_LAI_ITEMS }, (_, i) => dong(1, i, 1)),
      ...Array.from({ length: 10 }, (_, i) => dong(2, i, 1_000_000)),
    ];
    const out = await buildProjectRef(["DA-2_1", "DA-2_2"]);
    // Sheet 1 nạp đủ → tính lại được.
    expect(out.get("DA-2_1").preTaxAmount).toBe(MAX_TINH_LAI_ITEMS);
    // Sheet 2 nạp thiếu → giữ nguyên giá trị cột (0 = "chưa biết"), KHÔNG phải tổng của phần đã nạp.
    expect(out.get("DA-2_2").preTaxAmount).toBe(0);
  });

  it("không có sheet nào cột = 0 thì KHÔNG truy vấn items lần nào (đường nhanh)", async () => {
    h.quotes = [{
      quoteNumber: "BG-3", projectCode: "DA-3", projectVersion: 1, subtotal: 5000,
      sheets: [{ id: 9, order: 0, name: "s", signedAt: null, invoiceNo: null, paidAt: null, poNumber: null, subtotal: 5000, groupSubtotal: false }],
    }];
    const out = await buildProjectRef(["DA-3"]);
    expect(h.itemArgs.length).toBe(0);
    expect(out.get("DA-3").preTaxAmount).toBe(5000);
  });
});
