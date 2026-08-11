// Bản đồ TRƯỜNG PII + hai hàm ghi/đọc song song. Đây là bước 2 của lộ trình mã hoá (src/piiBox.ts
// là bước 1). Mọi tầng service chỉ cần gọi hai hàm ở cuối file; không nơi nào tự gọi encrypt/decrypt.
//
// ── PHÂN LOẠI DỮ LIỆU (chỉ mã hoá nhóm cao nhất) ─────────────────────────────
// HIGHLY_SENSITIVE — mã hoá:  idCard (CCCD) · bankAccount (STK) · salary (lương)
//   Ba trường này đủ để mạo danh, rút tiền, hoặc gây tổn hại cá nhân nếu bản dump CSDL rò ra ngoài.
// CONFIDENTIAL — KHÔNG mã hoá (có chủ ý): taxCode · address · phone · pit · taxableIncome
//   Chúng vẫn nhạy cảm nhưng: (a) `pit`/`taxableIncome` được TÍNH từ salary lúc đọc, không lưu ở
//   dạng cần bảo vệ riêng; (b) `phone`/`address`/`taxCode` xuất hiện khắp giao diện tìm kiếm và lọc,
//   mã hoá chúng sẽ phá tính năng tìm-theo-số-điện-thoại mà không giảm được nhiều rủi ro (cùng bản
//   dump đó vẫn còn tên + dự án). Mã hoá mọi thứ là cách chắc chắn nhất để không ai dùng được hệ
//   thống; chọn đúng thứ đáng mã hoá mới là bảo mật.
//
// ── VÌ SAO KHÔNG ĐƯA idCard VÀO searchText ───────────────────────────────────
// `searchText` là cột phẳng, KHÔNG mã hoá, nằm ngay cạnh trong cùng bản dump. Để CCCD trong đó thì
// việc mã hoá cột `idCard` chỉ là trang trí. Thay bằng chỉ mục mù: tra CCCD BẰNG-ĐÚNG vẫn chạy.

import { encryptPii, decryptPii, decryptPiiOrThrow, blindIndex, isPiiEncryptionEnabled, isPiiEncrypted } from "./piiBox.js";

/** Một trường được mã hoá: cột thô ↔ cột bản mã (+ cột chỉ mục mù nếu cần tra cứu). */
type PiiField = { plain: string; enc: string; idx?: string };

export const PII_FIELDS: Record<string, PiiField[]> = {
  PersonnelRecord: [
    { plain: "idCard", enc: "idCardEnc", idx: "idCardIdx" },
    { plain: "bankAccount", enc: "bankAccountEnc" },
    { plain: "salary", enc: "salaryEnc" },
  ],
  Employee: [
    { plain: "idCard", enc: "idCardEnc", idx: "idCardIdx" },
    { plain: "bankAccount", enc: "bankAccountEnc" },
  ],
};

/** AAD buộc bản mã vào ĐÚNG model + ĐÚNG cột — xem giải thích ở src/piiBox.ts. */
const aadFor = (model: string, field: string) => `${model}:${field}`;

/** Giá trị PII dưới dạng chuỗi để mã hoá (salary là Decimal/number → chuỗi thập phân ổn định). */
function toStorable(v: unknown): string | null {
  if (v == null || v === "") return null;
  return typeof v === "object" && v !== null && "toString" in v ? String(v) : String(v);
}

/**
 * GHI SONG SONG: nhận `data` sắp ghi vào Prisma, trả bản đã bổ sung các cột bản mã + chỉ mục mù.
 *
 * Chưa bật khoá → trả nguyên `data` (không đổi hành vi). Đã bật → mọi trường PII có mặt trong `data`
 * đều được mã hoá kèm; cột thô GIỮ NGUYÊN cho tới khi cutover (giai đoạn đọc-song-song cần nó).
 *
 * FAIL-CLOSED: mã hoá ném thì để nó nổi lên. Nuốt lỗi rồi ghi mỗi plaintext là kịch bản tệ nhất —
 * hệ thống báo "đã bật mã hoá" trong khi dữ liệu mới vẫn nằm thô.
 */
export function encodePiiForWrite(model: string, data: Record<string, any>): Record<string, any> {
  const fields = PII_FIELDS[model];
  if (!fields || !isPiiEncryptionEnabled()) return data;
  const out = { ...data };
  let touched = false;
  for (const f of fields) {
    if (!(f.plain in data)) continue;          // không đụng tới trường không được gửi lên (update lẻ)
    const raw = toStorable(data[f.plain]);
    out[f.enc] = raw == null ? null : encryptPii(raw, aadFor(model, f.plain));
    if (f.idx) out[f.idx] = raw == null ? null : blindIndex(raw);
    touched = true;
  }
  if (touched) out.piiVersion = 1;
  return out;
}

/**
 * ĐỌC SONG SONG: trả bản ghi với giá trị PII đã giải mã, và LƯỢC BỎ các cột bản mã/chỉ mục.
 *
 * Thứ tự ưu tiên:
 *   1. có cột bản mã → giải mã (lỗi thì NÉM, xem decryptPiiOrThrow — không được lặng lẽ về plaintext);
 *   2. không có     → dùng cột thô (bản ghi chưa backfill).
 *
 * Hợp đồng API không đổi: client vẫn nhận `idCard`, `bankAccount`, `salary` như trước và KHÔNG BAO
 * GIỜ nhìn thấy cột `*Enc`/`*Idx`.
 */
export function decodePiiOnRead<T extends Record<string, any>>(model: string, row: T | null): T | null {
  const fields = PII_FIELDS[model];
  if (!row || !fields) return row;
  const out: Record<string, any> = { ...row };
  for (const f of fields) {
    const enc = out[f.enc];
    if (isPiiEncrypted(enc)) out[f.plain] = decryptPiiOrThrow(enc as string, aadFor(model, f.plain));
    delete out[f.enc];
    if (f.idx) delete out[f.idx];
  }
  delete out.piiVersion;
  return out as T;
}

/** Tiện dụng cho danh sách. */
export const decodePiiList = <T extends Record<string, any>>(model: string, rows: T[]): T[] =>
  rows.map((r) => decodePiiOnRead(model, r) as T);

/**
 * Điều kiện Prisma để tìm BẰNG-ĐÚNG theo CCCD, dùng được ở cả hai giai đoạn.
 * Chưa bật khoá → so cột thô. Đã bật → so chỉ mục mù (cột thô sẽ biến mất sau cutover).
 * Trả `null` khi từ khoá rỗng để chỗ gọi bỏ qua nhánh này.
 */
export function idCardLookupWhere(q: string | null | undefined): Record<string, any> | null {
  const v = (q ?? "").trim();
  if (!v) return null;
  if (!isPiiEncryptionEnabled()) return { idCard: v };
  const idx = blindIndex(v);
  return idx ? { idCardIdx: idx } : null;
}

export { isPiiEncryptionEnabled, decryptPii };
