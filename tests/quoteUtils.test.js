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

    it("account_hn row exposes assigner (createdBy) + hnStatus but NEVER leaks money/customer", () => {
      const row = presentQuoteRow({
        id: 7, quoteNumber: "GN26002", projectCode: "GN26002", title: "Nhà Mình",
        status: "approved", total: "29404600", toCompany: "Khách Bí Mật",
        customer: { code: "KH26009", name: "Bí Mật" }, hnStatus: "assigned",
        company: { id: 2, name: "Gia Nguyễn", shortName: "GN" },
        createdBy: { id: 3, displayName: "Chị Quản Lý" }, _count: { sheets: 1 },
        sheets: [{ extraTables: [
          { category: "hcm", items: [{ kind: "item", quantity: 9, unitPrice: 9999 }] },   // KHÔNG tính vào HN
          { category: "hanoi", items: [{ kind: "item", quantity: 2, unitPrice: 1000 }] },  // 2000
          { category: "hanoi", items: [{ kind: "item", quantity: 1, unitPrice: 500, days: 3 }] }, // 1500
        ] }],
      }, { hnOnly: true });
      // Phải có: định danh + người giao + trạng thái HN
      expect(row._accountHnRow).toBe(true);
      expect(row.hnStatus).toBe("assigned");
      expect(row.createdBy).toEqual({ id: 3, displayName: "Chị Quản Lý" });
      // Số sheet HN + tổng HN = đúng phần account tự làm (gộp bảng "hanoi", bỏ hcm)
      expect(row.hnSheetCount).toBe(2);
      expect(row.hnTotal).toBe(3500);
      // TUYỆT ĐỐI không lộ tiền/khách báo giá chính cho account_hn
      expect(row.total).toBeUndefined();
      expect(row.toCompany).toBeUndefined();
      expect(row.customerCode).toBeUndefined();
      expect(row.customerName).toBeUndefined();
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
    it("HCM/Khách: CHỈ cộng hàng đã DUYỆT; Hà Nội cộng tất cả", () => {
      const rows = [
        { kind: "item", quantity: 2, unitPrice: 1000, approved: true },   // 2000
        { kind: "item", quantity: 5, unitPrice: 1000, approved: false },  // chưa duyệt → bỏ (hcm/khach)
      ];
      expect(extraTableSum({ category: "hcm", items: rows })).toBe(2000);
      expect(extraTableSum({ category: "khach", items: rows })).toBe(2000);
      expect(extraTableSum({ category: "hanoi", items: rows })).toBe(7000);   // HN: cộng hết
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
    it("giữ MỌI sheet Hà Nội + dữ liệu (account thêm nhiều sheet, kể cả sheet trống, không mất)", () => {
      const out = sanitizeExtraTables([
        { category: "hanoi", name: "Bảng 1", templateId: 3, groupSubtotal: true, items: [
          { kind: "item", name: "Vách", quantity: 2, unitPrice: 1000 },
          { kind: "section", label: "A", name: "Nhóm A", quantity: 3 },
        ] },
        { category: "hanoi", name: "Bảng 2", templateId: 3, groupSubtotal: false, items: [
          { kind: "item", name: "Sàn", quantity: 5, unitPrice: 200, days: 2 },
        ] },
        { category: "hanoi", name: "Bảng 3 trống", templateId: 3, items: [] }, // sheet trống vẫn phải giữ → tab không biến mất
      ]);
      expect(out).toHaveLength(3);                  // không rớt sheet nào
      expect(out[0].name).toBe("Bảng 1");
      expect(out[0].items).toHaveLength(2);         // giữ đủ item + dòng nhóm
      expect(out[0].items[1].kind).toBe("section");
      expect(out[0].items[1].label).toBe("A");
      expect(out[1].name).toBe("Bảng 2");
      expect(out[1].groupSubtotal).toBe(false);
      expect(out[1].items[0].quantity).toBe(5);
      expect(out[1].items[0].days).toBe(2);
      expect(out[2].name).toBe("Bảng 3 trống");
      expect(out[2].items).toHaveLength(0);         // sheet trống vẫn còn
    });
  });
});
