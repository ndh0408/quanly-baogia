// BẰNG CHỨNG XOAY KHOÁ LÀ BẰNG CHỨNG GIẢ — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `decryptPii` CỐ Ý thử khoá mới rồi rơi về `PII_ENC_KEY_OLD` — đó chính là thứ làm cho việc xoay
// khoá không gây gián đoạn, và nó ĐÚNG.
//
// Nhưng hai bước KIỂM CHỨNG lại xây trên nó:
//     scripts/migration/pii-backfill.mjs  --verify   (verifyModel)
//     src/tools/verifyIntegrity.ts        --pii      (diễn tập khôi phục HẰNG TUẦN, chạy TRONG
//                                                     image production)
// Vì `decryptPii` rơi về khoá cũ, cả hai báo "tất cả đọc được / ✓ ĐẠT" kể cả khi **không một hàng
// nào** được mã lại bằng khoá mới.
//
// Đó không phải lỗi vô hại. `docs/operations/DISASTER_RECOVERY.md` dùng ĐÚNG dấu `✓` đó làm điều
// kiện để GỠ `PII_ENC_KEY_OLD`. Gỡ khoá cũ khi chưa xoay xong = mọi hàng còn lại **hoá đá vĩnh
// viễn**, không có đường về, và người vận hành tin rằng mình đã làm đúng quy trình.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Thêm `moTheoKhoa()` — giải mã và NÓI RÕ khoá nào mở được ("moi" | "cu" | null). Hai bước kiểm
// chuyển sang dùng nó và coi `khoa === "cu"` là CHƯA ĐẠT. `decryptPii` giữ nguyên hành vi rơi-về
// (đường đọc của ứng dụng vẫn phải chạy suốt cửa sổ xoay).
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const KHOA_CU = "khoa-cu-cua-toi-du-dai-32-ky-tu-abcdef";
const KHOA_MOI = "khoa-moi-hoan-toan-khac-32-ky-tu-123456";

let envCu;

beforeEach(() => {
  envCu = { moi: process.env.PII_ENC_KEY, cu: process.env.PII_ENC_KEY_OLD };
});
afterEach(async () => {
  if (envCu.moi === undefined) delete process.env.PII_ENC_KEY; else process.env.PII_ENC_KEY = envCu.moi;
  if (envCu.cu === undefined) delete process.env.PII_ENC_KEY_OLD; else process.env.PII_ENC_KEY_OLD = envCu.cu;
  const { __resetPiiKeyCache } = await import("../src/piiBox.js");
  __resetPiiKeyCache();
});

/** Đặt bộ khoá rồi nạp lại cache — piiBox nhớ khoá ở mức module. */
async function datKhoa(moi, cu) {
  process.env.PII_ENC_KEY = moi;
  if (cu) process.env.PII_ENC_KEY_OLD = cu; else delete process.env.PII_ENC_KEY_OLD;
  const m = await import("../src/piiBox.js");
  m.__resetPiiKeyCache();
  return m;
}

const AAD = "PersonnelRecord:idCard";

describe("moTheoKhoa — bước kiểm phải biết khoá NÀO mở được", () => {
  it("hàng mã bằng khoá CŨ, đang mở cửa sổ xoay → báo rõ 'cu' (KHÔNG được coi là đạt)", async () => {
    // 1. Mã hoá khi hệ thống còn chạy khoá cũ.
    const truoc = await datKhoa(KHOA_CU, null);
    const banMa = truoc.encryptPii("0123456789", AAD);

    // 2. Xoay khoá: khoá mới lên, khoá cũ giữ lại để không gián đoạn. CHƯA chạy --rotate.
    const sau = await datKhoa(KHOA_MOI, KHOA_CU);

    // Đường ĐỌC của ứng dụng vẫn phải chạy — đây là mục đích của cửa sổ xoay.
    expect(sau.decryptPii(banMa, AAD), "ứng dụng vẫn phải đọc được trong lúc xoay").toBe("0123456789");

    // Nhưng bước KIỂM phải phân biệt được. Trước khi vá, verifyModel/verifyIntegrity chỉ gọi
    // decryptPii nên thấy "đọc được" → in ✓ → người vận hành gỡ khoá cũ → mất dữ liệu.
    const r = sau.moTheoKhoa(banMa, AAD);
    expect(r.giaTri).toBe("0123456789");
    expect(r.khoa, "phải nói rõ là mở bằng khoá CŨ").toBe("cu");
  });

  it("hàng ĐÃ mã lại bằng khoá mới → 'moi' (đây mới là điều kiện để gỡ khoá cũ)", async () => {
    const m = await datKhoa(KHOA_MOI, KHOA_CU);
    const banMa = m.encryptPii("0123456789", AAD);
    const r = m.moTheoKhoa(banMa, AAD);
    expect(r.khoa).toBe("moi");
    expect(r.giaTri).toBe("0123456789");
  });

  it("không khoá nào mở được → null, không ném", async () => {
    const truoc = await datKhoa(KHOA_CU, null);
    const banMa = truoc.encryptPii("0123456789", AAD);
    const la = await datKhoa("mot-khoa-khac-han-32-ky-tu-xyzxyzxyz", null);
    const r = la.moTheoKhoa(banMa, AAD);
    expect(r.khoa).toBe(null);
    expect(r.giaTri).toBe(null);
  });

  it("AAD sai → coi như không mở được (chống tráo trường)", async () => {
    const m = await datKhoa(KHOA_MOI, null);
    const banMa = m.encryptPii("0123456789", AAD);
    expect(m.moTheoKhoa(banMa, "PersonnelRecord:bankAccount").khoa).toBe(null);
  });
});

describe("dangXoayKhoa — biết có đang mở cửa sổ xoay hay không", () => {
  it("chỉ có PII_ENC_KEY → false", async () => {
    const m = await datKhoa(KHOA_MOI, null);
    expect(m.dangXoayKhoa()).toBe(false);
  });

  it("có PII_ENC_KEY_OLD khác khoá hiện tại → true", async () => {
    const m = await datKhoa(KHOA_MOI, KHOA_CU);
    expect(m.dangXoayKhoa()).toBe(true);
  });

  it("PII_ENC_KEY_OLD TRÙNG khoá hiện tại → false (không phải đang xoay)", async () => {
    // Đặt trùng là cấu hình vô nghĩa; coi như không có, kẻo mỗi lần giải mã hỏng lại tốn thêm một
    // lượt thử vô ích và mọi bước kiểm báo "còn tồn đọng" sai sự thật.
    const m = await datKhoa(KHOA_MOI, KHOA_MOI);
    expect(m.dangXoayKhoa()).toBe(false);
  });
});
