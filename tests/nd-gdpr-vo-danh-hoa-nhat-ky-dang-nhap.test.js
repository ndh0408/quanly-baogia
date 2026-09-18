/**
 * ============================================================================
 * "QUYỀN ĐƯỢC QUÊN" CHẠY XONG MÀ EMAIL THẬT + IP + VÂN TAY THIẾT BỊ CỦA NGƯỜI ĐÓ VẪN NẰM TRONG
 * BẢNG `LoginAttempt`.
 *
 * ── QUYẾT ĐỊNH ĐÃ ĐẢO CHIỀU (2026-09-18) ──────────────────────────────────
 * Trước đây repo CỐ Ý không đụng bảng này, và quyết định đó được khoá bằng một khẳng định trên VĂN
 * BẢN NGUỒN trong tests/gx-gdpr-xoa-sot-cot-pii.test.js. Lý lẽ hồi đó không sai — nó chỉ không phải
 * một cái cớ: một phép `updateMany({ where: { username } })` so BYTE-FOR-BYTE sẽ SÓT hàng, và "xoá
 * sót mà đọc vào tưởng đã xong" thì tệ hơn không xoá. Chủ hệ thống nay yêu cầu xoá, nên lý lẽ ấy
 * thành BẢN ĐẶC TẢ của phép lọc, và bài này đo đúng từng vế của nó.
 *
 * ── BÀI NÀY ĐI ĐÚNG CHỖ BẢN VÁ CŨ SAI, VÀ THÊM MỘT CHỖ NỮA ────────────────
 * Bảng không có khoá ngoại về User; chuỗi `username` là đường lần ra DUY NHẤT. Phía GHI lưu ĐÚNG
 * chuỗi người dùng gõ (`authCore.ts`: `username: loginId`), phía ĐỌC (`findLoginUser`) khớp KHÔNG
 * PHÂN BIỆT HOA/THƯỜNG và khớp CẢ cột `email`. Nên hàng cần ẩn danh gồm bốn hình dạng, và bài dựng
 * đủ cả bốn: username đúng · username KHÁC HOA/THƯỜNG · email · email khác hoa/thường.
 *
 * Và một cái bẫy NGƯỢC CHIỀU, nặng hơn cái bẫy trên, mà bài kiểm cũ MÙ hoàn toàn: Prisma biên dịch
 * `equals` + `mode: "insensitive"` thành **ILIKE**, không phải `lower() = lower()`. Nên `_` và `%`
 * trong chuỗi trở thành KÝ TỰ ĐẠI DIỆN — mà regex `username` CHO PHÉP `_`, và tài khoản mời qua
 * email lấy thẳng email làm username. Chữa cái "xoá sót" mà quên `thoatLike` là tự tay XOÁ QUÁ:
 * phá dấu vết đăng nhập của NGƯỜI KHÁC, đúng thứ bản vá này tồn tại để tránh. Nạn nhân ở đây mang
 * `_` trong username, và nhân chứng là chuỗi mà dấu `_` ấy quét trúng.
 *
 * Vế thứ ba: chỉ hàng `success: true` được đụng. `recordAttempt(false, "no_such_user")` ghi một hàng
 * cho MỌI chuỗi người lạ gõ vào, nên ip/userAgent của hàng thất bại là dấu vết của người KHÁC —
 * bằng chứng an ninh, không phải dữ liệu cá nhân của người xin xoá. Hàng thành công thì người gõ đã
 * chứng minh biết mật khẩu VÀ qua cổng MFA.
 *
 * ── MỘT KIỂU THẤT BẠI IM LẶNG PHẢI CHẶN RIÊNG ─────────────────────────────
 * `username`/`email` cũ phải đọc TRƯỚC transaction, vì chính transaction đó ghi đè `username` và đặt
 * `email = null`. Đọc sau là khớp 0 hàng — và `updateMany` trả `count: 0` chứ không ném, nên đường
 * xoá vẫn trả 200 và không ai biết. Mọi khẳng định dưới đây đều soi CSDL sau lượt HTTP thật, chứ
 * không soi văn bản nguồn: một chốt đo văn bản nguồn xanh được cả khi phép lọc khớp 0 hàng.
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

const TAG = `ndla${Date.now()}`;
const MAT_KHAU = "NhatKy1234!dn";

// Nạn nhân mang `_` trong username — ký tự HỢP LỆ theo regex username, và là ký tự đại diện
// một-ký-tự của ILIKE. Nhân chứng là chuỗi mà dấu `_` ấy quét trúng (`_` ↔ `X`).
const NAN_NHAN_USERNAME = `${TAG}_ha`;
const NHAN_CHUNG_USERNAME = `${TAG}Xha`;
const NAN_NHAN_EMAIL = `${TAG}-mail@vd.test`;
const IP_THAT = "203.0.113.7";
const UA_THAT = "Mozilla/5.0 (thiet-bi-that)";

describe.runIf(dbAvailable)("Xoá theo GDPR: nhật ký đăng nhập của người đó bị ẩn danh, của người khác thì không", () => {
  let app, quanTri, nanNhanId, tenThayThe;

  const nhatKy = (username) => prisma.loginAttempt.findMany({ where: { username }, orderBy: { id: "asc" } });
  /** Hàng THÀNH CÔNG còn sót dưới một chuỗi định danh — vế "phải biến mất". Lọc `success` vì hàng
   *  THẤT BẠI mang cùng username CỐ Ý được giữ lại (xem ca riêng bên dưới): không lọc thì khẳng định
   *  "đã biến mất" sẽ đỏ vì đúng cái hàng mà bài này đòi phải còn. */
  const conSotThanhCong = (username) => prisma.loginAttempt.findMany({ where: { username, success: true }, orderBy: { id: "asc" } });

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    const ad = await prisma.user.create({
      data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) },
    });
    const nn = await prisma.user.create({
      data: { username: NAN_NHAN_USERNAME, email: NAN_NHAN_EMAIL, displayName: `${TAG} nạn nhân`, role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4) },
    });
    nanNhanId = nn.id;
    await prisma.user.create({
      data: { username: NHAN_CHUNG_USERNAME, email: `${TAG}-chung@vd.test`, displayName: `${TAG} nhân chứng`, role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4) },
    });

    // Bốn hình dạng PHẢI bị ẩn danh + hai hàng PHẢI còn nguyên. Dựng bằng `create` thẳng thay vì gọi
    // /login thật: ở đây cần điều khiển chính xác chuỗi `username` đã lưu, mà /login thì còn đụng
    // failedAttempts/lockout và làm bài phụ thuộc bcrypt cost.
    const dat = (username, success, ip = IP_THAT) =>
      prisma.loginAttempt.create({ data: { username, ip, userAgent: UA_THAT, success, reason: success ? null : "bad_password" } });

    await dat(NAN_NHAN_USERNAME, true);                       // (1) username đúng
    await dat(NAN_NHAN_USERNAME.toUpperCase(), true);          // (2) username khác hoa/thường
    await dat(NAN_NHAN_EMAIL, true);                           // (3) gõ EMAIL để đăng nhập
    await dat(NAN_NHAN_EMAIL.toUpperCase(), true);             // (4) email khác hoa/thường
    await dat(NAN_NHAN_USERNAME, false, "198.51.100.44");      // (5) THẤT BẠI — dấu vết người khác dò
    await dat(NHAN_CHUNG_USERNAME, true, "10.0.0.9");          // (6) nhân chứng bị dấu `_` quét trúng

    quanTri = agentWithCsrf(app);
    const r = await quanTri.post("/api/auth/login").send({ username: ad.username, password: MAT_KHAU });
    expect(r.status, "không đăng nhập được bằng tài khoản quản trị vừa tạo").toBe(200);

    const xoa = await quanTri.post(`/api/gdpr/users/${nanNhanId}/delete`).send({ confirm: "DELETE-USER" });
    expect(xoa.status, JSON.stringify(xoa.body).slice(0, 300)).toBe(200);

    const sau = await prisma.user.findFirst({ where: { id: nanNhanId }, includeDeleted: true, select: { username: true } });
    tenThayThe = sau?.username;
    expect(tenThayThe, "hàng User không còn hoặc chưa được đổi tên — mốc của cả tệp này sai").toMatch(/^deleted-/u);
  }, 60_000);

  afterAll(async () => {
    const ids = (
      await prisma.user.findMany({ where: { OR: [{ username: { contains: TAG } }, { username: tenThayThe ?? "__khong-co__" }] }, select: { id: true }, includeDeleted: true })
    ).map((u) => u.id);
    await prisma.loginAttempt.deleteMany({ where: { OR: [{ username: { contains: TAG } }, { username: tenThayThe ?? "__khong-co__" }] } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ids } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("hàng đăng nhập THÀNH CÔNG gõ bằng USERNAME bị đổi tên + gỡ ip/userAgent", async () => {
    expect(await conSotThanhCong(NAN_NHAN_USERNAME), "username thật của người đã yêu cầu được quên vẫn nằm trong nhật ký đăng nhập").toEqual([]);
  }, 60_000);

  it("hàng gõ KHÁC HOA/THƯỜNG cũng bị ẩn danh — đúng chỗ bản vá cũ SÓT", async () => {
    // Đây là lý do số 1 mà quyết định cũ nêu ra để không xoá. Một phép so byte-for-byte để nguyên
    // hàng này: cùng một con người, cùng một IP, chỉ khác cách gõ chữ hoa.
    expect(await conSotThanhCong(NAN_NHAN_USERNAME.toUpperCase()), "phép lọc so BYTE-FOR-BYTE — hàng gõ khác hoa/thường còn nguyên email thật + IP").toEqual([]);
  }, 60_000);

  it("hàng gõ bằng EMAIL cũng bị ẩn danh — `findLoginUser` khớp cả cột email", async () => {
    // Lý do số 1, nửa thứ hai: người dùng đăng nhập được bằng email, nên chuỗi lưu trong nhật ký có
    // thể là EMAIL THẬT của họ — thứ nhạy hơn cả username.
    expect(await conSotThanhCong(NAN_NHAN_EMAIL), "hàng đăng nhập bằng email còn nguyên — email thật vẫn nằm trong nhật ký sau khi đã xoá tài khoản").toEqual([]);
    expect(await conSotThanhCong(NAN_NHAN_EMAIL.toUpperCase()), "hàng đăng nhập bằng email khác hoa/thường còn nguyên").toEqual([]);
  }, 60_000);

  it("bốn hàng đó nằm dưới tên thay thế, và KHÔNG còn ip/userAgent", async () => {
    // Đổi tên chứ KHÔNG xoá hàng: giữ SỐ HÀNG nên dòng thời gian an ninh (bao nhiêu lần đăng nhập
    // thành công, lúc nào) còn nguyên — cùng cách `RefreshToken` đang được xử lý.
    const con = await nhatKy(tenThayThe);
    expect(con.length, "không đủ 4 hàng dưới tên thay thế — phép lọc khớp thiếu hình dạng nào đó, hoặc đã XOÁ HÀNG thay vì đổi tên").toBe(4);
    for (const h of con) {
      expect(h.success, "một hàng THẤT BẠI bị cuốn theo — ip/userAgent ở đó là dấu vết người khác").toBe(true);
      expect(h.ip, "IP thật vẫn nằm lại trong hàng đã đổi tên — đổi tên mà giữ IP là làm nửa việc").toBe(null);
      expect(h.userAgent, "vân tay thiết bị vẫn nằm lại").toBe(null);
    }
  }, 60_000);

  it("hàng `success: false` CÒN NGUYÊN, kể cả IP — đó là bằng chứng an ninh, không phải PII của người xoá", async () => {
    // `recordAttempt(false, "no_such_user")` ghi một hàng cho MỌI chuỗi người lạ gõ vào, nên hàng
    // thất bại mang tên nạn nhân có thể do NGƯỜI KHÁC gõ. Quét sạch theo username là xoá dấu vết của
    // một lượt dò mật khẩu — mất đúng thứ mà bảng này tồn tại để giữ.
    const con = await prisma.loginAttempt.findMany({ where: { success: false, ip: "198.51.100.44" } });
    expect(con.length, "hàng đăng nhập THẤT BẠI bị cuốn theo — mất dấu vết của lượt dò mật khẩu").toBe(1);
    expect(con[0].username, "hàng thất bại bị đổi tên theo").toBe(NAN_NHAN_USERNAME);
    expect(con[0].ip, "IP của hàng thất bại bị xoá — đó là IP của NGƯỜI KHÁC").toBe("198.51.100.44");
    expect(con[0].userAgent, "user-agent của hàng thất bại bị xoá").toBe(UA_THAT);
  }, 60_000);

  it("vế đối trọng KÝ TỰ ĐẠI DIỆN: nhật ký của người khác KHÔNG bị dấu `_` của nạn nhân quét trúng", async () => {
    // Đo được trên Prisma 7.10.0 + adapter-pg: `mode: "insensitive"` ra `ILIKE $n`, nên `_` là ký tự
    // đại diện một-ký-tự. Không bọc `thoatLike` thì `ndla…_ha` khớp luôn `ndla…Xha` — bản vá GDPR tự
    // tay phá dữ liệu của người vô can, trên CSDL production thật. Bài kiểm cũ MÙ với ca này vì cả
    // nạn nhân lẫn nhân chứng của nó đều không chứa `_`.
    const con = await nhatKy(NHAN_CHUNG_USERNAME);
    expect(con.length, "nhật ký đăng nhập của NGƯỜI KHÁC bị đổi tên theo — phép lọc thiếu `thoatLike`, `_` đang là ký tự đại diện").toBe(1);
    expect(con[0].ip, "IP của người khác bị xoá theo").toBe("10.0.0.9");
    expect(con[0].userAgent, "vân tay thiết bị của người khác bị xoá theo").toBe(UA_THAT);
  }, 60_000);

  it("vế đối trọng: hàng User của người khác không mất gì, và nhật ký kiểm toán của lượt xoá vẫn được ghi", async () => {
    const nc = await prisma.user.findFirst({ where: { username: NHAN_CHUNG_USERNAME } });
    expect(nc?.email, "email của người khác bị xoá theo").toBe(`${TAG}-chung@vd.test`);
    expect(nc?.deletedAt, "tài khoản của người khác bị đánh dấu xoá theo").toBe(null);

    const n = await prisma.auditEvent.findMany({ where: { action: "gdpr.delete.by_admin", resourceId: String(nanNhanId) } });
    expect(n.length, "không ghi nhật ký cho lượt xoá theo GDPR").toBeGreaterThan(0);
  }, 60_000);
});
