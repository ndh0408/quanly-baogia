// Trang Nhật ký hiện thay đổi "nhãn: trước → sau" từ before/after của máy chủ. Đổi khách hàng (danh mục) của báo giá ghi cả
// `customerId` (số id kỹ thuật) lẫn `khachHang` (MÃ + TÊN, đọc được) — chỉ dòng đọc được được hiện; số id chỉ bị ẩn KHI đã có dòng đó,
// còn nhật ký khác mang `customerId` (không có `khachHang`) giữ hành vi cũ.
import { describe, it, expect } from "vitest";
import { diffRows } from "./Audit";

describe("diffRows — đổi khách hàng của báo giá", () => {
  it("hiện 'Khách hàng (danh mục): KH005 — Cũ → KH009 — Mới', KHÔNG hiện số customerId", () => {
    const r = diffRows(
      { total: 100, status: "draft", customerId: 5, khachHang: "KH005 — Công ty Cũ" },
      { total: 100, status: "draft", reopened: false, customerId: 9, khachHang: "KH009 — Công ty Mới" },
    );
    expect(r).toEqual([
      { label: "Khách hàng (danh mục)", from: "KH005 — Công ty Cũ", to: "KH009 — Công ty Mới" },
      { label: "reopened", from: "(trống)", to: "Không" },   // `reopened` chỉ có ở phía sau — hành vi sẵn có của mọi lần Lưu
    ]);
    expect(r.some((x) => /customerId/i.test(x.label)), "số id kỹ thuật lọt ra trang Nhật ký").toBe(false);
  });

  it("gỡ liên kết → 'KH005 — Cũ → (trống)'", () => {
    const r = diffRows({ customerId: 5, khachHang: "KH005 — Công ty Cũ" }, { customerId: null, khachHang: null });
    expect(r).toEqual([{ label: "Khách hàng (danh mục)", from: "KH005 — Công ty Cũ", to: "(trống)" }]);
  });

  it("nhật ký KHÁC mang customerId mà không có khachHang → giữ hiện như cũ (không đổi hành vi ngoài phạm vi)", () => {
    const r = diffRows({ customerId: 5 }, { customerId: 9 });
    expect(r).toEqual([{ label: "customerId", from: "5", to: "9" }]);
  });

  it("lần Lưu thường (chỉ total/status) không sinh dòng khách hàng", () => {
    expect(diffRows({ total: 100, status: "draft" }, { total: 200, status: "draft", reopened: false }).map((x) => x.label)).toEqual(["total", "reopened"]);
  });
});
