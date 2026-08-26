import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, CreateBucketCommand, HeadBucketCommand, CopyObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
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

/**
 * Sao chép object trong CÙNG bucket, phía máy chủ (không kéo dữ liệu về ứng dụng).
 * Dùng để chuyển object từ vùng tạm sang vùng dùng được SAU khi đã xác minh nội dung.
 */
export async function copyObject(fromKey: string, toKey: string, { contentType, bucket = config.S3_BUCKET }: { contentType?: string; bucket?: string } = {}) {
  const c = getClient();
  if (!c) throw new Error("Storage not configured");
  await c.send(new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${fromKey}`,
    Key: toKey,
    ContentType: contentType,
    // Ép lại kiểu + luôn tải-về (không render inline), thay vì giữ metadata của bản tạm do client PUT.
    MetadataDirective: contentType ? "REPLACE" : "COPY",
    ContentDisposition: "attachment",
  }));
  return { key: toKey, bucket };
}

export async function deleteObject(key: string, bucket = config.S3_BUCKET) {
  const c = getClient();
  if (!c) return;
  await c.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Liệt kê object theo tiền tố, CÓ TRẦN SỐ LƯỢNG và CÓ ĐIỂM BẮT ĐẦU.
 *
 * Vì sao có trần: bucket production chứa cả file xuất tích tụ nhiều năm. Gom hết khoá vào một mảng
 * là để một tác vụ dọn dẹp chạy nền tự tay làm cạn bộ nhớ tiến trình.
 *
 * ĐỌC KỸ Ý NGHĨA CỦA TRẦN: ListObjectsV2 trả khoá theo thứ tự TỰ VỰNG, KHÔNG theo ngày, và hàm này
 * KHÔNG nhớ vị trí giữa hai lần gọi. Nên "chạm trần rồi lượt sau dọn tiếp" là SAI: lượt sau lại bắt
 * đầu từ đúng đầu dải, phần ĐUÔI không bao giờ tới lượt (một tiền tố công ty đông việc chiếm trọn
 * cửa sổ đầu là đủ để file 5 năm tuổi của tiền tố xếp sau không bao giờ được rà).
 *
 * Muốn đi hết dải thì chỗ gọi phải TỰ PHÂN TRANG: truyền `startAfter` = khoá cuối của trang trước
 * (xem vòng lặp exports/ trong src/retention.ts). Cách đó giữ bộ nhớ ở mức O(một trang) mà vẫn quét
 * hết, thay vì cắt cụt rồi hứa suông.
 *
 * Trả về mảng rỗng khi chưa cấu hình kho, để chỗ gọi không phải bọc try/catch.
 */
export async function listObjects(prefix: string, { bucket = config.S3_BUCKET, maxKeys = 10_000, startAfter }: { bucket?: string; maxKeys?: number; startAfter?: string } = {}) {
  const c = getClient();
  if (!c) return [];
  const out: Array<{ key: string; size: number; lastModified: Date | null }> = [];
  let token: string | undefined;
  do {
    // S3 CHỈ đọc StartAfter ở request ĐẦU TIÊN; từ trang thứ hai trở đi ContinuationToken mới là
    // thứ định vị. Truyền cả hai cùng lúc là mơ hồ nên chỉ gửi StartAfter khi chưa có token.
    const r: any = await c.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, StartAfter: token ? undefined : startAfter }));
    for (const o of r.Contents || []) {
      if (!o.Key) continue;
      out.push({ key: o.Key, size: Number(o.Size ?? 0), lastModified: o.LastModified ? new Date(o.LastModified) : null });
      if (out.length >= maxKeys) return out;
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
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

/**
 * Presigned PUT cho upload trực tiếp từ client.
 *
 * `contentLength` được ĐƯA VÀO CHỮ KÝ: S3/MinIO khi đó bắt buộc request phải gửi đúng
 * `Content-Length` ấy, nếu không thì từ chối. Đó là CÁI DUY NHẤT chặn được kích thước ở phía kho
 * lưu trữ — không có nó, đường presigned lách sạch giới hạn 10 MB của đường multipart và một tài
 * khoản bất kỳ có thể đẩy file khổng lồ vào bucket. `contentType` cũng nằm trong chữ ký nên client
 * không đổi kiểu được. Kiểm NỘI DUNG THẬT (magic bytes) làm ở bước finalize.
 */
export async function presignUpload({ key, contentType, contentLength, expiresIn = 3600, bucket = config.S3_BUCKET }: { key: string; contentType?: string; contentLength?: number; expiresIn?: number; bucket?: string }) {
  const c = getClient();
  if (!c) throw new Error("Storage not configured");
  return getSignedUrl(
    c,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
    { expiresIn, signableHeaders: contentLength != null ? new Set(["content-length", "content-type"]) : undefined }
  );
}

/** Metadata của object (kích thước/kiểu thật do kho lưu trữ ghi nhận). null nếu không tồn tại. */
export async function headObject(key: string, bucket = config.S3_BUCKET) {
  const c = getClient();
  if (!c) return null;
  try {
    const r = await c.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType || "", metadata: r.Metadata || {} };
  } catch {
    return null;
  }
}

/**
 * Tải TOÀN BỘ object về bộ nhớ, có TRẦN CỨNG. Dùng khi phải soi cấu trúc bên trong (vd kiểm .xlsx là
 * zip hợp lệ). Vượt trần → dừng và trả null chứ không nuốt hết vào RAM: nếu không, chính bước kiểm
 * an toàn lại thành cách làm cạn bộ nhớ tiến trình.
 */
export async function getObjectBytes(key: string, maxBytes: number, bucket = config.S3_BUCKET): Promise<Buffer | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const r = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of r.Body as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > maxBytes) return null;
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/** Đọc N byte ĐẦU của object — đủ để nhận dạng magic bytes mà không kéo cả file về. */
export async function getObjectHeadBytes(key: string, n = 16, bucket = config.S3_BUCKET): Promise<Buffer | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const r = await c.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${n - 1}` }));
    const chunks: Buffer[] = [];
    for await (const chunk of r.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}
