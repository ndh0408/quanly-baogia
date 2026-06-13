import { describe, it, expect, beforeAll } from "vitest";

// Load with an encryption key set so the AES-GCM path is exercised. Dynamic
// import after setting the env so config picks it up.
let mfa;
beforeAll(async () => {
  process.env.MFA_ENC_KEY = "test-mfa-encryption-key-at-least-16";
  mfa = await import("../src/mfa.js");
});

describe("MFA secret encryption", () => {
  it("round-trips a secret and stores ciphertext, not plaintext", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const enc = mfa.encryptSecret(secret);
    expect(enc).toMatch(/^enc:v1:/);
    expect(enc).not.toContain(secret);
    expect(mfa.decryptSecret(enc)).toBe(secret);
  });

  it("two encryptions of the same secret differ (random IV)", () => {
    expect(mfa.encryptSecret("SAME")).not.toBe(mfa.encryptSecret("SAME"));
  });

  it("decrypts legacy plaintext (no prefix) as-is for backward compat", () => {
    expect(mfa.decryptSecret("LEGACYPLAINTEXTSECRET")).toBe("LEGACYPLAINTEXTSECRET");
  });

  it("passes through null", () => {
    expect(mfa.encryptSecret(null)).toBe(null);
    expect(mfa.decryptSecret(null)).toBe(null);
  });
});

describe("MFA backup codes", () => {
  it("generates plaintext codes plus their hashes", () => {
    const { plain, hashed } = mfa.generateBackupCodes(8);
    expect(plain).toHaveLength(8);
    expect(hashed).toHaveLength(8);
    expect(plain.every((c) => /^[0-9A-F]{10}$/.test(c))).toBe(true);
    expect(hashed.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    expect(hashed).not.toContain(plain[0]); // stored value is a hash, not the code
  });

  it("matches a valid hashed code and returns matched entry + remaining list", () => {
    const { plain, hashed } = mfa.generateBackupCodes(3);
    const hit = mfa.consumeBackupCode(hashed, plain[1]);
    expect(hit.matched).toBe(hashed[1]);
    expect(hit.remaining).toHaveLength(2);
    expect(hit.remaining).not.toContain(hashed[1]);
    // already-used code no longer matches
    expect(mfa.consumeBackupCode(hit.remaining, plain[1])).toBeNull();
  });

  it("accepts legacy plaintext backup codes (pre-upgrade users)", () => {
    const legacy = ["AB12CD34EF", "FF00FF00FF"];
    const hit = mfa.consumeBackupCode(legacy, "ab12cd34ef"); // case-insensitive
    expect(hit.matched).toBe("AB12CD34EF");
    expect(hit.remaining).toEqual(["FF00FF00FF"]);
  });

  it("returns null for an unknown code", () => {
    const { hashed } = mfa.generateBackupCodes(2);
    expect(mfa.consumeBackupCode(hashed, "0000000000")).toBeNull();
    expect(mfa.consumeBackupCode([], "0000000000")).toBeNull();
  });
});
