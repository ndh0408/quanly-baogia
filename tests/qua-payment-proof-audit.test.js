// XEM ảnh chứng từ thanh toán không để lại dấu vết — chốt hồi quy nhật ký.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `getPaymentProof` (src/services/personnelService.ts) gác quyền đúng (`loadAuthorized(req,
// "read")`) rồi trả thẳng data-URL, KHÔNG gọi `audit`. Ngay hàm bên dưới, `downloadContract` CÓ
// `audit(req, "personnel.contract-download", …)`, và thao tác GHI `markPayment` cũng có audit.
// Tức nguyên tắc đã thống nhất trong chính module này; chỗ này bị sót.
//
// ── ĐÂY KHÔNG PHẢI LỖ HỔNG ──────────────────────────────────────────────────
// Không ai đọc được ảnh mà lẽ ra không được đọc — cổng quyền vẫn nguyên. Cái thiếu là khả năng
// TRUY VẾT: chứng từ thanh toán là ảnh uỷ nhiệm chi (tên + số tài khoản + số tiền), và khi có
// tranh chấp chi trả thì câu hỏi đầu tiên là "ai đã mở cái này, lúc nào". Không có hàng audit thì
// không trả lời được, kể cả khi hệ thống chưa hề bị xâm nhập.
//
// ── CHỐT LUÔN MỘT ĐIỀU NỮA ──────────────────────────────────────────────────
// Hàng audit KHÔNG được cõng theo base64 của ảnh: bảng `AuditEvent` không mã hoá, ghi ảnh chứng
// từ vào đó là nhân bản đúng thứ dữ liệu nhạy cảm mà `storeProof` vừa dời khỏi CSDL.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
// Ảnh chứng từ đi qua `storeProof` → BẮT BUỘC có kho object. Không có thì bỏ qua (CI luôn có MinIO).
const storageAvailable = !!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);
if (!storageAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng chưa cấu hình kho object — đường chứng từ không chạy thật");

const TAG = `quaaudit${Date.now()}`;
const PWD = "Test1234!a";
const ANH = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe.runIf(dbAvailable && storageAvailable)("xem chứng từ thanh toán phải ghi nhật ký", () => {
  let app, adminU, admin, recordId;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: adminU.username, password: PWD })).status).toBe(200);

    recordId = (await prisma.personnelRecord.create({ data: { createdById: adminU.id, fullName: `${TAG} Nhân sự` } })).id;
    const pay = await admin.post(`/api/personnel/${recordId}/payment`).send({ paid: true, paymentProof: ANH });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
  });

  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.$disconnect();
  });

  it("GET /api/personnel/:id/payment-proof → 200 và đẻ đúng MỘT hàng audit", async () => {
    const truoc = await prisma.auditEvent.count({ where: { action: "personnel.payment-proof.view", resourceId: String(recordId) } });
    expect(truoc).toBe(0);

    const res = await admin.get(`/api/personnel/${recordId}/payment-proof`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.paymentProof).toMatch(/^data:image\/png;base64,/);

    const rows = await prisma.auditEvent.findMany({ where: { action: "personnel.payment-proof.view", resourceId: String(recordId) } });
    expect(rows.length).toBe(1);
    expect(rows[0].actorId).toBe(adminU.id);
    expect(rows[0].resource).toBe("personnel");
    // KHÔNG được nhét ảnh vào nhật ký — bảng AuditEvent không mã hoá.
    expect(JSON.stringify(rows[0].before ?? null) + JSON.stringify(rows[0].after ?? null)).not.toContain("base64");
  });
});
