/**
 * ============================================================================
 * ĐẶT LẠI MẬT KHẨU KHÔNG ĐƯỢC XOÁ TRẮNG HỒ SƠ.
 *
 * ── LỖI ────────────────────────────────────────────────────────────────────
 * `POST /api/auth/accept-invite` KIÊM LUÔN "Quên mật khẩu" — cùng một token, cùng một đường cấp
 * phiên (xem chú thích `passwordChangedAt` trong src/services/authService.ts). Nhưng nó ghi:
 *
 *     displayName: displayName?.trim() || user.displayName,   ← bỏ trống thì GIỮ
 *     phone:       phone?.trim() || null,                     ← bỏ trống thì XOÁ
 *     title:       title?.trim() || null,                     ← XOÁ
 *     senderName:  senderName?.trim() || null,                ← XOÁ
 *
 * Tức mỗi lần một người đặt lại mật khẩu mà không gõ lại SĐT / chức danh / tên người gửi thì ba
 * trường đó bị xoá trắng, IM LẶNG, không báo gì.
 *
 * ── HẬU QUẢ ĐÃ THẤY TRÊN PRODUCTION ────────────────────────────────────────
 * 5/10 tài khoản trống cả ba trường, trong đó có tài khoản tạo gần như toàn bộ báo giá. Người dùng
 * gặp đúng triệu chứng này: "lúc đầu có nhập khi tạo tài khoản mà nó không ăn, phải vào phần hồ sơ
 * cập nhật lại thì ăn" — họ ĐÃ nhập, chỉ là một lần đặt lại mật khẩu sau đó đã xoá đi.
 *
 * Mất ba trường này không phải chuyện thẩm mỹ: wizard tạo báo giá tự điền người gửi từ chính chúng
 * (`me.phone` / `me.title` / `me.senderName`, xem web/src/pages/NewQuoteWizard.tsx). Trống thì mỗi
 * báo giá mới phải gõ tay lại, và người ta sẽ gõ sai.
 *
 * ── BÀI NÀY KHOÁ ───────────────────────────────────────────────────────────
 * Bỏ trống = GIỮ NGUYÊN. Gửi giá trị mới = ĐỔI. Hai vế, và vế thứ hai quan trọng không kém: sửa
 * thành "luôn giữ" thì người nhận lời mời lần đầu không điền được gì cả.
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

const TAG = `dmhs${Date.now()}`;
const MK_CU = "Cu1234!abcd";
const MK_MOI = "Moi1234!abcd";
const bam = (t) => createHash("sha256").update(String(t)).digest("hex");

describe.runIf(dbAvailable)("Đặt lại mật khẩu giữ nguyên hồ sơ", () => {
  let app, userId;

  /** Cấp một token đặt-lại còn hạn. `acceptInvite` tiêu thụ token nên mỗi kịch bản cần token mới. */
  async function tokenMoi() {
    const t = randomBytes(24).toString("hex");
    await prisma.user.update({
      where: { id: userId },
      data: { inviteTokenHash: bam(t), inviteExpiresAt: new Date(Date.now() + 3600_000) },
    });
    return t;
  }

  /** Đặt lại hồ sơ về mốc đã biết trước mỗi kịch bản. */
  const datMoc = () =>
    prisma.user.update({
      where: { id: userId },
      data: { phone: "0909123456", title: "Account", senderName: "Lan Anh", displayName: `${TAG} tên` },
    });

  const doc = () =>
    prisma.user.findUnique({ where: { id: userId }, select: { phone: true, title: true, senderName: true, displayName: true } });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const u = await prisma.user.create({
      data: {
        username: `${TAG}@thu.vn`,
        displayName: `${TAG} tên`,
        role: "manager",
        passwordHash: await bcrypt.hash(MK_CU, 4),
        phone: "0909123456",
        title: "Account",
        senderName: "Lan Anh",
      },
    });
    userId = u.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("KHÔNG gửi SĐT/chức danh/tên người gửi → cả ba GIỮ NGUYÊN", async () => {
    await datMoc();
    const r = await agentWithCsrf(app)
      .post("/api/auth/accept-invite")
      .send({ token: await tokenMoi(), password: MK_MOI });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);

    const sau = await doc();
    expect(sau.phone, "đặt lại mật khẩu đã XOÁ số điện thoại").toBe("0909123456");
    expect(sau.title, "đã XOÁ chức danh").toBe("Account");
    expect(sau.senderName, "đã XOÁ tên người gửi").toBe("Lan Anh");
    expect(sau.displayName).toBe(`${TAG} tên`);
  }, 60_000);

  it("gửi chuỗi RỖNG cũng là bỏ trống → vẫn GIỮ NGUYÊN", async () => {
    // Form web gửi "" chứ không bỏ hẳn trường khi người dùng không gõ gì. Chỉ chặn `undefined` mà
    // quên chuỗi rỗng là để nguyên lỗi cũ cho đúng đường mà người dùng thật đi qua.
    await datMoc();
    const r = await agentWithCsrf(app)
      .post("/api/auth/accept-invite")
      .send({ token: await tokenMoi(), password: MK_MOI, phone: "", title: "", senderName: "" });
    expect(r.status).toBe(200);

    const sau = await doc();
    expect(sau.phone).toBe("0909123456");
    expect(sau.title).toBe("Account");
    expect(sau.senderName).toBe("Lan Anh");
  }, 60_000);

  it("CÓ gửi giá trị mới → ĐỔI theo, không phải lúc nào cũng giữ", async () => {
    // Vế đối trọng. Sửa thành "luôn giữ giá trị cũ" thì người nhận lời mời LẦN ĐẦU không điền được
    // gì cả — hỏng đúng công dụng chính của đường này.
    await datMoc();
    const r = await agentWithCsrf(app).post("/api/auth/accept-invite").send({
      token: await tokenMoi(),
      password: MK_MOI,
      displayName: "Tên Mới",
      phone: "0911222333",
      title: "Director",
      senderName: "Tên Gửi Mới",
    });
    expect(r.status).toBe(200);

    const sau = await doc();
    expect(sau.phone).toBe("0911222333");
    expect(sau.title).toBe("Director");
    expect(sau.senderName).toBe("Tên Gửi Mới");
    expect(sau.displayName).toBe("Tên Mới");
  }, 60_000);

  it("người MỚI (hồ sơ trống) vẫn điền được lần đầu", async () => {
    // Ca nhận lời mời thật: trước đó cả ba đều null, người dùng gõ vào và phải được lưu.
    await prisma.user.update({ where: { id: userId }, data: { phone: null, title: null, senderName: null } });
    const r = await agentWithCsrf(app).post("/api/auth/accept-invite").send({
      token: await tokenMoi(), password: MK_MOI, phone: "0977000111", title: "Sale", senderName: "Người Gửi",
    });
    expect(r.status).toBe(200);

    const sau = await doc();
    expect(sau.phone).toBe("0977000111");
    expect(sau.title).toBe("Sale");
    expect(sau.senderName).toBe("Người Gửi");
  }, 60_000);
});
