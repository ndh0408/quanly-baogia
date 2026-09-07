// NHÂN SỰ: ba đường ghi RIÊNG LẺ (markPayment/writeNoteField/markConfirm) từng trả PII đã giải mã
// cho người KHÔNG có quyền đọc hồ sơ đó — chốt hồi quy, phát hiện qua ultracode audit 2026-09-07.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `personnel:pay` / `personnel:accounting-note` / `personnel:confirm` là các Ô ĐỘC LẬP trong ma
// trận Phân quyền — không nằm trong ADMIN_ONLY_PERMISSIONS, nên admin tích được cho một tài khoản
// mà KHÔNG kèm bất kỳ ô "Xem hồ sơ" nào (personnel:read:own / personnel:read:all). Trước bản vá,
// markPayment/writeNoteField/markConfirm (src/services/personnelService.ts) không hề kiểm phạm vi
// đọc — chỉ `findFirst` theo id rồi update — và trả về `decorate(decodePiiOnRead(...))`: CCCD, số
// tài khoản, lương ĐÃ GIẢI MÃ. `PersonnelRecord.id` tăng dần đếm được → một tài khoản chỉ có
// `personnel:pay` một mình đếm 1,2,3… là moi sạch PII + lương toàn công ty qua đúng endpoint GHI.
//
// ── VÌ SAO KHÔNG CHẶN CẢ LẦN GHI (không kỳ vọng 403) ─────────────────────────
// `personnel.routes.ts` ghi rõ personnel:pay "KHÔNG owner-scope → kế toán đánh dấu MỌI hồ sơ" — đó
// là thiết kế CÓ CHỦ Ý (mọi vai trò MẶC ĐỊNH — accountant/hr/admin — đều bundle sẵn
// personnel:read:all cùng các ô này nên hành vi hiện tại của họ không đổi). Cái lộ nằm ở PHẢN HỒI,
// nên bài dưới đây khẳng định: (a) THAO TÁC GHI vẫn chạy — 200, dữ liệu vẫn được cập nhật đúng;
// (b) PHẢN HỒI không còn cõng theo CCCD/số tài khoản/lương khi caller không đọc được hồ sơ đó.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "PersonnelRecord" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres/schema PersonnelRecord");
}

const TAG = `rbacpn${Date.now()}`;
const PWD = "Test1234!a";
const CCCD = "079888777666";
const STK = "0099887766554";
const LUONG = 25_000_000;

describe.runIf(dbAvailable)("nhân sự: đường ghi riêng lẻ (pay/note/confirm) không rò PII khi không có phạm vi đọc", () => {
  let app, adminU, chiPayU, chiConfirmU, chiNoteU;
  let admin, chiPay, chiConfirm, chiNote;
  let recId;

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const hash = await bcrypt.hash(PWD, 4);

    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: hash } });
    // Ba tài khoản CHỈ có ĐÚNG MỘT ô độc lập — KHÔNG kèm personnel:read:own/all nào. Đúng kịch bản
    // "giám đốc tích đúng một ô" nêu trong phát hiện — chỉ đạt được qua tập quyền per-user tuỳ chỉnh.
    chiPayU = await prisma.user.create({ data: { username: `${TAG}-pay`, displayName: `${TAG} pay`, role: "manager", passwordHash: hash, permissions: [P.PERSONNEL_MARK_PAYMENT] } });
    chiConfirmU = await prisma.user.create({ data: { username: `${TAG}-cf`, displayName: `${TAG} cf`, role: "manager", passwordHash: hash, permissions: [P.PERSONNEL_CONFIRM] } });
    chiNoteU = await prisma.user.create({ data: { username: `${TAG}-note`, displayName: `${TAG} note`, role: "manager", passwordHash: hash, permissions: [P.PERSONNEL_ACCOUNTING_NOTE] } });

    // Hồ sơ do ADMIN tạo (không phải chi*U) — ba tài khoản trên chắc chắn KHÔNG owner-match.
    const rec = await prisma.personnelRecord.create({
      data: { createdById: adminU.id, fullName: `${TAG} Nạn nhân`, idCard: CCCD, bankAccount: STK, salary: LUONG, projectCode: "PRJ-X" },
    });
    recId = rec.id;

    admin = await dangNhap(adminU);
    chiPay = await dangNhap(chiPayU);
    chiConfirm = await dangNhap(chiConfirmU);
    chiNote = await dangNhap(chiNoteU);
  });

  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [adminU?.id, chiPayU?.id, chiConfirmU?.id, chiNoteU?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("chỉ có personnel:pay → đánh dấu THÀNH CÔNG (thiết kế cố ý) nhưng phản hồi KHÔNG lộ CCCD/STK/lương", async () => {
    const r = await chiPay.post(`/api/personnel/${recId}/payment`).send({ paid: true });
    expect(r.status, "kế toán chỉ-pay vẫn phải đánh dấu được MỌI hồ sơ — đây không phải chỗ chặn").toBe(200);
    expect(r.body.payment, "trường giao dịch (không nhạy cảm) vẫn phải có để UI dùng được").toBe("Đã thanh toán");
    expect(r.body.paidAt).toBeTruthy();

    const s = JSON.stringify(r.body);
    expect(s, "trước khi vá: lộ CCCD của hồ sơ không đọc được").not.toContain(CCCD);
    expect(s, "trước khi vá: lộ số tài khoản của hồ sơ không đọc được").not.toContain(STK);
    expect(s, "trước khi vá: lộ lương của hồ sơ không đọc được").not.toContain(String(LUONG));
    expect(s, "không lộ luôn cả họ tên").not.toContain("Nạn nhân");

    // Và bản ghi CSDL THẬT SỰ đã đổi — thao tác ghi không bị cắt xén, chỉ phản hồi bị cắt.
    const that = await prisma.personnelRecord.findUnique({ where: { id: recId }, select: { paidAt: true, paidById: true } });
    expect(that.paidAt).toBeTruthy();
    expect(that.paidById).toBe(chiPayU.id);
  });

  it("chỉ có personnel:confirm → xác nhận THÀNH CÔNG nhưng phản hồi KHÔNG lộ PII", async () => {
    const r = await chiConfirm.post(`/api/personnel/${recId}/confirm`).send({ confirmed: true });
    expect(r.status).toBe(200);
    expect(r.body.confirmed).toBe("Đã ký");
    expect(r.body.confirmedAt).toBeTruthy();

    const s = JSON.stringify(r.body);
    expect(s).not.toContain(CCCD);
    expect(s).not.toContain(STK);
    expect(s).not.toContain(String(LUONG));
  });

  it("chỉ có personnel:accounting-note → ghi chú THÀNH CÔNG nhưng phản hồi KHÔNG lộ PII", async () => {
    const r = await chiNote.post(`/api/personnel/${recId}/accounting-note`).send({ value: "đã đối chiếu công nợ" });
    expect(r.status).toBe(200);
    expect(r.body.accountingNote).toBe("đã đối chiếu công nợ");

    const s = JSON.stringify(r.body);
    expect(s).not.toContain(CCCD);
    expect(s).not.toContain(STK);
    expect(s).not.toContain(String(LUONG));

    const that = await prisma.personnelRecord.findUnique({ where: { id: recId }, select: { accountingNote: true } });
    expect(that.accountingNote).toBe("đã đối chiếu công nợ");
  });

  it("ĐỐI CHỨNG — admin (có personnel:read:all) vẫn nhận bản ghi ĐẦY ĐỦ như cũ, không bị ảnh hưởng", async () => {
    const r = await admin.post(`/api/personnel/${recId}/payment`).send({ paid: false });
    expect(r.status).toBe(200);
    expect(r.body.idCard, "admin có quyền đọc — không được vô tình bị vạ lây bởi bản vá này").toBe(CCCD);
    expect(r.body.bankAccount).toBe(STK);
  });
});
