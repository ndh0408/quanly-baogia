import { describe, it, expect } from "vitest";
import {
  canEdit,
  presentQuoteRow,
  buildSheetsCreate,
  sanitizeExtraTables,
  extraTableSum,
} from "../src/quoteUtils.js";

describe("quoteUtils (extracted pure helpers)", () => {
  describe("canEdit", () => {
    const admin = { role: "admin", userId: 1 };
    it("admin can edit a non-terminal quote", () => {
      expect(canEdit({ status: "approved", createdById: 9, members: [] }, admin)).toBe(true);
    });
    it("nobody can edit a converted/lost quote", () => {
      expect(canEdit({ status: "converted", createdById: 1, members: [] }, admin)).toBe(false);
      expect(canEdit({ status: "lost", createdById: 1, members: [] }, admin)).toBe(false);
    });
    it("a stranger cannot edit", () => {
      const stranger = { role: "manager", userId: 2 };
      expect(canEdit({ status: "draft", createdById: 9, members: [] }, stranger)).toBe(false);
    });
  });

  describe("buildSheetsCreate", () => {
    it("preserves productId and normalizes fields", () => {
      const [sheet] = buildSheetsCreate([
        { templateId: "5", order: 1, groupSubtotal: true, items: [
          { productId: "42", kind: "weird", name: "  A\r\nB ", quantity: "3", unitPrice: "1000", days: "2" },
        ] },
      ]);
      expect(sheet.templateId).toBe(5);
      expect(sheet.groupSubtotal).toBe(true);
      const it0 = sheet.items.create[0];
      expect(it0.productId).toBe(42);          // catalog link kept
      expect(it0.kind).toBe("item");           // unknown kind -> item
      expect(it0.name).toBe("A\nB");           // CRLF normalized + trimmed
      expect(it0.quantity.toString()).toBe("3");
      expect(it0.unitPrice.toString()).toBe("1000");
      expect(it0.days.toString()).toBe("2");
    });
    it("productId is null when absent", () => {
      const [sheet] = buildSheetsCreate([{ templateId: 1, items: [{ name: "x", quantity: 1, unitPrice: 1 }] }]);
      expect(sheet.items.create[0].productId).toBeNull();
    });
  });

  describe("presentQuoteRow", () => {
    it("coerces Decimals to numbers and derives customer/sheet fields", () => {
      const row = presentQuoteRow({
        id: 1, vatPercent: "8", subtotal: "1000", vat: "80", discount: "0", total: "1080",
        customer: { code: "KH26001", name: "Acme" }, _count: { sheets: 3 },
      });
      expect(row.total).toBe(1080);
      expect(row.vat).toBe(80);
      expect(row.customerCode).toBe("KH26001");
      expect(row.customerName).toBe("Acme");
      expect(row.sheetCount).toBe(3);
    });
  });

  describe("extraTableSum", () => {
    it("sums item/sub rows, excludes section & info, applies days", () => {
      const t = { items: [
        { kind: "section", quantity: 5, unitPrice: 999 },   // excluded
        { kind: "info", quantity: 1, unitPrice: 999 },       // excluded
        { kind: "item", quantity: 2, unitPrice: 1000 },      // 2000
        { kind: "item", quantity: 3, unitPrice: 1000, days: 2 }, // 6000
      ] };
      expect(extraTableSum(t)).toBe(8000);
    });
  });

  describe("sanitizeExtraTables", () => {
    it("returns undefined for empty / drops invalid categories", () => {
      expect(sanitizeExtraTables([])).toBeUndefined();
      expect(sanitizeExtraTables([{ category: "bogus", items: [] }])).toBeUndefined();
    });
    it("keeps valid categories", () => {
      const out = sanitizeExtraTables([{ category: "hcm", name: "x", items: [{ kind: "item", name: "a", quantity: 1, unitPrice: 2 }] }]);
      expect(out).toHaveLength(1);
      expect(out[0].category).toBe("hcm");
    });
  });
});
