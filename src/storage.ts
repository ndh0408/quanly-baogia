import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config.js";
import { logger } from "./logger.js";

let client: S3Client | null = null;

export function isStorageEnabled() {
  return !!(config.S3_ENDPOINT && config.S3_ACCESS_KEY && config.S3_SECRET_KEY);
}

export function getClient() {
  if (!isStorageEnabled()) return null;
  if (client) return client;
  const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY } = config;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) return null;
  client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  });
  return client;
}

export async function ensureBucket(bucket = config.S3_BUCKET) {
  const c = getClient();
  if (!c) return false;
  try {
    await c.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    try {
      await c.send(new CreateBucketCommand({ Bucket: bucket }));
      logger.info({ bucket }, "S3 bucket created");
      return true;
    } catch (e) {
      logger.error({ err: e instanceof Error ? e.message : String(e), bucket }, "S3 bucket create failed");
      return false;
    }
  }
}

/**
 * Upload an object. Key is deterministic from caller (e.g. `logos/${companyId}.png`).
 * Returns { key, bucket }.
 */
export async function putObject({ key, body, contentType, bucket = config.S3_BUCKET, metadata, contentDisposition }: { key: string; body: Buffer | Uint8Array | string; contentType?: string; bucket?: string; metadata?: Record<string, string>; contentDisposition?: string }) {
  const c = getClient();
  if (!c) throw new Error("Storage not configured");
  await c.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: body, ContentType: contentType, Metadata: metadata,
    // Default to attachment so a mis-stored text/html object can never be rendered
    // inline by the browser (stored-XSS defence).
    ContentDisposition: contentDisposition || "attachment",
  }));
  return { key, bucket };
}

export async function deleteObject(key: string, bucket = config.S3_BUCKET) {
  const c = getClient();
  if (!c) return;
  await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function objectExists(key: string, bucket = config.S3_BUCKET) {
  const c = getClient();
  if (!c) return false;
  try {
    await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a time-limited signed URL clients can download the object from directly.
 * Always forces an `attachment` disposition (sanitized filename) so the object is
 * downloaded, never rendered inline — even if it was stored with a risky
 * Content-Type. Pass `inline:true` only for trusted, display-safe assets.
 */
export async function presignDownload(key: string, { expiresIn = 3600, bucket = config.S3_BUCKET, filename, inline = false }: { expiresIn?: number; bucket?: string; filename?: string; inline?: boolean } = {}) {
  const c = getClient();
  if (!c) throw new Error("Storage not configured");
  const safeName = String(filename || key.split("/").pop() || "download").replace(/[^A-Za-z0-9._-]/g, "_");
  return getSignedUrl(
    c,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
    }),
    { expiresIn }
  );
}

export async function presignUpload({ key, contentType, expiresIn = 3600, bucket = config.S3_BUCKET }: { key: string; contentType?: string; expiresIn?: number; bucket?: string }) {
  const c = getClient();
  if (!c) throw new Error("Storage not configured");
  return getSignedUrl(c, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn });
}
