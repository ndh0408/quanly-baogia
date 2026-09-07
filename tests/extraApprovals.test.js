import { describe, it, expect } from "vitest";
import { reconcileExtraApprovals } from "../src/services/quoteService.js";

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

/**
 * SỬA SỐ TIỀN CỦA HÀNG ĐÃ DUYỆT MÀ VẪN GIỮ DẤU DUYỆT — phát hiện qua ultracode audit 2026-09-07.
 *
 * Trước bản vá: nhánh non-admin CHỈ kế thừa `approved`/`approvedAt`/`approvedBy` theo `rid`, không
 * so số tiền. Người có `quote:update:own` nhưng KHÔNG có `quote:internal:approve` mở báo giá đã có
 * hàng "hcm"/"khach" approved:true, sửa unitPrice/quantity của đúng rid đó rồi Lưu — dấu duyệt của
 * người khác đứng nguyên trên số tiền họ vừa bịa. Cùng lỗ, cùng cách vá với
 * tests/qua-extra-pay-rid-cloning.test.js (bản thanh toán) — CHỈ khác chữ "thanh toán" → "duyệt".
 */
describe("reconcileExtraApprovals — sửa số tiền hàng đã duyệt (rid do client gửi)", () => {
  const hangDb = (over = {}) => ({ rid: "r-that", name: "Thi công nhỏ", quantity: 1, unitPrice: 1_000_000, days: null, approved: true, approvedAt: "2026-01-01T00:00:00.000Z", approvedBy: 3, ...over });
  const db = (items) => [{ extraTables: [{ category: "hcm", items }] }];
  const payload = (items) => [{ extraTables: [{ category: "hcm", items }] }];
  const hang = (p) => p[0].extraTables[0].items;

  it("non-admin ĐỔI SỐ TIỀN của hàng đã duyệt (cùng rid) → cả lần lưu bị từ chối", () => {
    const p = payload([{ rid: "r-that", name: "Thi công nhỏ", quantity: 1, unitPrice: 50_000_000, approved: true }]);
    let loi;
    try { reconcileExtraApprovals(p, db([hangDb()]), false, 1); } catch (e) { loi = e; }
    expect(loi, "sửa tiền hàng đã duyệt phải bị chặn cả lần ghi").toBeTruthy();
    expect(loi.status, "phải là lỗi của người gửi, không phải 500").toBe(400);
    expect(loi.message, "thông điệp phải nêu đích danh hàng vướng").toContain("Thi công nhỏ");
  });

  it("đổi SỐ LƯỢNG cũng tính là đổi số tiền", () => {
    const p = payload([{ rid: "r-that", name: "Thi công nhỏ", quantity: 40, unitPrice: 1_000_000, approved: true }]);
    expect(() => reconcileExtraApprovals(p, db([hangDb()]), false, 1)).toThrowError(/đã duyệt/);
  });

  it("KHÔNG đổi tiền → hàng đã duyệt GIỮ NGUYÊN dấu duyệt và người duyệt", () => {
    const p = payload([{ rid: "r-that", name: "Đổi tên thôi", quantity: 1, unitPrice: 1_000_000, approved: true }]);
    reconcileExtraApprovals(p, db([hangDb()]), false, 1);
    const it = hang(p)[0];
    expect(it.approved).toBe(true);
    expect(it.approvedBy).toBe(3);
    expect(it.approvedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("hàng CHƯA duyệt đổi giá tự do — ràng buộc chỉ áp cho hàng ĐÃ duyệt", () => {
    const p = payload([{ rid: "r-chua", name: "Sửa giá", quantity: 2, unitPrice: 9_000_000 }]);
    reconcileExtraApprovals(p, db([{ rid: "r-chua", quantity: 1, unitPrice: 1_000_000, approved: false }]), false, 1);
    expect(hang(p)[0].approved).toBe(false);
    expect(hang(p)[0].unitPrice).toBe(9_000_000);
  });

  it("người CÓ quote:internal:approve vẫn đổi được giá hàng đã duyệt (luồng duyệt bình thường)", () => {
    const p = payload([{ rid: "r-that", name: "Người duyệt chỉnh", quantity: 1, unitPrice: 3_000_000, approved: true }]);
    reconcileExtraApprovals(p, db([hangDb()]), true, 5);
    const it = hang(p)[0];
    expect(it.approved).toBe(true);
    expect(it.approvedBy).toBe(3);   // giữ người duyệt gốc (vẫn đang duyệt, không phải MỚI duyệt)
  });

  it("bản CSDL KHÔNG ghi số tiền (hàng cũ trước sanitize) → giữ nguyên kế thừa (fail-open)", () => {
    const p = payload([{ rid: "r-cu", name: "Thuê xe (sửa chính tả)", quantity: 1, unitPrice: 100, approved: true }]);
    reconcileExtraApprovals(p, db([{ rid: "r-cu", name: "Thuê xe", approved: true, approvedAt: "2026-08-01T00:00:00Z", approvedBy: 7 }]), false, 1);
    const it = hang(p)[0];
    expect(it.approved, "hàng cũ hợp lệ không được mất dấu duyệt vì thiếu dữ liệu để so").toBe(true);
    expect(it.approvedBy).toBe(7);
  });

  it("hai hàng CÙNG rid → chỉ hàng ĐẦU kế thừa, bản sao thì không (và không bị chặn vì bản sao có giá khác)", () => {
    const p = payload([
      { rid: "r-that", name: "Thi công nhỏ", quantity: 1, unitPrice: 1_000_000, approved: true },
      { rid: "r-that", name: "Bản sao", quantity: 1, unitPrice: 1_000_000, approved: true },
    ]);
    reconcileExtraApprovals(p, db([hangDb()]), false, 1);
    expect(hang(p)[0].approved, "hàng gốc giữ được dấu duyệt").toBe(true);
    expect(hang(p)[1].approved, "bản sao cùng rid không ăn theo dấu duyệt").toBe(false);
  });
});
