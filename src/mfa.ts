// MFA secret/backup-code cryptography. Two goals:
//  1) Never store the TOTP secret in plaintext — encrypt with AES-256-GCM.
//  2) Never store backup codes in plaintext — store SHA-256 hashes.
// Both are BACKWARD-COMPATIBLE: legacy plaintext secrets and 10-char plaintext
// backup codes are still accepted (and re-secured on next write), so enabling
// this does not lock out users who set up MFA before the upgrade.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
  const cipher = createCipheriv("aes-256-gcm", key, iv);
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
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "MFA secret decrypt failed (wrong/rotated key or corrupt data)");
    return null;
  }
}

const sha256 = (s: string) => createHash("sha256").update(String(s)).digest("hex");

/** Generate N single-use backup codes; returns { plain[], hashed[] }. Show plain ONCE. */
export function generateBackupCodes(n = 8) {
  const plain = Array.from({ length: n }, () => randomBytes(5).toString("hex").toUpperCase());
  return { plain, hashed: plain.map(sha256) };
}

function eq(a: string, b: string) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Match a submitted backup code against the stored list (hashed or legacy plaintext).
 * Returns { matched, remaining } where `matched` is the exact stored entry (used as
 * an optimistic-lock guard so consumption is atomic), or null if no match.
 */
export function consumeBackupCode(storedList: string[] | null | undefined, submitted: string) {
  const code = String(submitted || "").toUpperCase();
  const list = storedList || [];
  const target = sha256(code);
  for (let i = 0; i < list.length; i++) {
    const entry = String(list[i]);
    // Hashed entries are 64 hex chars; legacy plaintext are 10.
    const match = entry.length === 64 ? eq(entry, target) : eq(entry.toUpperCase(), code);
    if (match) {
      const remaining = [...list];
      remaining.splice(i, 1);
      return { matched: entry, remaining };
    }
  }
  return null;
}
