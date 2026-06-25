// Test VECTOR VÀNG cho lõi toán tiền dùng chung (shared/quote-math.ts, qua re-export ./quoteMath).
// Khóa CHÍNH SÁCH làm tròn/cắt/giảm-giá để KHÔNG ai đổi nhầm → lệch tiền khách. Đây là tiền khách.
import { describe, it, expect } from "vitest";
import { trunc2, roundVnd, lineAmount, sheetSubtotalGrouped, quoteTotals, fmtNumCell, parseVN } from "./quoteMath";

describe("trunc2 — CẮT 2 số (không làm tròn)", () => {
  it("cắt chứ không làm tròn", () => { expect(trunc2(5.6375)).toBe(5.63); expect(trunc2(2.999)).toBe(2.99); });
  it("giữ dấu âm", () => { expect(trunc2(-5.6375)).toBe(-5.63); });
  it("0 / rác → 0", () => { expect(trunc2(0)).toBe(0); expect(trunc2(NaN)).toBe(0); });
});

describe("lineAmount — Thành Tiền 1 dòng", () => {
  it("không ngày: SL × Đơn giá, làm tròn VNĐ", () => {
    expect(lineAmount({ kind: "item", quantity: 2, unitPrice: 1_000_000 }, false)).toBe(2_000_000);
  });
  it("có ngày: SL × Ngày × Đơn giá", () => {
    expect(lineAmount({ kind: "item", quantity: 2, days: 3, unitPrice: 1_000_000 }, true)).toBe(6_000_000);
  });
  it("SL lẻ bị CẮT 2 số trước khi nhân", () => {
    expect(lineAmount({ kind: "item", quantity: 2.555, unitPrice: 1_000 }, false)).toBe(2_550);
  });
});

describe("sheetSubtotalGrouped — hệ số nhóm", () => {
  const items = [
    { kind: "section" as const, quantity: 3 },
    { kind: "item" as const, quantity: 2, unitPrice: 1_000_000 },
    { kind: "info" as const },
  ];
  it("BẬT nhóm → item nhân SL nhóm (×3), info bỏ qua", () => {
    expect(sheetSubtotalGrouped(items, false, true)).toBe(6_000_000);
  });
  it("TẮT nhóm → không nhân (×1)", () => {
    expect(sheetSubtotalGrouped(items, false, false)).toBe(2_000_000);
  });
});

describe("quoteTotals — VAT + kẹp giảm giá", () => {
  it("VAT tính TỪ subtotal đã làm tròn", () => {
    expect(quoteTotals(6_000_000, 8, 0)).toEqual({ subtotal: 6_000_000, vat: 480_000, discount: 0, total: 6_480_000 });
  });
  it("giảm giá > tổng → kẹp về tổng (total không âm)", () => {
    expect(quoteTotals(6_000_000, 8, 10_000_000)).toEqual({ subtotal: 6_000_000, vat: 480_000, discount: 6_480_000, total: 0 });
  });
  it("giảm giá âm → 0", () => {
    expect(quoteTotals(6_000_000, 8, -5).discount).toBe(0);
  });
});

describe("định dạng VN", () => {
  it("fmtNumCell: 0 → rỗng, nguyên → chấm nghìn, lẻ → 2 số", () => {
    expect(fmtNumCell(0)).toBe("");
    expect(fmtNumCell(1_234_567)).toBe("1.234.567");
    expect(fmtNumCell(1234.5)).toBe("1.234,50");
  });
  it("parseVN: chấm nghìn / phẩy thập phân / âm", () => {
    expect(parseVN("1.234.567")).toBe(1_234_567);
    expect(parseVN("12,5")).toBe(12.5);
    expect(parseVN("-5.000")).toBe(-5_000);
  });
  it("roundVnd làm tròn nửa lên", () => { expect(roundVnd(0.5)).toBe(1); expect(roundVnd(2.4)).toBe(2); });
});
