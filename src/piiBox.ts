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
//
// ── VÌ SAO CÓ PII_ENC_KEY_OLD ────────────────────────────────────────────────
// Xoay khoá là thao tác KHÔNG NGUYÊN TỬ: hàng đang nằm trong CSDL mã bằng khoá cũ, hàng ghi mới mã
// bằng khoá mới, và giữa hai mốc đó ứng dụng vẫn phải phục vụ. Chỉ có một khoá thì không có cửa sổ
// nào để chuyển — đổi biến môi trường là toàn bộ dữ liệu cũ "hoá đá" ngay lập tức, đúng như
// docs/operations/INCIDENT_RESPONSE.md đang phải cảnh báo. Đặt THÊM `PII_ENC_KEY_OLD` mở ra cửa sổ
// đó: ĐỌC chấp nhận cả hai khoá, GHI chỉ dùng khoá mới, và `scripts/migration/pii-backfill.mjs
// --rotate` mã hoá lại dần. Xong thì gỡ `PII_ENC_KEY_OLD` — gỡ được nghĩa là đã xoay xong thật.
// KHÔNG nhét định danh khoá vào bản mã: thử-hai-khoá tốn nhiều nhất một phép giải mã thất bại, còn
// gắn nhãn khoá vào từng hàng là thêm một trường phải di trú và phải giữ đồng bộ mãi mãi.
type PiiKeys = { enc: Buffer; idx: Buffer; encOld: Buffer | null; idxOld: Buffer | null };
let cachedKeys: PiiKeys | null = null;

function derive(material: string) {
  const salt = Buffer.from("quanly-pii-v1");
  return {
    enc: Buffer.from(hkdfSync("sha256", material, salt, "encryption", 32)),
    idx: Buffer.from(hkdfSync("sha256", material, salt, "blind-index", 32)),
  };
}

function keys(): PiiKeys | null {
  const material = process.env.PII_ENC_KEY || "";
  if (!material) return null;
  if (cachedKeys) return cachedKeys;
  const cur = derive(material);
  // Khoá cũ TRÙNG khoá mới thì coi như không có: tránh mọi lần giải mã hỏng đều tốn thêm một lượt
  // thử vô ích, và tránh log "còn hàng chưa xoay" sai sự thật.
  const before = process.env.PII_ENC_KEY_OLD || "";
  const prev = before && before !== material ? derive(before) : null;
  cachedKeys = { enc: cur.enc, idx: cur.idx, encOld: prev?.enc ?? null, idxOld: prev?.idx ?? null };
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
  const r = moTheoKhoa(stored, aad);
  if (r.khoa === "cu") {
    // Giải được bằng khoá CŨ = hàng chưa được `--rotate` chạy tới. Đọc vẫn phải chạy, nhưng phải để
    // lại dấu vết: im lặng ở đây là cách chắc chắn nhất để quên mất còn tồn đọng rồi gỡ khoá cũ.
    logger.warn({ aad }, "PII còn mã bằng KHOÁ CŨ — chạy pii-backfill.mjs --rotate trước khi gỡ PII_ENC_KEY_OLD");
  } else if (r.khoa === null) {
    logger.error({ aad }, "giải mã PII thất bại (sai khoá / dữ liệu hỏng)");
  }
  return r.giaTri;
}

/**
 * Giải mã và NÓI RÕ KHOÁ NÀO mở được — `"moi"`, `"cu"`, hoặc `null` khi không khoá nào mở nổi.
 *
 * ── VÌ SAO PHẢI CÓ HÀM NÀY, KHÔNG DÙNG `decryptPii` ─────────────────────────
 * `decryptPii` cố ý thử khoá mới rồi rơi về khoá cũ — đó là điều làm cho việc xoay khoá không gây
 * gián đoạn. Nhưng chính cái rơi-về ấy làm mọi bước KIỂM CHỨNG dựa trên nó trở thành BẰNG CHỨNG
 * GIẢ: sau khi xoay, `verify` báo "tất cả đọc được" kể cả khi KHÔNG MỘT HÀNG NÀO được mã lại.
 *
 * Đó không phải lỗi vô hại. Quy trình trong docs/operations/DISASTER_RECOVERY.md dùng đúng dấu `✓`
 * đó làm điều kiện để GỠ `PII_ENC_KEY_OLD`. Gỡ khoá cũ khi chưa xoay xong = toàn bộ hàng còn lại
 * hoá đá VĨNH VIỄN, không có đường về. Bước chứng minh phải hỏi "mở được bằng khoá MỚI chưa",
 * không phải "có mở được không".
 *
 * Dùng ở: scripts/migration/pii-backfill.mjs (--verify) và src/tools/verifyIntegrity.ts (diễn tập
 * khôi phục hằng tuần, chạy trong image production).
 */
export function moTheoKhoa(stored: string, aad?: string): { giaTri: string | null; khoa: "moi" | "cu" | null } {
  const k = keys();
  if (!k) return { giaTri: null, khoa: null };
  const raw = Buffer.from(String(stored).slice(PREFIX.length), "base64");
  const cur = openWith(k.enc, raw, aad);
  if (cur != null) return { giaTri: cur, khoa: "moi" };
  if (k.encOld) {
    const prev = openWith(k.encOld, raw, aad);
    if (prev != null) return { giaTri: prev, khoa: "cu" };
  }
  return { giaTri: null, khoa: null };
}

/** Có đang mở cửa sổ xoay khoá không (PII_ENC_KEY_OLD được đặt và KHÁC khoá hiện tại). */
export function dangXoayKhoa() {
  return !!keys()?.encOld;
}

/**
 * Một lượt thử mở bản mã bằng ĐÚNG một khoá. Trả `null` khi không mở được — KHÔNG log ở đây, vì
 * lượt thử đầu thất bại là chuyện BÌNH THƯỜNG trong lúc xoay khoá; chỉ chỗ gọi mới biết đã hết cửa
 * hay chưa. Log ở đây là đổ đầy log bằng báo động giả.
 */
function openWith(key: Buffer, raw: Buffer, aad?: string): string | null {
  try {
    if (raw.length < IV_LEN + TAG_LEN) return null;
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const d = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
    d.setAuthTag(tag);
    if (aad) d.setAAD(Buffer.from(aad, "utf8"));
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
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
  return hmacIdx(k.idx, value);
}

const hmacIdx = (key: Buffer, value: string) =>
  createHmac("sha256", key).update(String(value).trim().toLowerCase().replace(/\s+/g, "")).digest("hex");

/**
 * MỌI chỉ mục mù có thể đang nằm trong CSDL cho một giá trị — khoá mới trước, khoá cũ sau.
 *
 * Chỉ mục mù dẫn xuất TỪ KHOÁ, nên trong lúc xoay khoá cùng một CCCD tồn tại dưới hai HMAC khác
 * nhau. Tra cứu chỉ bằng chỉ mục MỚI sẽ lặng lẽ không tìm thấy hàng chưa xoay — tệ hơn lỗi, vì nó
 * trông y hệt "không có hồ sơ nào". Chỗ gọi dùng `IN (...)` để phủ cả hai giai đoạn.
 */
export function blindIndexCandidates(value: string | null | undefined): string[] {
  if (value == null || value === "") return [];
  const k = keys();
  if (!k) return [];
  const out = [hmacIdx(k.idx, value)];
  if (k.idxOld) out.push(hmacIdx(k.idxOld, value));
  return out;
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
