/**
 * ============================================================================
 * "QUYỀN ĐƯỢC QUÊN" ĐÃ CHẠY XONG MÀ TÊN THẬT CỦA NGƯỜI ĐÓ VẪN NẰM TRONG CSDL.
 *
 * ── LỖI THẬT ───────────────────────────────────────────────────────────────
 * `anonymizeUserOps` xoá username/displayName/email/phone/title/MFA nhưng BỎ SÓT `senderName` —
 * cột giữ TÊN THẬT của một con người và là nguồn ô "Người gửi" IN LÊN BÁO GIÁ GỬI RA NGOÀI. Nên
 * sau khi tài khoản đã bị xoá theo yêu cầu GDPR và `deletedAt` đã đặt, tên người ấy vẫn còn nguyên,
 * vẫn đọc ra được, và wizard vẫn in nó lên tài liệu gửi cho khách.
 *
 * Cùng một lối bỏ sót còn để lại: `projectCode` (định danh giả gắn với một con người, đóng vào mã
 * mọi báo giá họ tạo), `lastLoginAt`/`lastLoginIp` (IP là dữ liệu cá nhân — chính bản xuất GDPR
 * trả cột này về cho chủ thể), `inviteTokenHash`/`inviteExpiresAt` (chứng thư kích hoạt còn SỐNG:
 * đường KHOÁ tài khoản đã bắt buộc đốt hai cột này, đường XOÁ thì không), và `passwordChangedAt`
 * không hề được đặt — tức chốt chặn phiên ĐỘC LẬP với kho phiên không hề đóng.
 *
 * Ngoài bảng User còn hai bản sao nữa của chính người đó: `RefreshToken.ip`/`userAgent` (trước đây
 * chỉ được đặt `revokedAt`) và `user_sessions.sess` (JSON chứa `displayName` + `username` thật).
 * Repo CÓ sẵn `destroyAllSessions`, ba service khác đều gọi, riêng gdprService thì không — nên
 * đường ADMIN xoá hộ không huỷ MỘT phiên cookie nào của nạn nhân.
 *
 * `LoginAttempt` thì CỐ Ý ĐỂ NGUYÊN — đã thử xoá rồi gỡ bỏ; lý do đầy đủ nằm ở ca kiểm cuối tệp
 * này và ở docblock của `anonymizeUserOps`.
 *
 * ── VÌ SAO TRƯỚC ĐÓ KHÔNG AI THẤY ──────────────────────────────────────────
 * Không có bài kiểm nào gác đường xoá. Cả 5 tệp `*gdpr*` trong tests/ đều về đường XUẤT. Nên thêm
 * một cột dữ liệu cá nhân mới vào `model User` mà quên vô danh hoá là lọt tuyệt đối im lặng — đúng
 * kịch bản `senderName` và `projectCode` đã đi qua.
 *
 * ── BÀI NÀY KHOÁ QUAN HỆ, KHÔNG KHOÁ DANH SÁCH ─────────────────────────────
 * Ghim một danh sách cột thì thêm cột mới vào schema là bài vẫn xanh trong khi lỗ hổng mở lại —
 * đúng cái bẫy mà tests/hs-cap-phien-tra-du-truong.test.js đã đặt luật để tránh. Nên ở đây:
 *
 *   Phần A đọc THẲNG `model User` trong prisma/schema.prisma, trừ đi một DANH SÁCH MIỄN TRỪ có ghi
 *          lý do từng cột, rồi đòi mọi cột còn lại phải có mặt trong khối `data` của
 *          `anonymizeUserOps`. Thêm cột mới ⇒ nó không nằm trong miễn trừ ⇒ ĐỎ.
 *   Phần B đi đường HTTP thật (admin xoá hộ), và cũng dựng dữ liệu mẫu THEO schema chứ không theo
 *          danh sách gõ tay: mỗi cột không-miễn-trừ được nhồi một giá trị dấu vân tay, và sau khi
 *          xoá thì KHÔNG cột nào được còn giữ dấu vân tay của nó.
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const SCHEMA = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const NGUON_GDPR = readFileSync(new URL("../src/services/gdprService.ts", import.meta.url), "utf8");

// ── DANH SÁCH MIỄN TRỪ ───────────────────────────────────────────────────────
// Cột của `model User` KHÔNG phải xoá khi thực thi quyền-được-quên. Mỗi dòng phải có lý do: đây là
// chỗ DUY NHẤT một cột được phép sống sót, nên thêm tên vào đây là một quyết định, không phải một
// thao tác dọn dẹp cho bài kiểm xanh lại.
const MIEN_TRU = {
  id: "khoá chính — báo giá, nhật ký kiểm toán và mọi FK còn trỏ về; đổi nó là làm hỏng bản ghi của người khác",
  role: "nhãn nghiệp vụ (admin/manager/…), không định danh ai; giữ để nhật ký cũ còn đọc được đúng ngữ cảnh",
  permissions: "tập quyền per-user — mô tả cái tài khoản được làm, không mô tả con người",
  canSign: "cờ quyền ký, cùng loại với `permissions`",
  failedAttempts: "bộ đếm chống dò mật khẩu; tài khoản đã bị khoá vĩnh viễn nên nó vô nghĩa, không phải PII",
  lockedUntil: "mốc khoá do bộ đếm trên sinh ra, cùng lý do",
  createdAt: "mốc tạo hàng — bản ghi vận hành của hệ thống, và là thứ nhật ký kiểm toán cần để xếp thời gian",
  updatedAt: "Prisma tự quản (@updatedAt), không ghi được giá trị tuỳ ý",
};

/** Tên mọi `model` trong schema — dùng để loại các trường QUAN HỆ ra khỏi danh sách cột. */
const TEN_MODEL = new Set([...SCHEMA.matchAll(/^model\s+(\w+)\s*\{/gmu)].map((m) => m[1]));

/** Đọc các trường CỘT (scalar + enum, bỏ quan hệ) của một model trong schema.prisma. */
function cotCuaModel(ten) {
  const khoi = SCHEMA.match(new RegExp(`^model\\s+${ten}\\s*\\{([\\s\\S]*?)^\\}`, "mu"));
  if (!khoi) throw new Error(`không tìm thấy model ${ten} trong prisma/schema.prisma`);
  const ra = [];
  for (const dong of khoi[1].split("\n")) {
    const t = dong.trim();
    if (!t || t.startsWith("//") || t.startsWith("@@")) continue;
    const m = t.match(/^(\w+)\s+([A-Za-z]\w*)(\[\])?(\?)?/u);
    if (!m) continue;
    const [, ten2, kieu, mang, rong] = m;
    if (TEN_MODEL.has(kieu)) continue; // trường quan hệ
    ra.push({ ten: ten2, kieu, mang: !!mang, rong: !!rong });
  }
  return ra;
}

const COT_USER = cotCuaModel("User");
/** Cột PHẢI được đường xoá xử lý = mọi cột trừ danh sách miễn trừ. */
const COT_PHAI_XOA = COT_USER.filter((c) => !(c.ten in MIEN_TRU));

// ─────────────────────────────────────────────────────────────────────────────
// PHẦN A — quan hệ schema ↔ khối `data`, KHÔNG cần CSDL
// ─────────────────────────────────────────────────────────────────────────────
describe("Đường xoá GDPR phủ hết cột của model User", () => {
  /** Khoá xuất hiện trong khối `data` của lệnh `prisma.user.update` bên trong anonymizeUserOps. */
  const khoaTrongKhoiData = () => {
    const ham = NGUON_GDPR.match(/function anonymizeUserOps\([\s\S]*?\n\}/u);
    expect(ham, "không còn hàm `anonymizeUserOps` trong src/services/gdprService.ts — bài kiểm này đang đo một hàm không tồn tại").toBeTruthy();
    const capNhat = ham[0].slice(ham[0].indexOf("prisma.user.update"));
    return new Set([...capNhat.matchAll(/^\s+(\w+):/gmu)].map((m) => m[1]));
  };

  it("mọi cột KHÔNG miễn trừ đều có mặt trong khối `data` — thêm cột PII mới là ĐỎ", () => {
    // Vế chính, và là chốt chống tái diễn: `senderName` lọt được vì không ai đối chiếu schema với
    // khối `data`. Đối chiếu ấy chính là ca này.
    const daXuLy = khoaTrongKhoiData();
    const sot = COT_PHAI_XOA.map((c) => c.ten).filter((t) => !daXuLy.has(t));
    expect(
      sot,
      `cột của model User còn sống sót sau khi xoá tài khoản: ${sot.join(", ")} — hoặc vô danh hoá chúng trong anonymizeUserOps, hoặc khai vào MIEN_TRU kèm lý do (đừng im lặng bỏ qua)`
    ).toEqual([]);
  });

  it("vế đối trọng: danh sách miễn trừ không được nở ra ngoài schema", () => {
    // Nếu ai đó xoá một cột khỏi schema mà quên gỡ khỏi MIEN_TRU, danh sách miễn trừ dần thành một
    // bãi tên chết và lần rà sau không phân biệt được "đã cân nhắc" với "sót lại".
    const khongCon = Object.keys(MIEN_TRU).filter((t) => !COT_USER.some((c) => c.ten === t));
    expect(khongCon, `MIEN_TRU kể tên cột không còn trong model User: ${khongCon.join(", ")}`).toEqual([]);
  });

  it("ba bảng ngoài User cũng phải bị chạm tới trong cùng đường xoá", () => {
    // Bảng thì không suy ra được từ schema như cột, nên chỗ này buộc phải nêu tên. Giá trị của nó
    // là chặn việc GỠ ÂM THẦM: bỏ một trong ba dòng dưới đây thì PII quay lại sống sót ngay.
    // `[^)]*` chứ KHÔNG phải `[\s\S]*?`: mẫu bắc cầu qua nhiều dòng sẽ khớp `userAgent: null` của
    // MỘT LỆNH KHÁC nằm bên dưới, tức khẳng định không đo đúng thứ nó nói là đang đo.
    expect(NGUON_GDPR, "refresh token bị thu hồi mà vẫn giữ IP + user-agent của từng lần đăng nhập").toMatch(/refreshToken\.updateMany\([^)]*userAgent: null/u);
    // LoginAttempt: CỐ Ý KHÔNG ĐỤNG. Khoá lại quyết định để người sau khỏi "sửa cho đủ" rồi tái
    // phạm — lý do đầy đủ nằm trong docblock của `anonymizeUserOps`, tóm tắt: lọc theo `username`
    // so byte-for-byte sẽ SÓT hàng (phía ghi lưu đúng chuỗi người gõ, phía đọc khớp không phân biệt
    // hoa/thường và khớp cả email), mà một phép xoá sót đọc vào tưởng đã xong thì tệ hơn không xoá.
    expect(NGUON_GDPR, "đã thêm lại phép xoá LoginAttempt — đọc docblock anonymizeUserOps trước khi làm").not.toMatch(/loginAttempt\.updateMany/u);
    expect(NGUON_GDPR, "không huỷ phiên cookie: `sess` chứa displayName + username thật, và người bị admin xoá vẫn dùng tiếp tab đang mở").toMatch(/destroyAllSessions\(/u);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHẦN B — đi đường HTTP thật: admin xoá hộ → soi lại từng cột trong CSDL
// ─────────────────────────────────────────────────────────────────────────────
const dbAvailable = await prisma
  .$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `gxpii${Date.now()}`;
const MAT_KHAU = "Xoa1234!pii";

/** Giá trị dấu vân tay theo KIỂU của cột. Kiểu lạ thì ĐỎ kèm hướng dẫn, không im lặng bỏ qua. */
function mau(c) {
  const theoKieu = {
    String: () => `PII-${c.ten}-${TAG}`,
    Int: () => 424242,
    Boolean: () => true,
    DateTime: () => new Date("2020-01-02T03:04:05.000Z"),
  };
  const f = theoKieu[c.kieu];
  if (!f) throw new Error(`cột User.${c.ten} kiểu ${c.kieu} chưa có giá trị mẫu — thêm vào bảng \`theoKieu\` rồi chạy lại`);
  return c.mang ? [f()] : f();
}

// `deletedAt` là ĐÍCH của thao tác xoá, không phải đầu vào: nhồi sẵn mốc vào đó là hàng bị soft-delete
// ngay từ đầu, đường xoá không tìm thấy người để xoá. Nó vẫn được kiểm riêng ở ca chính.
const KHONG_NHOI = new Set(["id", "deletedAt"]);
const COT_NHOI = COT_PHAI_XOA.filter((c) => !KHONG_NHOI.has(c.ten));

describe.runIf(dbAvailable)("Xoá tài khoản theo GDPR: không cột nào giữ lại dấu vân tay", () => {
  let app, quanTri, nanNhanId, nhanChungId, tenCu, tenChung;
  const SID = `${TAG}-sid`;
  const SID_CHUNG = `${TAG}-sid-chung`;

  const themPhien = (sid, userId, displayName, username) =>
    prisma.$executeRawUnsafe(
      `INSERT INTO user_sessions (sid, sess, expire) VALUES ($1, $2::json, now() + interval '1 day')`,
      sid,
      JSON.stringify({ userId, displayName, username, cookie: {} })
    );
  const demPhien = async (userId) =>
    Number((await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM user_sessions WHERE (sess ->> 'userId')::int = $1`, userId))[0].n);

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();

    const ad = await prisma.user.create({
      data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) },
    });

    // Nạn nhân: MỌI cột không-miễn-trừ đều mang dấu vân tay, dựng THEO schema chứ không gõ tay.
    const dl = {};
    for (const c of COT_NHOI) dl[c.ten] = mau(c);
    const nn = await prisma.user.create({ data: dl });
    nanNhanId = nn.id;
    tenCu = nn.username;

    // Nhân chứng: cùng hình dạng dữ liệu, KHÔNG bị xoá — vế đối trọng cho mọi khẳng định bên dưới.
    const nc = await prisma.user.create({
      data: {
        username: `${TAG}-chung`, displayName: `${TAG} chung`, role: "manager",
        passwordHash: await bcrypt.hash(MAT_KHAU, 4),
        senderName: "Chị Chứng", projectCode: "NC_A", phone: "0900000000", title: "Account",
        lastLoginIp: "10.0.0.9", lastLoginAt: new Date("2020-01-02T03:04:05.000Z"),
      },
    });
    nhanChungId = nc.id;
    tenChung = nc.username;

    for (const [uid, uname] of [[nanNhanId, tenCu], [nhanChungId, tenChung]]) {
      await prisma.refreshToken.create({
        data: { userId: uid, tokenHash: `${TAG}-${uid}`, family: `${TAG}-fam-${uid}`, ip: "203.0.113.7", userAgent: "Mozilla/5.0 (thiet-bi-that)", expiresAt: new Date(Date.now() + 86_400_000) },
      });
      await prisma.loginAttempt.create({ data: { username: uname, ip: "203.0.113.7", userAgent: "Mozilla/5.0 (thiet-bi-that)", success: true } });
    }
    await themPhien(SID, nanNhanId, `${TAG} nan-nhan`, tenCu);
    await themPhien(SID_CHUNG, nhanChungId, `${TAG} chung`, tenChung);

    quanTri = agentWithCsrf(app);
    const r = await quanTri.post("/api/auth/login").send({ username: ad.username, password: MAT_KHAU });
    expect(r.status, "không đăng nhập được bằng tài khoản quản trị vừa tạo").toBe(200);
  }, 60_000);

  afterAll(async () => {
    const ids = (
      await prisma.user.findMany({ where: { username: { contains: TAG } }, select: { id: true }, includeDeleted: true })
    ).map((u) => u.id);
    await prisma.$executeRawUnsafe(`DELETE FROM user_sessions WHERE sid LIKE $1`, `${TAG}%`).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { contains: TAG } } }).catch(() => {});
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ids } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("admin xoá hộ → KHÔNG cột nào của model User còn giữ giá trị cũ", async () => {
    const r = await quanTri.post(`/api/gdpr/users/${nanNhanId}/delete`).send({ confirm: "DELETE-USER" });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);

    const sau = await prisma.user.findFirst({ where: { id: nanNhanId }, includeDeleted: true });
    expect(sau, "hàng bị XOÁ CỨNG — báo giá và nhật ký cũ mất chỗ trỏ về; quyền-được-quên là vô danh hoá, không phải xoá hàng").toBeTruthy();

    const conSot = COT_NHOI.filter((c) => JSON.stringify(sau[c.ten]) === JSON.stringify(mau(c))).map((c) => c.ten);
    expect(
      conSot,
      `xoá xong mà các cột này vẫn y nguyên: ${conSot.join(", ")} — mỗi cột là một mảnh dữ liệu cá nhân của một người đã yêu cầu được quên`
    ).toEqual([]);

    expect(sau.deletedAt, "không đặt deletedAt — tài khoản chưa thật sự bị xoá").toBeTruthy();
    expect(sau.active, "tài khoản vẫn hoạt động sau khi xoá").toBe(false);
    // Mốc này là chốt chặn phiên ĐỘC LẬP với kho phiên: không đặt thì mọi access token JWT phát
    // hành trước lúc xoá vẫn qua được phép so thời gian ở middleware.
    expect(sau.passwordChangedAt?.getTime() ?? 0, "không đóng mốc passwordChangedAt — token cũ vẫn sống").toBeGreaterThan(Date.now() - 120_000);
  }, 60_000);

  it("refresh token: thu hồi VÀ gỡ IP + user-agent", async () => {
    const t = await prisma.refreshToken.findFirst({ where: { userId: nanNhanId } });
    expect(t?.revokedAt, "refresh token chưa bị thu hồi").toBeTruthy();
    expect(t?.ip, "token đã thu hồi nhưng IP thật vẫn nằm lại").toBe(null);
    expect(t?.userAgent, "vân tay thiết bị vẫn nằm lại").toBe(null);
  }, 60_000);

  it("nhật ký đăng nhập CỐ Ý còn nguyên — và đó là quyết định, không phải bỏ sót", async () => {
    /* Đã thử xoá rồi GỠ BỎ. Hai lý do, cả hai đều đo được:

       1. Lọc `where: { username }` so BYTE-FOR-BYTE. Phía ghi lưu đúng chuỗi người dùng gõ
          (`authCore.ts`: `username: loginId`), phía đọc khớp KHÔNG phân biệt hoa/thường và khớp cả
          cột `email`. Nên hàng sinh ra từ lần gõ khác hoa/thường — hoặc gõ email khi email khác
          username — KHÔNG bị chạm, giữ nguyên email thật + IP + user-agent. Một phép xoá SÓT mà
          đọc vào tưởng đã xong còn tệ hơn không xoá: nó tạo sự yên tâm sai.
       2. `ip`/`userAgent` của hàng `success: false` là dấu vết của NGƯỜI KHÁC gõ vào tài khoản này
          — bằng chứng an ninh, không phải dữ liệu cá nhân của người xin xoá.

       Retention tự dọn bảng sau 365 ngày (RETAIN_LOGIN_DAYS). Bài này khoá QUYẾT ĐỊNH lại: ai
       muốn đổi thì phải sửa cả bài kiểm và đọc lý do ở trên trước. */
    const con = await prisma.loginAttempt.findMany({ where: { username: tenCu } });
    expect(con.length, "hàng nhật ký đăng nhập bị đụng tới — xem lý do trong chính bài kiểm này").toBe(1);
    expect(con[0].ip, "IP trong nhật ký đăng nhập bị xoá — đó có thể là dấu vết của người khác").toBe("203.0.113.7");
  }, 60_000);

  it("mọi phiên cookie của người bị xoá bị huỷ — kể cả khi ADMIN xoá hộ", async () => {
    // Route chỉ `session.destroy()` cho đường TỰ xoá, tức phiên của chính admin đang thao tác.
    // Không gọi destroyAllSessions thì nạn nhân vẫn dùng tiếp tab đang mở, và hàng `user_sessions`
    // (JSON chứa displayName + username thật) nằm đó tới khi hết hạn.
    expect(await demPhien(nanNhanId), "phiên của người bị xoá vẫn còn trong kho phiên").toBe(0);
  }, 60_000);

  it("vế đối trọng: người KHÔNG bị xoá không mất gì cả", async () => {
    // Một bản vá quét sạch theo userId sai, hay một `updateMany` thiếu `where`, sẽ xanh ở mọi ca
    // trên mà vẫn phá dữ liệu của người khác. Ca này là chốt chặn đó.
    const nc = await prisma.user.findFirst({ where: { id: nhanChungId } });
    expect(nc?.senderName, "xoá một người mà tên người gửi của người khác cũng mất").toBe("Chị Chứng");
    expect(nc?.projectCode).toBe("NC_A");
    expect(nc?.lastLoginIp).toBe("10.0.0.9");
    expect(nc?.deletedAt, "tài khoản của người khác bị đánh dấu xoá theo").toBe(null);

    const t = await prisma.refreshToken.findFirst({ where: { userId: nhanChungId } });
    expect(t?.ip, "refresh token của người khác bị gỡ IP theo").toBe("203.0.113.7");
    expect(t?.revokedAt, "refresh token của người khác bị thu hồi theo").toBe(null);

    expect((await prisma.loginAttempt.findMany({ where: { username: tenChung } })).length, "nhật ký đăng nhập của người khác bị đổi tên theo").toBe(1);
    expect(await demPhien(nhanChungId), "phiên của người khác bị huỷ theo").toBe(1);

    // Và phiên của chính admin đang thao tác phải sống — nếu không thì mỗi lần xoá hộ một người là
    // admin bị đá ra ngoài giữa chừng.
    const ds = await quanTri.get("/api/users");
    expect(ds.status, "admin bị đăng xuất sau khi xoá hộ tài khoản người khác").toBe(200);
  }, 60_000);

  it("vế đối trọng: nhật ký kiểm toán của lượt xoá vẫn được ghi", async () => {
    // Giữ vết hành động là nghĩa vụ pháp lý, và cũng là thứ duy nhất còn lại để chứng minh đã thực
    // thi yêu cầu xoá. Một bản vá "dọn sạch mọi thứ liên quan" sẽ cuốn luôn cả chỗ này.
    const n = await prisma.auditEvent.findMany({ where: { action: "gdpr.delete.by_admin", resourceId: String(nanNhanId) } });
    expect(n.length, "không ghi nhật ký cho lượt xoá theo GDPR").toBeGreaterThan(0);
  }, 60_000);
});
