// Test VECTOR VÀNG cho lõi toán tiền dùng chung (shared/quote-math.ts, qua re-export ./quoteMath).
// Khóa CHÍNH SÁCH làm tròn/cắt/giảm-giá để KHÔNG ai đổi nhầm → lệch tiền khách. Đây là tiền khách.
import { describe, it, expect } from "vitest";
import { qtyRound, roundVnd, lineAmount, sheetSubtotalGrouped, sheetTotals, quoteTotals, fmtNumCell, parseVN, fmtMoney, statusLabel, groupLetter } from "./quoteMath";

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
  it("dòng import chính xác giữ tối đa 4 số lẻ khi tính tiền", () => {
    expect(lineAmount({ kind: "item", quantity: 0.35, quantityExact: true, unitPrice: 550_000 }, false)).toBe(192_500);
    expect(lineAmount({ kind: "item", quantity: 0.9075, quantityExact: true, unitPrice: 2_200_000 }, false)).toBe(1_996_500);
    expect(fmtNumCell(0.9075, true)).toBe("0,9075");
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

describe("sheetTotals — Discount RIÊNG của sheet, kẹp vào [0, tổng sheet]", () => {
  const sheet = (discount?: number) => ({
    groupSubtotal: false, discount,
    items: [{ kind: "item" as const, quantity: 2, unitPrice: 3_000_000 }],
  });
  it("không có Discount → net = gross", () => {
    expect(sheetTotals(sheet(), false)).toEqual({ gross: 6_000_000, discount: 0, net: 6_000_000 });
  });
  it("trừ đúng số đã nhập", () => {
    expect(sheetTotals(sheet(1_000_000), false)).toEqual({ gross: 6_000_000, discount: 1_000_000, net: 5_000_000 });
  });
  it("Discount > tổng sheet → kẹp về tổng (net không âm)", () => {
    expect(sheetTotals(sheet(9_000_000), false)).toEqual({ gross: 6_000_000, discount: 6_000_000, net: 0 });
  });
  it("Discount âm → 0", () => {
    expect(sheetTotals(sheet(-5), false).discount).toBe(0);
  });
});

describe("quoteTotals — VAT tính TRÊN số đã trừ Discount", () => {
  it("không sheet nào giảm giá: VAT trên tổng", () => {
    expect(quoteTotals([{ gross: 6_000_000, discount: 0, net: 6_000_000 }], 8))
      .toEqual({ gross: 6_000_000, discount: 0, subtotal: 6_000_000, vat: 480_000, total: 6_480_000 });
  });
  // Đúng con số trong file khách gửi: 294.988.400 − 3.000.000 = 291.988.400 · VAT 8% = 23.359.072.
  it("Cộng → Discount → Tổng Cộng → VAT(Tổng Cộng) → Thành Tiền", () => {
    expect(quoteTotals([{ gross: 294_988_400, discount: 3_000_000, net: 291_988_400 }], 8))
      .toEqual({ gross: 294_988_400, discount: 3_000_000, subtotal: 291_988_400, vat: 23_359_072, total: 315_347_472 });
  });
  it("cộng Discount của NHIỀU sheet", () => {
    expect(quoteTotals([
      { gross: 10_000_000, discount: 1_000_000, net: 9_000_000 },
      { gross: 5_000_000, discount: 0, net: 5_000_000 },
    ], 10)).toEqual({ gross: 15_000_000, discount: 1_000_000, subtotal: 14_000_000, vat: 1_400_000, total: 15_400_000 });
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

  // ── Ba bài dưới CHUYỂN TỪ tests/util.test.js ────────────────────────────────
  // File đó test `public/js/util.js`, bị gỡ cùng SPA cũ ngày 2026-08-26. Ba hàm này KHÔNG chết
  // theo: chúng sống ở `shared/quote-math.ts` và React đang dùng — nhưng trước đó chưa có bài nào
  // ở đây phủ, nên chuyển sang để lớp phủ không tụt khi xoá file cũ.
  it("fmtMoney: nhóm nghìn kiểu vi-VN, rác → 0", () => {
    expect(fmtMoney(1_234_567)).toBe("1.234.567");
    expect(fmtMoney(null)).toBe("0");
    expect(fmtMoney(undefined)).toBe("0");
    expect(fmtMoney(NaN)).toBe("0");
  });
  it("statusLabel: trạng thái đã biết → nhãn Việt; lạ → trả nguyên chuỗi", () => {
    expect(statusLabel("converted")).toBe("Đã chốt");
    expect(statusLabel("draft")).toBe("Nháp");
    // "expired" đã BỎ khỏi hệ (không còn auto hết hạn) → không có nhãn, rơi về chính nó.
    expect(statusLabel("expired")).toBe("expired");
    expect(statusLabel("")).toBe("—");
  });
  it("groupLetter: nhãn cột kiểu bảng tính (A…Z, AA)", () => {
    expect(groupLetter(0)).toBe("A");
    expect(groupLetter(25)).toBe("Z");
    expect(groupLetter(26)).toBe("AA");
  });
});
