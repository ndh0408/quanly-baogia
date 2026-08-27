// Cụm B5 — cửa THỨ HAI lấy ảnh chứng từ thanh toán mà không để lại dòng nhật ký nào.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Đường "xem chứng từ" qua hồ sơ nhân sự CÓ ghi nhật ký: personnelService.getPaymentProof ghi
// `personnel.payment-proof.view` ngay trước khi trả data-URL. Nhưng ảnh nằm trong kho object dưới
// namespace `payment-proofs/` (src/paymentProof.ts:26), và `GET /api/files/sign-download` ký được
// URL tải cho ĐÚNG khoá đó: trong `canAccessKey`, khoá không thuộc `uploads/` rơi thẳng vào nhánh
// bắt-tất `if (session.role === "admin") return true;` (files.routes.ts). Handler chỉ gọi
// canAccessKey → presignDownload → res.json, KHÔNG ghi audit nào.
//
// Khoá thì nằm sẵn trong tay client: personnelService chỉ `omit: { paymentProof: true }` — cột
// `paymentProofKey` VẪN đi ra trong JSON danh sách/chi tiết. Nên admin — đúng vai trò mà nhật ký
// "ai đã mở ảnh uỷ nhiệm chi" sinh ra để soi — chỉ cần chép khoá từ /api/personnel rồi gọi
// /api/files/sign-download là xem được ảnh mà không để lại vết.
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// Gọi THẬT endpoint qua supertest với phiên admin, rồi đếm hàng AuditEvent có resourceId đúng bằng
// khoá vừa ký. Trên mã cũ: 0 hàng.
//
// KHO OBJECT: bài này KHÔNG cần MinIO chạy. `presignDownload` của AWS SDK v3 ký URL bằng thuật toán
// SigV4 tại chỗ, không gửi request nào tới máy chủ — chỉ cần ba biến môi trường S3_* để
// `isStorageEnabled()` trả true. Ba biến ấy được đặt TRƯỚC khi nạp src/config.ts (config đọc env
// ngay lúc nạp module) và được trả lại nguyên trạng ở afterAll để không rò sang bộ test khác.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";

const envGoc = {
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  S3_BUCKET: process.env.S3_BUCKET,
};
process.env.S3_ENDPOINT ||= "http://127.0.0.1:59999";
process.env.S3_ACCESS_KEY ||= "b5test";
process.env.S3_SECRET_KEY ||= "b5testsecret";
process.env.S3_BUCKET ||= "quanly";

const { prisma } = await import("../src/db.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "AuditEvent" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `b5sign${Date.now()}`;
const PASSWORD = "Test1234!a";
const KHOA_CHUNG_TU = `payment-proofs/p999999/${TAG}-anh.png`;

describe.runIf(dbAvailable)("sign-download phải ghi nhật ký khi trao URL chứng từ", () => {
  let app, adminU, adminA;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    adminU = await prisma.user.create({
      data: { username: `${TAG}-ad`, displayName: `${TAG} ad`, role: "admin", passwordHash: await bcrypt.hash(PASSWORD, 4) },
    });
    adminA = agentWithCsrf(app);
    const r = await adminA.post("/api/auth/login").send({ username: adminU.username, password: PASSWORD });
    expect(r.status).toBe(200);
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    for (const [k, v] of Object.entries(envGoc)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("ký URL tải ảnh chứng từ để lại một hàng AuditEvent trỏ đúng khoá", async () => {
    const res = await adminA.get(`/api/files/sign-download?key=${encodeURIComponent(KHOA_CHUNG_TU)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(typeof res.body.url).toBe("string");

    const hang = await prisma.auditEvent.findMany({ where: { actorId: adminU.id, resourceId: KHOA_CHUNG_TU } });
    expect(hang.length, "trao URL tải chứng từ mà không ghi một dòng nhật ký nào").toBe(1);
    // Nhật ký KHÔNG được cõng theo nội dung ảnh — bảng AuditEvent không mã hoá.
    expect(JSON.stringify(hang[0].after ?? {}).length).toBeLessThan(500);
  });

  // ĐÃ SỬA (cụm W5): bài này trước đây khoá cứng miễn trừ `logos/` với lý do "SPA gọi liên tục".
  // Đo lại thì SPA KHÔNG gọi endpoint này lần nào — `grep -rn "sign-download" web/src` chỉ ra một
  // dòng duy nhất, là nhãn mã hành động ở web/src/pages/Audit.tsx:58, không phải lời gọi. Miễn trừ
  // đã bị bỏ; nay MỌI khoá đều ghi nhật ký. Chi tiết + bài đo ở tests/w5-signdownload-logo-audit.test.js.
  it("logo công ty CŨNG ghi nhật ký — không còn miễn trừ theo tiền tố", async () => {
    const khoaLogo = `logos/${TAG}.png`;
    const res = await adminA.get(`/api/files/sign-download?key=${encodeURIComponent(khoaLogo)}`);
    expect(res.status).toBe(200);
    const hang = await prisma.auditEvent.findMany({ where: { actorId: adminU.id, resourceId: khoaLogo } });
    expect(hang.length).toBe(1);
  });
});
