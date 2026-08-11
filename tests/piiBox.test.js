// Lớp mã hoá PII khi lưu trữ (src/piiBox.ts) — nền cho lộ trình mã hoá CCCD / số tài khoản / lương.
//
// Bốn tính chất phải giữ, vì mỗi cái tương ứng một cách hỏng đã gặp thật trong repo này:
//   1. chưa đặt khoá → KHÔNG làm gì (triển khai được mà không đổi hành vi);
//   2. đọc-song-song: bản ghi thô chưa backfill vẫn đọc bình thường;
//   3. thẻ xác thực GCM ghim 16 byte (đúng lỗi semgrep vừa vá ở mfa.ts/secretbox.ts);
//   4. chỉ mục mù tất định + khoá TÁCH BIỆT khỏi khoá mã hoá.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

const KEY = "khoa-thu-nghiem-pii-du-dai-de-hkdf-lam-viec";
let box;

async function load(key) {
  if (key === null) delete process.env.PII_ENC_KEY;
  else process.env.PII_ENC_KEY = key;
  box = await import("../src/piiBox.js");
  box.__resetPiiKeyCache();
  return box;
}

beforeEach(async () => { await load(KEY); });
afterAll(() => { delete process.env.PII_ENC_KEY; });

describe("piiBox — khi CHƯA đặt khoá thì không làm gì", () => {
  it("encrypt/decrypt trả nguyên giá trị, blindIndex trả null", async () => {
    const b = await load(null);
    expect(b.isPiiEncryptionEnabled()).toBe(false);
    expect(b.encryptPii("079301001234")).toBe("079301001234");
    expect(b.decryptPii("079301001234")).toBe("079301001234");
    expect(b.blindIndex("079301001234")).toBeNull();
  });
});

describe("piiBox — vòng tròn mã hoá", () => {
  it("mã hoá rồi giải mã ra đúng giá trị gốc", () => {
    const cccd = "079301001234";
    const enc = box.encryptPii(cccd);
    expect(box.isPiiEncrypted(enc)).toBe(true);
    expect(enc).not.toContain(cccd);          // bản mã không rò bản rõ
    expect(box.decryptPii(enc)).toBe(cccd);
  });

  it("cùng một giá trị cho hai bản mã KHÁC nhau (IV ngẫu nhiên)", () => {
    const a = box.encryptPii("0123456789");
    const b = box.encryptPii("0123456789");
    expect(a).not.toBe(b);                     // không tất định → không lộ 'hai người trùng CCCD'
    expect(box.decryptPii(a)).toBe(box.decryptPii(b));
  });

  it("giá trị rỗng/null đi qua nguyên trạng", () => {
    expect(box.encryptPii(null)).toBeNull();
    expect(box.encryptPii(undefined)).toBeUndefined();
    expect(box.encryptPii("")).toBe("");
  });

  it("ĐỌC-SONG-SONG: giá trị thô (chưa backfill) trả nguyên trạng", () => {
    expect(box.decryptPii("079301001234")).toBe("079301001234");
    expect(box.isPiiEncrypted("079301001234")).toBe(false);
  });
});

describe("piiBox — toàn vẹn (fail-closed)", () => {
  it("thẻ xác thực bị cắt ngắn → null, KHÔNG giải mã", () => {
    const enc = box.encryptPii("079301001234");
    const raw = Buffer.from(enc.slice("pii:v1:".length), "base64");
    const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), ct = raw.subarray(28);
    for (const n of [4, 8, 12, 15]) {
      const bad = "pii:v1:" + Buffer.concat([iv, tag.subarray(0, n), ct]).toString("base64");
      expect(box.decryptPii(bad)).toBeNull();
    }
  });

  it("lật 1 bit trong bản mã → null", () => {
    const enc = box.encryptPii("079301001234");
    const raw = Buffer.from(enc.slice("pii:v1:".length), "base64");
    raw[raw.length - 1] ^= 0x01;
    expect(box.decryptPii("pii:v1:" + raw.toString("base64"))).toBeNull();
  });

  it("bản mã cụt → null, không ném lỗi", () => {
    expect(box.decryptPii("pii:v1:" + Buffer.alloc(8).toString("base64"))).toBeNull();
  });

  it("SAI KHOÁ → null (không trả rác)", async () => {
    const enc = box.encryptPii("079301001234");
    const other = await load("mot-khoa-hoan-toan-khac-de-thu-nghiem-xoay-vong");
    expect(other.decryptPii(enc)).toBeNull();
  });
});

describe("piiBox — chỉ mục mù", () => {
  it("tất định: cùng giá trị → cùng chỉ mục", () => {
    expect(box.blindIndex("079301001234")).toBe(box.blindIndex("079301001234"));
  });

  it("chuẩn hoá khoảng trắng + hoa/thường trước khi băm", () => {
    expect(box.blindIndex(" 079301001234 ")).toBe(box.blindIndex("079301001234"));
    expect(box.blindIndex("AB 123")).toBe(box.blindIndex("ab123"));
  });

  it("giá trị khác → chỉ mục khác", () => {
    expect(box.blindIndex("079301001234")).not.toBe(box.blindIndex("079301001235"));
  });

  it("KHÓA TÁCH BIỆT: chỉ mục không phải là băm trần của giá trị", async () => {
    const { createHash } = await import("node:crypto");
    const plain = createHash("sha256").update("079301001234").digest("hex");
    expect(box.blindIndex("079301001234")).not.toBe(plain);   // có khoá → không dò được bằng bảng tra
  });

  it("đổi khoá gốc → chỉ mục đổi theo", async () => {
    const a = box.blindIndex("079301001234");
    const other = await load("mot-khoa-hoan-toan-khac-de-thu-nghiem-xoay-vong");
    expect(other.blindIndex("079301001234")).not.toBe(a);
  });

  it("so sánh theo thời gian hằng cho đúng kết quả", () => {
    const a = box.blindIndex("079301001234");
    expect(box.blindIndexEquals(a, box.blindIndex("079301001234"))).toBe(true);
    expect(box.blindIndexEquals(a, box.blindIndex("079301001235"))).toBe(false);
    expect(box.blindIndexEquals(a, null)).toBe(false);
    expect(box.blindIndexEquals(null, null)).toBe(false);
  });
});
