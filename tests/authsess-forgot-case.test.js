/**
 * CỤM auth-session — "QUÊN MẬT KHẨU" cũng phân biệt HOA/thường (src/services/authService.ts).
 *
 * ── LỖI ─────────────────────────────────────────────────────────────────────────────────
 * `sendPasswordReset` tra cứu bằng `findFirst({ OR: [{ email }, { username: email }] })` — so sánh
 * byte-for-byte y như đường đăng nhập, vì cột khai là String @unique thường (không citext).
 *
 * ── TÁI HIỆN ────────────────────────────────────────────────────────────────────────────
 * Tài khoản có email "An.Nguyen@Example.vn". Người dùng gõ "an.nguyen@example.vn" (bàn phím điện
 * thoại tự hạ chữ) vào ô Quên mật khẩu → không tìm thấy hàng nào → KHÔNG có token nào được cấp.
 *
 * ── HẬU QUẢ ─────────────────────────────────────────────────────────────────────────────
 * Endpoint LUÔN trả 200 để chống dò tài khoản, nên người dùng không hề biết là không có gì xảy ra:
 * họ ngồi chờ một email không bao giờ tới. Đây chính là mặt còn lại của lỗi đăng nhập hoa/thường —
 * đường tự phục hồi duy nhất cũng hỏng theo, buộc phải gọi admin.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { sendPasswordReset } from "../src/services/authService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres — test cụm auth-session không được skip trong CI");
}

const TAG = `asxFgt${Date.now()}`;
const EMAIL = `${TAG}.Hoa@Example.VN`;
// Tài khoản ĐỐI CHỨNG: dùng làm mốc đồng bộ cho ca "email không tồn tại" (xem chú thích ở đó).
const EMAIL_DC = `${TAG}.Doi@Example.VN`;

describe.runIf(dbAvailable)("quên mật khẩu — không phân biệt hoa/thường", () => {
  let userId, userDcId;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { username: `${TAG}u`, email: EMAIL, displayName: "Forgot Case", passwordHash: bcrypt.hashSync("Abc12345", 4), active: true },
    });
    userId = u.id;
    const dc = await prisma.user.create({
      data: { username: `${TAG}dc`, email: EMAIL_DC, displayName: "Forgot Control", passwordHash: bcrypt.hashSync("Abc12345", 4), active: true },
    });
    userDcId = dc.id;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({ where: { actorId: userId } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: userDcId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId }, includeDeleted: true }).catch(() => {});
    await prisma.user.delete({ where: { id: userDcId }, includeDeleted: true }).catch(() => {});
  });

  // sendPasswordReset chạy nền và tự nuốt lỗi (kể cả lỗi SMTP), nhưng nó GHI inviteTokenHash TRƯỚC
  // khi gửi mail — nên cột đó là bằng chứng đáng tin cho việc "có cấp token hay không".
  const doiCapToken = async (id = userId) => {
    for (let i = 0; i < 60; i++) {
      const u = await prisma.user.findUnique({ where: { id }, select: { inviteTokenHash: true } });
      if (u.inviteTokenHash) return u.inviteTokenHash;
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  };

  it("email gõ VIẾT THƯỜNG vẫn cấp được token đặt lại", async () => {
    await prisma.user.update({ where: { id: userId }, data: { inviteTokenHash: null, inviteExpiresAt: null } });
    sendPasswordReset({ body: { email: EMAIL.toLowerCase() }, headers: {}, ip: "127.0.0.1" });
    expect(await doiCapToken()).toBeTruthy();
  });

  it("email KHÔNG tồn tại thì vẫn không cấp gì (không mở đường dò tài khoản)", async () => {
    await prisma.user.update({ where: { id: userId }, data: { inviteTokenHash: null, inviteExpiresAt: null } });
    await prisma.user.update({ where: { id: userDcId }, data: { inviteTokenHash: null, inviteExpiresAt: null } });
    sendPasswordReset({ body: { email: `khong-ton-tai-${TAG}@example.vn` }, headers: {}, ip: "127.0.0.1" });

    // MỐC ĐỒNG BỘ, KHÔNG PHẢI `sleep(500)`. Tác vụ nền chạy sau khi route đã trả 200, nên "chờ nửa
    // giây rồi khẳng định vẫn null" là XANH VÌ LÝ DO SAI mỗi khi CI tải nặng: có thể tác vụ chưa
    // kịp chạy chứ không phải nó đã chạy và đã từ chối. Ở đây ta bắn thêm một yêu cầu cho tài khoản
    // ĐỐI CHỨNG NGAY SAU đó rồi chờ token của nó xuất hiện: đường đi của ca đối chứng là đường đi
    // của ca âm CỘNG THÊM phần ghi CSDL, và nó khởi chạy SAU — nên khi nó đã ghi xong thì ca âm
    // chắc chắn đã tra cứu xong và đã quyết định không cấp gì.
    sendPasswordReset({ body: { email: EMAIL_DC.toLowerCase() }, headers: {}, ip: "127.0.0.1" });
    expect(await doiCapToken(userDcId)).toBeTruthy();

    const u = await prisma.user.findUnique({ where: { id: userId }, select: { inviteTokenHash: true } });
    expect(u.inviteTokenHash).toBeNull();
  });

  // ── NGÕ CỤT ĐÃ VÁ (2026-09-07) ────────────────────────────────────────────────────────────
  // Trước đây `sendPasswordReset` có nhánh `if (!user || !user.active) return;`. Endpoint LUÔN trả
  // 200 (chống dò tài khoản), nên người được mời — lời mời hết hạn, chưa từng đặt mật khẩu — bấm
  // "Quên mật khẩu", thấy báo thành công, rồi ngồi chờ một email KHÔNG BAO GIỜ TỚI. Không còn
  // đường nào tự thoát, phải nhờ admin. Đo được trên production: một tài khoản kẹt đúng thế 2,5 tháng.
  it("tài khoản CHƯA KÍCH HOẠT vẫn được cấp token — không còn ngõ cụt", async () => {
    const u = await prisma.user.create({
      data: { username: `${TAG}na`, email: `${TAG}.chuakichhoat@example.vn`, displayName: "Chua Kich Hoat",
              passwordHash: bcrypt.hashSync("Abc12345", 4), active: false,
              // lời mời ĐÃ HẾT HẠN — đúng trạng thái kẹt trên production
              inviteTokenHash: null, inviteExpiresAt: new Date(Date.now() - 24 * 3600 * 1000) },
    });
    try {
      sendPasswordReset({ body: { email: `${TAG}.chuakichhoat@example.vn` }, headers: {}, ip: "127.0.0.1" });
      expect(await doiCapToken(u.id)).toBeTruthy();
      // và hạn phải được ĐẨY VỀ TƯƠNG LAI, nếu không token vừa cấp đã chết ngay lúc sinh ra.
      const sau = await prisma.user.findUnique({ where: { id: u.id }, select: { inviteExpiresAt: true } });
      expect(sau.inviteExpiresAt.getTime()).toBeGreaterThan(Date.now());
    } finally {
      await prisma.auditEvent.deleteMany({ where: { actorId: u.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: u.id }, includeDeleted: true }).catch(() => {});
    }
  });

  // ── LỖ VỪA MỞ RA BỞI CHÍNH BẢN VÁ TRÊN (2026-09-07, phát hiện qua ultracode audit cùng ngày) ──
  // Gỡ thẳng `!user.active` cho CẢ hai ca "chưa từng kích hoạt" LẪN "đã bị admin khoá" (off-
  // boarding) — hai ca đều là `active:false` như nhau. Nhân viên vừa bị khoá tài khoản (nghỉ việc,
  // vi phạm…) mà còn giữ hộp thư cá nhân sẽ tự cấp lại được token kích hoạt, accept-invite tự đặt
  // `active:true`, và họ quay lại với ĐÚNG role/permissions cũ — kể cả admin. Khoá tài khoản là
  // đường off-boarding DUY NHẤT cho ai từng làm báo giá (`deleteUser` từ chối xoá khi có báo giá).
  //
  // Phân biệt hai ca bằng `passwordChangedAt`: null = chưa từng đặt mật khẩu thật = ca cần vá ở
  // trên; có giá trị = đã từng kích hoạt ít nhất 1 lần = `active:false` bây giờ là admin CHỦ ĐỘNG
  // khoá → phải im lặng, không cấp token nào, y hệt hành vi trước 2026-09-07.
  it("tài khoản ĐÃ TỪNG kích hoạt rồi bị KHOÁ (off-boarding) — Quên mật khẩu KHÔNG cấp lại token", async () => {
    const u = await prisma.user.create({
      data: {
        username: `${TAG}lk`, email: `${TAG}.bikhoa@example.vn`, displayName: "Bi Khoa",
        passwordHash: bcrypt.hashSync("Abc12345", 4),
        active: false,                         // admin vừa khoá (PUT /api/users/:id active:false)
        passwordChangedAt: new Date(),          // ĐÃ từng đặt mật khẩu thật lúc kích hoạt — dấu hiệu phân biệt
        inviteTokenHash: null, inviteExpiresAt: null,   // updateUser xoá token cũ khi khoá (đúng hành vi thật)
      },
    });
    try {
      sendPasswordReset({ body: { email: `${TAG}.bikhoa@example.vn` }, headers: {}, ip: "127.0.0.1" });
      // Đối chứng ĐI SAU để chờ đủ thời gian tác vụ nền của ca trên chạy xong — cùng kỹ thuật mốc
      // đồng bộ đã dùng ở bài "email KHÔNG tồn tại" phía trên, không phải sleep().
      sendPasswordReset({ body: { email: EMAIL_DC.toLowerCase() }, headers: {}, ip: "127.0.0.1" });
      expect(await doiCapToken(userDcId)).toBeTruthy();

      const sau = await prisma.user.findUnique({ where: { id: u.id }, select: { inviteTokenHash: true, active: true } });
      expect(sau.inviteTokenHash, "tài khoản đã bị khoá thì Quên mật khẩu không được cấp token mới").toBeNull();
      expect(sau.active, "và chắc chắn không tự bật lại active").toBe(false);
    } finally {
      await prisma.auditEvent.deleteMany({ where: { actorId: u.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: u.id }, includeDeleted: true }).catch(() => {});
    }
  });

});