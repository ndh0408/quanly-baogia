/**
 * ============================================================================
 * MỌI ĐƯỜNG CẤP PHIÊN PHẢI TRẢ ĐỦ NHƯ NHAU — THIẾU MỘT TRƯỜNG LÀ MỘT LỆNH XOÁ NGẦM.
 *
 * ── VÌ SAO TỆP NÀY TỒN TẠI ─────────────────────────────────────────────────
 * SPA lấy THẲNG phản hồi của đường cấp phiên làm state `me` (web/src/App.tsx: `onLogin(m)` →
 * `setMe(m)`), và chỉ gọi lại `/auth/me` khi có sự kiện SSE "session:refresh". Tức suốt cả phiên
 * vừa tạo, `me` đúng bằng những gì đường đó trả về.
 *
 * Trang Hồ sơ nạp ô bằng `me.phone || ""`, `me.title || ""`. Và luật đã chốt của repo là:
 *
 *     Ô CÓ nạp sẵn giá trị hiện tại  →  bỏ trống = XOÁ
 *
 * Ghép hai điều đó lại: một trường THIẾU trong phản hồi cấp phiên sẽ làm ô của nó hiện RỖNG dù
 * trong CSDL đang có giá trị — rồi lần Lưu hồ sơ kế tiếp biến chính ô rỗng ấy thành lệnh xoá.
 *
 * ── ĐÃ XẢY RA THẬT ─────────────────────────────────────────────────────────
 * `/login` trả đủ `phone` + `title`; `acceptInvite` (kiêm luôn "Quên mật khẩu") thì KHÔNG. Nên
 * người vừa đặt lại mật khẩu xong, vào Hồ sơ, thấy hai ô đó trống, sửa mỗi "Tên người gửi" rồi bấm
 * Lưu — mất luôn SĐT và chức danh. Đúng triệu chứng của sự cố đã vá ở
 * tests/dm-dat-lai-mat-khau-khong-xoa-ho-so.test.js, nhưng đi vào bằng CỬA KHÁC: lần đó mất ở
 * chính lệnh accept-invite, lần này mất ở lần Lưu hồ sơ ngay sau đó.
 *
 * ── BÀI NÀY KHOÁ QUAN HỆ, KHÔNG KHOÁ DANH SÁCH ─────────────────────────────
 * Ghim một danh sách trường thì thêm cột mới vào Hồ sơ là bài kiểm vẫn xanh trong khi lỗ hổng mở
 * lại. Nên bài này so `accept-invite` VỚI `/login`: hai đường cùng cấp phiên đầy đủ thì phải trả
 * cùng bộ khoá. Thêm cột vào một bên mà quên bên kia là ĐỎ ngay.
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
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

const TAG = `hscp${Date.now()}`;
const MK = "Cu1234!abcd";
const MK_MOI = "Moi1234!abcd";
const bam = (t) => createHash("sha256").update(String(t)).digest("hex");

describe.runIf(dbAvailable)("Đường cấp phiên trả đủ trường", () => {
  let app, userId;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const u = await prisma.user.create({
      data: {
        username: `${TAG}@thu.vn`,
        displayName: `${TAG} tên`,
        role: "manager",
        passwordHash: await bcrypt.hash(MK, 4),
        phone: "0909123456",
        title: "Account",
        senderName: "Tên Gửi",
      },
    });
    userId = u.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.user
      .deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true })
      .catch(() => {});
  });

  /** Cấp token đặt-lại còn hạn. `acceptInvite` tiêu thụ token nên mỗi ca cần token mới. */
  async function tokenMoi() {
    const t = randomBytes(24).toString("hex");
    await prisma.user.update({
      where: { id: userId },
      data: { inviteTokenHash: bam(t), inviteExpiresAt: new Date(Date.now() + 3600_000) },
    });
    return t;
  }

  it("accept-invite trả ĐỦ BỘ KHOÁ như /login", async () => {
    // Vế chính. So hai bộ khoá với nhau chứ không so với một danh sách ghim cứng.
    const rLogin = await agentWithCsrf(app).post("/api/auth/login").send({ username: `${TAG}@thu.vn`, password: MK });
    expect(rLogin.status, JSON.stringify(rLogin.body).slice(0, 200)).toBe(200);

    const rAccept = await agentWithCsrf(app)
      .post("/api/auth/accept-invite")
      .send({ token: await tokenMoi(), password: MK_MOI });
    expect(rAccept.status, JSON.stringify(rAccept.body).slice(0, 200)).toBe(200);

    const thieu = Object.keys(rLogin.body).filter((k) => !(k in rAccept.body));
    expect(thieu, `accept-invite thiếu khoá so với /login: ${thieu.join(", ")} — mỗi khoá thiếu là một ô Hồ sơ hiện rỗng, và lần Lưu kế tiếp sẽ xoá cột đó`).toEqual([]);
  }, 60_000);

  it("accept-invite trả ĐÚNG GIÁ TRỊ đang có trong CSDL, không phải rỗng", async () => {
    // Có khoá mà giá trị `null` thì ô vẫn hiện rỗng — hỏng y hệt. Nên phải soi giá trị.
    await prisma.user.update({
      where: { id: userId },
      data: { phone: "0909123456", title: "Account", senderName: "Tên Gửi" },
    });
    const r = await agentWithCsrf(app)
      .post("/api/auth/accept-invite")
      .send({ token: await tokenMoi(), password: MK_MOI });
    expect(r.status).toBe(200);
    expect(r.body.phone, "ô SĐT ở trang Hồ sơ sẽ hiện RỖNG").toBe("0909123456");
    expect(r.body.title, "ô Chức danh ở trang Hồ sơ sẽ hiện RỖNG").toBe("Account");
    expect(r.body.senderName).toBe("Tên Gửi");
  }, 60_000);

  it("kịch bản đầy đủ: đặt lại mật khẩu → Lưu hồ sơ → SĐT và chức danh CÒN NGUYÊN", async () => {
    // Đây là đường mà người dùng thật đi, và là chỗ dữ liệu từng mất. Dựng lại y nguyên: đặt lại
    // mật khẩu, rồi gửi đúng payload mà trang Hồ sơ gửi khi người ta chỉ sửa mỗi "Tên người gửi" —
    // tức bốn khoá, trong đó phone/title lấy từ `me` vừa nhận được.
    await prisma.user.update({
      where: { id: userId },
      data: { phone: "0909123456", title: "Account", senderName: "Tên Gửi" },
    });

    const ag = agentWithCsrf(app);
    const r = await ag.post("/api/auth/accept-invite").send({ token: await tokenMoi(), password: MK_MOI });
    expect(r.status).toBe(200);

    const me = r.body; // đúng thứ SPA gán vào state `me`
    const luu = await ag.post("/api/auth/profile").send({
      displayName: me.displayName,
      senderName: "Tên Gửi Mới",
      phone: me.phone ?? "", // trang Hồ sơ nạp ô bằng `me.phone || ""`
      title: me.title ?? "",
    });
    expect(luu.status, JSON.stringify(luu.body).slice(0, 200)).toBe(200);

    const sau = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, title: true, senderName: true },
    });
    expect(sau.phone, "Lưu hồ sơ sau khi đặt lại mật khẩu đã XOÁ số điện thoại").toBe("0909123456");
    expect(sau.title, "đã XOÁ chức danh").toBe("Account");
    expect(sau.senderName, "tên người gửi phải đổi theo đúng ý người dùng").toBe("Tên Gửi Mới");
  }, 60_000);
});
