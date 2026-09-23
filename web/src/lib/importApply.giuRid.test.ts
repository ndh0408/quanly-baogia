// Soát toàn diện L48 (phần còn lại, phản biện độc lập nêu) — bảng HÀ NỘI (AccountHnView → hnTables →
// sanitizeExtraTables) dùng `rid` để máy chủ khớp trạng thái DUYỆT / THANH TOÁN / ẢNH CHỨNG TỪ theo từng
// hàng (reconcileHnApprovals, reconcileExtraPayments — src/services/quoteService.ts). "Thay toàn bộ" dựng
// item mới từ blankItem, KHÔNG có `rid` → máy chủ cấp rid mới → hàng vẫn khớp đúng nội dung mất dấu
// duyệt, mất cờ đã trả và mất VĨNH VIỄN ảnh uỷ nhiệm chi, không một lời cảnh báo.
//
// Mang `rid` của dòng khớp sang KHÔNG nới bảo mật: rid là thứ client đã có; máy chủ vẫn chỉ cho mỗi rid
// kế thừa MỘT lần và vẫn ghim số tiền của hàng đã duyệt / đã trả (đổi số tiền → từ chối cả lần lưu).
import { describe, expect, it } from "vitest";
import type * as M from "./quoteMath";
import type { ImportedItem } from "./api";
import { giuTruongChiApp, toGridItems } from "./importApply";

type HangHn = M.Item & { rid?: string; paid?: boolean; paidAt?: string | null; paidById?: number | null; hasPaidProof?: boolean };
const truoc = (): HangHn[] => [
  { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000, rid: "r-1",
    approved: true, approvedAt: "2026-09-01T00:00:00.000Z", approvedBy: 3,
    paid: true, paidAt: "2026-09-02T00:00:00.000Z", paidById: 5, hasPaidProof: true },
  { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 300000, rid: "r-2" },
  { kind: "item", name: "Bàn bị khách xoá", unit: "cái", quantity: 1, unitPrice: 100000, rid: "r-3", paid: true, hasPaidProof: true },
  { kind: "item", name: "Ghế bị khách xoá", unit: "cái", quantity: 1, unitPrice: 90000, rid: "r-4", approved: true },
  { kind: "item", name: "Đèn bị khách xoá", unit: "bộ", quantity: 1, unitPrice: 80000, rid: "r-5" },
];
const nhap: ImportedItem[] = [
  { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000, row: 7 },
  { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 320000, row: 8 },
  { kind: "item", name: "Hạng mục mới", unit: "cái", quantity: 1, unitPrice: 50000, row: 9 },
];
const OPTS = { addrDetail: false, usesDays: false };

describe("L48 (bảng HN): Thay toàn bộ giữ rid + trạng thái duyệt/thanh toán của dòng khớp", () => {
  it("dòng khớp mang rid và cờ duyệt / thanh toán sang; dòng mới của tệp không bịa rid", () => {
    const r = giuTruongChiApp(truoc(), toGridItems(nhap, OPTS).items, { giuGhiChuNoiBo: true });
    const [bd, st, moi] = r.items as HangHn[];
    expect(bd).toMatchObject({
      rid: "r-1", approved: true, approvedAt: "2026-09-01T00:00:00.000Z", approvedBy: 3,
      paid: true, paidAt: "2026-09-02T00:00:00.000Z", paidById: 5, hasPaidProof: true,
    });
    // Số liệu vẫn là của TỆP — máy chủ tự ghim số tiền của hàng đã trả, client không che hộ.
    expect(st).toMatchObject({ rid: "r-2", unitPrice: 320000 });
    expect(moi.rid).toBeUndefined();
  });

  it("hàng đã duyệt / đã thanh toán KHÔNG còn trong tệp được ĐẾM để nói ra ở hộp xác nhận", () => {
    const r = giuTruongChiApp(truoc(), toGridItems(nhap, OPTS).items, { giuGhiChuNoiBo: true });
    expect(r.trangThaiMat).toBe(2);   // r-3 (đã trả) + r-4 (đã duyệt); r-5 không có trạng thái gì
  });

  it("hai dòng cũ trùng khoá, tệp chỉ còn một → rid chỉ đi theo MỘT dòng (không nhân bản rid)", () => {
    const cu: HangHn[] = [
      { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000, rid: "a", paid: true },
      { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000, rid: "b" },
    ];
    const r = giuTruongChiApp(cu, toGridItems(nhap.slice(0, 1), OPTS).items, { giuGhiChuNoiBo: true });
    expect(r.items.map((x) => (x as HangHn).rid)).toEqual(["a"]);
    expect(r.trangThaiMat).toBe(0);
  });

  it("sheet báo giá thường (không có rid) → không đẻ ra trường nào", () => {
    const cu: M.Item[] = [{ kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000 }];
    const r = giuTruongChiApp(cu, toGridItems(nhap.slice(0, 1), OPTS).items, { giuGhiChuNoiBo: true });
    expect(Object.keys(r.items[0]).filter((k) => /rid|approved|paid/i.test(k))).toEqual([]);
    expect(r.trangThaiMat).toBe(0);
  });
});
