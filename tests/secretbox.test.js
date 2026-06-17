import { describe, it, expect } from "vitest";
import { encryptValue, decryptValue, isEncrypted } from "../src/secretbox.js";

describe("secretbox (encrypt-at-rest)", () => {
  it("round-trips a value", () => {
    const enc = encryptValue("super-secret-token");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("super-secret-token"); // ciphertext doesn't leak plaintext
    expect(decryptValue(enc)).toBe("super-secret-token");
  });

  it("uses a random IV (two encryptions differ)", () => {
    expect(encryptValue("x")).not.toBe(encryptValue("x"));
  });

  it("passes legacy plaintext through unchanged (backward compat)", () => {
    expect(decryptValue("legacy-plaintext-secret")).toBe("legacy-plaintext-secret");
    expect(isEncrypted("legacy-plaintext-secret")).toBe(false);
  });

  it("returns null on a tampered ciphertext (fail-closed)", () => {
    const enc = encryptValue("abc");
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B" : "A");
    expect(decryptValue(tampered)).toBeNull();
  });

  it("handles null/empty without throwing", () => {
    expect(encryptValue(null)).toBeNull();
    expect(encryptValue("")).toBe("");
    expect(decryptValue(null)).toBeNull();
  });
});
