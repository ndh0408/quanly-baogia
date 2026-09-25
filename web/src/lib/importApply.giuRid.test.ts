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
import { diffItems, giuTruongChiApp, toGridItems } from "./importApply";

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

// Soát toàn diện đợt 3 (L48, phần máy chủ từ chối): rid đi theo dòng khớp nên máy chủ nhận ra hàng ĐÃ
// TRẢ — tệp đổi SL / Đơn Giá / Số Ngày của hàng đó thì người không có quyền thanh toán bị từ chối CẢ lần
// Lưu (400, reconcileExtraPayments). Xem trước phải đếm được để nói ra TRƯỚC khi nạp.
describe("L48 (bảng HN): đếm hàng ĐÃ THANH TOÁN bị tệp đổi số tiền", () => {
  it("hàng đã trả bị đổi Đơn Giá → đếm 1; hàng chưa trả đổi giá, hàng đã trả giữ nguyên số → không đếm", () => {
    const tep: ImportedItem[] = [
      { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 260000, row: 7 },   // r-1 đã trả: 250.000 → 260.000
      { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 320000, row: 8 },   // r-2 chưa trả
    ];
    const r = giuTruongChiApp(truoc(), toGridItems(tep, OPTS).items, { giuGhiChuNoiBo: true });
    expect(r.tienDaTraDoi).toEqual(["Backdrop"]);
    const giuSo = giuTruongChiApp(truoc(), toGridItems(nhap, OPTS).items, { giuGhiChuNoiBo: true });
    expect(giuSo.tienDaTraDoi).toEqual([]);
  });

  it("đổi SỐ LƯỢNG hàng đã trả cũng đếm; hàng cũ không ghi số tiền (bản trước chuẩn hoá) thì không — khớp máy chủ", () => {
    const tep: ImportedItem[] = [{ kind: "item", name: "Backdrop", unit: "m2", quantity: 3, unitPrice: 250000, row: 7 }];
    expect(giuTruongChiApp(truoc(), toGridItems(tep, OPTS).items, { giuGhiChuNoiBo: true }).tienDaTraDoi).toEqual(["Backdrop"]);
    const cuKhongSo = [{ kind: "item", name: "Backdrop", unit: "m2", rid: "r-9", paid: true }] as unknown as M.Item[];
    expect(giuTruongChiApp(cuKhongSo, toGridItems(tep, OPTS).items, { giuGhiChuNoiBo: true }).tienDaTraDoi).toEqual([]);
  });
});

// Ba cột NỘI BỘ của bảng HCM / Phí KH / Hà Nội (4e24308) — bảng nội bộ không xuất ra Excel và
// excelImport không đọc chúng, nên tệp nạp vào KHÔNG BAO GIỜ chở NS / CHỨNG TỪ / LƯU KHO. Trước bản vá,
// "Thay toàn bộ" trả hàng khớp không còn ba trường; Lưu xong sanitizeExtraTables ghi null/false ở MỌI
// hàng khớp, trong khi bảng đối chiếu vẫn ghi "Giữ nguyên" và hộp xác nhận không báo gì.
describe("Thay toàn bộ giữ NS / CHỨNG TỪ / LƯU KHO của dòng khớp", () => {
  type HangNb = HangHn & { ns?: string | null; luuKho?: boolean; chungTu?: "VAT" | "HDNS" | "TM" | null };
  const cu = (): HangNb[] => [
    { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000, rid: "r-1", ns: "Anh Tuấn", luuKho: true, chungTu: "VAT" },
    { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 300000, rid: "r-2", ns: "Chị Lan", luuKho: false, chungTu: "TM" },
    { kind: "item", name: "Bàn bị khách xoá", unit: "cái", quantity: 1, unitPrice: 100000, rid: "r-3", ns: "Anh Nam", chungTu: "HDNS" },
  ];

  it("dòng khớp giữ nguyên ba trường; dòng mới của tệp không bịa giá trị", () => {
    const r = giuTruongChiApp(cu(), toGridItems(nhap, OPTS).items, { giuGhiChuNoiBo: true });
    const [bd, st, moi] = r.items as HangNb[];
    expect(bd).toMatchObject({ rid: "r-1", ns: "Anh Tuấn", luuKho: true, chungTu: "VAT" });
    // Số liệu vẫn theo TỆP (320.000); luuKho=false cũng là giá trị phải giữ, không phải "không có".
    expect(st).toMatchObject({ rid: "r-2", unitPrice: 320000, ns: "Chị Lan", luuKho: false, chungTu: "TM" });
    expect(moi.name).toBe("Hạng mục mới");
    expect(moi.ns ?? null).toBeNull();
    expect(moi.luuKho ?? false).toBe(false);
    expect(moi.chungTu ?? null).toBeNull();
  });

  it("bảng đối chiếu nói THẬT: mọi dòng nó ghi 'Giữ nguyên' đều còn đủ ba trường như trước", () => {
    const truocNb = cu();
    const giu = giuTruongChiApp(truocNb, toGridItems(nhap, OPTS).items, { giuGhiChuNoiBo: true }).items as HangNb[];
    const dong = diffItems(truocNb, giu, false);
    const giuNguyen = dong.filter((d) => d.kind === "same");
    expect(giuNguyen.length).toBeGreaterThan(0);
    for (const d of giuNguyen) {
      const a = truocNb[d.beforeNo! - 1], b = giu[d.afterNo! - 1];
      expect([b.ns, b.luuKho, b.chungTu], `dòng "${d.name}" ghi 'Giữ nguyên' mà ba cột nội bộ đã đổi`).toEqual([a.ns, a.luuKho, a.chungTu]);
    }
  });

  it("không sửa tại chỗ mảng đầu vào", () => {
    const sau = toGridItems(nhap, OPTS).items as HangNb[];
    giuTruongChiApp(cu(), sau, { giuGhiChuNoiBo: true });
    expect(sau.every((it) => it.ns === undefined && it.chungTu === undefined)).toBe(true);
  });
});
