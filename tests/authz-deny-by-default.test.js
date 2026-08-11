// Deny-by-default cho PHẠM VI ĐỌC — chốt chặn lớp thuần (không cần DB).
//
// Lỗi gốc mà bộ test này canh: "không có :all" bị hiểu thành "có :own". Khi ma trận phân quyền gỡ
// sạch quyền đọc của một vai trò (hoặc admin đặt quyền riêng cho một tài khoản), người đó VẪN thấy
// các bản ghi mình từng tạo / được thêm làm thành viên, vì hàm phạm vi rơi thẳng xuống nhánh own
// thay vì từ chối. Ba trạng thái phải TÁCH BẠCH: all → {} ; own → bộ lọc chủ sở hữu ; không có gì → null.
import { describe, it, expect } from "vitest";
import {
  quoteScopeWhere,
  quoteScopeWhereOrThrow,
  readScopeWhere,
  readScopeWhereOrThrow,
  PERMISSIONS as P,
} from "../src/permissions.js";

// Phiên có ĐÚNG tập quyền được liệt kê (permissions rỗng ≠ "theo role" ở đây vì can() đọc thẳng mảng).
const sess = (userId, permissions) => ({ userId, role: "manager", permissions });

describe("quoteScopeWhere — ba trạng thái tách bạch", () => {
  it("quote:read:all → {} (mọi báo giá)", () => {
    expect(quoteScopeWhere(sess(1, [P.QUOTE_READ_ALL]))).toEqual({});
  });

  it("quote:read:own → lọc theo người tạo HOẶC thành viên", () => {
    expect(quoteScopeWhere(sess(7, [P.QUOTE_READ_OWN]))).toEqual({
      OR: [{ createdById: 7 }, { members: { some: { id: 7 } } }],
    });
  });

  it("KHÔNG có quyền đọc báo giá nào → null (từ chối), KHÔNG rơi xuống phạm vi own", () => {
    expect(quoteScopeWhere(sess(7, []))).toBeNull();
    expect(quoteScopeWhere(sess(7, [P.QUOTE_CREATE]))).toBeNull();       // tạo được ≠ đọc được
    expect(quoteScopeWhere(sess(7, [P.PERSONNEL_READ_ALL]))).toBeNull(); // quyền domain khác không lây
    expect(quoteScopeWhere({})).toBeNull();
    expect(quoteScopeWhere({ userId: 7, role: "hr" })).toBeNull();
  });

  it(":all ngầm bao :own (không cần tick cả hai)", () => {
    expect(quoteScopeWhere(sess(1, [P.QUOTE_READ_ALL]))).toEqual({});
  });

  it("quoteScopeWhereOrThrow ném 403 thay vì trả phạm vi rỗng", () => {
    expect(() => quoteScopeWhereOrThrow(sess(7, []))).toThrowError(/không có quyền/i);
    try { quoteScopeWhereOrThrow(sess(7, [])); } catch (e) { expect(e.status).toBe(403); }
    expect(quoteScopeWhereOrThrow(sess(7, [P.QUOTE_READ_OWN]))).toBeTruthy();
  });
});

describe("readScopeWhere — cùng ngữ nghĩa cho tài nguyên có chủ sở hữu", () => {
  it("customer:read:all → {}", () => {
    expect(readScopeWhere(sess(1, [P.CUSTOMER_READ_ALL]), "customer")).toEqual({});
  });

  it("customer:read:own → ghim ownerId về chính mình", () => {
    expect(readScopeWhere(sess(5, [P.CUSTOMER_READ_OWN]), "customer")).toEqual({ ownerId: 5 });
  });

  it("không có quyền khách hàng nào → null (kế toán/nhân sự/account HN)", () => {
    expect(readScopeWhere(sess(5, []), "customer")).toBeNull();
    expect(readScopeWhere(sess(5, [P.PERSONNEL_READ_ALL]), "customer")).toBeNull();
    expect(readScopeWhere({ userId: 5, role: "hr" }, "customer")).toBeNull();
    expect(readScopeWhere({ userId: 5, role: "accountant" }, "customer")).toBeNull();
    expect(readScopeWhere({ userId: 5, role: "account_hn" }, "customer")).toBeNull();
  });

  it("đổi được tên cột chủ sở hữu (personnel dùng createdById)", () => {
    expect(readScopeWhere(sess(5, [P.PERSONNEL_READ_OWN]), "personnel", "createdById")).toEqual({ createdById: 5 });
    expect(readScopeWhere(sess(5, [P.PERSONNEL_READ_ALL]), "personnel", "createdById")).toEqual({});
  });

  it("readScopeWhereOrThrow ném 403", () => {
    try { readScopeWhereOrThrow(sess(5, []), "customer"); expect.unreachable(); }
    catch (e) { expect(e.status).toBe(403); }
  });
});

describe("phạm vi mặc định theo vai trò — vai trò nào ĐƯỢC/KHÔNG được đọc gì", () => {
  it.each([
    // [role, quoteScope != null, customerScope != null]
    ["admin", true, true],
    ["manager", true, true],
    ["account_hn", true, false],   // chỉ báo giá được giao; KHÔNG có quyền khách hàng
    ["hr", false, false],          // chỉ hồ sơ nhân sự
    ["accountant", false, false],  // hồ sơ nhân sự + hóa đơn
  ])("role=%s → đọc báo giá: %s, đọc khách hàng: %s", (role, quoteOk, custOk) => {
    const s = { userId: 42, role };
    expect(quoteScopeWhere(s) !== null).toBe(quoteOk);
    expect(readScopeWhere(s, "customer") !== null).toBe(custOk);
  });
});
