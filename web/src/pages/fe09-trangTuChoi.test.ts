// FE-09: báo giá đã chốt với một trang khách KHÔNG duyệt — convertedTotal (máy chủ) đã trừ trang đó,
// nhưng Hóa đơn / Quản lý dự án / "Cần xử lý" vẫn coi nó là việc cần xuất HĐ và cộng vào Số tiền,
// Chưa thu, Tổng VAT. Kiểm cả ba bộ dựng dòng.
import { describe, it, expect } from "vitest";
import type { ProjectQuote } from "../lib/api";
import { buildRows as dongHoaDon } from "./Invoices";
import { buildRows as dongDuAn } from "./Projects";
import { buildActionItems } from "./Dashboard";

const baoGia = (status: string): ProjectQuote => ({
  id: 9, title: "Sự kiện", status, vatPercent: 10, quoteNumber: "GN26009",
  sheets: [
    { id: 91, name: "Backdrop", subtotal: 1_000_000, custStatus: "approved", signedAt: "2026-09-01", invoiceNo: null },
    { id: 92, name: "Standee", subtotal: 500_000, custStatus: "rejected", signedAt: "2026-09-01", invoiceNo: null },
  ],
});

describe("FE-09 — trang khách không duyệt của báo giá đã chốt", () => {
  it("Hóa đơn: không thành dòng cần xuất HĐ, không vào tổng", () => {
    const rows = dongHoaDon([baoGia("converted")]);
    expect(rows.map((r) => r.sheetId)).toEqual([91]);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(1_100_000);
  });
  it("Hóa đơn: mã sản xuất của trang còn lại KHÔNG trượt số", () => {
    const [chuaLoc] = dongHoaDon([{ ...baoGia("converted"), sheets: baoGia("converted").sheets!.map((s) => ({ ...s, custStatus: null })) }]);
    expect(dongHoaDon([baoGia("converted")])[0].code).toBe(chuaLoc.code);
  });
  it("Quản lý dự án: không vào Số tiền / Tổng VAT", () => {
    const rows = dongDuAn([baoGia("converted")]);
    expect(rows.reduce((s, r) => s + r.thanhTienVAT, 0)).toBe(1_100_000);
  });
  it("Cần xử lý: trang bị từ chối không nằm trong 'Đã ký · chưa xuất hóa đơn'", () => {
    const inv = buildActionItems([baoGia("converted")]).find((c) => c.key === "inv")!;
    expect(inv.items).toHaveLength(1);
    expect(inv.total).toBe(1_100_000);
  });
  it("báo giá CHƯA chốt: giữ nguyên (trang bị từ chối vẫn có thể được đồng ý lại)", () => {
    expect(dongDuAn([baoGia("sent")])).toHaveLength(2);
  });
});
