// Soát toàn diện L48 — nạp Excel chế độ "Thay toàn bộ" XOÁ HẾT ảnh hạng mục của sheet, trong khi
// bảng đối chiếu vẫn báo "Giữ nguyên".
//
// ĐÃ ĐO trước khi sửa: toGridItems dựng item mới từ blankItem (không images, mất productId), diffFields
// không so ảnh → diffItems ghép LCS xong xếp dòng mất ảnh vào "same". Tệp xuất lúc TẮT cột ảnh không
// có cột HÌNH ẢNH nên máy chủ không cảnh báo gì. Bấm Lưu là ảnh của cả sheet mất vĩnh viễn.
//   diff: {"same":2,"changed":0,"added":0,"removed":0} ảnh trước: [2, 1] ảnh sau: [0, 0]
import { describe, expect, it } from "vitest";
import type * as M from "./quoteMath";
import type { ImportedItem } from "./api";
import { diffCounts, diffItems, giuTruongChiApp, toGridItems } from "./importApply";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const truoc = (): M.Item[] => [
  { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000, images: [PNG, PNG], productId: 7, internalNote: "giá vốn 180k" } as M.Item,
  { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 300000, images: [PNG] },
  { kind: "item", name: "Bàn bị khách xoá", unit: "cái", quantity: 1, unitPrice: 100000, images: [PNG, PNG, PNG] },
];
// Khách sửa đơn giá Standee rồi gửi lại tệp KHÔNG có cột ảnh (xuất lúc tắt "Hình ảnh").
const nhap: ImportedItem[] = [
  { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000, row: 7 },
  { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 320000, row: 8 },
];
const OPTS = { addrDetail: false, usesDays: false };

describe("L48: chế độ Thay — ảnh (và trường chỉ app có) đi theo dòng khớp", () => {
  it("dòng khớp khoá giữ ảnh + productId; dòng bị xoá thật thì đếm vào số ảnh sẽ mất", () => {
    const before = truoc();
    const conv = toGridItems(nhap, OPTS);
    const r = giuTruongChiApp(before, conv.items, { giuGhiChuNoiBo: true });
    expect(r.items.map((x) => x.images?.length || 0)).toEqual([2, 1]);
    expect((r.items[0] as Record<string, unknown>).productId).toBe(7);
    expect(r.items[0].internalNote).toBe("giá vốn 180k");
    // Số liệu vẫn là của TỆP — chỉ mang sang thứ tệp không chở được.
    expect(r.items[1].unitPrice).toBe(320000);
    expect(r.anhMat).toBe(3);
    // Không sửa tại chỗ mảng của sheet đang mở.
    expect(conv.items[0].images).toBeUndefined();
  });

  it("tệp CÓ cột Ghi chú nội bộ → lấy theo tệp, kể cả ô trống (khách cố ý xoá)", () => {
    const r = giuTruongChiApp(truoc(), toGridItems(nhap, OPTS).items, { giuGhiChuNoiBo: false });
    expect(r.items[0].internalNote).toBeUndefined();
    expect(r.items[0].images?.length).toBe(2);
  });

  it("bảng đối chiếu sau khi mang ảnh: dòng khớp là 'Giữ nguyên' THẬT, dòng xoá hiện 'Sẽ xóa'", () => {
    const before = truoc();
    const after = giuTruongChiApp(before, toGridItems(nhap, OPTS).items, { giuGhiChuNoiBo: true }).items;
    expect(diffCounts(diffItems(before, after, false))).toEqual({ same: 1, changed: 1, added: 0, removed: 1 });
  });

  it("dòng ghép được mà MẤT ảnh (chưa mang sang) phải hiện 'changed' — không được báo 'Giữ nguyên'", () => {
    const before = truoc().slice(0, 1);
    const after = toGridItems(nhap.slice(0, 1), OPTS).items;
    const rows = diffItems(before, after, false);
    expect(rows[0].kind).toBe("changed");
    expect(rows[0].fields).toContainEqual(expect.objectContaining({ field: "images", before: 2, after: 0 }));
  });
});
