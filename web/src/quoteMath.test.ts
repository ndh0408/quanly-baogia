// Test VECTOR VÀNG cho lõi toán tiền dùng chung (shared/quote-math.ts, qua re-export ./quoteMath).
// Khóa CHÍNH SÁCH làm tròn/cắt/giảm-giá để KHÔNG ai đổi nhầm → lệch tiền khách. Đây là tiền khách.
import { describe, it, expect } from "vitest";
import { qtyRound, roundVnd, lineAmount, sheetSubtotalGrouped, quoteTotals, fmtNumCell, parseVN } from "./quoteMath";

describe("qtyRound — LÀM TRÒN Số Lượng về 1 chữ số thập phân", () => {
  it("làm tròn 1 số (7,378→7,4 · 6,42→6,4 · 5,65→5,7)", () => { expect(qtyRound(7.378)).toBeCloseTo(7.4); expect(qtyRound(6.42)).toBeCloseTo(6.4); expect(qtyRound(5.65)).toBeCloseTo(5.7); });
  it("giữ dấu âm", () => { expect(qtyRound(-7.378)).toBeCloseTo(-7.4); });
  it("0 / rác → 0", () => { expect(qtyRound(0)).toBe(0); expect(qtyRound(NaN)).toBe(0); });
});

describe("lineAmount — Thành Tiền 1 dòng", () => {
  it("không ngày: SL × Đơn giá, làm tròn VNĐ", () => {
    expect(lineAmount({ kind: "item", quantity: 2, unitPrice: 1_000_000 }, false)).toBe(2_000_000);
  });
  it("có ngày: SL × Ngày × Đơn giá", () => {
    expect(lineAmount({ kind: "item", quantity: 2, days: 3, unitPrice: 1_000_000 }, true)).toBe(6_000_000);
  });
  it("SL lẻ làm tròn 1 số trước khi nhân (2,555→2,6 × 1.000 = 2.600)", () => {
    expect(lineAmount({ kind: "item", quantity: 2.555, unitPrice: 1_000 }, false)).toBe(2_600);
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
  it("fmtNumCell: 0 → rỗng, nguyên → chấm nghìn, lẻ → 1 số", () => {
    expect(fmtNumCell(0)).toBe("");
    expect(fmtNumCell(1_234_567)).toBe("1.234.567");
    expect(fmtNumCell(1234.5)).toBe("1.234,5");
  });
  it("parseVN: chấm nghìn / phẩy thập phân / âm", () => {
    expect(parseVN("1.234.567")).toBe(1_234_567);
    expect(parseVN("12,5")).toBe(12.5);
    expect(parseVN("-5.000")).toBe(-5_000);
  });
  it("roundVnd làm tròn nửa lên", () => { expect(roundVnd(0.5)).toBe(1); expect(roundVnd(2.4)).toBe(2); });
});
