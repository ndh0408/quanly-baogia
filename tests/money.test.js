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

describe("computeQuoteTotals — discount", () => {
  const oneItem = (discount) => ({
    vatPercent: 0,
    discount,
    sheets: [{ items: [{ quantity: 1, unitPrice: 1000 }] }],
  });

  it("subtracts a normal discount from the grand total", () => {
    const t = computeQuoteTotals(oneItem(300));
    expect(t.discount.toNumber()).toBe(300);
    expect(t.total.toNumber()).toBe(700);
  });

  it("clamps discount to gross — total never goes negative", () => {
    const t = computeQuoteTotals(oneItem(999999));
    expect(t.discount.toNumber()).toBe(1000);
    expect(t.total.toNumber()).toBe(0);
  });

  it("negative discount is treated as zero", () => {
    const t = computeQuoteTotals(oneItem(-500));
    expect(t.discount.toNumber()).toBe(0);
    expect(t.total.toNumber()).toBe(1000);
  });

  it("discount applies after VAT (current policy: VAT on full subtotal)", () => {
    const t = computeQuoteTotals({
      vatPercent: 10,
      discount: 100,
      sheets: [{ items: [{ quantity: 1, unitPrice: 1000 }] }],
    });
    expect(t.vat.toNumber()).toBe(100);   // 10% of 1000 — NOT of (1000 - 100)
    expect(t.total.toNumber()).toBe(1000); // 1000 + 100 - 100
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
