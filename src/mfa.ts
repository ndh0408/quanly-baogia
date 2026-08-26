// MFA secret/backup-code cryptography. Two goals:
//  1) Never store the TOTP secret in plaintext — encrypt with AES-256-GCM.
//  2) Never store backup codes in a form that survives a database dump — store bcrypt hashes.
// Both are BACKWARD-COMPATIBLE: legacy plaintext secrets, legacy SHA-256 backup-code hashes and
// legacy 10-char plaintext backup codes are still accepted (and re-secured on next write), so
// enabling this does not lock out users who set up MFA before the upgrade.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { logger } from "./logger.js";

const ENC_PREFIX = "enc:v1:";
let warnedNoKey = false;

function encKey() {
  if (!config.MFA_ENC_KEY) return null;
  // Derive a stable 32-byte key from the configured secret.
  return createHash("sha256").update(config.MFA_ENC_KEY).digest();
}

/** Encrypt a TOTP secret for storage. Falls back to plaintext if no key configured. */
export function encryptSecret(plain: string | null | undefined) {
  if (plain == null) return plain;
  const key = encKey();
  if (!key) {
    if (!warnedNoKey) { logger.warn("MFA_ENC_KEY not set — MFA secrets stored in plaintext (set it in production)"); warnedNoKey = true; }
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Decrypt a stored secret. Legacy plaintext (no prefix) is returned as-is.
 * FAILS CLOSED: returns null (never throws) if the key is missing/rotated or the
 * ciphertext is corrupt — so a TOTP check just fails instead of 500-ing the
 * login/disable handlers. Recovery is via a backup code.
 */
export function decryptSecret(stored: string | null | undefined) {
  if (stored == null || !String(stored).startsWith(ENC_PREFIX)) return stored;
  const key = encKey();
  if (!key) return null;
  try {
    const raw = Buffer.from(String(stored).slice(ENC_PREFIX.length), "base64");
    // GCM CẮT NGẮN THẺ XÁC THỰC — xem giải thích đầy đủ ở src/secretbox.ts. Tóm tắt: `subarray` không
    // báo lỗi khi dữ liệu ngắn, và Node nhận thẻ GCM 4–16 byte nếu không ghim `authTagLength`; ai ghi
    // được vào DB có thể lưu thẻ 4 byte rồi giả mạo bí mật TOTP với 2^32 công thay vì 2^128.
    if (raw.length < 28) throw new Error("ciphertext quá ngắn");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    if (tag.length !== 16) throw new Error("thẻ xác thực sai độ dài");
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "MFA secret decrypt failed (wrong/rotated key or corrupt data)");
    return null;
  }
}

const sha256 = (s: string) => createHash("sha256").update(String(s)).digest("hex");

// 10 byte = 80 bit. Bản cũ dùng randomBytes(5) — đúng 2^40 khả năng — mà lại băm bằng SHA-256 TRẦN
// (không muối, không KDF), trong khi định dạng `[0-9A-Fa-f]{10}` được công bố ngay trong schema của
// route. Ai lấy được một bản dump CSDL quét cạn được không gian đó trong vài giờ trên một GPU, rồi
// dùng mã tìm ra để VƯỢT MFA lẫn TẮT MFA — mà mã dự phòng KHÔNG bị vô hiệu khi đổi mật khẩu nên nó
// là thông tin đăng nhập sống rất dai. Chính thiết kế đã coi "dump CSDL" là mô hình đe doạ có thật:
// bí mật TOTP được AES-256-GCM và MFA_ENC_KEY là BẮT BUỘC ở production.
const BACKUP_CODE_BYTES = 10;

// Cost RIÊNG, thấp hơn config.BCRYPT_COST (mật khẩu người tự nghĩ ra) một cách CÓ CHỦ Ý.
//
// Mã dự phòng là 80 bit NGẪU NHIÊN: nó không nằm trong bất kỳ từ điển nào, nên việc của hàm băm ở
// đây chỉ là muối + làm chậm vừa đủ, không phải kéo giãn một bí mật yếu. Đổi lại, cost thấp giữ cho
// việc so tuần tự tới 8 mã không biến một lần đăng nhập bằng mã dự phòng thành nhiều giây bcrypt.
const BACKUP_CODE_COST = 10;

/**
 * Sinh N mã dự phòng dùng-một-lần; trả { plain[], hashed[] }. CHỈ hiện `plain` đúng một lần.
 * Bất đồng bộ vì bcryptjs là JS thuần: bản `*Sync` băm 8 mã sẽ CHẶN vòng lặp sự kiện gần một giây.
 */
export async function generateBackupCodes(n = 8) {
  const plain = Array.from({ length: n }, () => randomBytes(BACKUP_CODE_BYTES).toString("hex").toUpperCase());
  const hashed: string[] = [];
  for (const p of plain) hashed.push(await bcrypt.hash(p, BACKUP_CODE_COST));
  return { plain, hashed };
}

function eq(a: string, b: string) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Match a submitted backup code against the stored list (bcrypt, legacy SHA-256, or legacy plaintext).
 * Returns { matched, remaining } where `matched` is the exact stored entry (used as
 * an optimistic-lock guard so consumption is atomic), or null if no match.
 */
export async function consumeBackupCode(storedList: string[] | null | undefined, submitted: string) {
  const code = String(submitted || "").toUpperCase();
  // Chuỗi rỗng không được phép khớp một phần tử plaintext rỗng còn sót trong CSDL.
  if (!code) return null;
  const list = storedList || [];
  const target = sha256(code);
  for (let i = 0; i < list.length; i++) {
    const entry = String(list[i]);
    // bcrypt bắt đầu bằng "$2"; bản băm SHA-256 cũ dài đúng 64 ký tự hex; mã plaintext cũ dài 10.
    // Giữ đủ ba nhánh để bản vá KHÔNG khoá những người đã đăng ký MFA trước đó.
    const match = entry.startsWith("$2")
      ? await bcrypt.compare(code, entry)
      : entry.length === 64
        ? eq(entry, target)
        : eq(entry.toUpperCase(), code);
    if (match) {
      const remaining = [...list];
      remaining.splice(i, 1);
      return { matched: entry, remaining };
    }
  }
  return null;
}
