/**
 * ============================================================================
 * EMAIL: ĐỌC RA ĐƯỢC MÀ KHÔNG SỬA ĐƯỢC — ẢNH GƯƠNG CỦA CA `title`.
 *
 * ── LỖI THẬT ───────────────────────────────────────────────────────────────
 * `USER_SELECT` trả `email` (giao diện ĐỌC được), nhưng KHÔNG schema quản trị nào NHẬN nó:
 * `UserUpdateSchema` không có khoá `email`, `ProfileUpdateSchema` cũng không. Chỉ `UserInviteSchema`
 * đặt được, tức email đặt được ĐÚNG MỘT LẦN lúc mời rồi khoá cứng vĩnh viễn. Và vì `validate()` dùng
 * `z.object`, khoá lạ bị STRIP IM LẶNG: admin gửi `email` lên nhận 200 mà không có gì đổi — "lưu mà
 * không ăn", không một dòng lỗi.
 *
 * Hậu quả không phải thẩm mỹ. `email` là:
 *   · MỘT TRONG HAI ĐỊNH DANH ĐĂNG NHẬP — `findLoginUser` khớp `username` HOẶC `email`;
 *   · địa chỉ nhận THƯ MỜI và THƯ ĐẶT LẠI MẬT KHẨU;
 *   · địa chỉ nhận thông báo (kênh email bật mặc định ở mức "important").
 * Nên một địa chỉ gõ sai một ký tự lúc mời là một tài khoản không ai sửa nổi: người đó không nhận
 * được lời mời, không đặt lại được mật khẩu, và quản trị không có đường nào chữa ngoài SQL tay.
 *
 * ── VÌ SAO KHÔNG PHẢI "MỘT DÒNG SCHEMA" ───────────────────────────────────
 * `updateUser` truyền thẳng `{ ...rest }` vào `prisma.user.update`, nên chỉ cần thêm khoá là email
 * ĐƯỢC GHI NGAY — không có tầng nào khác chặn (ngược hẳn `canSign` ở `createUser`, nơi destructure
 * tường minh ném trường đi). Bốn thứ phải làm CÙNG LÚC, mỗi thứ chặn một lỗi mới:
 *
 *   1. Ô Email trong modal Sửa phải NẠP SẴN `user.email` TRƯỚC khi schema nhận khoá. Làm ngược là
 *      mỗi lần bấm Lưu xoá trắng email của người ta — biến thể NẶNG NHẤT của sự cố xoá trắng 5/10
 *      hồ sơ (tests/dm-dat-lai-mat-khau-khong-xoa-ho-so.test.js), vì đây là định danh đăng nhập.
 *   2. KHÔNG dùng lại `oXoaDuoc` (không kiểm định dạng), và KHÔNG đặt `.email()` trước `.transform`
 *      (ô rỗng thành 400 "Email không hợp lệ" — LỆNH XOÁ biến thành LỖI NHẬP LIỆU).
 *   3. `updateUser` KHÔNG gọi `timTaiKhoanTrung` lần nào — không có chốt chống trùng nào trên đường
 *      PUT. Thiếu chốt thì trùng email rơi xuống P2002 → 409 câu chữ CHUNG "Dữ liệu đã tồn tại
 *      (trùng khóa duy nhất)": không nói trùng cột nào, với ai, hay "thuộc về một tài khoản đã xoá".
 *      Và có một ca CSDL KHÔNG CHẶN ĐƯỢC: đặt `email` của A bằng `username` của B — index
 *      `User_email_key` chỉ phủ email-vs-email, nhưng `findLoginUser` OR cả hai cột, nên hai hàng
 *      cùng khớp một chuỗi đăng nhập và bộ đếm `failedAttempts` cộng lên hàng tuỳ ý: KHOÁ CHÉO tài
 *      khoản người khác.
 *   4. Chốt phải là `if (data.email)`, KHÔNG phải `!== undefined`. Prisma dịch `{ email: null }`
 *      thành `IS NULL`, nên gọi chốt với `null` khớp BẤT KỲ tài khoản nào đang không có email (mọi
 *      tài khoản đã vô danh hoá GDPR đều `email: null`) ⇒ 409 GIẢ, không ai xoá được email nữa.
 *
 * ── CHÍNH SÁCH Ô RỖNG: CHỌN TƯỜNG MINH, KHÔNG ĐỂ MẶC ĐỊNH ─────────────────
 * Ô CÓ nạp sẵn ⇒ rỗng = XOÁ. Nhưng xoá email làm chết ÂM THẦM ba đường, nên quyết định là:
 *   · tài khoản ĐÃ kích hoạt → CHO xoá (còn đăng nhập bằng `username`), giao diện phải nói hệ quả;
 *   · tài khoản CHƯA kích hoạt → CHẶN 400. Ca duy nhất làm tài khoản hết đường dùng: không còn địa
 *     chỉ nhận lời mời, mà chưa có mật khẩu để đăng nhập.
 * ĐỔI email cũng ĐỐT `inviteTokenHash`: cùng lớp rủi ro với nhánh khoá tài khoản — một chứng thư còn
 * hạn là đường TỰ ĐẶT MẬT KHẨU rồi `active: true`, nên người giữ hộp thư CŨ chiếm được tài khoản.
 * ============================================================================
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma
  .$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `emql${Date.now()}`;
const MAT_KHAU = "Email1234!ql";
const EMAIL_GOC = `${TAG}-nv@vd.test`;

describe.runIf(dbAvailable)("Quản trị sửa email nhân viên", () => {
  let app, quanTri, nvId, nguoiKhacId, daXoaId, pendingId;
  const NGUOI_KHAC_EMAIL = `${TAG}-khac@vd.test`;
  const NGUOI_KHAC_USERNAME = `${TAG}-khac-dangnhap@vd.test`; // username hình dạng email — đúng hình dạng mà inviteUser tạo ra
  const DA_XOA_EMAIL = `${TAG}-daxoa@vd.test`;

  const doc = (id) => prisma.user.findFirst({ where: { id }, select: { email: true, phone: true, inviteTokenHash: true }, includeDeleted: true });
  const nhatKyMoiNhat = () =>
    prisma.auditEvent.findFirst({ where: { action: "user.update", resourceId: String(nvId) }, orderBy: { id: "desc" } });

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    const ad = await prisma.user.create({
      data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) },
    });
    const nv = await prisma.user.create({
      data: { username: `${TAG}-nv`, email: EMAIL_GOC, displayName: `${TAG} nv`, role: "manager", phone: "0909123456", passwordHash: await bcrypt.hash(MAT_KHAU, 4) },
    });
    nvId = nv.id;

    // Người khác: mang SẴN cả một email VÀ một username-hình-dạng-email. Hai cột, hai ca trùng khác nhau.
    const nk = await prisma.user.create({
      data: { username: NGUOI_KHAC_USERNAME, email: NGUOI_KHAC_EMAIL, displayName: `${TAG} khác`, role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4) },
    });
    nguoiKhacId = nk.id;

    // Tài khoản XOÁ MỀM vẫn giữ email trong index unique (index KHÔNG partial theo deletedAt).
    const dx = await prisma.user.create({
      data: { username: `${TAG}-daxoa`, email: DA_XOA_EMAIL, displayName: `${TAG} đã xoá`, role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4) },
    });
    daXoaId = dx.id;
    await prisma.user.update({ where: { id: dx.id }, data: { deletedAt: new Date() } });

    // Tài khoản PENDING: chưa kích hoạt, còn chứng thư mời sống.
    const pd = await prisma.user.create({
      data: {
        username: `${TAG}-pending@vd.test`, email: `${TAG}-pending@vd.test`, displayName: `${TAG} pending`, role: "manager",
        active: false, passwordHash: "x", inviteTokenHash: `${TAG}-hash`, inviteExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    pendingId = pd.id;

    // Một tài khoản đang KHÔNG có email — để chứng minh chốt chống trùng không hiểu `null` thành "khớp mọi hàng null".
    await prisma.user.create({
      data: { username: `${TAG}-khong-email`, email: null, displayName: `${TAG} không email`, role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4) },
    });

    quanTri = agentWithCsrf(app);
    const r = await quanTri.post("/api/auth/login").send({ username: ad.username, password: MAT_KHAU });
    expect(r.status, "không đăng nhập được bằng tài khoản quản trị vừa tạo").toBe(200);
  }, 60_000);

  // Mỗi `it` phải tự đứng được: về mốc đã biết trước mỗi kịch bản.
  beforeEach(async () => {
    if (nvId) await prisma.user.update({ where: { id: nvId }, data: { email: EMAIL_GOC, phone: "0909123456", active: true, inviteTokenHash: null, inviteExpiresAt: null } });
  });

  afterAll(async () => {
    const ids = (
      await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true }, includeDeleted: true })
    ).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("danh sách GET /api/users trả `email` — modal Sửa dựng ô từ chính hàng này", async () => {
    // Bước này ĐÃ xong từ trước bản vá (USER_SELECT có `email`). Khoá lại vì nó là ĐIỀU KIỆN CẦN của
    // luật ô-nạp-sẵn: gỡ cột khỏi select mà vẫn giữ ô trong modal là mỗi lần Lưu xoá trắng email.
    const r = await quanTri.get("/api/users");
    expect(r.status).toBe(200);
    expect(r.body.find((u) => u.id === nvId)?.email, "danh sách nhân viên KHÔNG kèm email → modal Sửa không pre-fill được").toBe(EMAIL_GOC);
  }, 60_000);

  it("PUT đổi email: ghi được, ĐỌC LẠI được trong phản hồi, và CÓ VẾT trong nhật ký", async () => {
    // Trước bản vá: 200, phản hồi trả email CŨ, cột không đổi, before/after của nhật ký GIỐNG HỆT NHAU.
    const moi = `${TAG}-moi@vd.test`;
    const r = await quanTri.put(`/api/users/${nvId}`).send({ email: moi });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body.email, "API không trả email → người gọi không xác nhận được là đã ghi").toBe(moi);
    expect((await doc(nvId)).email, "PUT không ghi được email vào CSDL — schema strip khoá im lặng").toBe(moi);

    const nk = await nhatKyMoiNhat();
    expect(nk?.before?.email, "nhật ký không lưu email CŨ — đổi định danh đăng nhập mà không có vết").toBe(EMAIL_GOC);
    expect(nk?.after?.email, "nhật ký không lưu email MỚI").toBe(moi);
  }, 60_000);

  it("đổi email là đổi ĐỊNH DANH ĐĂNG NHẬP: đăng nhập bằng địa chỉ mới phải được", async () => {
    // Nếu một bản vá "an toàn hơn" nào đó ghi email vào một cột khác, hay chuẩn hoá nó khi lưu, thì
    // mọi ca trên vẫn xanh mà người dùng vẫn không vào được. Đây là phép đo cuối cùng đúng nghĩa.
    const moi = `${TAG}-dangnhap@vd.test`;
    expect((await quanTri.put(`/api/users/${nvId}`).send({ email: moi })).status).toBe(200);
    const khach = agentWithCsrf(app);
    const r = await khach.post("/api/auth/login").send({ username: moi, password: MAT_KHAU });
    expect(r.status, "đổi email xong mà không đăng nhập được bằng địa chỉ mới").toBe(200);
  }, 60_000);

  it("XOÁ TRẮNG email bị CHẶN — email là đường phục hồi DUY NHẤT", async () => {
    /* NGOẠI LỆ CÓ CHỦ Ý so với luật "ô có nạp sẵn ⇒ rỗng = xoá" của ba ô hồ sơ bên cạnh.

       Lý do: endpoint quên-mật-khẩu LUÔN trả 200 để chống dò tài khoản (authService, `sendPasswordReset`).
       Nên email rỗng không báo lỗi ở đâu cả — người dùng bấm "Quên mật khẩu", thấy "đã gửi", rồi ngồi
       chờ một lá thư KHÔNG BAO GIỜ TỚI. Đường tự phục hồi duy nhất chết trong im lặng.

       Muốn bỏ một người thì KHOÁ tài khoản, đừng xoá email. Cả `""` và `null` tường minh đều phải bị
       chặn — hai giá trị cho cùng một ý "không có". */
    for (const v of ["", null]) {
      const r = await quanTri.put(`/api/users/${nvId}`).send({ email: v });
      expect(r.status, `gửi email=${JSON.stringify(v)} mà không bị chặn — đường đặt lại mật khẩu chết im lặng`).toBe(400);
      expect(r.body.error, "400 không nói ra phải làm gì thay thế").toMatch(/khoá tài khoản|kho[áa] t[àa]i kho[ảa]n/iu);
      expect((await doc(nvId)).email, "payload bị từ chối mà cột vẫn bị ghi đè").toBe(EMAIL_GOC);
    }
  }, 60_000);

  it("CHẶN ĐỔI email của tài khoản CHƯA kích hoạt — đổi là làm nó KẸT CỨNG", async () => {
    /* Đổi email BUỘC phải đốt chứng thư đang sống (xem ca dưới). Nhưng `listUsers` tính
       `pending: !active && !!inviteTokenHash`, và giao diện CHỈ hiện nút "Gửi lại lời mời" khi
       `pending`. Nên đốt token của một tài khoản chưa kích hoạt là làm nó rơi khỏi trạng thái "Chờ
       kích hoạt", MẤT LUÔN nút gửi lại — một hàng kẹt cứng mà admin không còn đường sửa.

       Và không mở nút "Gửi lại" cho mọi tài khoản `!active` được: `acceptInvite` đặt `active: true`,
       nên gửi lại lời mời cho tài khoản ĐÃ KHOÁ là cho họ tự kích hoạt lại.

       Đường đúng đã có sẵn ngay trên cùng một hàng: "Huỷ lời mời" rồi mời lại bằng địa chỉ mới. */
    const r = await quanTri.put(`/api/users/${pendingId}`).send({ email: `${TAG}-pending-doi@vd.test` });
    expect(r.status, "đổi được email của tài khoản pending — nó sẽ mất nút gửi lại lời mời").toBe(400);
    expect(r.body.error, "400 không chỉ ra đường thay thế (Huỷ lời mời rồi mời lại)").toMatch(/hu[ỷy] l[ờo]i m[ờo]i/iu);
    const sau = await doc(pendingId);
    expect(sau.email, "đã ghi đè dù payload bị từ chối").not.toBe(`${TAG}-pending-doi@vd.test`);
    expect(sau.inviteTokenHash, "chứng thư bị đốt dù lệnh đã bị từ chối — tài khoản kẹt cứng").toBeTruthy();
  }, 60_000);

  it("ĐỔI email thì ĐỐT chứng thư mời — hộp thư CŨ không kích hoạt được tài khoản nữa", async () => {
    // Cùng lớp rủi ro với nhánh `active === false` (đã bắt buộc đốt hai cột này vì token còn sống là
    // người bị khoá tự mở khoá lại được). Không đốt thì người giữ hộp thư cũ tự đặt mật khẩu và
    // chiếm tài khoản — bằng đúng đường mà việc đổi email lẽ ra phải cắt.
    // Tài khoản ĐÃ kích hoạt nhưng đang giữ một chứng thư đặt-lại còn hạn (ca thật: vừa bấm "Quên
    // mật khẩu" xong thì admin đổi email). Ca pending bị chặn ở trên, nên đây là đường duy nhất còn
    // đổi được email — và cũng là đường mà việc đốt token thực sự quan trọng.
    await prisma.user.update({
      where: { id: nvId },
      data: { inviteTokenHash: "a".repeat(64), inviteExpiresAt: new Date(Date.now() + 3600_000) },
    });
    const r = await quanTri.put(`/api/users/${nvId}`).send({ email: `${TAG}-doi-moi@vd.test` });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const sau = await doc(nvId);
    expect(sau.email).toBe(`${TAG}-doi-moi@vd.test`);
    expect(sau.inviteTokenHash, "đổi email mà chứng thư gửi tới hộp thư CŨ vẫn sống — chiếm được tài khoản").toBe(null);
    await prisma.user.update({ where: { id: nvId }, data: { email: EMAIL_GOC } });
  }, 60_000);

  it("trùng email của người khác → 409 nói rõ lý do, KHÔNG phải 200 và KHÔNG phải câu chữ chung của P2002", async () => {
    const r = await quanTri.put(`/api/users/${nvId}`).send({ email: NGUOI_KHAC_EMAIL });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(409);
    expect(r.body.error, "409 nhưng là câu chữ CHUNG của ràng buộc CSDL — không nói trùng cột nào với ai").not.toMatch(/trùng khóa duy nhất/iu);
    expect(r.body.error).toMatch(/email/iu);
    expect((await doc(nvId)).email, "đã ghi đè dù payload bị từ chối").toBe(EMAIL_GOC);
  }, 60_000);

  it("trùng KHÁC HOA/THƯỜNG cũng là trùng — `@unique` của Postgres KHÔNG chặn ca này", async () => {
    // Không có citext, nên "bob@x.com" cạnh "Bob@x.com" là HỢP LỆ với CSDL. Nhưng `findLoginUser` khớp
    // không-phân-biệt-hoa/thường, nên hai hàng cùng khớp một chuỗi đăng nhập. Đó đúng lý do
    // `timTaiKhoanTrung` phải tồn tại, và lý do chốt của PUT phải gọi nó chứ không tin vào index.
    const r = await quanTri.put(`/api/users/${nvId}`).send({ email: NGUOI_KHAC_EMAIL.toUpperCase() });
    expect(r.status, "trùng khác hoa/thường lọt qua — hai hàng cùng khớp một chuỗi đăng nhập").toBe(409);
  }, 60_000);

  it("trùng `username` của người khác → 409 (ca CSDL KHÔNG chặn được)", async () => {
    // Index `User_email_key` chỉ phủ email-vs-email, nên ca này qua Postgres TRƠN TRU. Hệ quả nếu lọt:
    // hai hàng cùng khớp một chuỗi đăng nhập ⇒ `findLoginUser` trả hàng tuỳ ý ⇒ mật khẩu đúng vẫn 401
    // và `failedAttempts` cộng lên tài khoản NGƯỜI KHÁC — khoá chéo tài khoản của người vô can.
    const r = await quanTri.put(`/api/users/${nvId}`).send({ email: NGUOI_KHAC_USERNAME });
    expect(r.status, "đặt email của A bằng username của B — CSDL cho qua, chỉ chốt ở tầng ứng dụng chặn được").toBe(409);
    expect((await doc(nvId)).email).toBe(EMAIL_GOC);
  }, 60_000);

  it("trùng email của tài khoản ĐÃ XOÁ MỀM → 409, và nói ra là đã xoá", async () => {
    // `find*` mặc định thêm `deletedAt: null` nên một chốt viết bình thường KHÔNG THẤY hàng này rồi ăn
    // P2002; index unique không partial theo `deletedAt`. Admin cần biết "địa chỉ đang bị một tài khoản
    // đã xoá giữ" để đi xoá cứng, chứ không phải đoán vì sao 409.
    const r = await quanTri.put(`/api/users/${nvId}`).send({ email: DA_XOA_EMAIL });
    expect(r.status, "chốt chống trùng không nhìn hàng xoá mềm → rơi xuống P2002").toBe(409);
    expect(r.body.error, "409 không nói địa chỉ thuộc về tài khoản ĐÃ XOÁ → admin không biết đường chữa").toMatch(/đã xóa|đã xoá/iu);
  }, 60_000);

  it("gửi lại CHÍNH email đang có → 200 (chốt loại-trừ-self)", async () => {
    // Modal Sửa gửi lại giá trị NẠP SẴN y nguyên mỗi lần Lưu. Chốt không loại trừ chính hàng đang sửa
    // là 409 MỖI LẦN bấm Lưu dù admin chỉ đổi số điện thoại — và cái 409 đó nói "email đã có tài khoản"
    // trong khi tài khoản đó là chính họ.
    const r = await quanTri.put(`/api/users/${nvId}`).send({ email: EMAIL_GOC, phone: "0911222333" });
    expect(r.status, "gửi lại email của chính mình bị coi là trùng — modal Sửa không lưu được gì nữa").toBe(200);
    expect((await doc(nvId)).phone).toBe("0911222333");
  }, 60_000);

  it("xoá email khi CSDL đã có tài khoản `email = null` → vẫn 200 (chốt chống 409 GIẢ)", async () => {
    // Prisma dịch `{ email: null }` thành `IS NULL`. Gọi chốt với `null` (dùng `!== undefined` thay vì
    // `if (data.email)`) khớp MỌI tài khoản không có email — mà mọi tài khoản đã vô danh hoá theo GDPR
    // đều `email: null` — nên không ai xoá được email nữa. Và nếu CSDL chưa có hàng null nào thì nó rơi
    // xuống `thoatLike(null)` ⇒ TypeError ⇒ 500.
    // Xoá email nay bị chặn, nên ca này kiểm bằng ĐỔI email: trong CSDL vẫn có hàng `email = null`
    // (mọi tài khoản đã vô danh hoá theo GDPR đều vậy), và chốt không được coi chúng là "trùng".
    // Không cần tạo hàng mới: bộ mốc đã có sẵn một hàng `email = null` — chính tài khoản
    // `${TAG}-admin` được tạo KHÔNG kèm email ở `beforeAll`. Tạo thêm chỉ rước lỗi trùng username.
    const soHangNull = await prisma.user.count({ where: { email: null } });
    expect(soHangNull, "mốc test sai: phải có ít nhất một hàng `email = null` để ca này có nghĩa").toBeGreaterThan(0);
    const r = await quanTri.put(`/api/users/${nvId}`).send({ email: `${TAG}-sau-null@vd.test` });
    expect(r.status, "409 GIẢ: chốt khớp cả hàng `email = null` nên không ai đổi được email nữa").toBe(200);
    expect((await doc(nvId)).email).toBe(`${TAG}-sau-null@vd.test`);
    await prisma.user.update({ where: { id: nvId }, data: { email: EMAIL_GOC } });
  }, 60_000);

  it("ký tự đại diện của LIKE không được biến chốt thành \"trùng với mọi người\"", async () => {
    // Phép so không-phân-biệt-hoa/thường của Prisma biên dịch thành ILIKE, nên `%` trong chuỗi là KÝ TỰ
    // ĐẠI DIỆN. Không thoát thì `%@vd.test` khớp mọi tài khoản và chốt thành "không đổi được email nữa".
    // `timTaiKhoanTrung` đã dùng `thoatLike`; ca này khoá lại để không ai gỡ.
    // Chuỗi này bị `.email()` từ chối ở tầng zod TRƯỚC khi tới chốt — đó chính là lớp phòng thủ thứ nhất,
    // nên kỳ vọng là 400, và điều PHẢI đúng là: không có 409 "trùng" nào, và cột không đổi.
    const r = await quanTri.put(`/api/users/${nvId}`).send({ email: `%@vd.test` });
    expect(r.status, "mẫu ILIKE được coi là một email TRÙNG — chốt đang so bằng ký tự đại diện").toBe(400);
    expect((await doc(nvId)).email).toBe(EMAIL_GOC);
    expect((await prisma.user.findFirst({ where: { id: nguoiKhacId }, select: { email: true } }))?.email, "email của người khác bị đụng").toBe(NGUOI_KHAC_EMAIL);
  }, 60_000);

  it("định dạng sai → 400 theo Ô, cùng câu chữ với đường MỜI; và ô rỗng KHÔNG bị gộp vào lỗi đó", async () => {
    // Bẫy zod: `.email()` chạy TRƯỚC `.transform()`. Viết sai thứ tự thì `{email:""}` cũng nhận
    // "Email không hợp lệ" — LỆNH XOÁ hiện ra như LỖI NHẬP LIỆU, admin đi sửa thứ không sai. Ca trên đã
    // khoá vế `""` → null; ca này khoá vế còn lại, và khoá luôn việc câu chữ/trần phải TRÙNG
    // `UserInviteSchema` (một trường thì một trần và một câu chữ).
    const sai = await quanTri.put(`/api/users/${nvId}`).send({ email: "khong-phai-email" });
    expect(sai.status, "chuỗi không phải email lọt xuống cột `@unique` là định danh đăng nhập").toBe(400);
    expect(JSON.stringify(sai.body), "400 không mang câu chữ theo ô → giao diện không tô đỏ được ô nào").toMatch(/Email không hợp lệ/u);
    expect((await doc(nvId)).email, "đã ghi đè dù payload bị từ chối").toBe(EMAIL_GOC);

    const dai = await quanTri.put(`/api/users/${nvId}`).send({ email: `${"x".repeat(160)}@vd.test` });
    expect(dai.status, "trần 160 ký tự không còn được áp").toBe(400);
    expect(JSON.stringify(dai.body)).toMatch(/Email tối đa 160 ký tự/u);

    // Khoảng trắng dán kèm phải được TRIM, không phải bị từ chối — `.email()` đặt trước `.trim()` là 400.
    const ok = await quanTri.put(`/api/users/${nvId}`).send({ email: `  ${TAG}-trim@vd.test  ` });
    expect(ok.status, "địa chỉ dán kèm khoảng trắng bị từ chối — `.email()` đang đứng trước `.trim()`").toBe(200);
    expect((await doc(nvId)).email).toBe(`${TAG}-trim@vd.test`);
  }, 60_000);

  it("vế đối trọng: KHÔNG gửi khoá `email` thì email KHÔNG đổi", async () => {
    // Nếu khoá vắng mặt bị quy về null thì mọi client gửi thiếu trường là xoá định danh đăng nhập của
    // người ta — chính hình dạng của sự cố xoá trắng 5/10 hồ sơ, chỉ khác cột và nặng hơn.
    const r = await quanTri.put(`/api/users/${nvId}`).send({ phone: "0933444555" });
    expect(r.status).toBe(200);
    expect((await doc(nvId)).email, "client không gửi `email` mà email bị XOÁ").toBe(EMAIL_GOC);
  }, 60_000);

  it("vế đối trọng: người tự sửa hồ sơ của mình vẫn KHÔNG đổi được email", async () => {
    // `ProfileUpdateSchema` cố ý không có `email`: đây là định danh đăng nhập, để quản trị giữ. Mở theo
    // là cho phép một nhân viên tự trỏ đường đặt-lại-mật-khẩu của mình sang hộp thư khác.
    const nv = agentWithCsrf(app);
    expect((await nv.post("/api/auth/login").send({ username: `${TAG}-nv`, password: MAT_KHAU })).status).toBe(200);
    const r = await nv.post("/api/auth/profile").send({ displayName: `${TAG} nv`, email: `${TAG}-tu-doi@vd.test` });
    expect(r.status).toBe(200);
    expect((await doc(nvId)).email, "nhân viên tự đổi được email của mình qua /auth/profile").toBe(EMAIL_GOC);
  }, 60_000);
});
