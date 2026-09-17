/**
 * ============================================================================
 * QUẢN TRỊ PHẢI ĐẶT ĐƯỢC "TÊN NGƯỜI GỬI" HỘ NHÂN VIÊN — VÀ BỎ TRỐNG THÌ KHÔNG XOÁ.
 *
 * ── THIẾU SÓT ──────────────────────────────────────────────────────────────
 * Cột `senderName` đã có trong CSDL (prisma/schema.prisma) và đã chạy trên hai đường TỰ PHỤC VỤ
 * (`POST /api/auth/profile`, `POST /api/auth/accept-invite`). Đường QUẢN TRỊ thì đứt ở ba điểm:
 *
 *     UserInviteSchema / UserCreateSchema / UserUpdateSchema   ← KHÔNG khai senderName
 *     createUser: const { username, …, title } = req.body      ← destructure TƯỜNG MINH, thiếu nó
 *     USER_SELECT = { …, phone, projectCode, … }               ← không trả senderName
 *
 * `validate()` làm `req.body = schemas.body.parse(req.body ?? {})`, mà z.object mặc định STRIP khoá
 * lạ — nên admin có gửi senderName lên thì service KHÔNG BAO GIỜ nhìn thấy, không một lỗi nào được
 * báo. Và kể cả ghi được thì GET /api/users vẫn không trả về, nên modal "Sửa" không pre-fill nổi.
 *
 * ── HẬU QUẢ ────────────────────────────────────────────────────────────────
 * Wizard tạo báo giá điền ô "Người gửi" từ chính trường này. Admin lập tài khoản hộ nhân viên mới
 * KHÔNG đặt được, nên đến lượt mình mỗi người phải tự vào Hồ sơ cá nhân gõ lại — ai chưa gõ thì
 * mọi báo giá của họ ra tên đăng nhập.
 *
 * ── BÀI NÀY KHOÁ ───────────────────────────────────────────────────────────
 * Ba đường ghi của quản trị (mời / tạo / sửa) đều nhận senderName, và ĐỌC LẠI được qua API.
 * Cộng VẾ BỎ TRỐNG, quan trọng không kém — và nó KHÔNG cùng một luật cho mọi cột:
 *
 *   `senderName`, `phone`  → modal Sửa NẠP SẴN từ GET /api/users ⇒ xoá trắng = XOÁ THẬT (null).
 *   `title`                → USER_SELECT không có cột này, API không trả về, modal không dựng nổi
 *                            ô ⇒ không client nào biết giá trị đang có ⇒ "" = KHÔNG ĐỔI.
 *
 * Đây chính là luật đã chốt sau hai sự cố ngược chiều nhau: coi "" là "không đổi" ở ô CÓ nạp sẵn
 * thì admin xoá ô, bấm Lưu, thấy toast "Đã lưu" mà cột vẫn nguyên (lưu mà không ăn); còn coi "" là
 * "xoá" ở ô KHÔNG nạp sẵn thì mỗi lần đặt lại mật khẩu là xoá trắng hồ sơ — đã xảy ra thật, 5/10
 * tài khoản (tests/dm-dat-lai-mat-khau-khong-xoa-ho-so.test.js). Luật ở tầng helper của
 * src/validators.ts: `oXoaDuoc` cho ô nạp sẵn, `oGiuLai` cho ô không nạp sẵn
 * (tests/hs-o-bo-trong-hai-luat.test.js khoá riêng hai helper đó).
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

const TAG = `sntng${Date.now()}`;
const MAT_KHAU = "Quan1234!tri";

describe.runIf(dbAvailable)("Quản trị đặt tên người gửi trên báo giá", () => {
  let app, quanTri, nhanVienId;

  const doc = (id) =>
    prisma.user.findUnique({ where: { id }, select: { senderName: true, phone: true, title: true, displayName: true } });

  /** Đặt hồ sơ nhân viên về mốc đã biết trước mỗi kịch bản (mỗi `it` phải tự đứng được). */
  const datMoc = () =>
    prisma.user.update({
      where: { id: nhanVienId },
      data: { senderName: "Chị Lan", phone: "0909123456", title: "Account", displayName: `${TAG} nv` },
    });

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    // Admin THẬT (role admin) — bài này không đụng tới phân quyền, chỉ đi đúng cổng user:manage
    // mà trang "Quản lý nhân viên" vẫn đi.
    const ad = await prisma.user.create({
      data: {
        username: `${TAG}-admin`,
        displayName: `${TAG} admin`,
        role: "admin",
        passwordHash: await bcrypt.hash(MAT_KHAU, 4),
      },
    });
    const nv = await prisma.user.create({
      data: {
        username: `${TAG}-nv`,
        displayName: `${TAG} nv`,
        role: "manager",
        passwordHash: await bcrypt.hash(MAT_KHAU, 4),
        senderName: "Chị Lan",
        phone: "0909123456",
        title: "Account",
      },
    });
    nhanVienId = nv.id;
    quanTri = agentWithCsrf(app);
    const r = await quanTri.post("/api/auth/login").send({ username: ad.username, password: MAT_KHAU });
    expect(r.status, "không đăng nhập được bằng tài khoản quản trị vừa tạo").toBe(200);
  }, 60_000);

  afterAll(async () => {
    // AuditEvent trỏ tới user nên phải xoá TRƯỚC. hardDelete/includeDeleted vì prisma của repo có
    // phần mở rộng soft-delete (src/db.ts) — thiếu hai cờ này là rác đọng lại trong quanly_test.
    const ids = (
      await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true }, includeDeleted: true })
    ).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("SỬA: PUT /api/users/:id đặt được tên người gửi, và ĐỌC LẠI được trong phản hồi", async () => {
    // Hai khẳng định là hai lỗ khác nhau: schema strip khoá lạ (ghi hụt) và USER_SELECT thiếu cột
    // (ghi được mà modal Sửa vẫn không pre-fill nổi). Thiếu một trong hai là tính năng vẫn đứt.
    await datMoc();
    const r = await quanTri.put(`/api/users/${nhanVienId}`).send({ senderName: "Nguyễn Thị Lan Anh" });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(r.body.senderName, "API không trả senderName → modal Sửa không pre-fill được").toBe("Nguyễn Thị Lan Anh");
    expect((await doc(nhanVienId)).senderName, "PUT không ghi được senderName vào CSDL").toBe("Nguyễn Thị Lan Anh");
  }, 60_000);

  it("SỬA: danh sách GET /api/users cũng trả senderName", async () => {
    // Modal Sửa dựng từ hàng trong danh sách, không gọi riêng GET /users/:id.
    await datMoc();
    const r = await quanTri.get("/api/users");
    expect(r.status).toBe(200);
    const hang = r.body.find((u) => u.id === nhanVienId);
    expect(hang, "không thấy nhân viên vừa tạo trong danh sách").toBeTruthy();
    expect(hang.senderName, "danh sách nhân viên KHÔNG kèm senderName").toBe("Chị Lan");
  }, 60_000);

  it("SỬA + BỎ TRỐNG: ô NẠP SẴN xoá trắng là XOÁ THẬT; ô không nạp sẵn thì KHÔNG ĐỔI", async () => {
    // Hai vế ngược nhau trong CÙNG một lệnh ghi, và ranh giới là "form có nhìn thấy giá trị cũ không".
    //
    // senderName + phone: modal Sửa pre-fill từ GET /api/users, admin NHÌN THẤY "Chị Lan" /
    //   "0909123456" rồi mới xoá ⇒ kỳ vọng duy nhất là nó biến mất. Bản trước quy "" về `undefined`,
    //   Prisma bỏ qua cột, mà giao diện vẫn toast "Đã lưu" — lưu mà không ăn, một lời nói dối im lặng.
    // title: USER_SELECT không có cột này nên API không trả về và modal không có ô Chức danh. Ô
    //   không nhìn thấy được thì "" không phải ý định của ai cả ⇒ phải GIỮ. Muốn cho admin sửa chức
    //   danh thì thêm `title: true` vào USER_SELECT TRƯỚC, rồi mới thêm ô và đổi helper — làm ngược
    //   thứ tự là mỗi lần bấm Lưu xoá sạch chức danh của người ta.
    await datMoc();
    const r = await quanTri.put(`/api/users/${nhanVienId}`).send({ senderName: "", phone: "", title: "", projectCode: "FE_A" });
    expect(r.status).toBe(200);

    const sau = await doc(nhanVienId);
    expect(sau.senderName, "xoá trắng ô mà tên người gửi VẪN CÒN — lưu mà không ăn").toBe(null);
    expect(sau.phone, "xoá trắng ô mà SĐT vẫn còn").toBe(null);
    expect(sau.title, "đã XOÁ chức danh dù không client nào đọc lại được cột này").toBe("Account");
    // Phản hồi phải nói đúng sự thật ngay: danh sách nhân viên dựng lại từ đây.
    expect(r.body.senderName, "phản hồi 200 vẫn trả giá trị CŨ").toBe(null);
    expect(r.body.phone).toBe(null);
  }, 60_000);

  it("SỬA: gửi giá trị MỚI thì vẫn đổi — vế đối trọng của ca trên", async () => {
    // Sửa thành "luôn giữ giá trị cũ" thì đổi tên người gửi trở nên bất khả, tức vá xong lại hỏng
    // đúng công dụng chính. Hai vế phải cùng đúng.
    await datMoc();
    const r = await quanTri.put(`/api/users/${nhanVienId}`).send({ senderName: "Tên Gửi Mới", phone: "0911222333" });
    expect(r.status).toBe(200);

    const sau = await doc(nhanVienId);
    expect(sau.senderName).toBe("Tên Gửi Mới");
    expect(sau.phone).toBe("0911222333");
  }, 60_000);

  it("MỜI: POST /api/users/invite lưu sẵn tên người gửi cho người chưa kích hoạt", async () => {
    // Đây là đường TẠO thật của trang Quản lý nhân viên (không có form username/password).
    const email = `${TAG}-moi@thu.vn`;
    const r = await quanTri.post("/api/users/invite").send({
      email, displayName: `${TAG} moi`, role: "manager", projectCode: "FE_B", senderName: "Trần Văn Mời", permissions: [],
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);

    const u = await prisma.user.findFirst({ where: { username: email }, select: { senderName: true } });
    expect(u?.senderName, "lời mời KHÔNG lưu senderName → nhân viên mới vẫn phải tự điền").toBe("Trần Văn Mời");
  }, 60_000);

  it("TẠO: POST /api/users lưu tên người gửi ngay khi tạo tài khoản", async () => {
    // Đường gọi API trực tiếp (không có trên giao diện). Nó destructure TƯỜNG MINH nên chỉ thêm vào
    // schema là chưa đủ — ca này bắt đúng cái bẫy đó.
    const username = `${TAG}-tao`;
    const r = await quanTri.post("/api/users").send({
      username, password: "Nhan1234!vien", displayName: `${TAG} tao`, role: "manager",
      phone: "0988777666", title: "Sale", senderName: "Lê Thị Tạo",
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
    expect(r.body.senderName, "phản hồi tạo tài khoản không có senderName").toBe("Lê Thị Tạo");

    const u = await prisma.user.findFirst({ where: { username }, select: { senderName: true, title: true } });
    expect(u?.senderName, "createUser bỏ rơi senderName dù zod đã cho qua").toBe("Lê Thị Tạo");
  }, 60_000);

  it("giữ nguyên trần 120 ký tự của helper dùng chung", async () => {
    // Bốn nơi khai senderName đều đi ra từ cùng một factory trong validators.ts (`oGiuLai` /
    // `oXoaDuoc`, cùng con số 120). Ca này khoá việc đó: đẻ một định nghĩa riêng ở một schema
    // (hoặc quên .max) là chúng trôi khỏi nhau ngay.
    await datMoc();
    const r = await quanTri.put(`/api/users/${nhanVienId}`).send({ senderName: "x".repeat(121) });
    expect(r.status, "senderName dài quá vẫn được nhận → không còn đi qua helper chung").toBe(400);
    expect((await doc(nhanVienId)).senderName, "đã ghi đè dù payload bị từ chối").toBe("Chị Lan");
  }, 60_000);
});
