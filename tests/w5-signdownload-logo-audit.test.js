// Cụm W5 — miễn trừ ghi nhật ký cho tiền tố `logos/` ở GET /api/files/sign-download.
//
// ── VÌ SAO BỎ MIỄN TRỪ ──────────────────────────────────────────────────────
// Nhánh `if (!key.startsWith("logos/"))` trong src/routes/files.routes.ts được biện minh bằng một
// phép đo không đúng: "SPA xin chữ ký cho logo ở gần như mỗi lần mở báo giá". Đo lại:
//
//   $ grep -rn "sign-download\|signDownload" web/src --include=*.ts --include=*.tsx | grep -v '\.test\.'
//   web/src/pages/Audit.tsx:58: ["file.sign-download", "Xin URL tải tệp về"]
//
// ĐÚNG MỘT dòng, và nó là NHÃN tiếng Việt của mã hành động trong bộ lọc trang Nhật ký — không phải
// lời gọi. web/src/lib/api.ts không có hàm nào chạm endpoint này. Logo khách hàng trong SPA là
// data-URL nhúng thẳng vào báo giá (web/src/pages/NewQuoteWizard.tsx:62), không đi qua kho object.
// Tức chi phí ghi nhật ký mà miễn trừ định tiết kiệm là 0 hàng/ngày từ SPA, đổi lấy một khe không
// để lại vết ở đúng cái endpoint TRAO nội dung.
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// Gọi THẬT /api/files/sign-download với một khoá `logos/...`, rồi đếm hàng AuditEvent có resourceId
// đúng bằng khoá đó. Trên mã cũ: 0 hàng (bài này ĐỎ). Sau khi bỏ miễn trừ: 1 hàng.
//
// KHO OBJECT: bài này KHÔNG cần MinIO chạy — presignDownload của AWS SDK v3 ký SigV4 tại chỗ, không
// gửi request nào. Chỉ cần các biến S3_* để isStorageEnabled() trả true; chúng được đặt TRƯỚC khi
// nạp src/config.ts và trả lại nguyên trạng ở afterAll.
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
process.env.S3_ACCESS_KEY ||= "w5test";
process.env.S3_SECRET_KEY ||= "w5testsecret";
process.env.S3_BUCKET ||= "quanly";

const { prisma } = await import("../src/db.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "AuditEvent" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `w5logo${Date.now()}`;
const PASSWORD = "Test1234!a";
const KHOA_LOGO = `logos/${TAG}.png`;

describe.runIf(dbAvailable)("sign-download: tiền tố logos/ KHÔNG còn được miễn ghi nhật ký", () => {
  let app, nguoiDung, agent;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    // Vai `hr` chứ KHÔNG phải admin: trong canAccessKey (files.routes.ts) nhánh bắt-tất
    // `if (session.role === "admin") return true;` đứng TRƯỚC `if (key.startsWith("logos/"))`, nên
    // phiên admin sẽ đi qua cửa admin chứ không qua cửa logo. Dùng vai thường để chạm đúng nhánh
    // `logos/` — nó cho MỌI người đăng nhập đọc vô điều kiện.
    nguoiDung = await prisma.user.create({
      data: { username: `${TAG}-hr`, displayName: `${TAG} hr`, role: "hr", passwordHash: await bcrypt.hash(PASSWORD, 4) },
    });
    agent = agentWithCsrf(app);
    const r = await agent.post("/api/auth/login").send({ username: nguoiDung.username, password: PASSWORD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: nguoiDung?.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    for (const [k, v] of Object.entries(envGoc)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it("ký URL tải logo để lại một hàng AuditEvent trỏ đúng khoá", async () => {
    const res = await agent.get(`/api/files/sign-download?key=${encodeURIComponent(KHOA_LOGO)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(typeof res.body.url).toBe("string");

    const hang = await prisma.auditEvent.findMany({ where: { actorId: nguoiDung.id, resourceId: KHOA_LOGO } });
    expect(hang.length, "trao URL tải logo mà không ghi dòng nhật ký nào").toBe(1);
    expect(hang[0].action).toBe("file.sign-download");
    // URL đã ký chính là thứ mở được file, và bảng AuditEvent không mã hoá → `after` chỉ được chứa
    // khoá + hạn, không được cõng theo URL.
    const after = JSON.stringify(hang[0].after ?? {});
    expect(after).not.toContain("X-Amz-Signature");
    expect(after.length).toBeLessThan(500);
  });
});
