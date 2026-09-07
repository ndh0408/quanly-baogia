// Trang Nhân sự (buildProjectRef) và trang Quản lý dự án phải hiện CÙNG MỘT con số cho cùng một
// mã sản xuất. Hai trang lấy số theo hai đường khác nhau:
//   · đường NHANH  — đọc thẳng cột materialized `QuoteSheet.subtotal` (đã trừ Discount của sheet);
//   · đường LÙI    — cột đó bằng 0 thì kéo items và tính lại bằng computeQuoteTotals.
//
// LỖI ĐÃ CÓ THẬT: từ khi Discount xuống mức SHEET, một sheet bị giảm giá HẾT có subtotal = 0 — mà
// projectRef coi 0 là "chưa backfill" (cột này được thêm với NOT NULL DEFAULT 0, xem migration
// 20260625000003) nên luôn rơi vào đường lùi. Đường lùi trước đây KHÔNG select `discount` và
// KHÔNG truyền nó vào computeQuoteTotals ⇒ tính ra số GROSS. Kết quả: Quản lý dự án hiện 0 đ,
// Nhân sự hiện nguyên giá chưa giảm — cùng một sheet, hai con số, không ai biết cái nào đúng.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ quotes: [], items: [], quoteArgs: [] }));

vi.mock("../src/db.js", () => ({
  prisma: {
    quote: { findMany: async (args) => { h.quoteArgs.push(args); return h.quotes; } },
    quoteItem: {
      findMany: async (args) => h.items.filter((i) => args.where.sheetId.in.includes(i.sheetId)),
    },
  },
}));

const { buildProjectRef } = await import("../src/services/projectRef.js");

const dong = (sheetId, order, unitPrice) => ({
  sheetId, order, kind: "item", quantity: 1, quantityExact: false, unitPrice, days: null,
});
const sheet = (id, order, over = {}) => ({
  id, order, name: `s${order + 1}`, signedAt: null, invoiceNo: null, paidAt: null, poNumber: null,
  subtotal: 0, groupSubtotal: false, discount: 0, ...over,
});

beforeEach(() => { h.quotes = []; h.items = []; h.quoteArgs = []; });

describe("buildProjectRef — Discount ở mức sheet", () => {
  it("sheet bị giảm giá HẾT (cột subtotal = 0) → 0 đ, KHÔNG phải số gross", async () => {
    // Trạng thái CSDL SAU migration 20260907090000:
    //   trước: sheet1 = 30tr, sheet2 = 70tr, Quote.subtotal = 100tr, Quote.discount = 30tr
    //   rót:   sheet1.discount = 30tr → sheet1.subtotal = 0 ; sheet2 giữ 70tr
    //   quote: subtotal = 70tr
    h.quotes = [{
      quoteNumber: "BG-9", projectCode: "DA-9", projectVersion: 1, subtotal: 70_000_000,
      sheets: [
        sheet(101, 0, { subtotal: 0, discount: 30_000_000 }),
        sheet(102, 1, { subtotal: 70_000_000 }),
      ],
    }];
    h.items = [dong(101, 0, 30_000_000), dong(102, 0, 70_000_000)];

    const out = await buildProjectRef(["DA-9_1", "DA-9_2"]);
    expect(out.get("DA-9_1").preTaxAmount).toBe(0);            // khớp cột → khớp trang Dự án
    expect(out.get("DA-9_2").preTaxAmount).toBe(70_000_000);
  });

  it("sheet giảm giá MỘT PHẦN mà cột chưa backfill → tính lại vẫn phải TRỪ discount", async () => {
    h.quotes = [{
      quoteNumber: "BG-8", projectCode: "DA-8", projectVersion: 1, subtotal: 8_000_000,
      // cột subtotal còn 0 (dữ liệu cũ chưa chạy prisma/backfill-sheet-subtotal.mjs)
      sheets: [sheet(201, 0, { subtotal: 0, discount: 2_000_000 })],
    }];
    h.items = [dong(201, 0, 10_000_000)];

    const out = await buildProjectRef(["DA-8"]);
    expect(out.get("DA-8").preTaxAmount).toBe(8_000_000);      // 10tr − 2tr, KHÔNG phải 10tr
  });

  it("sheet KHÔNG giảm giá, cột chưa backfill → vẫn tính lại đúng như trước", async () => {
    h.quotes = [{
      quoteNumber: "BG-7", projectCode: "DA-7", projectVersion: 1, subtotal: 5_000_000,
      sheets: [sheet(301, 0, { subtotal: 0 })],
    }];
    h.items = [dong(301, 0, 5_000_000)];

    const out = await buildProjectRef(["DA-7"]);
    expect(out.get("DA-7").preTaxAmount).toBe(5_000_000);
  });

  // Chốt CHÍNH CÁI SELECT: bỏ `discount: true` đi là hai bài trên vẫn có thể xanh nhờ fixture,
  // nhưng thực tế Prisma sẽ không trả cột đó và đường lùi lại tính ra gross.
  it("truy vấn PHẢI kéo QuoteSheet.discount về", async () => {
    h.quotes = [];
    await buildProjectRef(["DA-0"]);
    expect(h.quoteArgs[0].select.sheets.select.discount).toBe(true);
  });
});
