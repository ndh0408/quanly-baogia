import { describe, it, expect } from "vitest";
import * as M from "./quoteMath";
import { coNhomNhanHeSo, khoaBatNhom } from "./khoaThanhTienNhom";

// Luật khoá ô "Hiện Thành Tiền nhóm" là hàm THUẦN của (cờ, items) — kiểm riêng ở đây; đường nối vào lưới
// (gõ / dán / hoàn tác / ExtraTables / HnTables) nằm ở components/GridTable.khoaThanhTienNhom.test.tsx.
const it_ = (kind: M.Item["kind"], quantity: number, o: Partial<M.Item> = {}): M.Item =>
  ({ kind, name: "x", detail: "", unit: "", quantity, unitPrice: 100, days: null, notes: "", ...o }) as M.Item;

describe("coNhomNhanHeSo — có nhóm nào mà SL nhân THẬT vào tổng không", () => {
  it("nhóm / nhóm con SL > 1 → có", () => {
    expect(coNhomNhanHeSo([it_("section", 2), it_("item", 1)])).toBe(true);
    expect(coNhomNhanHeSo([it_("section", 1), it_("subsection", 3), it_("item", 1)])).toBe(true);
    expect(coNhomNhanHeSo([it_("section", 1.5)])).toBe(true);
  });

  it("nhóm SL 1 / 0 / bỏ trống → không (groupMult tối thiểu 1)", () => {
    expect(coNhomNhanHeSo([it_("section", 1), it_("item", 5)])).toBe(false);
    expect(coNhomNhanHeSo([it_("section", 0), it_("subsection", 0)])).toBe(false);
    expect(coNhomNhanHeSo([])).toBe(false);
  });

  it("SL 1,04 hiện là '1' (làm tròn 1 số lẻ như ô hiển thị) → không; SL 1,05 hiện '1,1' → có", () => {
    expect(coNhomNhanHeSo([it_("section", 1.04)])).toBe(false);
    expect(coNhomNhanHeSo([it_("section", 1.05)])).toBe(true);
    // Dòng SL chính xác 4 số lẻ nhân đúng số gốc.
    expect(coNhomNhanHeSo([it_("section", 1.04, { quantityExact: true })])).toBe(true);
  });

  it("hàng mục / dòng thông tin SL > 1 KHÔNG tính — chỉ hàng nhóm mới có hệ số", () => {
    expect(coNhomNhanHeSo([it_("item", 9), it_("sub", 9), it_("info", 9)])).toBe(false);
  });

  it("khớp đúng cái sheetSubtotalGrouped nhân: có nhóm SL > 1 ⇔ bật/tắt cờ đổi tổng", () => {
    const co = [it_("section", 3), it_("item", 2)];
    expect(M.sheetSubtotalGrouped(co, false, true)).not.toBe(M.sheetSubtotalGrouped(co, false, false));
    expect(coNhomNhanHeSo(co)).toBe(true);
    const khong = [it_("section", 1), it_("item", 2)];
    expect(M.sheetSubtotalGrouped(khong, false, true)).toBe(M.sheetSubtotalGrouped(khong, false, false));
    expect(coNhomNhanHeSo(khong)).toBe(false);
  });
});

describe("khoaBatNhom — khoá CHỈ ở trạng thái bật", () => {
  const co = [it_("section", 2), it_("item", 1)];
  const khong = [it_("section", 1), it_("item", 1)];
  it("bật + có nhóm SL > 1 → khoá", () => expect(khoaBatNhom(true, co)).toBe(true));
  it("bật + không có → tự do", () => expect(khoaBatNhom(true, khong)).toBe(false));
  it("TẮT + có nhóm SL > 1 (báo giá cũ) → KHÔNG khoá", () => expect(khoaBatNhom(false, co)).toBe(false));
  it("tắt + không có → tự do", () => expect(khoaBatNhom(false, khong)).toBe(false));
});
