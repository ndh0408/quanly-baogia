// CUTOVER PII: NGỪNG GHI CỘT THÔ — chốt hồi quy (src/piiFields.ts).
//
// ── VÌ SAO ───────────────────────────────────────────────────────────────────
// Đặt PII_ENC_KEY xong thì `isPiiEncryptionEnabled()` là true và bản mã `pii:v1:…` được sinh ra —
// nhưng `encodePiiForWrite` VẪN ghi cột thô song song (giai đoạn "bước 1/6" có chủ ý, để so đối
// chiếu trước khi tin bản mã). Chừng nào cột thô còn giá trị thì mã hoá CHƯA chống được mối đe doạ
// nó nêu tên: một bản dump CSDL vẫn lộ nguyên CCCD / số tài khoản / lương.
// Đo trực tiếp trên production 2026-09-08: bật khoá xong, encodePiiForWrite vẫn trả
// `idCard: "079123456789"` y nguyên. Cờ PII_PLAINTEXT_CUTOVER đóng nốt đường đó.
//
// Bài này KHÔNG cần Postgres: kiểm thẳng hàm biến đổi dữ liệu trước khi ghi.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const KEY_CU = process.env.PII_ENC_KEY;
const CUT_CU = process.env.PII_PLAINTEXT_CUTOVER;

// piiBox/piiFields đọc process.env tại thời điểm GỌI (không cache ở module) — nhưng vẫn nạp lại
// module cho chắc, vì `isPiiEncryptionEnabled` là điều kiện vào của mọi nhánh dưới đây.
async function nap() {
  const m = await import("../src/piiFields.js");
  return m;
}

const HO_SO = () => ({ fullName: "Nguyễn Văn Thử", idCard: "079123456789", bankAccount: "0011002233445", salary: "25000000" });

beforeEach(() => { process.env.PII_ENC_KEY = "khoa-test-du-dai-cho-hkdf-0123456789"; });
afterEach(() => {
  if (KEY_CU === undefined) delete process.env.PII_ENC_KEY; else process.env.PII_ENC_KEY = KEY_CU;
  if (CUT_CU === undefined) delete process.env.PII_PLAINTEXT_CUTOVER; else process.env.PII_PLAINTEXT_CUTOVER = CUT_CU;
});

describe("PII cutover — cột thô sau khi bật cờ", () => {
  it("MẶC ĐỊNH (chưa bật cờ): giữ nguyên ghi-song-song — không đổi hành vi đang chạy", async () => {
    delete process.env.PII_PLAINTEXT_CUTOVER;
    const { encodePiiForWrite, piiCutoverBat } = await nap();
    expect(piiCutoverBat()).toBe(false);
    const ra = encodePiiForWrite("PersonnelRecord", HO_SO());
    expect(ra.idCard, "giai đoạn đọc-song-song cần cột thô").toBe("079123456789");
    expect(String(ra.idCardEnc)).toMatch(/^pii:v1:/);
  });

  it("BẬT cờ: cột thô về null, bản mã + chỉ mục mù vẫn có", async () => {
    process.env.PII_PLAINTEXT_CUTOVER = "1";
    const { encodePiiForWrite, piiCutoverBat } = await nap();
    expect(piiCutoverBat()).toBe(true);
    const ra = encodePiiForWrite("PersonnelRecord", HO_SO());
    expect(ra.idCard, "trước khi vá: CCCD nằm thô trong CSDL, dump là lộ").toBeNull();
    expect(ra.bankAccount).toBeNull();
    expect(ra.salary).toBeNull();
    expect(String(ra.idCardEnc)).toMatch(/^pii:v1:/);
    expect(String(ra.bankAccountEnc)).toMatch(/^pii:v1:/);
    expect(String(ra.salaryEnc)).toMatch(/^pii:v1:/);
    expect(ra.idCardIdx, "chỉ mục mù phải còn để tra CCCD bằng-đúng").toBeTruthy();
    expect(ra.piiVersion).toBe(1);
    expect(ra.fullName, "trường KHÔNG phải PII không được đụng").toBe("Nguyễn Văn Thử");
  });

  it("BẬT cờ + model Employee (tập trường khác) cũng phải sạch cột thô", async () => {
    process.env.PII_PLAINTEXT_CUTOVER = "1";
    const { encodePiiForWrite } = await nap();
    const ra = encodePiiForWrite("Employee", { fullName: "A", idCard: "079000111222", bankAccount: "999888777" });
    expect(ra.idCard).toBeNull();
    expect(ra.bankAccount).toBeNull();
    expect(String(ra.idCardEnc)).toMatch(/^pii:v1:/);
  });

  it("ĐỌC vẫn chạy sau cutover: bản mã giải ra đúng nguyên văn", async () => {
    process.env.PII_PLAINTEXT_CUTOVER = "1";
    const { encodePiiForWrite, decodePiiOnRead } = await nap();
    const ghi = encodePiiForWrite("PersonnelRecord", HO_SO());
    const doc = decodePiiOnRead("PersonnelRecord", ghi);
    expect(doc.idCard).toBe("079123456789");
    expect(doc.bankAccount).toBe("0011002233445");
    expect(String(doc.salary)).toBe("25000000");
  });

  it("HÀNG CŨ chưa backfill (chỉ có cột thô, không có bản mã) vẫn đọc được sau khi bật cờ", async () => {
    process.env.PII_PLAINTEXT_CUTOVER = "1";
    const { decodePiiOnRead } = await nap();
    const hangCu = { fullName: "Cũ", idCard: "079999888777", bankAccount: "123456", salary: "9000000", piiVersion: 0 };
    const doc = decodePiiOnRead("PersonnelRecord", hangCu);
    expect(doc.idCard, "cutover chỉ đổi đường GHI — đọc phải còn nhánh rơi về cột thô").toBe("079999888777");
  });

  it("update LẺ (không gửi trường PII) không vô tình xoá cột thô của trường khác", async () => {
    process.env.PII_PLAINTEXT_CUTOVER = "1";
    const { encodePiiForWrite } = await nap();
    const ra = encodePiiForWrite("PersonnelRecord", { fullName: "Chỉ đổi tên" });
    expect("idCard" in ra, "trường không được gửi lên thì không đụng tới").toBe(false);
    expect("idCardEnc" in ra).toBe(false);
  });

  it("CHƯA có PII_ENC_KEY thì cờ vô nghĩa — không được xoá cột thô (mất trắng dữ liệu)", async () => {
    delete process.env.PII_ENC_KEY;
    process.env.PII_PLAINTEXT_CUTOVER = "1";
    const { encodePiiForWrite, piiCutoverBat } = await nap();
    expect(piiCutoverBat()).toBe(false);
    const ra = encodePiiForWrite("PersonnelRecord", HO_SO());
    expect(ra.idCard, "không có khoá mà xoá cột thô là xoá sạch dữ liệu").toBe("079123456789");
  });

  it("giá trị cờ lạ không bật nhầm", async () => {
    const { piiCutoverBat } = await nap();
    for (const v of ["0", "false", "no", "off", "", "  "]) {
      process.env.PII_PLAINTEXT_CUTOVER = v;
      expect(piiCutoverBat(), `giá trị ${JSON.stringify(v)}`).toBe(false);
    }
    for (const v of ["1", "true", "YES", " on "]) {
      process.env.PII_PLAINTEXT_CUTOVER = v;
      expect(piiCutoverBat(), `giá trị ${JSON.stringify(v)}`).toBe(true);
    }
  });
});
