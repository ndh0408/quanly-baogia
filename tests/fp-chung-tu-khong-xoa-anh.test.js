// FILE-01 / FILE-02 / FILE-03 — ảnh chứng từ thanh toán KHÔNG được mất vì một thao tác trên hồ sơ.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `markPayment` (src/services/personnelService.ts) gọi `removeProof(before.paymentProofKey)` —
// DeleteObject vĩnh viễn — ở ba nhánh: thay ảnh, gửi chuỗi rỗng, và "Bỏ đánh dấu". Kho object là
// bản DUY NHẤT của ảnh (cột base64 bị null khi ghi mới; MinIO một ổ không có versioning), nên:
//   · FILE-01: một cú bấm "Bỏ đánh dấu" là mất vĩnh viễn chứng từ uỷ nhiệm chi;
//   · FILE-03: lệnh xoá chạy TRƯỚC `prisma.update` — update hỏng thì hàng vẫn trỏ khoá cũ đã bị
//     xoá, còn ảnh mới thành mồ côi;
//   · FILE-02: audit ghi `hasProof: !!before.paymentProof` (cột base64 CŨ) → với mọi ảnh ở kho
//     object nhật ký khẳng định "trước đó không có ảnh", đúng lúc vừa huỷ một ảnh.
// Thêm: DELETE /api/files xoá thẳng `payment-proofs/...` mà hàng CSDL vẫn trỏ vào.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { headObject, listObjects } from "../src/storage.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
const storageAvailable = !!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY);
if (!storageAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng chưa cấu hình kho object");

const TAG = `fpkx${Date.now()}`;
const PWD = "Test1234!a";
// Hai PNG 1×1 khác nhau (khác byte cuối IDAT) — đủ để sha256/khoá khác nhau.
const ANH_A = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const ANH_B = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

describe.runIf(dbAvailable && storageAvailable)("chứng từ thanh toán không bị xoá theo thao tác hồ sơ", () => {
  let app, adminU, admin;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: adminU.username, password: PWD })).status).toBe(200);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: adminU?.id } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.$disconnect();
  });

  const taoHoSo = async () => (await prisma.personnelRecord.create({ data: { createdById: adminU.id, fullName: `${TAG} NS` } })).id;
  const khoaHienTai = async (id) => (await prisma.personnelRecord.findFirst({ where: { id }, select: { paymentProofKey: true } })).paymentProofKey;

  it("THAY ảnh: object cũ vẫn còn trong kho; hàng trỏ ảnh mới", async () => {
    const id = await taoHoSo();
    expect((await admin.post(`/api/personnel/${id}/payment`).send({ paid: true, paymentProof: ANH_A })).status).toBe(200);
    const khoaA = await khoaHienTai(id);
    expect(khoaA).toMatch(/^payment-proofs\//);
    expect((await admin.post(`/api/personnel/${id}/payment`).send({ paid: true, paymentProof: ANH_B })).status).toBe(200);
    const khoaB = await khoaHienTai(id);
    expect(khoaB).not.toBe(khoaA);
    expect(await headObject(khoaA), "ảnh cũ bị DeleteObject vĩnh viễn khi thay ảnh").not.toBeNull();
    expect(await headObject(khoaB)).not.toBeNull();
  });

  it("BỎ ĐÁNH DẤU: object vẫn còn; audit ghi hasProof=true + khoá object để truy lại", async () => {
    const id = await taoHoSo();
    expect((await admin.post(`/api/personnel/${id}/payment`).send({ paid: true, paymentProof: ANH_A })).status).toBe(200);
    const khoa = await khoaHienTai(id);
    const res = await admin.post(`/api/personnel/${id}/payment`).send({ paid: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await khoaHienTai(id)).toBeNull();
    expect(await headObject(khoa), "Bỏ đánh dấu đã xoá vĩnh viễn ảnh chứng từ").not.toBeNull();

    const ev = await prisma.auditEvent.findFirst({ where: { action: "personnel.unpay", resourceId: String(id) }, orderBy: { id: "desc" } });
    expect(ev.before.hasProof, "audit nói 'trước đó không có ảnh' dù ảnh nằm ở kho object").toBe(true);
    expect(ev.before.proofKey).toBe(khoa);
    expect(ev.before.proofSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ev.before) + JSON.stringify(ev.after)).not.toContain("base64");
  });

  it("CSDL từ chối lượt ghi: ảnh CŨ còn nguyên, hàng vẫn trỏ nó, ảnh MỚI vừa PUT bị dọn", async () => {
    const id = await taoHoSo();
    expect((await admin.post(`/api/personnel/${id}/payment`).send({ paid: true, paymentProof: ANH_A })).status).toBe(200);
    const khoaA = await khoaHienTai(id);
    const truoc = (await listObjects(`payment-proofs/p${id}/`)).map((o) => o.key).sort();

    vi.spyOn(prisma.personnelRecord, "update").mockImplementationOnce(async () => { throw new Error("giả lập statement_timeout"); });
    const res = await admin.post(`/api/personnel/${id}/payment`).send({ paid: true, paymentProof: ANH_B });
    expect(res.status).toBeGreaterThanOrEqual(500);
    vi.restoreAllMocks();

    expect(await khoaHienTai(id)).toBe(khoaA);
    expect(await headObject(khoaA), "ảnh cũ bị xoá TRƯỚC khi CSDL ghi — hàng trỏ vào hư không").not.toBeNull();
    const sau = (await listObjects(`payment-proofs/p${id}/`)).map((o) => o.key).sort();
    expect(sau, "ảnh mới mồ côi khi CSDL không nhận").toEqual(truoc);
  });

  it("DELETE /api/files không được xoá chứng từ thanh toán → 403, object còn nguyên", async () => {
    const id = await taoHoSo();
    expect((await admin.post(`/api/personnel/${id}/payment`).send({ paid: true, paymentProof: ANH_A })).status).toBe(200);
    const khoa = await khoaHienTai(id);
    const res = await admin.delete(`/api/files?key=${encodeURIComponent(khoa)}`);
    expect(res.status).toBe(403);
    expect(await headObject(khoa)).not.toBeNull();
  });
});
