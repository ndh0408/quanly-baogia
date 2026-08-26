// THANH TOÁN BẢNG NỘI BỘ bị XOÁ SẠCH mỗi lần Lưu báo giá — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `itemSchema` (src/validators.ts) khai tường minh `rid`, `approved`, `approvedAt`, `approvedBy`,
// kèm hẳn một chú thích giải thích vì sao phải khai: **để Zod KHÔNG strip chúng**.
//
// Nhưng nó KHÔNG khai `paid`, `paidAt`, `paidById`. Zod v4 mặc định loại bỏ khoá lạ, còn
// `validate()` thì THAY LUÔN req.body bằng object đã lọc:
//     if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
// nên tới `reconcileExtraPayments`, mọi hàng đều có `it.paid === undefined`.
//
// Ở đó:
//     const want = !!it.paid;                       // !!undefined === false
//     else { it.paidAt = null; it.paidById = null; } // ← rơi vào nhánh này
//     it.paid = want;                                // ← false
//
// Nhánh `!canPay` phía trên thì KHÔI PHỤC đúng từ giá trị trong CSDL. Nghĩa là lỗi chỉ đánh vào
// người CÓ quyền `quote:internal:pay` — tức đúng những người quản lý thanh toán. Kế toán tích 40
// hàng đã trả; admin mở báo giá sửa một lỗi chính tả rồi bấm Lưu; cả 40 hàng về `paid:false`,
// mất luôn `paidAt` và `paidById`. Không có cảnh báo nào.
//
// `paidProof` CỐ Ý vẫn bị strip: ảnh chỉ đi qua route /pay, không đi qua đường lưu báo giá
// (chống base64 chảy qua payload và chống giả mạo). reconcileExtraPayments luôn lấy ảnh từ CSDL.
import { describe, it, expect } from "vitest";
import { reconcileExtraPayments } from "../src/services/quoteService.js";
import { QuoteUpdateSchema } from "../src/validators.js";

// CỐ Ý đi qua CHÍNH cái schema mà route dùng, rồi mới gọi reconcile — đó là chuỗi thật:
//     validate() → req.body = schema.parse(body) → reconcileExtraPayments(req.body.sheets, ...)
// Gọi thẳng reconcile với dữ liệu tự dựng sẽ BỎ QUA đúng chỗ hỏng (Zod strip khoá không khai),
// tức là test sẽ không bao giờ bắt được lỗi này.
const quaSchema = (items) =>
  QuoteUpdateSchema.parse({
    title: "Báo giá thử",
    sheets: [{ name: "S", order: 0, templateId: 1, items: [], extraTables: [{ category: "hcm", items }] }],
  }).sheets;

const sheetsTuDB = [
  {
    extraTables: [
      {
        category: "hcm",
        items: [
          { rid: "r1", name: "Thuê xe", paid: true, paidAt: "2026-08-01T00:00:00Z", paidById: 7, paidProof: "data:image/png;base64,AAA" },
          { rid: "r2", name: "Nhân công", paid: true, paidAt: "2026-08-02T00:00:00Z", paidById: 7, paidProof: null },
        ],
      },
    ],
  },
];

const sheetsGuiLen = (doi = (x) => x) =>
  quaSchema(
    doi([
      { kind: "item", name: "Thuê xe (sửa chính tả)", quantity: 1, unitPrice: 100, rid: "r1", paid: true, paidAt: "x", paidById: 7 },
      { kind: "item", name: "Nhân công", quantity: 1, unitPrice: 200, rid: "r2", paid: true, paidAt: "x", paidById: 7 },
    ])
  );

describe("reconcileExtraPayments — giữ trạng thái đã thanh toán", () => {
  it("người CÓ quyền trả tiền bấm Lưu → KHÔNG được xoá cờ đã trả (đây là lỗi đã vá)", () => {
    const sheets = sheetsGuiLen();
    reconcileExtraPayments(sheets, sheetsTuDB, /* canPay */ true, /* payerId */ 99);
    const rows = sheets[0].extraTables[0].items;

    expect(rows[0].paid, "hàng r1 phải CÒN đánh dấu đã trả").toBe(true);
    expect(rows[1].paid, "hàng r2 phải CÒN đánh dấu đã trả").toBe(true);
    // Dấu thời gian và người trả phải giữ NGUYÊN của lần trả gốc, không bị đóng lại theo người đang lưu.
    expect(rows[0].paidAt).toBe("2026-08-01T00:00:00Z");
    expect(rows[0].paidById).toBe(7);
    expect(rows[1].paidById).toBe(7);
    // Ảnh LUÔN lấy từ CSDL, không tin client.
    expect(rows[0].paidProof).toBe("data:image/png;base64,AAA");
    expect(rows[1].paidProof).toBe(null);
  });

  it("người KHÔNG có quyền trả tiền bấm Lưu → cũng giữ nguyên (nhánh này vốn đã đúng)", () => {
    const sheets = sheetsGuiLen();
    reconcileExtraPayments(sheets, sheetsTuDB, /* canPay */ false, 99);
    const rows = sheets[0].extraTables[0].items;
    expect(rows[0].paid).toBe(true);
    expect(rows[0].paidAt).toBe("2026-08-01T00:00:00Z");
    expect(rows[0].paidById).toBe(7);
  });

  it("người CÓ quyền BỎ đánh dấu tường minh → phải bỏ thật", () => {
    const sheets = sheetsGuiLen((its) => its.map((x) => (x.rid === "r1" ? { ...x, paid: false } : x)));
    reconcileExtraPayments(sheets, sheetsTuDB, true, 99);
    const rows = sheets[0].extraTables[0].items;
    expect(rows[0].paid).toBe(false);
    expect(rows[0].paidAt).toBe(null);
    expect(rows[0].paidById).toBe(null);
    expect(rows[1].paid, "hàng khác KHÔNG bị ảnh hưởng").toBe(true);
  });

  it("người CÓ quyền đánh dấu hàng MỚI → đóng dấu thời gian + người trả", () => {
    const sheets = sheetsGuiLen((its) => [...its, { kind: "item", name: "Phát sinh", quantity: 1, unitPrice: 50, rid: "r3", paid: true }]);
    reconcileExtraPayments(sheets, sheetsTuDB, true, 99);
    const r3 = sheets[0].extraTables[0].items.find((r) => r.rid === "r3");
    expect(r3.paid).toBe(true);
    expect(r3.paidById).toBe(99);
    expect(r3.paidAt).toBeTruthy();
  });
});
