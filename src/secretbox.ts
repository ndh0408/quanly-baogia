// Application-level encryption for secrets stored at rest (e.g. webhook signing
// secrets). AES-256-GCM (authenticated) with a random IV per value and a versioned
// prefix. decryptValue() is backward-compatible: a value WITHOUT the prefix is
// returned as-is, so existing plaintext rows keep working and get re-encrypted on
// next write. Fail-closed: a tampered/undecryptable ciphertext returns null.
//
// Key source: MFA_ENC_KEY if set (the app's dedicated at-rest key), else the
// configured JWT_SECRET (always present). Prefer setting a stable MFA_ENC_KEY in
// production — rotating the key makes previously-encrypted values undecryptable.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";

const PREFIX = "enc:v1:";
const IV_LEN = 12;
const TAG_LEN = 16;

function key() {
  const material = process.env.MFA_ENC_KEY || config.JWT_SECRET || "";
  return createHash("sha256").update(material).digest(); // 32 bytes for AES-256
}

/** Encrypt a string for storage. Returns the prefixed ciphertext, or the value unchanged if null/empty. */
export function encryptValue(plain) {
  if (plain == null || plain === "") return plain;
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a stored value. Plaintext (no prefix) is returned as-is; failures return null. */
export function decryptValue(value) {
  if (value == null) return value;
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return value; // legacy plaintext
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const d = createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch (e) {
    logger.warn({ err: e.message }, "secretbox decrypt failed");
    return null;
  }
}

/** True if a stored value is already encrypted. */
export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}
