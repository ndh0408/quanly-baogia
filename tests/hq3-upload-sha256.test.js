// Cụm hàng đợi/SSE/quan trắc — cột `sha256` của UploadObject KHÔNG AI GHI (upload-objects-have-no-stored-hash).
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// prisma/schema.prisma:102 đã có `sha256 String? // băm nội dung — chống trùng lặp + đối chiếu về
// sau`, và migration 20260811140000_upload_object_state đã tạo cột. Nhưng `grep sha256
// src/routes/files.routes.ts` ra 0 kết quả: cả đường multipart (create) lẫn đường /finalize
// (updateMany pending→finalized) đều bỏ trống nó.
// TÁI HIỆN: tải một tệp lên rồi đọc dữ liệu ghi vào UploadObject — không có `sha256`.
// HẬU QUẢ: đối lập hẳn với `paymentProofSha256` (thứ khiến verifyIntegrity.ts đối chiếu được bản
// khôi phục). Với tệp đính kèm, sau một lần khôi phục hay một lần bucket hỏng âm thầm, KHÔNG có
// cách nào biết nội dung còn đúng hay đã sai — chỉ biết "có object ở đó".
//
// Test đi qua route THẬT + kho object THẬT (MinIO); chỉ lớp Prisma bị theo dõi để đọc đúng thứ
// route định ghi xuống.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";

const UID = 900_113; // TAG riêng của agent này — không đụng namespace khoá của test khác

// Vitest có thể DÙNG LẠI tiến trình worker cho nhiều file test → phải trả process.env về nguyên
// trạng ở afterAll, nếu không file test khác sẽ thấy kho object "đã cấu hình" một cách bất ngờ.
const S3_GOC = { ...process.env };
const S3_KHOA = ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET", "S3_FORCE_PATH_STYLE"];
process.env.S3_ENDPOINT ||= "http://127.0.0.1:9000";
process.env.S3_ACCESS_KEY ||= "minioadmin";
process.env.S3_SECRET_KEY ||= "minioadmin";
process.env.S3_BUCKET ||= "quanly";
process.env.S3_FORCE_PATH_STYLE ||= "true";

vi.mock("../src/audit.js", () => ({ audit: async () => {} }));

// PNG hợp lệ ở mức magic bytes (sniffType chỉ đọc 8 byte đầu) + phần thân để có nội dung mà băm.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("hq3-noi-dung-de-bam".repeat(8))]);
const BAM = createHash("sha256").update(PNG).digest("hex");

let app, prisma, storage;

beforeAll(async () => {
  ({ prisma } = await import("../src/db.js"));
  storage = await import("../src/storage.js");
  await storage.ensureBucket();
  const { default: filesRoutes } = await import("../src/routes/files.routes.js");
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: UID, role: "admin" }; next(); });
  app.use("/api/files", filesRoutes);
});

afterAll(() => {
  for (const k of S3_KHOA) { if (S3_GOC[k] === undefined) delete process.env[k]; else process.env[k] = S3_GOC[k]; }
  vi.restoreAllMocks();
});

describe("UploadObject.sha256 — đường multipart", () => {
  it("POST /api/files phải ghi băm SHA-256 của nội dung vừa nhận", async () => {
    let ghi = null;
    vi.spyOn(prisma.uploadObject, "create").mockImplementation(async (a) => { ghi = a.data; return { id: 1, ...a.data }; });
    const r = await request(app).post("/api/files").attach("file", PNG, { filename: "a.png", contentType: "image/png" });
    expect(r.status).toBe(201);
    expect(ghi, "route không gọi uploadObject.create").not.toBeNull();
    expect(ghi.sha256).toBe(BAM);
    await storage.deleteObject(r.body.key).catch(() => {});
  });
});

describe("UploadObject.sha256 — đường presigned /finalize", () => {
  it("POST /api/files/finalize phải băm nội dung THẬT trên kho rồi lưu cùng lúc lật sang finalized", async () => {
    const key = `uploads/u${UID}/hq3-${Date.now()}.png`;
    const stagingKey = `uploads/u${UID}/staging-hq3-${Date.now()}.png`;
    await storage.putObject({ key: stagingKey, body: PNG, contentType: "image/png" });

    vi.spyOn(prisma.uploadObject, "findUnique").mockResolvedValue({
      key, stagingKey, ownerId: UID, status: "pending",
      expectedMime: "image/png", expectedSize: PNG.length,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    let ghi = null;
    vi.spyOn(prisma.uploadObject, "updateMany").mockImplementation(async (a) => {
      if (a.data?.status === "finalized") ghi = a.data;
      return { count: 1 };
    });

    const r = await request(app).post("/api/files/finalize").send({ key });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(ghi, "route không lật được pending→finalized").not.toBeNull();
    expect(ghi.sha256).toBe(BAM);

    await storage.deleteObject(key).catch(() => {});
    await storage.deleteObject(stagingKey).catch(() => {});
  });
});
