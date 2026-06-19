import { describe, it, expect } from "vitest";
import {
  LoginSchema,
  ChangePasswordSchema,
  UserCreateSchema,
  QuoteCreateSchema,
  ListQuerySchema,
  zbool,
} from "../src/validators.js";

describe("zbool (boolean coercion — regression for z.coerce.boolean gotcha)", () => {
  it('parses the STRING "false"/"0"/"no" as false (NOT truthy)', () => {
    expect(zbool.parse("false")).toBe(false);
    expect(zbool.parse("0")).toBe(false);
    expect(zbool.parse("no")).toBe(false);
    expect(zbool.parse("FALSE")).toBe(false);
    expect(zbool.parse(" false ")).toBe(false);
    expect(zbool.parse("")).toBe(false);
  });
  it("parses truthy strings as true", () => {
    expect(zbool.parse("true")).toBe(true);
    expect(zbool.parse("1")).toBe(true);
    expect(zbool.parse("yes")).toBe(true);
  });
  it("passes real booleans through unchanged", () => {
    expect(zbool.parse(true)).toBe(true);
    expect(zbool.parse(false)).toBe(false);
  });
  it('UserCreateSchema honors canSign "false" → false', () => {
    const u = UserCreateSchema.parse({
      username: "tester", password: "GoodPass1", displayName: "T", role: "manager", canSign: "false",
    });
    expect(u.canSign).toBe(false);
  });
});

describe("LoginSchema", () => {
  it("accepts valid input", () => {
    expect(LoginSchema.parse({ username: "alice", password: "secret" })).toBeTruthy();
  });
  it("rejects empty username", () => {
    expect(() => LoginSchema.parse({ username: "", password: "x" })).toThrow();
  });
});

describe("ChangePasswordSchema", () => {
  it("requires 8+ chars with letter + digit", () => {
    expect(() => ChangePasswordSchema.parse({ oldPassword: "x", newPassword: "short1A" })).toThrow();
    expect(() => ChangePasswordSchema.parse({ oldPassword: "x", newPassword: "alllowercase" })).toThrow();
    expect(() => ChangePasswordSchema.parse({ oldPassword: "x", newPassword: "12345678" })).toThrow();
    expect(ChangePasswordSchema.parse({ oldPassword: "x", newPassword: "GoodPass1" })).toBeTruthy();
  });
});

describe("UserCreateSchema", () => {
  it("validates role enum", () => {
    expect(() => UserCreateSchema.parse({
      username: "u1", password: "GoodPass1", displayName: "U1", role: "owner",
    })).toThrow();
  });
  it("rejects username with special chars", () => {
    expect(() => UserCreateSchema.parse({
      username: "u 1", password: "GoodPass1", displayName: "U1", role: "employee",
    })).toThrow();
  });
});

describe("QuoteCreateSchema", () => {
  it("requires at least 1 sheet", () => {
    expect(() => QuoteCreateSchema.parse({
      title: "T", toCompany: "C", companyId: 1, sheets: [],
    })).toThrow();
  });
  it("coerces numbers from strings", () => {
    const q = QuoteCreateSchema.parse({
      title: "T",
      toCompany: "C",
      companyId: "1",
      vatPercent: "8",
      sheets: [{
        templateId: "1",
        items: [{ name: "x", quantity: "3", unitPrice: "100" }],
      }],
    });
    expect(q.companyId).toBe(1);
    expect(q.vatPercent).toBe(8);
    expect(q.sheets[0].items[0].quantity).toBe(3);
  });
});

describe("ListQuerySchema", () => {
  it("defaults page=1, size=20, sort=createdAt desc", () => {
    const q = ListQuerySchema.parse({});
    expect(q.page).toBe(1);
    expect(q.size).toBe(20);
    expect(q.sort).toBe("createdAt");
    expect(q.order).toBe("desc");
  });
  it("rejects size over MAX_PAGE_SIZE", () => {
    expect(() => ListQuerySchema.parse({ size: 9999 })).toThrow();
  });
});
