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

// Soát chéo money#1: trang bị từ chối mà ĐÃ có chứng từ (số HĐ / ngày thu) là hoá đơn đã phát hành
// thật — công nợ còn đó. Ẩn nó đi thì kế toán mất dòng DUY NHẤT sửa được số HĐ / ngày thu (trang Hóa
// đơn), và "Chưa thu" / "Đã thu" / thẻ "chờ thu tiền" hụt đúng khoản đó.
describe("soát chéo money#1 — trang bị từ chối nhưng ĐÃ có hoá đơn / đã thu vẫn phải hiện", () => {
  const coChungTu = (tru: { invoiceNo?: string | null; paidAt?: string | null }): ProjectQuote => {
    const q = baoGia("converted");
    return { ...q, sheets: q.sheets!.map((s) => (s.id === 92 ? { ...s, ...tru } : s)) };
  };

  it("đã xuất HĐ, chưa thu: còn trên Hóa đơn, Dự án và nhóm 'Đã xuất HĐ · chờ thu tiền'", () => {
    const q = coChungTu({ invoiceNo: "HD01", paidAt: null });
    expect(dongHoaDon([q]).map((r) => r.sheetId)).toEqual([91, 92]);
    expect(dongDuAn([q]).reduce((s, r) => s + r.thanhTienVAT, 0)).toBe(1_650_000);
    const ar = buildActionItems([q]).find((c) => c.key === "ar");
    expect(ar?.items.map((i) => i.amount)).toEqual([550_000]);
  });

  it("đã thu tiền (kể cả khi chưa có số HĐ): dòng vẫn còn trên Hóa đơn (kế toán sửa được ngày thu)", () => {
    expect(dongHoaDon([coChungTu({ invoiceNo: "HD01", paidAt: "2026-09-10" })]).map((r) => r.sheetId)).toEqual([91, 92]);
    expect(dongHoaDon([coChungTu({ invoiceNo: null, paidAt: "2026-09-10" })]).map((r) => r.sheetId)).toEqual([91, 92]);
  });

  it("số HĐ chỉ toàn khoảng trắng = CHƯA xuất (cùng luật daXuatHoaDon ở máy chủ) → vẫn ẩn", () => {
    expect(dongHoaDon([coChungTu({ invoiceNo: "   " })]).map((r) => r.sheetId)).toEqual([91]);
  });
});
