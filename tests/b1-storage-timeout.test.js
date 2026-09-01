// Cụm hạ tầng/worker — S3Client dựng KHÔNG có trần thời gian nào.
//
// ── LỖI (bullmq-export-blocks-worker-loop-stalls, đường còn hở) ─────────────
// Bản vá trước đưa việc SINH FILE sang worker_threads và đặt trần cứng 30s (EXPORT_GEN_TIMEOUT_MS),
// rồi neo ân hạn dừng 90s của k8s/compose vào con số đó. Nhưng job xuất nền còn MỘT pha nữa sau khi
// sinh xong: `putObject` rồi `presignDownload` (src/worker.ts). Pha đó KHÔNG có trần:
//     client = new S3Client({ endpoint, region, forcePathStyle, credentials });   // hết
// AWS SDK v3 mặc định KHÔNG đặt requestTimeout ở NodeHttpHandler — nghĩa là MinIO/S3 treo thì
// `await c.send(...)` chờ vô hạn, `Worker.close()` chờ job đó mãi, hết 90s ân hạn → SIGKILL → job
// nằm lại tới hết EXPORT_JOB_LOCK_MS (300s) rồi về hàng chờ ở trạng thái stalled. Bị cắt hai lần
// (deploy rồi rollback) là chạm maxStalledCount = 1: BullMQ đánh hỏng VĨNH VIỄN.
//
// TÁI HIỆN: soi đúng đối số tới `new S3Client` — trước bản vá không có `requestHandler`.
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ ctorArgs: [] }));

vi.mock("@aws-sdk/client-s3", () => {
  const cmd = class { constructor(i) { this.input = i; } };
  return {
    S3Client: class { constructor(cfg) { h.ctorArgs.push(cfg); this.config = cfg; } send() {} destroy() {} },
    PutObjectCommand: cmd, GetObjectCommand: cmd, DeleteObjectCommand: cmd, HeadObjectCommand: cmd,
    CreateBucketCommand: cmd, HeadBucketCommand: cmd, CopyObjectCommand: cmd, ListObjectsV2Command: cmd,
  };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: async () => "https://vi-du" }));
vi.mock("../src/config.js", () => ({
  config: {
    S3_ENDPOINT: "http://127.0.0.1:9000", S3_ACCESS_KEY: "a", S3_SECRET_KEY: "b",
    S3_REGION: "auto", S3_FORCE_PATH_STYLE: true, S3_BUCKET: "quanly", NODE_ENV: "test",
  },
}));

const { getClient, S3_REQUEST_TIMEOUT_MS, S3_CONNECT_TIMEOUT_MS } = await import("../src/storage.js");

describe("S3Client — phải có trần thời gian, nếu không worker treo qua cả ân hạn dừng", () => {
  it("truyền requestHandler kèm requestTimeout/connectionTimeout THẬT", () => {
    const c = getClient();
    expect(c).toBeTruthy();
    const cfg = h.ctorArgs[0];
    expect(cfg.requestHandler, "S3Client không có requestHandler → không có trần nào").toBeTruthy();
    expect(cfg.requestHandler.requestTimeout).toBe(S3_REQUEST_TIMEOUT_MS);
    expect(cfg.requestHandler.connectionTimeout).toBe(S3_CONNECT_TIMEOUT_MS);
  });

  it("trần phải NGẮN HƠN ân hạn dừng 90s của worker, kể cả khi thử lại", () => {
    // Ân hạn dừng: infra/k8s/worker.yaml `terminationGracePeriodSeconds: 90`. Một lệnh S3 tối đa
    // ~ (1 + maxAttempts thử lại) × requestTimeout, nên trần đơn lẻ phải nhỏ hơn hẳn 90s.
    expect(S3_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(S3_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    expect(S3_CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(S3_REQUEST_TIMEOUT_MS);
  });

  it("số lần thử lại có trần (không để SDK nhân thời gian chờ lên vô định)", () => {
    expect(typeof h.ctorArgs[0].maxAttempts).toBe("number");
    expect(h.ctorArgs[0].maxAttempts).toBeLessThanOrEqual(3);
  });
});
