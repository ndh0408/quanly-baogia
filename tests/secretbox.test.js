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

// Chống CẮT NGẮN THẺ XÁC THỰC GCM (semgrep gcm-no-tag-length, phát hiện 2026-08-11).
// Node nhận thẻ GCM dài 4/8/12–16 byte nếu không ghim `authTagLength`, còn `subarray` thì lặng lẽ trả
// buffer ngắn khi dữ liệu bị cắt. Ghép lại: ai ghi được vào DB có thể lưu bản mã kèm thẻ 4 byte và hạ
// công sức giả mạo từ 2^128 xuống 2^32. Bộ test này khoá cả hai lớp chặn.
describe("secretbox — không nhận thẻ xác thực bị cắt ngắn", () => {
  it("bản mã có thẻ ngắn hơn 16 byte → null (không giải mã)", () => {
    const enc = encryptValue("giá trị bí mật");
    const raw = Buffer.from(enc.slice("enc:v1:".length), "base64");
    const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28);
    for (const shortLen of [4, 8, 12, 15]) {
      const truncated = "enc:v1:" + Buffer.concat([iv, tag.subarray(0, shortLen), ct]).toString("base64");
      expect(decryptValue(truncated)).toBeNull();
    }
  });

  it("bản mã cụt (ngắn hơn cả IV+thẻ) → null, không ném lỗi", () => {
    expect(decryptValue("enc:v1:" + Buffer.alloc(10).toString("base64"))).toBeNull();
    expect(decryptValue("enc:v1:")).toBeNull();
  });

  it("sửa 1 bit trong bản mã → null (tính toàn vẹn còn nguyên)", () => {
    const enc = encryptValue("giá trị bí mật");
    const raw = Buffer.from(enc.slice("enc:v1:".length), "base64");
    raw[raw.length - 1] ^= 0x01;
    expect(decryptValue("enc:v1:" + raw.toString("base64"))).toBeNull();
  });
});
