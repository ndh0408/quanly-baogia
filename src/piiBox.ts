// Mã hoá PII khi lưu trữ (at-rest) — dành cho các trường có sức sát thương cao nhất nếu bản dump
// CSDL bị lộ: CCCD, số tài khoản ngân hàng, lương.
//
// Đây là lớp mật mã thuần. Bản đồ trường + ghi/đọc song song nằm ở `src/piiFields.ts`; tầng service
// KHÔNG gọi thẳng vào đây. Backfill ở `scripts/migration/pii-backfill.mjs`.
// (Chú thích cũ ghi "module này CHƯA được gọi ở đâu cả" — đúng ở bước 1, sai từ khi nối bước 2.
//  Một chú thích bảo mật lỗi thời tạo cảm giác an toàn giả, nên sửa ngay khi hành vi đổi.)
//
// ── VÌ SAO TÁCH KHOÁ RIÊNG ───────────────────────────────────────────────────
// Không dùng lại MFA_ENC_KEY. Hai kho bí mật này có vòng đời và bán kính thiệt hại khác nhau: xoay
// khoá MFA (vì nghi lộ) mà lại làm hỏng luôn toàn bộ hồ sơ nhân sự là kiểu ràng buộc chéo tự chuốc
// lấy sự cố. Lộ khoá này = lộ PII; lộ khoá kia = lộ 2FA. Giữ chúng độc lập.
//
// ── VÌ SAO MẶC ĐỊNH TẮT ──────────────────────────────────────────────────────
// Không đặt PII_ENC_KEY → mọi hàm ở đây thành "không làm gì": dữ liệu đi qua nguyên vẹn. Nhờ vậy
// triển khai module + migration mà KHÔNG đổi hành vi; việc bật là một quyết định vận hành riêng,
// thực hiện sau khi đã sao lưu và chạy backfill. Bật nhầm cũng không mất dữ liệu — chỉ là các bản
// ghi mới có thêm bản mã ở cột phụ.

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { logger } from "./logger.js";

const PREFIX = "pii:v1:";
const IV_LEN = 12;
const TAG_LEN = 16;

// Hai khoá con dẫn xuất từ CÙNG một khoá gốc bằng HKDF với `info` khác nhau: một để mã hoá, một để
// làm chỉ mục mù. Dùng chung một khoá cho cả hai việc là lỗi kinh điển — HMAC của chỉ mục sẽ rò
// thông tin về khoá mã hoá.
let cachedKeys: { enc: Buffer; idx: Buffer } | null = null;
function keys() {
  const material = process.env.PII_ENC_KEY || "";
  if (!material) return null;
  if (cachedKeys) return cachedKeys;
  const salt = Buffer.from("quanly-pii-v1");
  cachedKeys = {
    enc: Buffer.from(hkdfSync("sha256", material, salt, "encryption", 32)),
    idx: Buffer.from(hkdfSync("sha256", material, salt, "blind-index", 32)),
  };
  return cachedKeys;
}

/** Đã cấu hình khoá chưa. Chưa → mọi hàm dưới đây là no-op (dữ liệu giữ nguyên dạng thô). */
export function isPiiEncryptionEnabled() {
  return !!process.env.PII_ENC_KEY;
}

/** Giá trị này đã ở dạng mã hoá chưa (dùng để nhận biết bản ghi đã được backfill). */
export function isPiiEncrypted(value: unknown) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Mã hoá một giá trị PII để lưu. Trả về nguyên `value` nếu chưa bật khoá, hoặc nếu giá trị rỗng.
 * AES-256-GCM, IV ngẫu nhiên mỗi lần, thẻ xác thực GHIM 16 byte (xem src/secretbox.ts để biết vì sao
 * không ghim là mở đường cho giả mạo bằng thẻ cắt ngắn).
 */
export function encryptPii(value: string | null | undefined, aad?: string): string | null | undefined {
  if (value == null || value === "") return value;
  const k = keys();
  if (!k) return value;
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv("aes-256-gcm", k.enc, iv, { authTagLength: TAG_LEN });
  // DỮ LIỆU XÁC THỰC KÈM THEO (AAD) = "model:field". Nó KHÔNG được mã hoá, nhưng thẻ xác thực phủ
  // lên nó — nên bản mã bị đem từ cột này sang cột khác sẽ KHÔNG giải mã được. Không có AAD thì ai
  // ghi được vào DB có thể chuyển bản mã số-tài-khoản sang ô CCCD và ngược lại.
  // KHÔNG đưa recordId vào: lúc TẠO bản ghi chưa có id, mà mã hoá sau khi insert thì phải thêm một
  // vòng ghi nữa. Rủi ro còn lại là hoán bản mã GIỮA HAI BẢN GHI cùng cột — cần quyền ghi DB, và hậu
  // quả là sai lệch dữ liệu chứ không phải lộ dữ liệu. Đánh đổi có chủ ý, ghi lại ở đây.
  if (aad) c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(String(value), "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

/**
 * Giải mã. Giá trị KHÔNG có tiền tố được trả nguyên trạng — đó là bản ghi chưa backfill, và đọc-song
 * -song phải chạy được suốt giai đoạn chuyển tiếp.
 *
 * FAIL-CLOSED: bản mã hỏng / sai khoá → trả `null` chứ không ném, để một hồ sơ lỗi không làm sập cả
 * trang danh sách. Trả `null` (chứ không phải chuỗi rỗng) để chỗ gọi phân biệt được "không có dữ
 * liệu" với "có nhưng đọc không nổi" — và log lại để phát hiện khoá bị xoay nhầm.
 */
export function decryptPii(stored: string | null | undefined, aad?: string): string | null | undefined {
  if (stored == null || !isPiiEncrypted(stored)) return stored;
  const k = keys();
  if (!k) {
    logger.error("Gặp dữ liệu PII đã mã hoá nhưng PII_ENC_KEY chưa được đặt — kiểm tra cấu hình môi trường");
    return null;
  }
  try {
    const raw = Buffer.from(String(stored).slice(PREFIX.length), "base64");
    if (raw.length < IV_LEN + TAG_LEN) throw new Error("bản mã quá ngắn");
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    if (tag.length !== TAG_LEN) throw new Error("thẻ xác thực sai độ dài");
    const d = createDecipheriv("aes-256-gcm", k.enc, iv, { authTagLength: TAG_LEN });
    d.setAuthTag(tag);
    if (aad) d.setAAD(Buffer.from(aad, "utf8"));
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "giải mã PII thất bại (sai khoá / dữ liệu hỏng)");
    return null;
  }
}

/**
 * CHỈ MỤC MÙ để tra cứu BẰNG-ĐÚNG trên trường đã mã hoá (vd tìm hồ sơ theo số CCCD).
 *
 * Bản mã GCM có IV ngẫu nhiên nên cùng một CCCD ra hai bản mã khác nhau — không thể `WHERE idCard =`.
 * Cách sai mà người ta hay chọn: đổi sang chế độ mã hoá tất định cho dễ tìm; làm vậy là để lộ ngay
 * "hai người này trùng CCCD" và mở đường phân tích tần suất. Cách đúng: lưu thêm HMAC-SHA256 của giá
 * trị đã CHUẨN HOÁ, khoá riêng. Kẻ đọc được DB thấy HMAC nhưng không đảo ngược được nếu không có khoá.
 *
 * Vẫn còn giới hạn cố hữu: chỉ tra được BẰNG-ĐÚNG, không tra được "chứa". Chấp nhận — tìm CCCD theo
 * một phần chuỗi vốn không phải nhu cầu thật.
 */
export function blindIndex(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const k = keys();
  if (!k) return null;
  const norm = String(value).trim().toLowerCase().replace(/\s+/g, "");
  return createHmac("sha256", k.idx).update(norm).digest("hex");
}

/** So hai chỉ mục mù theo thời gian hằng — tránh biến phép so sánh thành kênh phụ dò từng byte. */
export function blindIndexEquals(a: string | null, b: string | null) {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/**
 * Như `decryptPii` nhưng NÉM khi bản mã tồn tại mà không giải được.
 *
 * Đây là ranh giới quan trọng nhất của cả cơ chế. Có hai tình huống nhìn giống nhau nhưng ý nghĩa
 * trái ngược:
 *   • cột bản mã RỖNG  → bản ghi chưa backfill → đọc cột thô là ĐÚNG (giai đoạn chuyển tiếp);
 *   • cột bản mã CÓ nhưng thẻ xác thực sai → dữ liệu đã bị can thiệp hoặc sai khoá.
 *
 * Nếu tình huống thứ hai cũng lặng lẽ rơi về cột thô thì kẻ ghi được vào DB chỉ cần làm hỏng 1 byte
 * bản mã là ép hệ thống quay lại đọc plaintext — vô hiệu hoá toàn bộ lớp toàn vẹn. Nên ở đây phải NỔ.
 */
export function decryptPiiOrThrow(stored: string, aad?: string): string {
  const out = decryptPii(stored, aad);
  if (out == null) {
    throw Object.assign(new Error("Dữ liệu đã mã hoá không giải mã được (sai khoá hoặc bị can thiệp)"), { status: 500, piiIntegrity: true });
  }
  return out;
}

/** CHỈ DÙNG TRONG TEST: xoá cache khoá sau khi đổi biến môi trường. */
export function __resetPiiKeyCache() {
  cachedKeys = null;
}
