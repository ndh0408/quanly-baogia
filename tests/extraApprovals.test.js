import { describe, it, expect } from "vitest";
import { reconcileExtraApprovals } from "../src/quoteService.js";

// Duyệt theo HÀNG (bảng nội bộ HCM/Phí KH): CHỈ admin được đặt approved. Server phải chặn
// non-admin tự duyệt qua payload, và giữ nguyên trạng thái duyệt cũ theo rid.
describe("reconcileExtraApprovals — duyệt hàng chỉ admin", () => {
  const mkSheets = (approved) => [{
    extraTables: [{ category: "hcm", items: [{ rid: "r1", quantity: 1, unitPrice: 100, approved }] }],
  }];

  it("non-admin KHÔNG tự duyệt được (payload approved=true bị bỏ qua)", () => {
    const sheets = mkSheets(true);                 // client cố gửi approved=true
    reconcileExtraApprovals(sheets, [], false, 5); // non-admin, chưa có prior
    expect(sheets[0].extraTables[0].items[0].approved).toBe(false);
    expect(sheets[0].extraTables[0].items[0].approvedAt).toBe(null);
  });

  it("non-admin GIỮ trạng thái duyệt cũ theo rid (không bị bỏ duyệt)", () => {
    const existing = [{ extraTables: [{ category: "hcm", items: [{ rid: "r1", approved: true, approvedAt: "2026-06-01T00:00:00.000Z", approvedBy: 3 }] }] }];
    const sheets = mkSheets(false);                // client cố BỎ duyệt
    reconcileExtraApprovals(sheets, existing, false, 5);
    const it = sheets[0].extraTables[0].items[0];
    expect(it.approved).toBe(true);                // vẫn duyệt (theo DB)
    expect(it.approvedBy).toBe(3);
    expect(it.approvedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("admin duyệt → đóng dấu approvedAt + approvedBy = admin", () => {
    const sheets = mkSheets(true);
    reconcileExtraApprovals(sheets, [], true, 9);  // admin id 9
    const it = sheets[0].extraTables[0].items[0];
    expect(it.approved).toBe(true);
    expect(it.approvedBy).toBe(9);
    expect(typeof it.approvedAt).toBe("string");
  });

  it("admin bỏ duyệt → xoá dấu", () => {
    const existing = [{ extraTables: [{ category: "hcm", items: [{ rid: "r1", approved: true, approvedAt: "2026-06-01T00:00:00.000Z", approvedBy: 3 }] }] }];
    const sheets = mkSheets(false);
    reconcileExtraApprovals(sheets, existing, true, 9);
    const it = sheets[0].extraTables[0].items[0];
    expect(it.approved).toBe(false);
    expect(it.approvedAt).toBe(null);
    expect(it.approvedBy).toBe(null);
  });
});
