// Tầng SERVICE cho domain Người dùng (admin quản trị tài khoản). Bê NGUYÊN logic từ users.routes.ts
// (giữ hành vi y hệt): chống trùng, mời/onboard, đổi mật khẩu→thu hồi session, bảo vệ admin cuối,
// off-boarding xoá membership + audit. Route chỉ còn: requireRole("admin") + validate → gọi service → res.
// Các handler thao tác res trực tiếp (set-cookie/stream) — KHÔNG có ở đây; tất cả đều thuần trả dữ liệu.
import type { Request } from "express";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { audit } from "../audit.js";
import { sendEmail, brandedEmailHtml } from "../email.js";
import { revokeSession, refreshSession } from "../sse.js";
import { revokeAllForUser } from "../jwt.js";
import { destroyAllSessions } from "../sessions.js";
import { httpError } from "../httpError.js";
import { PERMISSIONS, ADMIN_ONLY_PERMISSIONS, KHONG_CO_QUYEN, permissionsForUser } from "../permissions.js";
import { thoatLike } from "../authCore.js";

/**
 * TÌM TÀI KHOẢN ĐÃ TỒN TẠI, KHÔNG PHÂN BIỆT HOA/THƯỜNG — chốt chống trùng cho đường GHI.
 *
 * VÌ SAO: `username` và `email` khai là `String @unique` THƯỜNG (prisma/schema.prisma), không phải
 * citext, nên Postgres so byte-for-byte. Ràng buộc unique KHÔNG chặn "bob@x.com" cạnh "Bob@x.com".
 * Trước đây `inviteUser` so bằng-đúng, nên mời lại đúng một con người bằng email viết hoa khác đi là
 * tạo tài khoản THỨ HAI: hai hồ sơ, hai tập quyền, hai đường đăng nhập — gỡ quyền ở một bên không
 * đụng bên kia. Phía ĐỌC (`findLoginUser` trong authCore.ts) đã không phân biệt hoa/thường từ trước;
 * để phía GHI so byte là để hai nửa nói hai chuyện khác nhau về "cùng một tài khoản".
 *
 * KHỚP CHÍNH XÁC ĐI TRƯỚC, cùng lý do như authCore.ts: CSDL hiện có thể ĐANG chứa hai hàng chỉ khác
 * hoa/thường; đường bằng-đúng dùng thẳng index unique và luôn thắng, nhánh không phân biệt hoa/thường
 * chỉ là đường lùi. `orderBy: { id: "asc" }` để kết quả TẤT ĐỊNH.
 *
 * ⚠️ PHẢI THOÁT `% _ \`: trên Postgres, Prisma biên dịch `equals` + `mode: "insensitive"` thành
 * ILIKE — chuỗi gửi lên trở thành MẪU. Không thoát thì một email hình dạng `%@x.com` khớp MỌI tài
 * khoản và biến chốt chống trùng thành "không mời được ai nữa". Dùng CHUNG `thoatLike` của authCore
 * để hai nửa không trôi khỏi nhau.
 *
 * KHÔNG chuẩn hoá giá trị đem LƯU: email/tên đăng nhập vẫn được lưu ĐÚNG như người dùng gõ. Đây chỉ
 * là phép TRA CỨU. Xem tests/b4-user-case-duplicate.test.js.
 */
async function timTaiKhoanTrung(giaTri: string, truong: ("username" | "email")[], kemDaXoa = false, boQuaId?: number) {
  // `boQuaId` — LOẠI TRỪ CHÍNH HÀNG ĐANG SỬA. Chỉ đường TẠO/MỜI mới được phép bỏ trống tham số này:
  // ở đó chưa có hàng nào của mình để tự đụng. Đường SỬA thì bắt buộc, vì modal "Sửa" gửi lại giá
  // trị NẠP SẴN y nguyên mỗi lần bấm Lưu — không loại trừ self là 409 MỖI LẦN LƯU dù admin chỉ đổi
  // số điện thoại, và cái 409 đó nói "email đã có tài khoản" trong khi tài khoản đó là chính họ.
  const loaiTru = boQuaId === undefined ? {} : { id: { not: boQuaId } };
  const dungY = await prisma.user.findFirst({
    where: { ...loaiTru, OR: truong.map((f) => ({ [f]: giaTri })) },
    includeDeleted: kemDaXoa,
  } as any);
  if (dungY) return dungY;
  const mau = thoatLike(giaTri);
  return (await prisma.user.findFirst({
    where: { ...loaiTru, OR: truong.map((f) => ({ [f]: { equals: mau, mode: "insensitive" } })) },
    orderBy: { id: "asc" },
    includeDeleted: kemDaXoa,
  } as any)) ?? null;
}

// Tích quyền PER-USER: chỉ nhận quyền HỢP LỆ (trong catalog) + KHÓA nhóm admin-tier (user:manage,
// settings:manage…) — chống leo thang đặc quyền (nhóm này chỉ vai trò admin/master mới có).
const KNOWN_PERMS = new Set<string>(Object.values(PERMISSIONS));
const sanitizePerms = (arr: unknown): string[] =>
  Array.isArray(arr) ? [...new Set(arr.filter((p): p is string => typeof p === "string" && KNOWN_PERMS.has(p) && !ADMIN_ONLY_PERMISSIONS.has(p)))] : [];

// ── TÀI KHOẢN KHẨN CẤP (break-glass) ─────────────────────────────────────────
// TRƯỚC 2026-08-11 đây là danh sách tài khoản ẨN: mặc định hard-code một email cá nhân của lập
// trình viên; tài khoản đó đăng nhập bình thường, có quyền admin, KHÔNG hiện trong danh sách nhân
// viên lẫn ma trận phân quyền, và KHÔNG thể bị hạ quyền/khóa. Đặc quyền lén lút như vậy là lỗi
// quản trị: chủ hệ thống không nhìn thấy nên không kiểm soát/thu hồi được.
//
// Nay: KHÔNG còn mặc định hard-code, và KHÔNG còn ẩn. Nếu doanh nghiệp thực sự cần một tài khoản
// khẩn cấp thì khai báo TƯỜNG MINH qua BREAK_GLASS_EMAILS — tài khoản vẫn HIỆN trong danh sách,
// gắn cờ `breakGlass: true` để admin thấy rõ, và vẫn hạ quyền/khóa được như mọi tài khoản khác
// (chỉ còn ràng buộc chung: không được gỡ quản trị viên cuối cùng).
// HIDDEN_USER_EMAILS đọc kèm CHỈ để tương thích ngược cấu hình cũ; nên đổi sang tên mới.
const BREAK_GLASS_EMAILS = new Set(
  (process.env.BREAK_GLASS_EMAILS || process.env.HIDDEN_USER_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);
const isBreakGlassUser = (u: { email?: string | null }) =>
  BREAK_GLASS_EMAILS.size > 0 && BREAK_GLASS_EMAILS.has(String(u.email || "").toLowerCase());

const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  role: true,
  phone: true,
  // Có GHI thì phải ĐỌC LẠI ĐƯỢC: modal "Sửa" pre-fill ô này từ GET /api/users, và nhật ký audit
  // (before/after của updateUser) chỉ lưu được vết của cột nào có mặt trong select này.
  //
  // `title` nằm ở đây từ 2026-09-17. Trước đó nó là cột GHI-ĐƯỢC-KHÔNG-ĐỌC-ĐƯỢC duy nhất:
  // UserCreateSchema/UserUpdateSchema đều nhận `title` và `createUser`/`updateUser` đều ghi được,
  // nhưng không đường đọc nào của quản trị trả nó về — nên modal "Sửa" không dựng nổi ô Chức danh,
  // và một lượt `PUT /api/users/:id` đổi chức danh IN LÊN BÁO GIÁ gửi khách để lại `before`/`after`
  // GIỐNG HỆT NHAU trong nhật ký: đổi mà không có một vết nào.
  title: true,
  senderName: true,
  // CHỈ cờ bật/tắt, KHÔNG phải `mfaSecret`/`mfaBackupCodes`. Cần nó để trang Tài khoản biết ai
  // đang bật xác thực hai bước mà hiện nút "Đặt lại MFA" — không có cột này thì nút hoặc hiện cho
  // TẤT CẢ (bấm vào nhận 400 "chưa bật"), hoặc không hiện cho ai, và người mất thiết bị hết đường.
  mfaEnabled: true,
  projectCode: true,
  active: true,
  canSign: true,
  permissions: true,
  lastLoginAt: true,
  createdAt: true,
};

const hashInvite = (t: string) => createHash("sha256").update(String(t)).digest("hex");
function inviteLink(token: string) {
  // Configuration only — Origin/Host headers are client-controlled and would
  // allow invite-link poisoning.
  return `${config.APP_BASE_URL}/#/onboard?token=${token}`;
}
async function sendInviteEmail(to: string, displayName: string, url: string) {
  return sendEmail({
    to,
    subject: "Lời mời tham gia hệ thống Báo Giá – Gia Nguyễn",
    text: `Chào ${displayName},\n\nBạn được mời tham gia hệ thống Quản lý Báo Giá – Gia Nguyễn. Mở liên kết bên dưới để đặt mật khẩu và hoàn tất thông tin của bạn (hết hạn sau 7 ngày):\n${url}\n`,
    html: brandedEmailHtml({
      name: displayName,
      paragraphs: [{ html: "Bạn được mời tham gia hệ thống <b>Quản lý Báo Giá – Gia Nguyễn</b>. Nhấn nút bên dưới để <b>đặt mật khẩu</b> và hoàn tất thông tin tài khoản của bạn." }],
      button: { label: "Đặt mật khẩu & kích hoạt", url },
      note: { html: "⏳ Liên kết hết hạn sau <b>7 ngày</b>." },
    }),
  });
}

export async function listUsers(_req: Request) {
  const users = await prisma.user.findMany({ orderBy: { id: "asc" }, select: { ...USER_SELECT, inviteTokenHash: true } });
  // KHÔNG lọc bỏ ai nữa — mọi tài khoản đều hiện; tài khoản khẩn cấp chỉ được GẮN CỜ để admin thấy.
  return users.map(({ inviteTokenHash, ...u }) => ({
    ...u,
    pending: !u.active && !!inviteTokenHash,
    breakGlass: isBreakGlassUser(u),
    // Quyền HIỆU LỰC để pre-fill ma trận (per-user nếu có, else theo role; +ký nếu canSign); permCustom = đã tùy biến.
    effectivePermissions: permissionsForUser(u.role, u.permissions, u.canSign),
    permCustom: (u.permissions?.length ?? 0) > 0,
  }));
}

// Invite an employee by email — they self-onboard (set password + fill details).
export async function inviteUser(req: Request) {
  // KHÔNG có `canSign` ở đây, và đó là chủ ý: `UserInviteSchema` cũng không khai nó, nên hai nửa
  // NHẤT QUÁN — không có gì bị rơi im lặng như ở `createUser` trước bản vá 2026-09-18. Người tự
  // onboard không được tự cấp quyền ký; quản trị cấp sau bằng ô "Ký chứng từ" trong ma trận.
  const { email, displayName, role, projectCode, permissions, senderName } = req.body;
  // Giữ NGUYÊN tập trường được đối chiếu (email HOẶC username) — chỉ đổi phép so từ byte-for-byte
  // sang không-phân-biệt-hoa/thường. Nới tập trường sẽ đổi hành vi đang chạy.
  const exists = await timTaiKhoanTrung(email, ["email", "username"]);
  if (exists) throw httpError(409, "Email này đã có tài khoản");
  const token = randomBytes(24).toString("hex");
  const user = await prisma.user.create({
    data: {
      username: email,
      email,
      displayName,
      role,
      permissions: sanitizePerms(permissions), // tích quyền per-user lúc mời ([] = theo role)
      // Hàng MỚI nên `|| null` ở đây không xoá được gì của ai. Đặt hộ ngay từ lời mời để wizard báo
      // giá của người đó chạy đúng ngay lần đầu, thay vì bắt họ tự vào Hồ sơ cá nhân điền.
      senderName: senderName || null,
      projectCode: projectCode ? String(projectCode).trim() : null,
      active: false,
      passwordHash: await bcrypt.hash(randomBytes(18).toString("hex"), config.BCRYPT_COST), // unusable until accept
      inviteTokenHash: hashInvite(token),
      inviteExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    },
    select: { id: true, email: true, displayName: true, role: true },
  });
  const url = inviteLink(token);
  const mail = await sendInviteEmail(email, displayName, url);
  await audit(req, "user.invite", { resource: "user", resourceId: user.id, after: { email, role } });
  // Trả LÝ DO thật, không chỉ true/false: "chưa cấu hình SMTP" và "SMTP từ chối mật khẩu" là hai
  // việc khác nhau, cần sửa ở hai chỗ khác nhau. Gộp làm một là đẩy admin đi tìm nhầm chỗ (đúng
  // chuyện đã xảy ra: Gmail trả 535 BadCredentials mà giao diện báo "email chưa được cấu hình").
  return { user, inviteUrl: url, emailSent: !mail.skipped && !mail.error, emailSkipped: !!mail.skipped, emailError: mail.error ?? null };
}

// Re-send an invite (new token) for a still-pending user.
export async function resendInvite(req: Request) {
  const id = Number(req.params.id);
  const u = await prisma.user.findFirst({ where: { id } });
  if (!u) throw httpError(404, "Không tìm thấy tài khoản");
  if (u.active) throw httpError(400, "Tài khoản đã được kích hoạt, không cần gửi lại lời mời");
  if (!u.email) throw httpError(400, "Tài khoản không có email");
  const token = randomBytes(24).toString("hex");
  await prisma.user.update({
    where: { id: u.id },
    data: { inviteTokenHash: hashInvite(token), inviteExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
  });
  const url = inviteLink(token);
  const mail = await sendInviteEmail(u.email, u.displayName, url);
  await audit(req, "user.invite.resend", { resource: "user", resourceId: u.id });
  return { inviteUrl: url, emailSent: !mail.skipped && !mail.error, emailSkipped: !!mail.skipped, emailError: mail.error ?? null };
}

export async function createUser(req: Request) {
  const { username, password, displayName, role, phone, title, senderName, canSign } = req.body;
  // includeDeleted: username is unique across soft-deleted rows too — a plain
  // check would miss a deleted holder and surface the DB constraint as a 500.
  // CHỈ đối chiếu cột `username` (KHÔNG kèm `email`) — giữ đúng tập trường cũ, chỉ đổi phép so.
  const exists = await timTaiKhoanTrung(username, ["username"], true);
  if (exists) throw httpError(409, exists.deletedAt ? "Tên đăng nhập thuộc về một tài khoản đã xóa" : "Tên đăng nhập đã tồn tại");

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, config.BCRYPT_COST),
      // Admin đặt mật khẩu THẬT cho tài khoản này — đóng mốc như mọi đường đặt mật khẩu khác. Thiếu
      // mốc thì tài khoản rơi vào nhóm `passwordChangedAt IS NULL`, nhóm mà sendPasswordReset từng
      // hiểu là "chưa từng kích hoạt" (AUTH-01). Hàng MỚI nên không có phiên cũ nào bị đá.
      passwordChangedAt: new Date(),
      displayName,
      role,
      phone: phone || null,
      title: title || null,
      // Destructure ở trên là TƯỜNG MINH, nên thêm trường vào UserCreateSchema thôi chưa đủ —
      // thiếu dòng này thì zod cho qua mà hàng vẫn ghi thiếu, im lặng.
      senderName: senderName || null,
      // Và đúng cái bẫy mà chú thích ngay trên vừa cảnh báo đã tái diễn ở dòng dưới nó: `canSign`
      // được `UserCreateSchema` khai từ lâu (tests/validators.test.js còn khẳng định zod quy chuỗi
      // "false" về `false`), nhưng destructure không có nó nên cờ RƠI IM LẶNG — admin tích ô, nhận
      // 201, và quyền ký không bao giờ được cấp. Bài kiểm zod xanh suốt vì nó đo tầng parse.
      //
      // ĐÂY LÀ QUYỀN THẬT, không phải cờ trang trí: `resolveUserPermissions` cộng `quote:sign:own`
      // vào tập hiệu lực khi cờ này bật, và middleware resolve lại tập đó TỪ CSDL mỗi request.
      //
      // ⚠ HÔM NAY CHƯA CÓ ĐƯỜNG VÀO TỪ GIAO DIỆN. `web/src/lib/api.ts` không có hàm `createUser`
      // nào, nên `POST /api/users` chỉ có người gọi API trực tiếp (và bài kiểm). Giao diện cấp quyền
      // ký bằng cách tích ô "Ký chứng từ" trong ma trận rồi để `updateUser` tự suy cờ. Vá ở đây vẫn
      // đúng — schema đã hứa nhận thì phải giữ lời, và một trường nhận-mà-không-ghi là cái bẫy chờ
      // người sau — nhưng đừng đọc nó thành "sự cố đang xảy ra trên giao diện".
      //
      // Phải có `?? false` vì cột là `Boolean` NOT NULL và `zbool.optional()` cho ra `undefined` khi
      // client không gửi khoá. Hàng MỚI nên không có gì để xoá — hai luật ô-bỏ-trống cho cùng một
      // kết quả ở đây, đúng như chú thích của `phone`/`title` ngay trên.
      canSign: canSign ?? false,
    },
    select: USER_SELECT,
  });
  await audit(req, "user.create", { resource: "user", resourceId: user.id, after: user });
  return user;
}

export async function updateUser(req: Request) {
  const id = Number(req.params.id);
  const before = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!before) throw httpError(404, "Không tìm thấy tài khoản");

  const { password, ...rest } = req.body;
  const data = { ...rest };
  if (password) {
    data.passwordHash = await bcrypt.hash(password, config.BCRYPT_COST);
    // Admin đặt lại mật khẩu = đổi thông tin xác thực → đóng mốc để MỌI phiên và access token cũ
    // của tài khoản đó chết ngay, không phụ thuộc việc xoá hàng trong kho phiên có thành công không.
    data.passwordChangedAt = new Date();
  }
  // ── ĐỔI EMAIL: CHỐT CHỐNG TRÙNG, VÀ MỘT LỆNH ĐỐT CHỨNG THƯ ─────────────────────────────────
  //
  // `if (data.email)` chứ KHÔNG phải `!== undefined`. Gọi chốt với `null` là tai hoạ hai chiều:
  // Prisma dịch `{ email: null }` thành `IS NULL` nên nó khớp BẤT KỲ tài khoản nào đang không có
  // email — mọi tài khoản đã vô danh hoá theo GDPR đều `email: null` — ra 409 GIẢ, tức không ai xoá
  // được email nữa; còn nếu CSDL chưa có hàng null nào thì nó rơi xuống `thoatLike(null)`, tức
  // `null.replace(...)` ⇒ TypeError ⇒ 500.
  //
  // Bốn vế của phép đối chiếu, thiếu vế nào cũng tự tạo một lỗi mới:
  //   (a) loại trừ chính hàng đang sửa — modal gửi lại email nạp sẵn y nguyên mỗi lần Lưu;
  //   (b) đối chiếu CẢ `email` LẪN `username` — index `User_email_key` chỉ phủ email-vs-email, nhưng
  //       `findLoginUser` OR cả hai cột. Đặt email của A bằng `username` của B là HỢP LỆ với Postgres
  //       mà làm hai hàng cùng khớp một chuỗi đăng nhập: bộ đếm `failedAttempts` cộng lên hàng
  //       `findFirst` trả về, tức KHOÁ CHÉO tài khoản người khác. Và tài khoản mời qua email có
  //       `username = email`, nên ca này không hiếm;
  //   (c) `kemDaXoa = true` — hàng xoá mềm vẫn giữ email trong index unique (index KHÔNG partial
  //       theo `deletedAt`), mà `find*` mặc định thêm `deletedAt: null` nên một chốt viết bình thường
  //       KHÔNG THẤY hàng đó rồi ăn P2002; đó đúng lý do `createUser` cũng truyền cờ này;
  //   (d) câu chữ nói rõ LÝ DO. Không có chốt thì P2002 → 409 "Dữ liệu đã tồn tại (trùng khóa duy
  //       nhất)" (errorHandler, src/middleware.ts) — không nói trùng cột nào, với ai, hay "thuộc về
  //       một tài khoản đã xoá".
  if (data.email) {
    const trung = await timTaiKhoanTrung(String(data.email), ["email", "username"], true, id);
    if (trung) throw httpError(409, trung.deletedAt ? "Email thuộc về một tài khoản đã xóa" : "Email này đã có tài khoản");
  }
  // ── XOÁ TRẮNG EMAIL: CHO, TRỪ ĐÚNG MỘT CA LÀM TÀI KHOẢN HẾT ĐƯỜNG DÙNG ─────────────────────
  //
  // Ô Email trong modal "Sửa" NẠP SẴN giá trị đang có, nên theo luật của repo bỏ trống PHẢI là xoá
  // thật — giữ luật ngược lại ở đây là "lưu mà không ăn". Nhưng xoá email KHÔNG vô hại như xoá chức
  // danh: nó làm CHẾT ÂM THẦM ba đường (gửi lại lời mời → 400, thư đặt lại mật khẩu → `findLoginUser`
  // không khớp rồi `return` im lặng sau khi endpoint đã trả 200, thông báo qua thư → bỏ qua không
  // một dòng log). Nên quyết định được chọn TƯỜNG MINH thay vì để rơi vào mặc định:
  //
  //   · tài khoản ĐÃ kích hoạt → CHO xoá. Họ vẫn đăng nhập bằng `username` (và với mọi tài khoản mời
  //     qua email thì `username` CHÍNH LÀ email cũ, nên chuỗi họ vẫn gõ vẫn chạy). Giao diện phải nói
  //     rõ hệ quả — xem placeholder ở web/src/pages/Users.tsx, đừng để admin tự bắn vào chân mình.
  //   · tài khoản CHƯA kích hoạt (pending) → CHẶN. Đây là ca DUY NHẤT xoá email làm tài khoản hết
  //     đường dùng: không còn địa chỉ để gửi lời mời, mà chưa có mật khẩu để đăng nhập. Người đó
  //     thành một hàng chết mà không ai hiểu vì sao.
  //
  // Truy vấn riêng cho `inviteTokenHash` chứ KHÔNG nhét cột đó vào `USER_SELECT`: `before`/`after`
  // của `USER_SELECT` được ghi NGUYÊN VĂN vào nhật ký kiểm toán, và một hash chứng thư kích hoạt là
  // thứ không được nhân bản thêm một bản sao nữa vào bảng nhật ký.
  if (data.email === null && before.email) {
    throw httpError(400, "Không xoá trắng được email: đó là đường DUY NHẤT để đặt lại mật khẩu. Đổi sang địa chỉ khác, hoặc khoá tài khoản nếu người này đã nghỉ.");
  }
  // ĐỔI EMAIL CỦA TÀI KHOẢN CHƯA KÍCH HOẠT → CHẶN, chỉ dẫn sang "Huỷ lời mời" rồi mời lại.
  //
  // Vì sao không cho: đổi email BUỘC phải đốt chứng thư đang sống (xem khối ngay dưới), nhưng
  // `listUsers` tính `pending: !active && !!inviteTokenHash` và giao diện CHỈ hiện nút "Gửi lại lời
  // mời" khi `pending`. Nên đốt token của một tài khoản chưa kích hoạt là làm nó rơi khỏi trạng thái
  // "Chờ kích hoạt", mất luôn nút gửi lại, thành một hàng KẸT CỨNG mà admin không còn đường sửa.
  //
  // Và không mở nút "Gửi lại" cho mọi tài khoản `!active` được: `acceptInvite` đặt `active: true`,
  // nên gửi lại lời mời cho một tài khoản ĐÃ KHOÁ là cho họ tự kích hoạt lại — đúng cái mà nhánh
  // `active === false` bên dưới đang cố chặn bằng cách đốt token.
  //
  // Huỷ-rồi-mời-lại là đường đã có, đã đúng, và admin thấy ngay trên cùng một hàng.
  if (data.email !== undefined && data.email !== before.email && !before.active) {
    throw httpError(400, "Tài khoản chưa kích hoạt: hãy bấm \"Huỷ lời mời\" rồi mời lại bằng địa chỉ mới — đổi email lúc này sẽ vô hiệu hoá lời mời đang gửi đi.");
  }
  // ĐỔI EMAIL = ĐỔI ĐÍCH ĐẾN CỦA CHỨNG THƯ ĐANG SỐNG. Cùng lớp rủi ro với nhánh `active === false`
  // ngay dưới: một token mời/đặt-lại còn hạn là đường TỰ ĐẶT MẬT KHẨU rồi `active: true`. Không đốt
  // nó thì người giữ HỘP THƯ CŨ vẫn kích hoạt được tài khoản và tự đặt mật khẩu — chiếm tài khoản,
  // bằng đúng đường mà việc đổi email lẽ ra phải cắt. Tới đây thì tài khoản CHẮC CHẮN đã kích hoạt
  // (ca chưa kích hoạt bị chặn ở trên), nên đốt token không làm mất nút "Gửi lại lời mời" của ai.
  if (data.email !== undefined && data.email !== before.email) {
    data.inviteTokenHash = null;
    data.inviteExpiresAt = null;
  }
  // Tích quyền per-user: lọc về quyền hợp lệ + bỏ nhóm admin-tier (chống leo thang). [] = về mặc định theo role.
  if (data.permissions === null) {
    // BỎ TUỲ BIẾN → quay về bộ mặc định của vai trò. Không đụng canSign: đó là cờ riêng.
    data.permissions = [];
  } else if (data.permissions !== undefined) {
    data.permissions = sanitizePerms(data.permissions);
    // "Ký chứng từ" giờ là ô trong ma trận (quote:sign:own) → đồng bộ cờ canSign cũ cho khớp (legacy reads).
    if (data.canSign === undefined) data.canSign = data.permissions.includes(PERMISSIONS.QUOTE_SIGN_OWN);
    // BỎ TÍCH HẾT = TƯỚC HẾT QUYỀN, không phải "về mặc định" (RBAC-01). Lưu `[]` thì resolveUserPermissions
    // trả lại nguyên bộ quyền của vai trò — admin bấm "Đã lưu" mà người kia vẫn đọc được danh bạ,
    // khách hàng, báo giá của mình. Ca này gồm cả khi admin chỉ tích quyền ADMIN_ONLY (bị lọc về rỗng).
    // Vai trò admin thì bỏ qua: admin luôn full quyền, và giao diện gửi `[]` khi bật cờ Quản trị.
    const roleSau = rest.role ?? before.role;
    if (data.permissions.length === 0 && roleSau !== "admin") data.permissions = [KHONG_CO_QUYEN];
  }
  // Deactivating an account must also burn any live invite/reset token —
  // otherwise the locked-out user could re-activate themselves through the
  // onboarding link (accept-invite sets active: true).
  if (rest.active === false) {
    data.inviteTokenHash = null;
    data.inviteExpiresAt = null;
  }

  // Giữ đường vào quản trị: chặn thay đổi làm mất QUẢN TRỊ VIÊN CUỐI CÙNG. Đây là ràng buộc DUY
  // NHẤT — không còn ngoại lệ "tài khoản hệ thống không được hạ quyền", và tài khoản khẩn cấp
  // ĐƯỢC TÍNH là admin hợp lệ khi đếm (nó hiện trong danh sách nên chủ hệ thống thấy và thu hồi được).
  const losingAdmin =
    before.role === "admin" &&
    ((rest.role !== undefined && rest.role !== "admin") || rest.active === false);
  if (losingAdmin) {
    const otherAdmins = await prisma.user.count({ where: { role: "admin", active: true, id: { not: id } } });
    if (otherAdmins === 0) {
      throw httpError(400, "Không thể gỡ quyền hoặc khóa quản trị viên cuối cùng.");
    }
  }
  // Thao tác trên tài khoản khẩn cấp là sự kiện đáng chú ý → ghi vết riêng, mức cao.
  if (isBreakGlassUser(before)) {
    await audit(req, "user.breakglass.modify", { resource: "user", resourceId: id, after: { changed: Object.keys(rest) } });
  }

  const user = await prisma.user.update({ where: { id }, data, select: USER_SELECT });
  // Credential rotation containment: an admin password reset invalidates every
  // existing session and refresh token of the target account.
  if (password) {
    await revokeAllForUser(id);
    await destroyAllSessions(id);
  }
  // Off-boarding: KHOÁ tài khoản KHÔNG còn gỡ họ khỏi các báo giá được phân công.
  // Trước 2026-09-15 nhánh này xoá sạch membership, hồi đó chấp nhận được vì "là thành viên"
  // chỉ là một BIT dựng lại bằng một cú tick. Nay mỗi hàng còn mang PHẠM VI do chủ báo giá tự
  // tick (QuoteMember.scopes) — xoá là mất cấu hình, không có đường hoàn tác (nhật ký chỉ ghi
  // `after`). Khoá một hôm rồi mở lại là phải tick lại toàn bộ.
  // Chặn truy cập KHÔNG dựa vào việc xoá hàng này: phiên bị huỷ ngay dưới đây, refresh-token bị
  // đốt, và `enforceActiveUser` chặn mọi request kế tiếp.
  if (before.active && user.active === false) {
    revokeSession(user.id, "deactivated");
    // Off-boarding containment (parity with the password branch): burn refresh-token
    // families and destroy store sessions now, instead of relying solely on
    // enforceActiveUser tearing the session down on the next request.
    await revokeAllForUser(id);
    await destroyAllSessions(id);
    const giuLai = await prisma.quoteMember.findMany({ where: { userId: id }, select: { quoteId: true, scopes: true } });
    if (giuLai.length) {
      await audit(req, "user.memberships.retained", {
        resource: "user", resourceId: id,
        after: { quoteIds: giuLai.map((m) => m.quoteId), scopes: Object.fromEntries(giuLai.map((m) => [m.quoteId, m.scopes])) },
      });
    }
  } else if (
    before.role !== user.role ||
    JSON.stringify(before.permissions) !== JSON.stringify(user.permissions) ||
    before.canSign !== user.canSign ||
    id === req.session.userId
  ) {
    // Đổi vai trò HOẶC tích quyền per-user → đẩy SSE để client tải lại /me, cập nhật ẩn/hiện ngay (server đã
    // áp dụng từ request kế nhờ middleware resolve mỗi request — cái này chỉ để UI mượt).
    //
    // `before.canSign !== user.canSign` — cùng lý lẽ, chỉ là cột khác: một lượt PUT chỉ đổi `canSign`
    // (không kèm `role`, không kèm `permissions`) ĐỔI QUYỀN THẬT ở máy chủ ngay request kế, nhưng
    // trước bản vá 2026-09-18 không sinh sự kiện nào — nút "Ký" không mọc ra cho tới khi họ F5.
    //
    // `id === req.session.userId` — ADMIN SỬA HỒ SƠ CỦA CHÍNH MÌNH. Đây không phải chuyện hiển thị
    // cho đẹp, nó là một LỆNH XOÁ NGẦM đang chờ: `App.tsx` gọi `api.me()` đúng MỘT LẦN lúc đăng
    // nhập, và `Shell.tsx` chỉ gọi lại khi nhận "session:refresh" — đường DUY NHẤT. Nên sau khi admin
    // tự sửa mình qua modal "Sửa" (nút đó KHÔNG bị chặn cho chính mình), state `me` giữ giá trị CŨ
    // tới hết phiên. Trang "Tài khoản" khởi tạo ô bằng `useState(me.phone || "")` MỘT LẦN, và ba ô
    // đó là ô NẠP SẴN ⇒ nội dung ô CHÍNH LÀ lệnh ghi: mở trang Hồ sơ rồi bấm Lưu là ghi đè giá trị
    // vừa sửa bằng giá trị cũ, hoặc XOÁ THẬT nếu trường vừa đi từ rỗng thành có. Cùng lớp lỗi mà
    // tests/hs-cap-phien-tra-du-truong.test.js gọi là "một lệnh xoá ngầm", chỉ khác cửa vào.
    //
    // VÌ SAO SỬA Ở MÁY CHỦ, KHÔNG SỬA Ở CLIENT: client phải gọi lại `api.me()` để có payload CHUẨN
    // (quyền HIỆU LỰC + `mfaEnabled`). Mẫu `onMe({ ...me, ...u })` của Profile.tsx ĐÚNG ở đó (đường
    // /auth/profile trả quyền hiệu lực) nhưng SAI nếu bê sang trang Nhân viên: `USER_SELECT.permissions`
    // là mảng quyền per-user THÔ (`[]` với người dùng quyền mặc định theo role), merge cái thô lên cái
    // hiệu lực là admin mất sạch menu tới khi F5 — biến một lỗi hiển thị thành một lỗi chặn việc.
    // Đường này thì dùng lại nguyên dây đã nối, một tệp, và có tiền lệ: `refreshRoleUsers`
    // (src/routes/permissions.routes.ts) bắn đúng sự kiện này cho mọi user của một vai trò.
    refreshSession(user.id);
  }
  await audit(req, "user.update", {
    resource: "user",
    resourceId: id,
    before,
    after: user,
    // log diff explicitly for searchability
  });
  if (password) {
    await audit(req, "password.reset.by_admin", { resource: "user", resourceId: id });
  }
  return user;
}

/**
 * GỠ MFA HỘ MỘT TÀI KHOẢN — đường phục hồi duy nhất khi người dùng mất cả điện thoại lẫn mã dự phòng.
 *
 * ── VÌ SAO PHẢI CÓ ──────────────────────────────────────────────────────────
 * `POST /api/mfa/disable` đòi đúng một mã TOTP hoặc một mã dự phòng (src/services/mfaService.ts),
 * mà mã dự phòng chỉ hiện MỘT LẦN lúc bật. Đường "Quên mật khẩu" (`/auth/accept-invite`) nay cũng
 * có cổng MFA đặt TRƯỚC lệnh đổi mật khẩu — đúng về bảo mật, vì chiếm được hộp thư không được phép
 * vô hiệu hoá lớp thứ hai. Nhưng cộng lại, người mất điện thoại + mất mã dự phòng KHÔNG còn đường
 * nào: `UserUpdateSchema` không nhận trường MFA nào nên admin sửa tài khoản cũng không hạ được cờ.
 * Trước bản này, cách duy nhất là chạy SQL tay trên Postgres production.
 *
 * ── VÌ SAO AN TOÀN ──────────────────────────────────────────────────────────
 * Người gọi phải có `user:manage` — đúng nhóm đã đặt lại được mật khẩu của người khác qua
 * `PUT /api/users/:id` (`UserUpdateSchema.password`). Nên đây KHÔNG mở thêm quyền nào mà nhóm đó
 * chưa có; nó chỉ đưa một thao tác vốn phải làm bằng SQL tay vào trong hệ thống, nơi có kiểm quyền
 * và có nhật ký kiểm toán.
 *
 * Huỷ luôn phiên đang mở của người đó: cờ MFA vừa đổi thì mọi phiên cấp trước đó không còn phản ánh
 * đúng trạng thái xác thực hiện tại.
 */
export async function resetMfa(req: Request) {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, mfaEnabled: true } });
  if (!user) throw httpError(404, "Không tìm thấy tài khoản");
  if (!user.mfaEnabled) throw httpError(400, "Tài khoản này chưa bật xác thực hai bước");
  await prisma.user.update({
    where: { id },
    // `mfaLastStep` về null cùng lý do như POST /api/mfa/disable: mốc đó chỉ có nghĩa với bí mật
    // vừa bị xoá; giữ lại thì lần BẬT lại sẽ từ chối mã hợp lệ đầu tiên của bí mật MỚI.
    data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [], mfaLastStep: null },
  });
  revokeSession(id, "mfa_reset");
  // `revokeSession` Ở TRÊN CHỈ BẮN MỘT SỰ KIỆN SSE — nó gợi ý client tự đăng xuất, KHÔNG huỷ gì ở
  // server. Docblock hàm này hứa "Huỷ luôn phiên đang mở", nhưng thiếu đúng hai dòng làm điều đó
  // thật sự (đã có sẵn, cùng nơi 2 nhánh khác của file này dùng — dòng ~250 và ~261). Không có nó:
  // kẻ đang giữ phiên/thiết bị của nạn nhân (đúng mô hình đe doạ "mất điện thoại" mà chức năng này
  // sinh ra để phục vụ) tiếp tục dùng được phiên cũ sau khi admin tưởng đã "gỡ MFA hộ" xong — MFA
  // vừa tắt không hề làm phiên đang mở hết hạn, và refresh token cũ vẫn cấp access token mới được.
  await revokeAllForUser(id);
  await destroyAllSessions(id);
  await audit(req, "user.mfa.reset", { resource: "user", resourceId: id, before: { mfaEnabled: true } });
  return { ok: true, username: user.username };
}

export async function deleteUser(req: Request) {
  const id = Number(req.params.id);
  if (id === req.session.userId) {
    throw httpError(400, "Không thể xóa chính bạn");
  }
  const count = await prisma.quote.count({
    where: { OR: [{ createdById: id }, { approvedById: id }] },
  });
  if (count > 0) {
    // Soft-delete still allowed via active=false, but block to preserve audit trail.
    throw httpError(409, `Tài khoản đang gắn với ${count} báo giá. Hãy khóa tài khoản thay vì xóa.`);
  }
  const before = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  // XOÁ hẳn tài khoản thì dọn phân công: `user.delete` là xoá MỀM (middleware) nên FK Cascade
  // không bao giờ chạy — không dọn tay là hàng QuoteMember trỏ tới người không còn tồn tại.
  // Chốt 409 phía trên chỉ đếm báo giá họ TẠO/DUYỆT, nên một tài khoản chỉ làm account phụ vẫn xoá
  // được — ghi lại phạm vi sắp mất, nếu không nhật ký không trả lời được "ai đã được giao gì".
  const phanCong = await prisma.quoteMember.findMany({ where: { userId: id }, select: { quoteId: true, scopes: true } });
  if (phanCong.length) {
    await audit(req, "user.memberships.cleared", {
      resource: "user", resourceId: id,
      before: { quoteIds: phanCong.map((m) => m.quoteId), scopes: Object.fromEntries(phanCong.map((m) => [m.quoteId, m.scopes])) },
    });
  }
  await prisma.quoteMember.deleteMany({ where: { userId: id } });
  await prisma.user.delete({ where: { id } }); // soft-delete via middleware
  revokeSession(id, "deleted");
  await audit(req, "user.delete", { resource: "user", resourceId: id, before });
  return { ok: true };
}
