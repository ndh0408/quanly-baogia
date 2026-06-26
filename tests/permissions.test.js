import { describe, it, expect } from "vitest";
import {
  roleCan,
  can,
  canOnQuote,
  quoteScopeWhere,
  canScoped,
  permissionsForRole,
  PERMISSIONS as P,
} from "../src/permissions.js";

// Table-driven snapshot of the effective permission matrix. Any change to
// ROLE_PERMISSIONS that widens/narrows access MUST flip one of these rows —
// a silent RBAC regression here means cross-salesperson data leaks.
describe("roleCan — role × permission matrix", () => {
  it.each([
    // 'employee' role REMOVED (2026-06-15) — it now grants NOTHING (fails closed).
    ["employee", P.QUOTE_CREATE, false],
    ["employee", P.QUOTE_READ_OWN, false],
    // manager (regular non-admin: creates/edits/sends OWN quotes)
    ["manager", P.QUOTE_CREATE, true],
    ["manager", P.QUOTE_READ_OWN, true],
    ["manager", P.QUOTE_UPDATE_OWN, true],
    ["manager", P.QUOTE_READ_ALL, false],      // managers see only their own quotes
    ["manager", P.QUOTE_UPDATE_ALL, false],
    ["manager", P.QUOTE_SEND, true],
    ["manager", P.CUSTOMER_MANAGE_ALL, true],
    ["manager", P.PRODUCT_MANAGE, true],
    ["manager", P.PRODUCT_READ_COST, true],
    ["manager", P.AUDIT_VIEW, true],
    ["manager", P.USER_MANAGE, false],
    // manager (Account) — Nhân sự: TẠO + thấy/sửa/xóa CỦA MÌNH (không read:all/edit:all)
    ["manager", P.PERSONNEL_CREATE, true],
    ["manager", P.PERSONNEL_READ_OWN, true],
    ["manager", P.PERSONNEL_EDIT_OWN, true],
    ["manager", P.PERSONNEL_DELETE_OWN, true],
    ["manager", P.PERSONNEL_READ_ALL, false],
    ["manager", P.PERSONNEL_EDIT_ALL, false],
    // admin (director) — full quote control + toàn quyền Nhân sự
    ["admin", P.QUOTE_READ_ALL, true],
    ["admin", P.QUOTE_UPDATE_ALL, true],
    ["admin", P.QUOTE_DELETE_ALL, true],
    ["admin", P.USER_MANAGE, true],
    ["admin", P.SETTINGS_MANAGE, true],
    ["admin", P.PERSONNEL_READ_ALL, true],
    ["admin", P.PERSONNEL_EDIT_ALL, true],
    ["admin", P.PERSONNEL_DELETE_ALL, true],
    // hr (Nhân sự) — CHỈ xem mọi hồ sơ; KHÔNG tạo/sửa; KHÔNG đụng báo giá/khách
    ["hr", P.PERSONNEL_READ_ALL, true],
    ["hr", P.PERSONNEL_CREATE, false],
    ["hr", P.PERSONNEL_EDIT_ALL, false],
    ["hr", P.QUOTE_READ_ALL, false],
    ["hr", P.QUOTE_CREATE, false],
    ["hr", P.CUSTOMER_READ_ALL, false],
    // accountant (Kế toán) — CHỈ xem mọi hồ sơ; KHÔNG tạo/sửa
    ["accountant", P.PERSONNEL_READ_ALL, true],
    ["accountant", P.PERSONNEL_CREATE, false],
    ["accountant", P.PERSONNEL_EDIT_OWN, false],
    ["accountant", P.QUOTE_READ_ALL, false],
  ])("roleCan(%s, %s) → %s", (role, perm, want) => {
    expect(roleCan(role, perm)).toBe(want);
  });

  it(":all implies :own", () => {
    expect(roleCan("admin", P.QUOTE_READ_OWN)).toBe(true);
    expect(roleCan("admin", P.QUOTE_UPDATE_OWN)).toBe(true);
  });

  it("unknown role / missing session never grants anything", () => {
    expect(roleCan("superuser", P.QUOTE_READ_OWN)).toBe(false);
    expect(roleCan(undefined, P.QUOTE_READ_OWN)).toBe(false);
    expect(can(null, P.QUOTE_READ_OWN)).toBe(false);
    expect(can({}, P.QUOTE_READ_OWN)).toBe(false);
  });
});

describe("canOnQuote — ownership & membership", () => {
  const owner = { userId: 1, role: "manager" };
  const member = { userId: 2, role: "manager" };
  const stranger = { userId: 3, role: "manager" };
  const admin = { userId: 9, role: "admin" };
  const quote = { createdById: 1, members: [{ id: 2 }] };

  it("owner can read/update/delete own quote", () => {
    for (const a of ["read", "update", "delete"]) {
      expect(canOnQuote(owner, a, quote)).toBe(true);
    }
  });

  it("member can read/update but NOT delete", () => {
    expect(canOnQuote(member, "read", quote)).toBe(true);
    expect(canOnQuote(member, "update", quote)).toBe(true);
    expect(canOnQuote(member, "delete", quote)).toBe(false);
  });

  it("stranger gets nothing", () => {
    for (const a of ["read", "update", "delete"]) {
      expect(canOnQuote(stranger, a, quote)).toBe(false);
    }
  });

  it("admin reaches any quote regardless of ownership", () => {
    for (const a of ["read", "update", "delete"]) {
      expect(canOnQuote(admin, a, quote)).toBe(true);
    }
  });

  it("members array of plain ids also works", () => {
    expect(canOnQuote(member, "read", { createdById: 1, members: [2] })).toBe(true);
  });

  it("missing quote denies scoped access", () => {
    expect(canOnQuote(owner, "read", null)).toBe(false);
  });
});

describe("quoteScopeWhere — list visibility", () => {
  it("admin sees everything (empty where)", () => {
    expect(quoteScopeWhere({ userId: 9, role: "admin" })).toEqual({});
  });
  it("manager restricted to created OR member quotes", () => {
    expect(quoteScopeWhere({ userId: 7, role: "manager" })).toEqual({
      OR: [{ createdById: 7 }, { members: { some: { id: 7 } } }],
    });
  });
});

describe("canScoped — generic resource scoping (customers)", () => {
  it("manager (customer:edit:all) sửa any customer regardless of owner", () => {
    expect(canScoped({ userId: 1, role: "manager" }, "customer", "edit", { ownerId: 5 })).toBe(true);
    expect(canScoped({ userId: 1, role: "manager" }, "customer", "edit", { ownerId: null })).toBe(true);
  });
  it("unknown role sửa/xóa nothing", () => {
    expect(canScoped({ userId: 5, role: "nope" }, "customer", "edit", { ownerId: 5 })).toBe(false);
    expect(canScoped({ userId: 5, role: "nope" }, "customer", "delete", { ownerId: 5 })).toBe(false);
  });
});

describe("permissionsForRole — client capability list", () => {
  it("expands :all into :own for the UI", () => {
    const perms = permissionsForRole("admin");
    expect(perms).toContain(P.QUOTE_READ_ALL);
    expect(perms).toContain(P.QUOTE_READ_OWN);
  });
  it("unknown role yields empty list", () => {
    expect(permissionsForRole("nope")).toEqual([]);
  });
});
