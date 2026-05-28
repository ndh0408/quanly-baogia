import { describe, it, expect } from "vitest";
import {
  LoginSchema,
  ChangePasswordSchema,
  UserCreateSchema,
  QuoteCreateSchema,
  ListQuerySchema,
} from "../src/validators.js";

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
