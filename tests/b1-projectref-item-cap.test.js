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
// ── BẢN VÁ ĐẦU DÙNG `take` CẮT CỤT. ĐÃ ĐỔI. ĐỌC KỸ TRƯỚC KHI "TỐI ƯU" LẠI. ─
// Bản đầu đặt `take: MAX_TINH_LAI_ITEMS + 1` rồi BỎ HẲN sheet bị cắt dở. Nó không cho ra số sai —
// nhưng nó biến một con số TIỀN ĐÚNG thành 0 đ ở cột "Tiền trước thuế" trang Nhân sự, và việc một
// hàng có hiện được số hay không phụ thuộc vào CÁC HÀNG KHÁC cùng trang (sheet nào rơi ra ngoài vết
// cắt là do tổng số dòng của những sheet đứng trước nó). Người dùng thấy 0 đ ở đúng hàng hôm qua
// còn có số, chỉ vì thêm một dự án khác vào trang.
// Nay nạp THEO LÔ SHEET: mỗi lô là một tập sheet TRỌN VẸN nên không sheet nào bị nạp thiếu, mà bộ
// nhớ vẫn O(một lô). Bài test dưới khoá cả hai vế: tính ĐÚNG cho mọi sheet, và KHÔNG nạp một phát.
//
// TÁI HIỆN: soi đối số thật của quoteItem.findMany.
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

describe("buildProjectRef — đường lùi phải có trần BỘ NHỚ mà vẫn tính đủ mọi sheet", () => {
  it("một sheet: vẫn tính lại đúng số tiền, và chỉ MỘT lượt truy vấn", async () => {
    h.quotes = [{
      quoteNumber: "BG-1", projectCode: "DA-1", projectVersion: 1, subtotal: 0,
      sheets: [{ id: 1, order: 0, name: "s", signedAt: null, invoiceNo: null, paidAt: null, poNumber: null, subtotal: 0, groupSubtotal: false }],
    }];
    h.items = [dong(1, 0, 1000)];
    const out = await buildProjectRef(["DA-1"]);
    expect(h.itemArgs.length, "một sheet mà chia lô là tự thêm round-trip vô ích").toBe(1);
    // Hành vi nghiệp vụ GIỮ NGUYÊN: sheet chưa backfill vẫn được tính lại đúng số tiền.
    expect(out.get("DA-1").preTaxAmount).toBe(1000);
  });

  it("NHIỀU sheet: MỌI sheet đều được tính đúng, không sheet nào rơi về 0", async () => {
    // Đây là ca mà bản `take` cắt cụt làm sai: sheet đứng sau bị vết cắt nuốt và rơi về 0 đ.
    const SO_SHEET = 60;   // > LO_SHEET (25) nên chắc chắn phải chia lô
    h.quotes = [{
      quoteNumber: "BG-2", projectCode: "DA-2", projectVersion: 1, subtotal: 0,
      sheets: Array.from({ length: SO_SHEET }, (_, i) => ({
        id: i + 1, order: i, name: `s${i}`, signedAt: null, invoiceNo: null, paidAt: null,
        poNumber: null, subtotal: 0, groupSubtotal: false,
      })),
    }];
    // Mỗi sheet 3 dòng, đơn giá khác nhau theo sheet → tổng của sheet i là (i+1) × 3.
    h.items = h.quotes[0].sheets.flatMap((sh) =>
      Array.from({ length: 3 }, (_, k) => dong(sh.id, k, sh.id)));

    const ma = Array.from({ length: SO_SHEET }, (_, i) => `DA-2_${i + 1}`);
    const out = await buildProjectRef(ma);
    for (let i = 0; i < SO_SHEET; i++) {
      expect(out.get(`DA-2_${i + 1}`).preTaxAmount,
        `sheet ${i + 1} rơi về 0 — bị vết cắt nuốt mất, và điều đó phụ thuộc các sheet đứng trước`)
        .toBe((i + 1) * 3);
    }
  });

  // ── CA CHẠM ĐÚNG TRẦN CŨ ──────────────────────────────────────────────────
  // 50 000 là `MAX_TINH_LAI_ITEMS` của bản cắt cụt. Sheet 1 lấp trọn trần đó, nên ở bản cũ sheet 2
  // rơi ra ngoài vết cắt và bị bỏ hẳn → cột Tiền hiện 0 đ cho một dự án CÓ dữ liệu. Đây là hình
  // dạng thật của lỗi: hàng của bạn mất số vì SỐ DÒNG CỦA DỰ ÁN KHÁC trên cùng trang.
  it("sheet đứng SAU một sheet khổng lồ vẫn phải ra đúng số tiền, không rơi về 0", async () => {
    const TRAN_CU = 50_000;
    h.quotes = [{
      quoteNumber: "BG-5", projectCode: "DA-5", projectVersion: 1, subtotal: 0,
      sheets: [
        { id: 1, order: 0, name: "khổng lồ", signedAt: null, invoiceNo: null, paidAt: null, poNumber: null, subtotal: 0, groupSubtotal: false },
        { id: 2, order: 1, name: "nhỏ", signedAt: null, invoiceNo: null, paidAt: null, poNumber: null, subtotal: 0, groupSubtotal: false },
      ],
    }];
    h.items = [
      ...Array.from({ length: TRAN_CU }, (_, i) => dong(1, i, 1)),
      ...Array.from({ length: 10 }, (_, i) => dong(2, i, 1_000_000)),
    ];
    const out = await buildProjectRef(["DA-5_1", "DA-5_2"]);
    expect(out.get("DA-5_1").preTaxAmount).toBe(TRAN_CU);
    expect(out.get("DA-5_2").preTaxAmount,
      "hiện 0 đ cho một dự án CÓ dữ liệu, chỉ vì dự án khác trên cùng trang quá nhiều dòng")
      .toBe(10_000_000);
  }, 60_000);

  it("chia LÔ thật: không nạp một phát, và mỗi lô là tập sheet TRỌN VẸN", async () => {
    const SO_SHEET = 60;
    h.quotes = [{
      quoteNumber: "BG-4", projectCode: "DA-4", projectVersion: 1, subtotal: 0,
      sheets: Array.from({ length: SO_SHEET }, (_, i) => ({
        id: i + 1, order: i, name: `s${i}`, signedAt: null, invoiceNo: null, paidAt: null,
        poNumber: null, subtotal: 0, groupSubtotal: false,
      })),
    }];
    h.items = h.quotes[0].sheets.flatMap((sh) => [dong(sh.id, 0, 1)]);
    await buildProjectRef(Array.from({ length: SO_SHEET }, (_, i) => `DA-4_${i + 1}`));

    expect(h.itemArgs.length, "vẫn nạp một phát → không có trần bộ nhớ nào").toBeGreaterThan(1);
    // KHÔNG được dùng `take`: cắt theo DÒNG là cách sinh ra đúng lỗi vừa gỡ.
    for (const a of h.itemArgs) expect(a.take, "quay lại cắt cụt theo dòng").toBeUndefined();
    // Mọi sheet phải xuất hiện đúng MỘT lần trên toàn bộ các lô.
    const daHoi = h.itemArgs.flatMap((a) => a.where.sheetId.in);
    expect(new Set(daHoi).size).toBe(SO_SHEET);
    expect(daHoi.length).toBe(SO_SHEET);
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
