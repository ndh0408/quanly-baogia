// Ghi/đọc song song PII (src/piiFields.ts) — bước 2 của lộ trình mã hoá.
//
// Ca quan trọng nhất ở cuối file: **bản mã tồn tại nhưng hỏng thì phải NỔ, không được lặng lẽ rơi về
// cột thô**. Nếu rơi về, kẻ ghi được vào CSDL chỉ cần làm hỏng 1 byte bản mã là ép hệ thống đọc lại
// plaintext — toàn bộ lớp toàn vẹn thành vô nghĩa.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

const KEY = "khoa-dev-pii-du-dai-de-hkdf-lam-viec-binh-thuong";
let F, box;

async function load(key) {
  if (key === null) delete process.env.PII_ENC_KEY;
  else process.env.PII_ENC_KEY = key;
  F = await import("../src/piiFields.js");
  box = await import("../src/piiBox.js");
  box.__resetPiiKeyCache();
  return F;
}

beforeEach(async () => { await load(KEY); });
afterAll(() => { delete process.env.PII_ENC_KEY; });

const ROW = () => ({ id: 7, fullName: "Nguyễn Văn A", idCard: "079301001234", bankAccount: "9704229201234567", salary: "15000000" });

describe("encodePiiForWrite — ghi song song", () => {
  it("điền cột bản mã + chỉ mục mù, GIỮ NGUYÊN cột thô (giai đoạn chuyển tiếp cần nó)", () => {
    const out = F.encodePiiForWrite("PersonnelRecord", ROW());
    expect(out.idCard).toBe("079301001234");               // cột thô còn nguyên
    expect(box.isPiiEncrypted(out.idCardEnc)).toBe(true);
    expect(box.isPiiEncrypted(out.bankAccountEnc)).toBe(true);
    expect(box.isPiiEncrypted(out.salaryEnc)).toBe(true);
    expect(out.idCardIdx).toMatch(/^[0-9a-f]{64}$/);        // HMAC hex
    expect(out.piiVersion).toBe(1);
    // Bản mã tự nó không được rò bản rõ. (Cột THÔ vẫn còn plaintext — đó chính là chủ đích của
    // ghi-song-song: đọc-song-song cần nó cho tới khi cutover. Vì vậy kiểm trên từng bản mã, không
    // kiểm trên cả object.)
    for (const enc of [out.idCardEnc, out.bankAccountEnc, out.salaryEnc]) {
      expect(enc).not.toContain("9704229201234567");
      expect(enc).not.toContain("079301001234");
      expect(enc).not.toContain("15000000");
    }
  });

  it("KHÔNG đụng tới trường không được gửi lên (cập nhật lẻ 1 cột)", () => {
    const out = F.encodePiiForWrite("PersonnelRecord", { teamNote: "ghi chú" });
    expect(out.idCardEnc).toBeUndefined();
    expect(out.piiVersion).toBeUndefined();
  });

  it("giá trị rỗng/null → cột bản mã null, không phải chuỗi rác", () => {
    const out = F.encodePiiForWrite("PersonnelRecord", { idCard: null, bankAccount: "" });
    expect(out.idCardEnc).toBeNull();
    expect(out.bankAccountEnc).toBeNull();
    expect(out.idCardIdx).toBeNull();
  });

  it("Employee KHÔNG có cột lương → không sinh salaryEnc", () => {
    const out = F.encodePiiForWrite("Employee", { idCard: "079301001234", salary: "999" });
    expect(out.idCardEnc).toBeTruthy();
    expect(out.salaryEnc).toBeUndefined();
  });

  it("chưa đặt khoá → KHÔNG làm gì (triển khai được mà không đổi hành vi)", async () => {
    const f = await load(null);
    const out = f.encodePiiForWrite("PersonnelRecord", ROW());
    expect(out.idCardEnc).toBeUndefined();
    expect(out.piiVersion).toBeUndefined();
    expect(out.idCard).toBe("079301001234");
  });
});

describe("decodePiiOnRead — đọc song song", () => {
  it("có bản mã → giải mã, và LƯỢC cột kỹ thuật khỏi phản hồi", () => {
    const stored = F.encodePiiForWrite("PersonnelRecord", ROW());
    const read = F.decodePiiOnRead("PersonnelRecord", stored);
    expect(read.idCard).toBe("079301001234");
    expect(read.bankAccount).toBe("9704229201234567");
    expect(read.salary).toBe("15000000");
    // Hợp đồng API không đổi: client KHÔNG BAO GIỜ thấy cột kỹ thuật.
    expect(read.idCardEnc).toBeUndefined();
    expect(read.idCardIdx).toBeUndefined();
    expect(read.bankAccountEnc).toBeUndefined();
    expect(read.piiVersion).toBeUndefined();
  });

  it("CHƯA backfill (không có bản mã) → đọc cột thô bình thường", () => {
    const legacy = { id: 1, idCard: "079301009999", bankAccount: "123", salary: "1" };
    const read = F.decodePiiOnRead("PersonnelRecord", legacy);
    expect(read.idCard).toBe("079301009999");
    expect(read.bankAccount).toBe("123");
  });

  it("null row → null, không ném", () => {
    expect(F.decodePiiOnRead("PersonnelRecord", null)).toBeNull();
  });

  it("model không có PII → trả nguyên", () => {
    const r = { id: 1, name: "x" };
    expect(F.decodePiiOnRead("Quote", r)).toBe(r);
  });
});

describe("AAD — bản mã bị buộc vào ĐÚNG cột", () => {
  it("đem bản mã của bankAccount sang ô idCard → KHÔNG giải mã được", () => {
    const stored = F.encodePiiForWrite("PersonnelRecord", ROW());
    const swapped = { ...stored, idCardEnc: stored.bankAccountEnc };
    expect(() => F.decodePiiOnRead("PersonnelRecord", swapped)).toThrow();
  });

  it("đem bản mã của Employee.idCard sang PersonnelRecord.idCard → KHÔNG giải mã được", () => {
    const emp = F.encodePiiForWrite("Employee", { idCard: "079301001234" });
    expect(() => F.decodePiiOnRead("PersonnelRecord", { idCardEnc: emp.idCardEnc })).toThrow();
  });
});

describe("TOÀN VẸN — bản mã hỏng KHÔNG được lặng lẽ rơi về cột thô", () => {
  it("sửa 1 byte bản mã → NÉM, không trả plaintext", () => {
    const stored = F.encodePiiForWrite("PersonnelRecord", ROW());
    const raw = Buffer.from(stored.idCardEnc.slice("pii:v1:".length), "base64");
    raw[raw.length - 1] ^= 0x01;
    const tampered = { ...stored, idCardEnc: "pii:v1:" + raw.toString("base64") };
    // ĐÂY là điểm chốt: nếu chỗ này trả "079301001234" thay vì ném, kẻ tấn công chỉ cần làm hỏng
    // bản mã là ép hệ thống đọc lại cột thô — vô hiệu hoá toàn bộ lớp mã hoá.
    expect(() => F.decodePiiOnRead("PersonnelRecord", tampered)).toThrow(/không giải mã được/i);
  });

  it("SAI KHOÁ → NÉM, không trả plaintext", async () => {
    const stored = F.encodePiiForWrite("PersonnelRecord", ROW());
    const f2 = await load("mot-khoa-hoan-toan-khac-de-thu-nghiem-xoay-vong-khoa");
    expect(() => f2.decodePiiOnRead("PersonnelRecord", stored)).toThrow();
  });

  it("MẤT khoá (biến môi trường bị xoá) → NÉM, không trả plaintext", async () => {
    const stored = F.encodePiiForWrite("PersonnelRecord", ROW());
    const f2 = await load(null);
    expect(() => f2.decodePiiOnRead("PersonnelRecord", stored)).toThrow();
  });
});

describe("idCardLookupWhere — tra CCCD bằng-đúng ở cả hai giai đoạn", () => {
  it("đã bật khoá → so chỉ mục mù, KHÔNG so cột thô", () => {
    const w = F.idCardLookupWhere("079301001234");
    expect(w.idCardIdx).toMatch(/^[0-9a-f]{64}$/);
    expect(w.idCard).toBeUndefined();
  });

  it("chưa bật khoá → so cột thô (hành vi cũ)", async () => {
    const f = await load(null);
    expect(f.idCardLookupWhere("079301001234")).toEqual({ idCard: "079301001234" });
  });

  it("khớp đúng giá trị đã ghi", () => {
    const stored = F.encodePiiForWrite("PersonnelRecord", ROW());
    expect(F.idCardLookupWhere("079301001234").idCardIdx).toBe(stored.idCardIdx);
    expect(F.idCardLookupWhere(" 079301001234 ").idCardIdx).toBe(stored.idCardIdx); // chuẩn hoá
  });

  it("từ khoá rỗng → null (chỗ gọi bỏ qua nhánh này)", () => {
    expect(F.idCardLookupWhere("")).toBeNull();
    expect(F.idCardLookupWhere(null)).toBeNull();
  });
});

describe("BACKFILL — chạy lại không hỏng dữ liệu", () => {
  it("mã hoá lần hai cho bản mã KHÁC nhưng giải ra CÙNG giá trị", () => {
    const a = F.encodePiiForWrite("PersonnelRecord", ROW());
    const b = F.encodePiiForWrite("PersonnelRecord", ROW());
    expect(a.idCardEnc).not.toBe(b.idCardEnc);   // IV ngẫu nhiên
    expect(a.idCardIdx).toBe(b.idCardIdx);       // chỉ mục mù tất định
    expect(F.decodePiiOnRead("PersonnelRecord", a).idCard)
      .toBe(F.decodePiiOnRead("PersonnelRecord", b).idCard);
  });
});
