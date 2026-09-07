import { describe, it, expect } from "vitest";
import { D, computeQuoteTotals, totalsToJson } from "../src/money.js";

describe("D() decimal coercer", () => {
  it("returns Decimal(0) for null/undefined/empty", () => {
    expect(D(null).toString()).toBe("0");
    expect(D(undefined).toString()).toBe("0");
    expect(D("").toString()).toBe("0");
  });
  it("preserves precision for string input", () => {
    expect(D("0.1").plus(D("0.2")).toString()).toBe("0.3");
  });
  it("idempotent on Decimal input", () => {
    const a = D("123.45");
    expect(D(a).toString()).toBe("123.45");
  });
});

describe("computeQuoteTotals", () => {
  it("quantityExact chỉ đổi cách tính cho đúng dòng được đánh dấu", () => {
    const t = computeQuoteTotals({ vatPercent: 0, sheets: [{ items: [
      { quantity: 0.35, quantityExact: true, unitPrice: 550_000 },
      { quantity: 0.35, quantityExact: false, unitPrice: 550_000 },
    ] }] });
    expect(t.subtotal.toNumber()).toBe(412_500);
  });

  it("handles single sheet, no days, integer math (Marico Decor style)", () => {
    const q = {
      vatPercent: 8,
      sheets: [{ items: [
        { quantity: 1, unitPrice: 100000 },
        { quantity: 2, unitPrice: 50000 },
      ] }],
    };
    const t = computeQuoteTotals(q);
    expect(t.subtotal.toNumber()).toBe(200000);
    expect(t.vat.toNumber()).toBe(16000);
    expect(t.total.toNumber()).toBe(216000);
  });

  it("multiplies by days when present (Unibenfood Sampling style)", () => {
    const q = {
      vatPercent: 8,
      sheets: [{ items: [{ quantity: 4, days: 14, unitPrice: 320000 }] }],
    };
    const t = computeQuoteTotals(q);
    // 4 × 14 × 320000 = 17,920,000
    expect(t.subtotal.toNumber()).toBe(17920000);
    expect(t.vat.toNumber()).toBe(1433600);
    expect(t.total.toNumber()).toBe(19353600);
  });

  it("aggregates across multiple sheets", () => {
    const q = {
      vatPercent: 10,
      sheets: [
        { items: [{ quantity: 1, unitPrice: 100 }] },
        { items: [{ quantity: 2, unitPrice: 200 }, { quantity: 3, unitPrice: 50 }] },
      ],
    };
    const t = computeQuoteTotals(q);
    expect(t.subtotal.toNumber()).toBe(650);
    expect(t.vat.toNumber()).toBe(65);
    expect(t.total.toNumber()).toBe(715);
    expect(t.sheetTotals).toHaveLength(2);
  });

  it("no float drift on 8% VAT (regression vs old float math)", () => {
    // This is the case where JS Number gives 1441600.0000000002
    const q = {
      vatPercent: 8,
      sheets: [{ items: [{ quantity: 1, unitPrice: 18020000 }] }],
    };
    const t = computeQuoteTotals(q);
    expect(t.vat.toString()).toBe("1441600");
    expect(t.total.toString()).toBe("19461600");
  });

  it("zero VAT works", () => {
    const q = { vatPercent: 0, sheets: [{ items: [{ quantity: 5, unitPrice: 100 }] }] };
    const t = computeQuoteTotals(q);
    expect(t.subtotal.toNumber()).toBe(500);
    expect(t.vat.toNumber()).toBe(0);
    expect(t.total.toNumber()).toBe(500);
  });

  it("empty sheets returns zero totals", () => {
    const t = computeQuoteTotals({ vatPercent: 8, sheets: [] });
    expect(t.subtotal.toNumber()).toBe(0);
    expect(t.vat.toNumber()).toBe(0);
    expect(t.total.toNumber()).toBe(0);
  });

  it("ignores days=0 (treats as no-days)", () => {
    const q = { vatPercent: 0, sheets: [{ items: [{ quantity: 3, days: 0, unitPrice: 100 }] }] };
    const t = computeQuoteTotals(q);
    expect(t.subtotal.toNumber()).toBe(300);
  });

  it("totalsToJson serializes decimals as numbers", () => {
    const t = computeQuoteTotals({ vatPercent: 8, sheets: [{ items: [{ quantity: 1, unitPrice: 1000 }] }] });
    const j = totalsToJson(t);
    expect(typeof j.subtotal).toBe("number");
    expect(j.subtotal).toBe(1000);
    expect(j.vat).toBe(80);
    expect(j.total).toBe(1080);
  });
});

// Discount ở MỨC SHEET và trừ TRƯỚC khi tính VAT:
//   Cộng → Discount → Tổng Cộng → VAT(Tổng Cộng) → Thành Tiền
describe("computeQuoteTotals — discount theo từng sheet", () => {
  const oneItem = (discount) => ({
    vatPercent: 0,
    sheets: [{ discount, items: [{ quantity: 1, unitPrice: 1000 }] }],
  });

  it("trừ thẳng vào tổng của sheet đó", () => {
    const t = computeQuoteTotals(oneItem(300));
    expect(t.sheetTotals[0].gross.toNumber()).toBe(1000);
    expect(t.sheetTotals[0].subtotal.toNumber()).toBe(700);   // ĐÃ trừ
    expect(t.discount.toNumber()).toBe(300);                  // Quote.discount = Σ các sheet
    expect(t.subtotal.toNumber()).toBe(700);
    expect(t.total.toNumber()).toBe(700);
  });

  it("kẹp Discount về tổng SHEET — tổng sheet không bao giờ âm", () => {
    const t = computeQuoteTotals(oneItem(999999));
    expect(t.discount.toNumber()).toBe(1000);
    expect(t.sheetTotals[0].subtotal.toNumber()).toBe(0);
    expect(t.total.toNumber()).toBe(0);
  });

  it("Discount âm → 0", () => {
    const t = computeQuoteTotals(oneItem(-500));
    expect(t.discount.toNumber()).toBe(0);
    expect(t.total.toNumber()).toBe(1000);
  });

  it("VAT tính TRÊN số đã trừ Discount", () => {
    const t = computeQuoteTotals({
      vatPercent: 10,
      sheets: [{ discount: 100, items: [{ quantity: 1, unitPrice: 1000 }] }],
    });
    expect(t.subtotal.toNumber()).toBe(900);
    expect(t.vat.toNumber()).toBe(90);      // 10% của 900, KHÔNG phải của 1000
    expect(t.total.toNumber()).toBe(990);
  });

  it("`discount` ở MỨC BÁO GIÁ bị BỎ QUA — chỉ sheet mới quyết", () => {
    const t = computeQuoteTotals({
      vatPercent: 0,
      discount: 500,                                   // client cũ gửi lên
      sheets: [{ items: [{ quantity: 1, unitPrice: 1000 }] }],
    });
    expect(t.discount.toNumber()).toBe(0);
    expect(t.total.toNumber()).toBe(1000);
  });

  it("nhiều sheet: mỗi sheet trừ riêng, VAT tính trên tổng đã trừ", () => {
    const t = computeQuoteTotals({
      vatPercent: 8,
      sheets: [
        { discount: 3_000_000, items: [{ quantity: 1, unitPrice: 294_988_400 }] },
        { items: [{ quantity: 1, unitPrice: 6_006_500 }] },
      ],
    });
    expect(t.discount.toNumber()).toBe(3_000_000);
    expect(t.subtotal.toNumber()).toBe(297_994_900);
    expect(t.vat.toNumber()).toBe(23_839_592);
    expect(t.total.toNumber()).toBe(321_834_492);
  });
});

describe("computeQuoteTotals — negative (discount) lines", () => {
  it("a negative-price line subtracts from the subtotal", () => {
    const t = computeQuoteTotals({
      vatPercent: 0,
      sheets: [{ items: [
        { quantity: 1, unitPrice: 1000 },
        { quantity: 1, unitPrice: -200 }, // "Giảm giá" line
      ] }],
    });
    expect(t.subtotal.toNumber()).toBe(800);
    expect(t.total.toNumber()).toBe(800);
  });
});

describe("computeQuoteTotals — section rows & groupSubtotal", () => {
  it("section row contributes nothing by itself", () => {
    const t = computeQuoteTotals({
      vatPercent: 0,
      sheets: [{ items: [
        { kind: "section", quantity: 5, unitPrice: 999 },
        { quantity: 1, unitPrice: 100 },
      ] }],
    });
    expect(t.subtotal.toNumber()).toBe(100);
  });

  // Ô Số Lượng của hàng nhóm HIỂN THỊ qua qtyRound (2,4213 → "2,4"). Hệ số nhân phải lấy đúng con
  // số đang hiện, không lấy số thô — nếu không, tiền không đối chiếu được với lưới và với file Excel.
  it("hệ số nhóm dùng Số Lượng ĐÃ làm tròn (2,4213 → ×2,4), không dùng số thô", () => {
    const t = computeQuoteTotals({
      vatPercent: 0,
      sheets: [{ groupSubtotal: true, items: [
        { kind: "section", quantity: 2.4213 },
        { quantity: 1, unitPrice: 100_000 },
      ] }],
    });
    expect(t.subtotal.toNumber()).toBe(240_000);      // 100.000 × 2,4
    expect(t.subtotal.toNumber()).not.toBe(242_130);  // ×2,4213 = bệnh cũ
  });

  it("hệ số nhóm của dòng quantityExact giữ 4 số lẻ", () => {
    const t = computeQuoteTotals({
      vatPercent: 0,
      sheets: [{ groupSubtotal: true, items: [
        { kind: "section", quantity: 2.4213, quantityExact: true },
        { quantity: 1, unitPrice: 100_000 },
      ] }],
    });
    expect(t.subtotal.toNumber()).toBe(242_130);
  });

  it("groupSubtotal multiplies following items by the section quantity", () => {
    const t = computeQuoteTotals({
      vatPercent: 0,
      sheets: [{ groupSubtotal: true, items: [
        { kind: "section", quantity: 2 },
        { quantity: 1, unitPrice: 100 },
        { quantity: 3, unitPrice: 10 },
      ] }],
    });
    expect(t.subtotal.toNumber()).toBe(260); // (100 + 30) × 2
  });

  it("a later section row resets the multiplier", () => {
    const t = computeQuoteTotals({
      vatPercent: 0,
      sheets: [{ groupSubtotal: true, items: [
        { kind: "section", quantity: 2 },
        { quantity: 1, unitPrice: 100 }, // ×2 = 200
        { kind: "section", quantity: 1 },
        { quantity: 1, unitPrice: 50 },  // ×1 = 50
      ] }],
    });
    expect(t.subtotal.toNumber()).toBe(250);
  });

  it("without groupSubtotal the section quantity is ignored", () => {
    const t = computeQuoteTotals({
      vatPercent: 0,
      sheets: [{ groupSubtotal: false, items: [
        { kind: "section", quantity: 2 },
        { quantity: 1, unitPrice: 100 },
      ] }],
    });
    expect(t.subtotal.toNumber()).toBe(100);
  });
});

describe("computeQuoteTotals — info rows", () => {
  it("info rows never contribute to the subtotal, even with stray qty/price", () => {
    // Excel folds info into a banner and excludes it; money.js + the client must agree
    // so a stray qty/price (via import/paste/API) can't silently inflate the stored total.
    const t = computeQuoteTotals({
      vatPercent: 0,
      sheets: [{ items: [
        { kind: "info", name: "Thông tin chương trình", quantity: 9, unitPrice: 9999 },
        { quantity: 1, unitPrice: 100 },
      ] }],
    });
    expect(t.subtotal.toNumber()).toBe(100);
  });

  it("info row inside a group does not get the section multiplier", () => {
    const t = computeQuoteTotals({
      vatPercent: 0,
      sheets: [{ groupSubtotal: true, items: [
        { kind: "section", quantity: 3 },
        { kind: "info", quantity: 5, unitPrice: 1000 },
        { quantity: 1, unitPrice: 100 },
      ] }],
    });
    expect(t.subtotal.toNumber()).toBe(300); // 100 × 3 only; info excluded
  });
});
