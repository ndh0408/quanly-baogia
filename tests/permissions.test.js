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
    // employee
    ["employee", P.QUOTE_CREATE, true],
    ["employee", P.QUOTE_READ_OWN, true],
    ["employee", P.QUOTE_READ_ALL, false],
    ["employee", P.QUOTE_UPDATE_OWN, true],
    ["employee", P.QUOTE_UPDATE_ALL, false],
    ["employee", P.QUOTE_DELETE_ALL, false],
    ["employee", P.QUOTE_SUBMIT, true],
    ["employee", P.QUOTE_APPROVE, false],
    ["employee", P.QUOTE_REJECT, false],
    ["employee", P.QUOTE_SEND, false],
    ["employee", P.CUSTOMER_READ_ALL, true],   // shared customer directory
    ["employee", P.CUSTOMER_MANAGE_ALL, false],
    ["employee", P.PRODUCT_READ, true],
    ["employee", P.PRODUCT_READ_COST, false],
    ["employee", P.USER_MANAGE, false],
    ["employee", P.SETTINGS_MANAGE, false],
    ["employee", P.AUDIT_VIEW, false],
    // manager
    ["manager", P.QUOTE_READ_ALL, false],      // managers see only their own quotes
    ["manager", P.QUOTE_UPDATE_ALL, false],
    ["manager", P.QUOTE_APPROVE, false],       // only the director approves
    ["manager", P.QUOTE_SEND, true],
    ["manager", P.CUSTOMER_MANAGE_ALL, true],
    ["manager", P.PRODUCT_MANAGE, true],
    ["manager", P.PRODUCT_READ_COST, true],
    ["manager", P.AUDIT_VIEW, true],
    ["manager", P.USER_MANAGE, false],
    // admin (director)
    ["admin", P.QUOTE_READ_ALL, true],
    ["admin", P.QUOTE_UPDATE_ALL, true],
    ["admin", P.QUOTE_DELETE_ALL, true],
    ["admin", P.QUOTE_APPROVE, true],
    ["admin", P.QUOTE_REJECT, true],
    ["admin", P.USER_MANAGE, true],
    ["admin", P.SETTINGS_MANAGE, true],
    ["admin", P.APPROVAL_MATRIX, true],
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
  const owner = { userId: 1, role: "employee" };
  const member = { userId: 2, role: "employee" };
  const stranger = { userId: 3, role: "employee" };
  const admin = { userId: 9, role: "admin" };
  const quote = { createdById: 1, members: [{ id: 2 }] };

  // NOTE: "submit" is NOT decided by canOnQuote — routes enforce it as
  // can(P.QUOTE_SUBMIT) && canOnQuote("update"), since no quote:submit:own
  // permission exists in the catalog.
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
  it("employee/manager restricted to created OR member quotes", () => {
    for (const role of ["employee", "manager"]) {
      expect(quoteScopeWhere({ userId: 7, role })).toEqual({
        OR: [{ createdById: 7 }, { members: { some: { id: 7 } } }],
      });
    }
  });
});

describe("canScoped — generic resource scoping (customers)", () => {
  it("manager manages any customer, employee only their own", () => {
    const row = { ownerId: 5 };
    expect(canScoped({ userId: 1, role: "manager" }, "customer", "manage", row)).toBe(true);
    expect(canScoped({ userId: 5, role: "employee" }, "customer", "manage", row)).toBe(true);
    expect(canScoped({ userId: 6, role: "employee" }, "customer", "manage", row)).toBe(false);
  });
  it("ownerless row is not 'own'", () => {
    expect(canScoped({ userId: 5, role: "employee" }, "customer", "manage", { ownerId: null })).toBe(false);
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
