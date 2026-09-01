// ── LỖI ─────────────────────────────────────────────────────────────────────
// `src/piiBox.ts` chỉ dẫn xuất khoá từ ĐÚNG MỘT biến `PII_ENC_KEY`, và `decryptPii` chỉ thử đúng
// một khoá rồi trả `null`. Hệ quả: KHÔNG có đường xoay khoá nào chạy được.
// `docs/operations/DISASTER_RECOVERY.md` lại dặn "giải mã bằng khoá cũ rồi mã hoá lại bằng khoá
// mới" — một quy trình không tồn tại trong mã. Còn `docs/operations/INCIDENT_RESPONSE.md` thì dặn
// NGƯỢC LẠI: "đừng xoay PII_ENC_KEY". Hai tài liệu mâu thuẫn nhau là phần nguy hiểm nhất.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// 1. Mã hoá một CCCD bằng khoá CŨ (đúng như dữ liệu đang nằm trong CSDL).
// 2. Đổi `PII_ENC_KEY` sang khoá MỚI và đặt `PII_ENC_KEY_OLD` = khoá cũ.
// 3. Đọc lại: trước bản vá `decryptPii` trả `null` — hồ sơ nhân sự "hoá đá".
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Nghi lộ khoá → không dám xoay (xoay là mất đọc toàn bộ CCCD/STK/lương), hoặc xoay rồi thì module
// Nhân sự ném lỗi toàn diện vì `decryptPiiOrThrow`. Cột thô còn nên KHÔNG mất dữ liệu, nhưng sự cố
// vận hành là thật. Bản vá cho phép ĐỌC bằng cả hai khoá trong lúc xoay, còn GHI thì luôn bằng khoá
// mới, và chỉ mục mù tra được cả hàng đã xoay lẫn chưa xoay.
import { describe, it, expect, beforeEach, afterAll } from "vitest";

// Tiền tố PIIROT để không đụng dữ liệu/biến của cụm khác.
const OLD_KEY = "PIIROT-khoa-cu-du-dai-cho-hkdf-lam-viec-0001";
const NEW_KEY = "PIIROT-khoa-moi-du-dai-cho-hkdf-lam-viec-0002";
const CCCD = "079301009999";

/** Nạp lại piiBox với bộ biến môi trường mong muốn (khoá được cache trong module). */
async function loadBox({ key, old }) {
  if (key == null) delete process.env.PII_ENC_KEY;
  else process.env.PII_ENC_KEY = key;
  if (old == null) delete process.env.PII_ENC_KEY_OLD;
  else process.env.PII_ENC_KEY_OLD = old;
  const box = await import("../src/piiBox.js");
  box.__resetPiiKeyCache();
  return box;
}

async function loadFields() {
  return import("../src/piiFields.js");
}

beforeEach(async () => { await loadBox({ key: NEW_KEY, old: null }); });
afterAll(async () => {
  delete process.env.PII_ENC_KEY;
  delete process.env.PII_ENC_KEY_OLD;
  const box = await import("../src/piiBox.js");
  box.__resetPiiKeyCache();
});

describe("piiBox — xoay khoá PII (PII_ENC_KEY_OLD)", () => {
  it("ĐỌC được bản mã của khoá CŨ khi đã chuyển sang khoá MỚI", async () => {
    let box = await loadBox({ key: OLD_KEY, old: null });
    const cu = box.encryptPii(CCCD, "PersonnelRecord:idCard");

    box = await loadBox({ key: NEW_KEY, old: OLD_KEY });
    expect(box.decryptPii(cu, "PersonnelRecord:idCard")).toBe(CCCD);
  });

  it("GHI luôn dùng khoá MỚI — bản mã mới đọc được kể cả khi đã gỡ khoá cũ", async () => {
    let box = await loadBox({ key: NEW_KEY, old: OLD_KEY });
    const moi = box.encryptPii(CCCD, "PersonnelRecord:idCard");

    box = await loadBox({ key: NEW_KEY, old: null });
    expect(box.decryptPii(moi, "PersonnelRecord:idCard")).toBe(CCCD);
  });

  it("AAD vẫn được giữ khi rơi về khoá cũ — bản mã đem sang cột khác KHÔNG đọc được", async () => {
    let box = await loadBox({ key: OLD_KEY, old: null });
    const cu = box.encryptPii(CCCD, "PersonnelRecord:idCard");

    box = await loadBox({ key: NEW_KEY, old: OLD_KEY });
    expect(box.decryptPii(cu, "PersonnelRecord:bankAccount")).toBeNull();
  });

  it("sai CẢ HAI khoá vẫn fail-closed: trả null, không rơi về plaintext", async () => {
    let box = await loadBox({ key: "PIIROT-khoa-la-hoan-toan-khong-lien-quan-0003", old: null });
    const la = box.encryptPii(CCCD, "PersonnelRecord:idCard");

    box = await loadBox({ key: NEW_KEY, old: OLD_KEY });
    expect(box.decryptPii(la, "PersonnelRecord:idCard")).toBeNull();
  });

  it("KHÔNG đặt PII_ENC_KEY_OLD → hành vi y hệt trước bản vá", async () => {
    const box = await loadBox({ key: NEW_KEY, old: null });
    const enc = box.encryptPii(CCCD, "PersonnelRecord:idCard");
    expect(box.decryptPii(enc, "PersonnelRecord:idCard")).toBe(CCCD);
    expect(box.blindIndexCandidates(CCCD)).toEqual([box.blindIndex(CCCD)]);
  });

  it("PII_ENC_KEY_OLD trùng PII_ENC_KEY → coi như không có khoá cũ", async () => {
    const box = await loadBox({ key: NEW_KEY, old: NEW_KEY });
    expect(box.blindIndexCandidates(CCCD)).toEqual([box.blindIndex(CCCD)]);
  });
});

describe("chỉ mục mù trong lúc xoay khoá", () => {
  it("blindIndexCandidates trả CẢ HAI chỉ mục (mới trước, cũ sau)", async () => {
    const boxCu = await loadBox({ key: OLD_KEY, old: null });
    const idxCu = boxCu.blindIndex(CCCD);

    const box = await loadBox({ key: NEW_KEY, old: OLD_KEY });
    const idxMoi = box.blindIndex(CCCD);
    expect(idxMoi).not.toBe(idxCu);
    expect(box.blindIndexCandidates(CCCD)).toEqual([idxMoi, idxCu]);
  });

  it("idCardLookupWhere tra được hàng CHƯA xoay khoá (nếu không thì tìm CCCD trả rỗng)", async () => {
    const boxCu = await loadBox({ key: OLD_KEY, old: null });
    const idxCu = boxCu.blindIndex(CCCD);

    const box = await loadBox({ key: NEW_KEY, old: OLD_KEY });
    const fields = await loadFields();
    const where = fields.idCardLookupWhere(CCCD);
    // Hàng chưa xoay mang chỉ mục CŨ; điều kiện phải phủ được nó.
    expect(where.idCardIdx.in).toContain(idxCu);
    expect(where.idCardIdx.in).toContain(box.blindIndex(CCCD));
  });

  it("không có khoá cũ → điều kiện tra cứu giữ nguyên dạng bằng-đúng (không đổi kế hoạch truy vấn)", async () => {
    const box = await loadBox({ key: NEW_KEY, old: null });
    const fields = await loadFields();
    expect(fields.idCardLookupWhere(CCCD)).toEqual({ idCardIdx: box.blindIndex(CCCD) });
  });
});
