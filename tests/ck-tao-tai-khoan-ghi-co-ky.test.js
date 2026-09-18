/**
 * ============================================================================
 * CỜ QUYỀN KÝ: SCHEMA NHẬN MÀ HÀNG KHÔNG GHI.
 *
 * ── LỖI THẬT ───────────────────────────────────────────────────────────────
 * `UserCreateSchema` khai `canSign: zbool.optional()`, nhưng `createUser` destructure TƯỜNG MINH
 * bảy trường (`username, password, displayName, role, phone, title, senderName`) — không có nó. Zod
 * cho qua, `prisma.user.create` không thấy cột, hàng ghi thiếu, phản hồi 201, KHÔNG một lỗi nào.
 * Admin tích ô "cho phép ký" rồi tạo tài khoản, và quyền ký không bao giờ được cấp.
 *
 * Trớ trêu là chú thích cảnh báo ĐÚNG lớp lỗi này đã có sẵn ngay trong khối `data` — nó được viết
 * cho `senderName` lần trước, rồi không ai áp lại cho dòng ngay dưới nó.
 *
 * ── ĐÂY LÀ QUYỀN THẬT, KHÔNG PHẢI CỜ TRANG TRÍ ────────────────────────────
 * `resolveUserPermissions` cộng `quote:sign:own` vào tập hiệu lực khi cờ này bật, và middleware
 * resolve lại tập đó TỪ CSDL ở MỖI request. Nên cờ rơi mất nghĩa là quyền được cưỡng chế ở máy chủ
 * bị mất, không phải một cái nút bị ẩn.
 *
 * ── NÓI ĐÚNG MỨC ĐỘ: ĐƯỜNG NÀY CHƯA CÓ NGƯỜI GỌI TỪ GIAO DIỆN ─────────────
 * `web/src/lib/api.ts` KHÔNG có hàm `createUser` nào — trang Quản lý nhân viên chỉ có modal Mời
 * (`POST /api/users/invite`) và modal Sửa (`PUT /api/users/:id`). Nên `POST /api/users` hiện chỉ có
 * người gọi API trực tiếp và bài kiểm. Đây là LỖI TIỀM ẨN của tầng API, không phải sự cố đang xảy
 * ra trên giao diện — nhưng vẫn phải vá: một trường schema hứa nhận mà tầng dưới ném đi là cái bẫy
 * chờ đúng người sau nào bật ô đó lên.
 *
 * ── VÌ SAO TRƯỚC ĐÓ KHÔNG AI THẤY ──────────────────────────────────────────
 * tests/validators.test.js CÓ một ca chạm `canSign` — và nó tạo sự yên tâm SAI: nó chỉ gọi
 * `UserCreateSchema.parse(...)` rồi khẳng định chuỗi "false" ra `false`. Ca đó XANH cả khi
 * `createUser` ném trường đi, vì nó đo tầng PARSE chứ không đo tầng GHI. Bài này đi đường GHI.
 *
 * `inviteUser` thì KHÔNG thuộc phạm vi lỗi: `UserInviteSchema` cũng không khai `canSign`, nên hai
 * nửa nhất quán và không có gì bị rơi. Ca cuối tệp khoá lại điều đó để không ai "vá cho đủ" bằng
 * cách mở một đường tự cấp quyền ký cho người tự onboard.
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { PERMISSIONS } from "../src/permissions.js";

const dbAvailable = await prisma
  .$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `ckky${Date.now()}`;
const MAT_KHAU = "CoKy1234!ok";

describe.runIf(dbAvailable)("POST /api/users phải GHI cờ canSign, không chỉ nhận nó", () => {
  let app, quanTri;

  const tao = (than) => quanTri.post("/api/users").send({ password: MAT_KHAU, role: "manager", ...than });

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    const ad = await prisma.user.create({
      data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) },
    });
    quanTri = agentWithCsrf(app);
    const r = await quanTri.post("/api/auth/login").send({ username: ad.username, password: MAT_KHAU });
    expect(r.status, "không đăng nhập được bằng tài khoản quản trị vừa tạo").toBe(200);
  }, 60_000);

  afterAll(async () => {
    const ids = (
      await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true }, includeDeleted: true })
    ).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("canSign: true → CỘT trong CSDL bật, không chỉ zod cho qua", async () => {
    // Vế chính. Trước bản vá: 201, `r.body.canSign === false`, cột trong CSDL `false`, không lỗi nào.
    const username = `${TAG}-co-ky`;
    const r = await tao({ username, displayName: `${TAG} có ký`, canSign: true });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);

    const hang = await prisma.user.findUnique({ where: { username }, select: { id: true, canSign: true } });
    expect(hang?.canSign, "zod cho `canSign` qua mà hàng vẫn ghi thiếu — destructure tường minh ném trường đi, im lặng").toBe(true);
    // Ghi được thì phải đọc lại được: người gọi API không có cách nào khác để xác nhận.
    expect(r.body.canSign, "phản hồi 201 không trả canSign → người gọi không xác nhận được là đã ghi").toBe(true);
  }, 60_000);

  it("cờ đó CẤP QUYỀN THẬT: `quote:sign:own` có mặt trong quyền hiệu lực", async () => {
    // Nếu ai đó "vá" bằng cách chỉ trả `canSign` về trong phản hồi mà không ghi cột, ca trên có thể
    // qua được. Ca này đi qua đúng hàm mà middleware dùng để cưỡng chế quyền ở MỖI request.
    const ds = await quanTri.get("/api/users");
    expect(ds.status).toBe(200);
    const hang = ds.body.find((u) => u.username === `${TAG}-co-ky`);
    expect(hang, "không thấy tài khoản vừa tạo trong danh sách").toBeTruthy();
    expect(
      hang.effectivePermissions,
      "canSign đã ghi nhưng không bắc cầu thành quyền ký — cờ này phải đi qua resolveUserPermissions"
    ).toContain(PERMISSIONS.QUOTE_SIGN_OWN);
  }, 60_000);

  it("vế đối trọng: KHÔNG gửi `canSign` thì cờ TẮT, không phải bật theo", async () => {
    // Vá bằng một giá trị mặc định sai chiều (`canSign ?? true`, hay `!!canSign` trên một biến chưa
    // khai) là cấp quyền ký cho MỌI tài khoản mới — nới quyền im lặng, tệ hơn lỗi ban đầu.
    const username = `${TAG}-khong-ky`;
    const r = await tao({ username, displayName: `${TAG} không ký` });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
    expect((await prisma.user.findUnique({ where: { username }, select: { canSign: true } }))?.canSign, "không gửi canSign mà tài khoản mới vẫn được cấp quyền ký").toBe(false);
    expect(r.body.canSign).toBe(false);
  }, 60_000);

  it("vế đối trọng: chuỗi \"false\" vẫn ra false — cổng zbool còn nguyên trên đường GHI", async () => {
    // tests/validators.test.js đã khoá điều này ở tầng parse. Ở đây khoá lại trên đường GHI: một bản
    // vá đọc thẳng `req.body.canSign` bằng `Boolean(...)` (bỏ qua `zbool`) sẽ biến "false" thành TRUE
    // — đúng cái bẫy JS mà `zbool` tồn tại để chặn, chỉ dịch xuống một tầng.
    const username = `${TAG}-chuoi-false`;
    const r = await tao({ username, displayName: `${TAG} chuỗi false`, canSign: "false" });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
    expect((await prisma.user.findUnique({ where: { username }, select: { canSign: true } }))?.canSign, 'chuỗi "false" được hiểu thành TRUE — đường ghi đã đi vòng qua zbool').toBe(false);
  }, 60_000);

  it("vế đối trọng: đường MỜI không nhận canSign, và đó là chủ ý", async () => {
    // Người tự onboard không được tự cấp quyền ký. `UserInviteSchema` không khai khoá này, nên
    // `validate()` (z.object) strip nó im lặng — hai nửa NHẤT QUÁN, không có gì bị rơi như ở create.
    // Ca này chặn việc "vá cho đủ" bằng cách mở luôn đường mời.
    const email = `${TAG}-moi@vd.test`;
    const r = await quanTri.post("/api/users/invite").send({ email, displayName: `${TAG} mời`, role: "manager", canSign: true });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(201);
    expect((await prisma.user.findFirst({ where: { email }, select: { canSign: true } }))?.canSign, "đường MỜI cấp được quyền ký — người tự onboard tự cấp quyền cho mình").toBe(false);
  }, 60_000);
});
