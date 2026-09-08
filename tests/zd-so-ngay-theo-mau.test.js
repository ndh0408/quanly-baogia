// HỆ SỐ SỐ NGÀY PHẢI THEO MẪU, CHUẨN HOÁ Ở SERVER — chốt hồi quy, phát hiện qua ultracode audit
// 2026-09-07 (src/quoteUtils.ts chuanHoaSoNgayTheoCoNgay / chuanHoaSoNgayTheoMau).
//
// money.ts nhân `days` theo TỪNG DÒNG; excel.ts và lưới web chỉ nhân khi TEMPLATE có cột Số Ngày.
// Gửi thẳng PUT /api/quotes/:id một sheet mẫu-không-ngày nhưng items có days:30 → CSDL/KPI ghi gấp 30
// lần, Excel gửi khách vẫn ra số gốc. Nay server ép days=null cho sheet của mẫu không có cột Số Ngày
// TRƯỚC computeQuoteTotals, nên ba đường ra cùng một số.
import { describe, it, expect } from "vitest";
import { chuanHoaSoNgayTheoCoNgay } from "../src/quoteUtils.js";
import { computeQuoteTotals } from "../src/money.js";

const sheet = (templateId, days) => ({ templateId, items: [{ kind: "item", quantity: 2, unitPrice: 1_000_000, days }] });

describe("chuanHoaSoNgayTheoCoNgay", () => {
  it("mẫu KHÔNG có cột Số Ngày → days bị ép về null, tổng KHÔNG nhân ngày", () => {
    const sheets = [sheet(7, 30)];
    chuanHoaSoNgayTheoCoNgay(sheets, new Map([[7, false]]));
    expect(sheets[0].items[0].days).toBeNull();
    const t = computeQuoteTotals({ vatPercent: 0, sheets });
    expect(Number(t.subtotal), "trước khi vá: 60.000.000 (×30)").toBe(2_000_000);
  });

  it("mẫu CÓ cột Số Ngày → giữ nguyên days, tổng nhân ngày như cũ (không phá nghiệp vụ đang chạy)", () => {
    const sheets = [sheet(8, 30)];
    chuanHoaSoNgayTheoCoNgay(sheets, new Map([[8, true]]));
    expect(sheets[0].items[0].days).toBe(30);
    expect(Number(computeQuoteTotals({ vatPercent: 0, sheets }).subtotal)).toBe(60_000_000);
  });

  it("mẫu KHÔNG TRA ĐƯỢC (id lạ, chưa có config) → không đoán, giữ nguyên", () => {
    const sheets = [sheet(999, 5)];
    chuanHoaSoNgayTheoCoNgay(sheets, new Map());
    expect(sheets[0].items[0].days).toBe(5);
  });

  it("nhiều sheet, mỗi sheet theo đúng mẫu của mình", () => {
    const sheets = [sheet(7, 3), sheet(8, 3)];
    chuanHoaSoNgayTheoCoNgay(sheets, new Map([[7, false], [8, true]]));
    expect(sheets[0].items[0].days).toBeNull();
    expect(sheets[1].items[0].days).toBe(3);
  });

  it("đầu vào lạ (null/undefined/không mảng) không ném", () => {
    expect(() => chuanHoaSoNgayTheoCoNgay(null, new Map())).not.toThrow();
    expect(() => chuanHoaSoNgayTheoCoNgay([{ templateId: 7 }, null, { templateId: 7, items: null }], new Map([[7, false]]))).not.toThrow();
  });
});
