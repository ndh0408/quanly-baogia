// Tầng SERVICE cho domain Xác thực (auth) — bê NGUYÊN logic từ auth.routes.ts (giữ hành vi y hệt):
// hồ sơ cá nhân, đổi mật khẩu, quên mật khẩu, lời mời (invite) + thiết lập session sau đăng nhập.
// Phần kiểm credentials/lockout/MFA đã ở authCore.ts, token JWT ở jwt.ts — service này KHÔNG lặp lại,
// route gọi thẳng 2 module đó cho các endpoint /login /token* (chúng chính là tầng service của auth).
import type { Request } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { audit } from "../audit.js";
import { logger } from "../logger.js";
import { httpError, loiXacNhanSai } from "../httpError.js";
import { revokeAllForUser } from "../jwt.js";
import { findLoginUser, verifyMfaChallenge } from "../authCore.js";
import { destroyAllSessions } from "../sessions.js";
import { permissionsForUser, resolveUserPermissions } from "../permissions.js";
import { sendEmail, brandedEmailHtml, mienNguoiNhan } from "../email.js";

type SessionSeed = { id: number; username: string; role: string; displayName: string; permissions?: string[]; canSign?: boolean };

/**
 * Request này có PHIÊN THẬT của express-session (xoay/lưu được) không?
 *
 * KHÔNG, khi JWT_API_ENABLED bật và request mang Bearer mà không kèm cookie `qly.sid`: cổng phiên ở
 * src/app.ts bỏ qua middleware phiên, nên `req.session` hoặc vắng mặt hoặc chỉ là object trần do
 * `bearerAuth` dựng — không có `regenerate`/`save`. Mọi đường CẤP PHIÊN phải hỏi câu này TRƯỚC khi
 * ghi CSDL (soát chéo auth#7): hỏi muộn là đã đổi mật khẩu / tiêu token mời rồi mới báo lỗi.
 */
export function coPhienThat(req: Request): boolean {
  return !!req.session && typeof req.session.regenerate === "function";
}

// Thiết lập session sau xác thực thành công: regenerate (chống session fixation) → gán → save.
// Dùng chung cho /login, /change-password và /accept-invite.
export async function establishSession(req: Request, user: SessionSeed) {
  // Lưới cuối (soát chéo auth#7): không có phiên thật thì `req.session.regenerate(...)` là TypeError
  // → 500 "Lỗi server". Ném 400 có mã để client biết mình đi nhầm đường. Đây KHÔNG thay được việc
  // kiểm sớm — tới được đây thì nơi gọi thường đã ghi CSDL xong (xem coPhienThat).
  if (!coPhienThat(req)) {
    throw Object.assign(httpError(400, "Client dùng Bearer phải xác thực bằng POST /api/auth/token — đường này cấp phiên cookie"), { code: "dung_auth_token" });
  }
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((err: unknown) => (err ? reject(err) : resolve()))
  );
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.displayName = user.displayName;
  req.session.username = user.username;
  req.session.permissions = resolveUserPermissions(user.role, user.permissions, user.canSign);
  // Mốc thiết lập phiên — middleware so với User.passwordChangedAt để giết phiên cũ sau khi
  // đổi mật khẩu, độc lập với việc kho phiên có xoá được hàng hay không.
  req.session.authAt = Date.now();
  await new Promise<void>((resolve, reject) =>
    req.session.save((err: unknown) => (err ? reject(err) : resolve()))
  );
}

/* ── MỘT NGUỒN DUY NHẤT CHO HÌNH DẠNG `me` ───────────────────────────────────────────────────
   SPA lấy THẲNG phản hồi của đường cấp phiên làm state `me` (App.tsx: `onLogin(m)` → `setMe(m)`)
   và chỉ gọi lại `/auth/me` khi có sự kiện SSE "session:refresh". Nên mọi đường cấp phiên PHẢI
   trả cùng một bộ trường — thiếu một trường ở một đường là làm màn hình nói sai suốt cả phiên.

   ĐÃ HỎNG THẬT HAI LẦN vì hai đường tự khai select riêng:
     · `acceptInvite` thiếu `phone` + `title` → sau khi đặt lại mật khẩu, trang Hồ sơ hiện hai ô
       RỖNG dù CSDL đang có số, và lần Lưu kế tiếp XOÁ chúng (đã vá).
     · `/login` thiếu `email` + `mfaEnabled` → Profile.tsx đọc `me.mfaEnabled` nên báo "Chưa bật"
       cho người ĐANG BẬT MFA, kèm nút "Bật bảo mật 2 lớp". Người ta bị nói rằng tài khoản mình
       không được bảo vệ, và bấm vào là đi đăng ký lại từ đầu.

   Nên hình dạng nay khai MỘT chỗ. Bài kiểm khoá QUAN HỆ: mọi đường cấp phiên phải trả đủ bộ
   khoá của `/auth/me` — xem tests/hs-cap-phien-tra-du-truong.test.js. */
export const HO_SO_PHIEN_SELECT = {
  id: true, username: true, email: true, displayName: true, role: true,
  phone: true, title: true, senderName: true,
  canSign: true, mfaEnabled: true, lastLoginAt: true, permissions: true,
} as const;

/** Dựng object `me` từ một hàng User đã select theo `HO_SO_PHIEN_SELECT`. */
export function hoSoPhien(user: { role: string; permissions?: string[]; canSign?: boolean }) {
  return { ...user, permissions: permissionsForUser(user.role, user.permissions, user.canSign) };
}

/** Đọc `me` theo id. Route KHÔNG được tự truy vấn Prisma (cổng check-architecture gác ranh giới
 *  tầng), nên đường `/login` gọi hàm này thay vì tự khai select. */
export async function hoSoPhienTheoId(id: number) {
  const user = await prisma.user.findUnique({ where: { id }, select: HO_SO_PHIEN_SELECT });
  if (!user) throw httpError(404, "Không tìm thấy tài khoản");
  return hoSoPhien(user);
}

export async function meProfile(req: Request) {
  const user = await prisma.user.findUnique({ where: { id: req.session.userId }, select: HO_SO_PHIEN_SELECT });
  if (!user) throw httpError(404, "Không tìm thấy tài khoản");
  // Ship the authoritative capability list so the SPA gates UI from the server catalog.
  return hoSoPhien(user);
}

export async function updateProfile(req: Request) {
  const user = await prisma.user.update({
    where: { id: req.session.userId },
    // BA trường cùng MỘT luật: khoá có mặt thì ghi (ProfileUpdateSchema đã biến "" thành `null`),
    // khoá vắng mặt thì KHÔNG đụng tới cột.
    //
    // Bản trước viết `phone: req.body.phone || null` — tức client nào KHÔNG gửi `phone` là bị XOÁ
    // số điện thoại, trong khi không gửi `title`/`senderName` thì không đổi. Một route, hai luật
    // ngược nhau cho ba ô nằm cạnh nhau. Chưa nổ chỉ vì web/src/lib/api.ts ép gửi đủ bốn chuỗi —
    // một client di động, một script, hay một PATCH tương lai gửi thiếu là mất dữ liệu.
    data: {
      displayName: req.body.displayName,
      ...(req.body.phone !== undefined ? { phone: req.body.phone } : {}),
      ...(req.body.title !== undefined ? { title: req.body.title } : {}),
      ...(req.body.senderName !== undefined ? { senderName: req.body.senderName } : {}),
    },
    // `senderName` phải có trong select: Profile.tsx làm `onMe({ ...me, ...u })`, thiếu trường thì
    // state client giữ lại giá trị CŨ và người vừa lưu tưởng là không ăn.
    select: { id: true, username: true, email: true, displayName: true, role: true, phone: true, title: true, senderName: true, mfaEnabled: true, permissions: true, canSign: true },
  });
  req.session.displayName = user.displayName;
  await audit(req, "user.profile.update", { resource: "user", resourceId: user.id, actorId: user.id });
  return { ...user, permissions: permissionsForUser(user.role, user.permissions, user.canSign) };
}

export async function changePassword(req: Request) {
  const { oldPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!user) throw httpError(404, "Không tìm thấy tài khoản");
  const ok = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!ok) {
    await audit(req, "password.change.failed", { resource: "user", resourceId: user.id, actorId: user.id });
    throw loiXacNhanSai("Mật khẩu cũ không đúng");
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    // Đốt luôn token mời/đặt-lại đang sống (AUTH-06): đổi mật khẩu là lúc người dùng nói "tôi nghi bị
    // lộ" — một liên kết đặt lại còn hạn trong hộp thư (có thể chính kẻ kia vừa bấm "Quên mật khẩu")
    // không được sống sót qua đó. Tài khoản đang đổi mật khẩu thì đã kích hoạt, không có lời mời nào để mất.
    data: { passwordHash: await bcrypt.hash(newPassword, config.BCRYPT_COST), passwordChangedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
  });
  // Thu hồi mọi refresh token — chúng sống độc lập với cookie nên không tự chết theo phiên.
  await revokeAllForUser(user.id);

  // CLIENT BEARER (không cookie) — soát chéo auth#7. Không có phiên nào để xoay: bản trước vẫn gọi
  // establishSession, ném TypeError → 500 SAU KHI mật khẩu đã đổi và refresh token đã bị thu hồi.
  // Client tin là đổi thất bại, rồi thử lại bằng mật khẩu cũ. Đổi mật khẩu là tính năng hợp lệ của
  // client di động nên không chặn: trả `reauth: true` — access token đang cầm đã chết theo
  // passwordChangedAt (bearerAuth so iat), client lấy cặp mới qua POST /api/auth/token.
  // Không có sid "của mình" để giữ, nên dọn MỌI phiên cookie của tài khoản.
  if (!coPhienThat(req)) {
    await destroyAllSessions(user.id);
    await audit(req, "password.change.success", { resource: "user", resourceId: user.id, actorId: user.id });
    return { ok: true, reauth: true };
  }

  // XOAY ĐỊNH DANH PHIÊN của chính người vừa đổi mật khẩu.
  //
  // Trước đây phiên gọi lệnh GIỮ NGUYÊN session ID cũ. Đổi mật khẩu là lúc người dùng tuyên bố
  // "thông tin xác thực cũ không còn đáng tin" — thường vì họ NGHI BỊ LỘ. Nếu chính chuỗi session ID
  // đã lộ từ trước (rò qua log, qua Referer, qua một lỗ XSS đã vá), giữ lại nó nghĩa là kẻ tấn công
  // vẫn còn đường vào sau khi nạn nhân vừa làm đúng việc cần làm. `regenerate()` huỷ hàng phiên cũ
  // trong kho và cấp định danh mới, nên chuỗi cũ chết ngay.
  //
  // THỨ TỰ QUAN TRỌNG: xoay TRƯỚC rồi mới dọn các phiên khác, và giữ lại đúng định danh MỚI. Làm
  // ngược lại sẽ giữ nhầm sid cũ (sắp bị huỷ) và phiên mới lại lọt vào diện bị xoá → người dùng bị
  // đá ra ngay khi vừa đổi mật khẩu thành công.
  await establishSession(req, updated as SessionSeed);
  await destroyAllSessions(user.id, req.sessionID);

  await audit(req, "password.change.success", { resource: "user", resourceId: user.id, actorId: user.id });
  return { ok: true };
}

// === Email-invite onboarding ===
const hashInvite = (t: string) => createHash("sha256").update(String(t)).digest("hex");

async function findInvitee(token: string) {
  if (!token) return null;
  // Same token mechanism powers both new-user invites and password resets.
  const user = await prisma.user.findFirst({ where: { inviteTokenHash: hashInvite(token) } });
  if (!user) return null;
  if (user.inviteExpiresAt && user.inviteExpiresAt < new Date()) return null;
  return user;
}

/**
 * Quên mật khẩu — chạy NỀN sau khi route đã trả 200 (chống timing-oracle dò tài khoản:
 * status lẫn thời gian phản hồi giống hệt nhau dù email có tồn tại hay không).
 * Route gọi hàm này SAU res.json({ok:true}); lỗi được nuốt + log, không nổi lên response.
 */
export function sendPasswordReset(req: Request) {
  const email = (req.body.email as string).trim();
  (async () => {
    // Dùng CHUNG hàm tra cứu của đường đăng nhập: nếu chỗ này còn so byte-for-byte thì người gõ
    // email viết thường (bàn phím điện thoại tự hạ chữ) sẽ không được cấp token nào — mà endpoint
    // luôn trả 200 để chống dò tài khoản, nên họ ngồi chờ một email không bao giờ tới. Đường tự
    // phục hồi duy nhất hỏng theo đúng cách khó nhận ra nhất.
    const user = await findLoginUser(email);
    if (!user) return;
    // TÀI KHOẢN KHÔNG CÓ EMAIL THÌ KHÔNG CÓ ĐÍCH GỬI HỢP LỆ (AUTH-05). findLoginUser OR cả cột
    // `username`, và bản trước gửi tới `user.email || email` — tức tới ĐỊA CHỈ DO NGƯỜI GỌI GÕ. Tài
    // khoản mời có username = email cũ, nên tài khoản bị xoá email (GDPR, hay trước khi updateUser
    // chặn xoá trắng) vẫn nhận thư đặt lại ở HỘP THƯ CŨ — đúng hộp thư mà admin muốn cắt.
    if (!user.email) {
      logger.warn({ userId: user.id }, "quên mật khẩu: tài khoản không có email — bỏ");
      return;
    }
    // TÀI KHOẢN CHƯA KÍCH HOẠT VẪN ĐƯỢC CẤP LIÊN KẾT — NHƯNG TÀI KHOẢN ĐÃ BỊ KHOÁ THÌ KHÔNG.
    //
    // Trước 2026-09-07 nhánh này là `if (!user || !user.active) return;`. Mà endpoint LUÔN trả 200
    // (chống dò tài khoản), nên người được mời — lời mời đã hết hạn, chưa từng đặt mật khẩu — bấm
    // "Quên mật khẩu", thấy báo thành công, rồi ngồi chờ một email KHÔNG BAO GIỜ TỚI. Không còn
    // đường nào tự thoát: đăng nhập thì nhận 401 chung chung, quên mật khẩu thì im lặng; phải nhờ
    // admin bấm "Gửi lại lời mời". Đo được trên production: minhhuy.gianguyen@gmail.com kẹt đúng
    // như vậy từ 22/06.
    //
    // GỠ THẲNG `!user.active` (bản vá 2026-09-07, commit 37f6d0c) THÌ MỞ LẠI MỘT LỖ KHÁC, NẶNG HƠN:
    // "chưa từng kích hoạt" và "ĐÃ bị admin khoá" đều là `active: false` như nhau — không phân biệt
    // được thì nhân viên vừa bị khoá tài khoản (nghỉ việc, vi phạm…) tự bấm "Quên mật khẩu" trên
    // chính hộp thư cá nhân của họ (đăng ký bằng gmail riêng, công ty không thu hồi được) là lấy
    // được token kích hoạt MỚI → accept-invite tự đặt lại `active: true` (xem hàm bên dưới) và cấp
    // phiên đầy đủ với ĐÚNG role/permissions CŨ — kể cả admin. Vòng khoá tài khoản ở updateUser trở
    // thành vô nghĩa. Nghiêm trọng hơn vì `deleteUser` từ chối xoá tài khoản đã gắn báo giá ("Hãy
    // khóa tài khoản thay vì xóa") — khoá là đường off-boarding DUY NHẤT cho ai từng làm báo giá.
    //
    // PHÂN BIỆT BẰNG `passwordChangedAt` — cột này CHỈ được set (authService.ts đường đổi mật khẩu,
    // acceptInvite, và updateUser khi admin gõ mật khẩu mới), KHÔNG NƠI NÀO xoá về null. Vậy:
    //   - null            → chưa từng đặt mật khẩu thật → CHƯA TỪNG KÍCH HOẠT → cấp token (ca cần vá).
    //   - có giá trị      → đã từng đặt mật khẩu thật ít nhất 1 lần → nếu giờ `active:false` thì đó
    //                       là admin CHỦ ĐỘNG khoá (off-boarding), không phải lời mời kẹt → im lặng,
    //                       y hệt hành vi trước 2026-09-07.
    // Không cần migration: tín hiệu có sẵn, không nhầm chiều, và giữ nguyên ca đã vá (tài khoản mời
    // — kể cả acceptInvite dở dang do đổi ý — luôn có `passwordChangedAt: null` cho tới khi kích hoạt).
    //
    // AUTH-01 (audit 2026-09-23): `passwordChangedAt` MỘT MÌNH KHÔNG ĐỦ. Cột này NULL ở cả những tài
    // khoản ĐÃ dùng hệ thống thật: mọi hàng có từ trước migration 20260811160000 (cố ý để NULL) mà
    // chưa đổi mật khẩu, tài khoản tạo bằng `createUser` trước bản vá cùng ngày, admin seed. Khoá một
    // người thuộc nhóm đó rồi họ bấm "Quên mật khẩu" là họ tự mở lại được — đúng lỗ vừa kể ở trên.
    // Nên ghép hai tín hiệu:
    //   · ĐÃ TỪNG KÍCH HOẠT = passwordChangedAt HOẶC lastLoginAt (lastLoginAt chỉ được ghi ở nhánh
    //     đăng nhập THÀNH CÔNG, authCore.ts — người được mời chưa kích hoạt không thể có nó);
    //   · ĐANG CHỜ LỜI MỜI = còn inviteTokenHash hoặc inviteExpiresAt. Lệnh khoá ở updateUser LUÔN
    //     đốt cả hai, và không job nào dọn lời mời hết hạn, nên tài khoản khoá mà hai cột đều trống
    //     là tài khoản bị admin khoá — kể cả khi người đó chưa đăng nhập lần nào (tạo tay rồi khoá,
    //     hoặc GDPR đã đưa lastLoginAt về null).
    // Chỉ ca "khoá + chưa từng kích hoạt + đang chờ lời mời" mới được cấp token — đúng ca ngõ cụt đã vá.
    const daTungKichHoat = !!(user.passwordChangedAt || user.lastLoginAt);
    const dangChoMoi = !!(user.inviteTokenHash || user.inviteExpiresAt);
    if (!user.active && (daTungKichHoat || !dangChoMoi)) return;
    const chuaKichHoat = !user.active;
    const token = randomBytes(24).toString("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: { inviteTokenHash: hashInvite(token), inviteExpiresAt: new Date(Date.now() + 2 * 3600 * 1000) },
    });
    // Link base comes from configuration only — Origin/Host headers are
    // client-controlled and would allow reset-link poisoning (ATO).
    const url = `${config.APP_BASE_URL}/#/onboard?token=${token}`;
    const nhan = chuaKichHoat
      ? { subject: "Kích hoạt tài khoản – Báo Giá Gia Nguyễn", nut: "Kích hoạt tài khoản",
          html: "Tài khoản của bạn <b>chưa được kích hoạt</b>. Nhấn nút bên dưới để đặt mật khẩu và bắt đầu dùng hệ thống Quản lý Báo Giá – Gia Nguyễn.",
          text: "Tài khoản của bạn chưa được kích hoạt. Mở liên kết bên dưới để đặt mật khẩu và bắt đầu dùng hệ thống Quản lý Báo Giá – Gia Nguyễn" }
      : { subject: "Đặt lại mật khẩu – Báo Giá Gia Nguyễn", nut: "Đặt lại mật khẩu",
          html: "Bạn vừa yêu cầu <b>đặt lại mật khẩu</b> cho hệ thống Quản lý Báo Giá – Gia Nguyễn. Nhấn nút bên dưới để tạo mật khẩu mới.",
          text: "Bạn vừa yêu cầu đặt lại mật khẩu cho hệ thống Quản lý Báo Giá – Gia Nguyễn. Mở liên kết bên dưới để tạo mật khẩu mới" };
    const gui = await sendEmail({
      to: user.email,
      subject: nhan.subject,
      text: `Chào ${user.displayName || ""},\n\n${nhan.text} (hết hạn sau 2 giờ):\n${url}\n\nNếu không phải bạn yêu cầu, hãy bỏ qua email này.`,
      html: brandedEmailHtml({
        name: user.displayName,
        paragraphs: [
          { html: nhan.html },
          "Nếu không phải bạn yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn an toàn.",
        ],
        button: { label: nhan.nut, url },
        note: { html: "⏳ Liên kết hết hạn sau <b>2 giờ</b>." },
      } as any),
    } as any);
    // KHÔNG ĐƯỢC VỨT KẾT QUẢ GỬI. Response đã trả 200 từ trước (chống dò tài khoản), nên đây là
    // NƠI DUY NHẤT còn biết thư có đi hay không. Không ghi lại thì khi người dùng bảo "tôi không
    // nhận được thư" sẽ không có gì để tra — đúng cảnh vừa xảy ra với thư mời trên production.
    const loiGui = (gui as { error?: string } | null)?.error;
    const boQua = (gui as { skipped?: boolean } | null)?.skipped;
    // Chỉ tên miền người nhận: email là PII, log có vòng đời khác CSDL (audit 2026-09-22, OBS-16).
    if (loiGui) logger.error({ err: loiGui, toDomain: mienNguoiNhan(user.email), chuaKichHoat }, "gửi thư đặt lại mật khẩu THẤT BẠI");
    else if (boQua) logger.warn({ toDomain: mienNguoiNhan(user.email) }, "chưa cấu hình SMTP — thư đặt lại mật khẩu bị bỏ");
    await audit(req, "password.forgot", {
      resource: "user", resourceId: user.id,
      after: { chuaKichHoat, emailSent: !loiGui && !boQua, emailError: loiGui ?? null },
    });
  })().catch((e) => logger.error({ err: e.message }, "forgot-password background task failed"));
}

// Validate an invite link and return prefill info for the onboarding form.
export async function inviteInfo(req: Request) {
  const user = await findInvitee(req.params.token);
  if (!user) throw httpError(404, "Lời mời không hợp lệ hoặc đã hết hạn");
  // `datLaiMatKhau` — MÀN NÀY KIÊM HAI VIỆC, và hai việc đó cần hai cái form khác nhau:
  //   · tài khoản CHƯA kích hoạt (active=false) → nhận lời mời LẦN ĐẦU: hỏi họ tên / SĐT / chức
  //     danh / tên người gửi là đúng, vì hồ sơ đang trống và đây là lúc duy nhất tiện hỏi;
  //   · tài khoản ĐÃ kích hoạt → đây là "Quên mật khẩu": người ta chỉ muốn đổi mật khẩu. Bắt gõ
  //     lại SĐT/chức danh ở đây vừa vô lý vừa nguy hiểm — bỏ trống một ô là mất dữ liệu đang có
  //     (chính lỗi đã xoá trắng hồ sơ 5/10 tài khoản trên production).
  // Trả cờ ra để SPA dựng đúng form. KHÔNG lộ thêm gì: người gọi được endpoint này đã cầm sẵn một
  // token dùng-một-lần còn hạn của chính tài khoản đó.
  return { email: user.email, displayName: user.displayName, role: user.role, datLaiMatKhau: user.active === true };
}

// Accept an invite: set own password + phone, activate, then log in.
export async function acceptInvite(req: Request) {
  const { token, displayName, phone, title, senderName, password, mfaToken } = req.body;
  const user = await findInvitee(token);
  if (!user) throw httpError(404, "Lời mời không hợp lệ hoặc đã hết hạn");
  // CHỐT LỚP HAI (AUTH-01): tài khoản đang KHOÁ mà đã từng kích hoạt thì không token nào được mở
  // lại nó — kể cả token còn hạn phát ra theo lỗ cũ của sendPasswordReset trước bản vá. Trả CÙNG
  // câu 404 như token sai để không lộ trạng thái khoá. Đặt TRƯỚC cổng MFA: không cho người bị khoá
  // dùng đường này làm máy thử mã TOTP.
  if (!user.active && (user.passwordChangedAt || user.lastLoginAt)) throw httpError(404, "Lời mời không hợp lệ hoặc đã hết hạn");

  // CỔNG MFA cho đường ĐẶT LẠI MẬT KHẨU.
  //
  // Endpoint này kiêm luôn "Quên mật khẩu", tức nó là một đường CẤP PHIÊN ĐẦY ĐỦ mà đầu vào duy
  // nhất là một token trong hộp thư. Cổng MFA duy nhất của hệ thống nằm trong
  // authenticateCredentials, và hàm đó chỉ được gọi từ /login và /token — nên trước bản vá này,
  // ai chiếm được hộp thư nạn nhân là vô hiệu hoá được lớp bảo vệ thứ hai mà nạn nhân đã CHỦ ĐỘNG
  // bật, trong khi mfaEnabled vẫn báo "đã bật 2FA" ở /me nên không có dấu hiệu gì để nghi ngờ.
  //
  // ĐẶT TRƯỚC prisma.user.update một cách CÓ CHỦ Ý: mã sai không được phép kịp xoay mật khẩu, nếu
  // không thì kẻ tấn công tuy không vào được vẫn khoá được nạn nhân ra khỏi chính tài khoản họ.
  if (user.mfaEnabled) {
    if (!mfaToken) throw Object.assign(httpError(401, "Cần mã MFA"), { mfaRequired: true });

    // ĐẾM MÃ SAI VÀO ĐÚNG BỘ ĐẾM KHOÁ CỦA ĐƯỜNG ĐĂNG NHẬP.
    //
    // Không có bước này thì cổng MFA ở đây là cổng DUY NHẤT của hệ thống không có trần thử: mã sai
    // ném lỗi TRƯỚC prisma.user.update nên token mời/đặt-lại KHÔNG bị tiêu thụ, tức cùng một token
    // thử lại được không giới hạn suốt vòng đời của nó (2 giờ với "quên mật khẩu", 7 ngày với lời
    // mời). Kẻ đã chiếm hộp thư nạn nhân — đúng mô hình đe doạ mà cổng này sinh ra để chặn — bắn
    // 120 request/phút (trần apiLimiter) với mã 6 số ngẫu nhiên là có xác suất thật sự đáng kể, và
    // nạn nhân không hề bị khoá nên không có tín hiệu nào để nhận ra.
    //
    // Dùng CHUNG failedAttempts/lockedUntil với /login (thay vì một bộ đếm riêng) để "khoá tài
    // khoản" chỉ có MỘT nghĩa duy nhất trong toàn hệ thống, và để admin gỡ ở một chỗ.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await audit(req, "user.invite.mfa.locked", { resource: "user", resourceId: user.id });
      throw httpError(423, `Tài khoản đang tạm khóa, vui lòng thử lại sau ${config.LOGIN_LOCKOUT_MINUTES} phút`);
    }
    // Khoá đã HẾT HẠN thì xoá luôn bộ đếm — giống hệt authenticateCredentials. Để nó nằm lại ở
    // ngưỡng thì lần gõ sai kế tiếp, dù nhiều ngày sau, lập tức khoá thêm một chu kỳ nữa.
    if (user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
      user.failedAttempts = 0;
      user.lockedUntil = null;
    }

    if (!(await verifyMfaChallenge(user, mfaToken))) {
      // Tăng NGUYÊN TỬ: nhiều request song song không được cùng đọc một giá trị cũ rồi lách ngưỡng.
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: { increment: 1 } },
        select: { failedAttempts: true },
      });
      const shouldLock = updated.failedAttempts >= config.LOGIN_MAX_ATTEMPTS;
      if (shouldLock) {
        await prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + config.LOGIN_LOCKOUT_MINUTES * 60_000) },
        });
      }
      await audit(req, "user.invite.mfa.failed", {
        resource: "user",
        resourceId: user.id,
        after: { failedAttempts: updated.failedAttempts, locked: shouldLock },
      });
      throw httpError(
        shouldLock ? 423 : 401,
        shouldLock ? `Sai mã MFA nhiều lần, tài khoản tạm khóa ${config.LOGIN_LOCKOUT_MINUTES} phút` : "Mã MFA không đúng"
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, config.BCRYPT_COST),
      // Đường này kiêm luôn ĐẶT LẠI mật khẩu → cũng phải đóng mốc, nếu không thì mọi phiên cũ của
      // tài khoản (kể cả phiên kẻ tấn công đang giữ) vẫn sống sau khi nạn nhân đặt lại mật khẩu.
      passwordChangedAt: new Date(),
      active: true,
      // ── BỎ TRỐNG = GIỮ NGUYÊN, KHÔNG PHẢI XOÁ ────────────────────────────
      // Đường này KIÊM LUÔN "Quên mật khẩu" (xem chú thích `passwordChangedAt` ngay trên). Bản
      // trước ghi `phone?.trim() || null`, tức mỗi lần một người đặt lại mật khẩu mà không gõ lại
      // SĐT/chức danh/tên người gửi thì BA TRƯỜNG ĐÓ BỊ XOÁ TRẮNG — im lặng, không báo gì.
      //
      // ĐÃ THẤY TRÊN PRODUCTION: 5/10 tài khoản trống cả ba, trong đó có tài khoản tạo gần như
      // toàn bộ báo giá. Hậu quả người dùng gặp: mọi báo giá mới không còn tự điền SĐT người gửi,
      // phải gõ tay lại từng lần — và họ CHẮC CHẮN đã nhập lúc nhận lời mời.
      //
      // `displayName` ngay trên đã làm đúng từ đầu (`|| user.displayName`); ba dòng dưới chỉ là
      // làm cho nhất quán với nó. Muốn XOÁ một trường thì vào Tài khoản → hồ sơ, nơi người dùng
      // nhìn thấy giá trị hiện tại trước khi sửa — chứ không phải ở một form đặt lại mật khẩu.
      displayName: displayName?.trim() || user.displayName,
      phone: phone?.trim() || user.phone,
      title: title?.trim() || user.title,
      senderName: senderName?.trim() || user.senderName,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      // Đặt lại mật khẩu THÀNH CÔNG thì xoá bộ đếm khoá, y như đăng nhập thành công. Không xoá thì
      // người vừa chứng minh được quyền sở hữu hộp thư (và mã MFA, nếu có) vẫn bị chặn ở màn đăng
      // nhập cho hết chu kỳ khoá — họ vừa làm đúng mọi thứ mà vẫn không vào được.
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
  await audit(req, "user.invite.accept", { resource: "user", resourceId: user.id, actorId: user.id });

  // This endpoint also serves password resets: the password just rotated, so
  // kill every pre-existing session/refresh token before issuing a new one.
  await revokeAllForUser(user.id);
  await destroyAllSessions(user.id);

  // Log the new user in immediately.
  await establishSession(req, updated as SessionSeed);

  /* ── PHẢI TRẢ ĐỦ NHƯ /login, KHÔNG ĐƯỢC THIẾU MỘT TRƯỜNG NÀO ────────────────────────────────
     Đây là đường CẤP PHIÊN, và SPA lấy THẲNG object này làm state `me` (App.tsx: `onLogin(m)` →
     `setMe(m)`). Nó chỉ gọi lại `/auth/me` khi có sự kiện SSE "session:refresh" — tức suốt cả
     phiên vừa tạo, `me` đúng bằng những gì trả về ở đây.

     Bản trước thiếu `phone` và `title` (`/login` ngay dưới thì có đủ). Hậu quả KHÔNG dừng ở chỗ
     hiển thị: trang Hồ sơ nạp ô bằng `me.phone || ""`, nên sau khi nhận lời mời HOẶC đặt lại mật
     khẩu, hai ô đó HIỆN RỖNG dù trong CSDL đang có số. Người dùng chỉ sửa "Tên người gửi" rồi bấm
     Lưu là gửi kèm hai ô rỗng ấy lên — và theo luật "ô có nạp sẵn thì bỏ trống = XOÁ", hệ thống
     xoá thật. Đúng sự cố đã xảy ra trên production, chỉ đổi cửa vào.

     Luật rút ra, áp cho mọi đường cấp phiên về sau: TRẢ ĐỦ những trường mà form Hồ sơ nạp sẵn.
     Thiếu một trường ở đây là biến ô của trường đó thành một lệnh xoá ngầm.
     Bài kiểm khoá: tests/hs-cap-phien-tra-du-truong.test.js */
  // Dùng CHUNG hình dạng với `/auth/me` và `/login` — xem `HO_SO_PHIEN_SELECT`.
  const hoSo = await prisma.user.findUnique({ where: { id: updated.id }, select: HO_SO_PHIEN_SELECT });
  return hoSoPhien(hoSo!);
}
