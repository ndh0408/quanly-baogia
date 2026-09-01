// Minimal env defaults so config.js doesn't fail-fast in tests.
process.env.NODE_ENV ||= "test";
process.env.DATABASE_URL ||= "postgresql://quanly:quanly_pwd@localhost:5432/quanly_test?schema=public";
process.env.SESSION_SECRET ||= "test-secret-must-be-long-enough-to-pass-the-zod-validator-yes";
process.env.LOG_LEVEL ||= "error";

// ── Kho object: tạo bucket nếu chưa có ─────────────────────────────────────
//
// `ensureBucket()` chỉ chạy lúc server khởi động (src/server.ts), mà test thì gọi thẳng
// `createApp()` — không đi qua entrypoint đó. Thiếu bước này, mọi test đụng tới ảnh chứng từ
// thanh toán sẽ ngã với `NoSuchBucket` và trả 500, dù kho object ĐANG chạy đàng hoàng.
//
// Cố ý KHÔNG phụ thuộc vào việc image MinIO có tự tạo sẵn bucket hay không: bộ test tự lo lấy
// điều kiện tiên quyết của mình thì chạy được ở mọi nơi (CI, máy dev, docker-compose).
//
// CỐ Ý dùng thẳng SDK thay vì `src/storage.js`: import module ứng dụng ở đây sẽ kéo theo
// `src/config.js`, mà config đọc process.env NGAY LÚC NẠP MODULE. tests/mfa.test.js đặt
// MFA_ENC_KEY trong beforeAll rồi mới import động `src/mfa.js` — nạp config sớm ở setup làm
// khoá ấy không bao giờ tới nơi và hai test mã hoá MFA đỏ. Setup không được quyết định thay
// thời điểm nạp config của các bài test.
if (process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY) {
  const { S3Client, HeadBucketCommand, CreateBucketCommand } = await import("@aws-sdk/client-s3");
  const Bucket = process.env.S3_BUCKET || "quanly";
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "auto",
    forcePathStyle: !/^(false|0|no)$/i.test(process.env.S3_FORCE_PATH_STYLE ?? "true"),
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket }));
    } catch (e) {
      console.warn(`[test setup] không tạo được bucket "${Bucket}":`, e instanceof Error ? e.message : String(e));
    }
  } finally {
    s3.destroy();
  }
}
