/**
 * ============================================================================
 * CHỨC DANH: GHI XUỐNG ĐƯỢC MÀ KHÔNG ĐỌC LẠI ĐƯỢC.
 *
 * ── LỖI THẬT ───────────────────────────────────────────────────────────────
 * `UserCreateSchema` và `UserUpdateSchema` đều NHẬN `title`, `createUser`/`updateUser` đều GHI được
 * xuống CSDL — nhưng `USER_SELECT` không có cột đó, nên KHÔNG đường đọc nào của quản trị trả nó về.
 * Ba hệ quả, cái sau nặng hơn cái trước:
 *
 *   1. Modal "Sửa" không dựng nổi ô Chức danh (nó pre-fill từ hàng trong GET /api/users), nên admin
 *      không nhìn thấy và không sửa được thứ đang được IN LÊN BÁO GIÁ GỬI KHÁCH. Người được mời qua
 *      email mà bỏ trống ô Chức danh ở màn #/onboard thì không ai sửa hộ được nữa.
 *   2. Phản hồi 201/200 của POST/PUT không chứa `title`, nên người gọi API không xác nhận được là
 *      đã ghi — ghi xong vẫn không biết mình vừa ghi gì.
 *   3. NẶNG NHẤT — MẤT VẾT. `updateUser` lấy `before` và `after` đều bằng `USER_SELECT` rồi ghi
 *      thẳng hai object đó vào nhật ký. Cột nào vắng mặt trong select thì before/after GIỐNG HỆT
 *      NHAU: một lượt `PUT /api/users/:id` đổi chức danh in trên tài liệu gửi ra ngoài không để lại
 *      một dấu vết nào. Đường này không cần giao diện — ai có `user:manage` gọi curl là được.
 *
 * ── THỨ TỰ VÁ LÀ BẮT BUỘC, VÀ ĐÃ ĐƯỢC VIẾT SẴN TỪ TRƯỚC ───────────────────
 * Chú thích ở src/validators.ts đã chốt: thêm `title: true` vào USER_SELECT TRƯỚC, rồi mới thêm ô
 * vào modal (NẠP SẴN từ `user.title`), rồi mới đổi helper `oGiuLai` → `oXoaDuoc`. Làm ngược thứ tự
 * — đổi helper khi ô chưa nạp sẵn, hay thêm ô mà không nạp sẵn — là mỗi lần bấm Lưu xoá sạch chức
 * danh của người ta, đúng cái bẫy đã xoá trắng hồ sơ 5/10 tài khoản trên production
 * (tests/dm-dat-lai-mat-khau-khong-xoa-ho-so.test.js).
 *
 * ── BÀI NÀY KHOÁ ───────────────────────────────────────────────────────────
 * Ghi được thì phải đọc lại được (API + nhật ký), và vì giờ ô CÓ nạp sẵn nên bỏ trống là XOÁ THẬT —
 * kèm vế đối trọng: KHÔNG gửi khoá thì KHÔNG đổi, và giá trị thật vẫn đi qua nguyên vẹn.
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

const TAG = `cdcd${Date.now()}`;
const MAT_KHAU = "Chuc1234!danh";

describe.runIf(dbAvailable)("Quản trị sửa chức danh nhân viên", () => {
  let app, quanTri, nhanVienId;

  const doc = (id) => prisma.user.findUnique({ where: { id }, select: { title: true, phone: true, senderName: true } });

  /** Về mốc đã biết trước mỗi kịch bản — mỗi `it` phải tự đứng được. */
  const datMoc = () =>
    prisma.user.update({ where: { id: nhanVienId }, data: { title: "Account", phone: "0909123456", senderName: "Chị Lan" } });

  /** Bản ghi nhật ký `user.update` mới nhất của nhân viên này. */
  const nhatKyMoiNhat = () =>
    prisma.auditEvent.findFirst({
      where: { action: "user.update", resourceId: String(nhanVienId) },
      orderBy: { id: "desc" },
    });

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    const ad = await prisma.user.create({
      data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(MAT_KHAU, 4) },
    });
    const nv = await prisma.user.create({
      data: {
        username: `${TAG}-nv`, displayName: `${TAG} nv`, role: "manager",
        passwordHash: await bcrypt.hash(MAT_KHAU, 4),
        title: "Account", phone: "0909123456", senderName: "Chị Lan",
      },
    });
    nhanVienId = nv.id;
    quanTri = agentWithCsrf(app);
    const r = await quanTri.post("/api/auth/login").send({ username: ad.username, password: MAT_KHAU });
    expect(r.status, "không đăng nhập được bằng tài khoản quản trị vừa tạo").toBe(200);
  }, 60_000);

  afterAll(async () => {
    const ids = (
      await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true }, includeDeleted: true })
    ).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("danh sách GET /api/users trả `title` — modal Sửa dựng ô từ chính hàng này", async () => {
    // Modal Sửa không gọi riêng GET /users/:id, nó dựng từ hàng trong danh sách. Thiếu cột ở đây là
    // ô Chức danh hoặc không tồn tại, hoặc (tệ hơn) tồn tại mà luôn rỗng → bấm Lưu là xoá trắng.
    await datMoc();
    const r = await quanTri.get("/api/users");
    expect(r.status).toBe(200);
    const hang = r.body.find((u) => u.id === nhanVienId);
    expect(hang, "không thấy nhân viên vừa tạo trong danh sách").toBeTruthy();
    expect(hang.title, "danh sách nhân viên KHÔNG kèm chức danh → modal Sửa không pre-fill được").toBe("Account");
  }, 60_000);

  it("PUT đổi chức danh: ghi được, ĐỌC LẠI được trong phản hồi, và CÓ VẾT trong nhật ký", async () => {
    // Ba khẳng định là ba lỗ khác nhau. Cái thứ ba là cái im lặng nhất: trước bản vá, before và
    // after của nhật ký giống hệt nhau nên không ai biết chức danh vừa bị đổi.
    await datMoc();
    const r = await quanTri.put(`/api/users/${nhanVienId}`).send({ title: "Trưởng phòng KD" });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(r.body.title, "API không trả title → người gọi không xác nhận được là đã ghi").toBe("Trưởng phòng KD");
    expect((await doc(nhanVienId)).title, "PUT không ghi được title vào CSDL").toBe("Trưởng phòng KD");

    const nk = await nhatKyMoiNhat();
    expect(nk, "không có bản ghi nhật ký user.update nào").toBeTruthy();
    expect(nk.before?.title, "nhật ký không lưu chức danh CŨ — đổi mà không có vết").toBe("Account");
    expect(nk.after?.title, "nhật ký không lưu chức danh MỚI").toBe("Trưởng phòng KD");
  }, 60_000);

  it("xoá trắng ô Chức danh là XOÁ THẬT — vì ô này CÓ nạp sẵn", async () => {
    // Đảo lại kỳ vọng cũ của tests/sn-quan-tri-dat-ten-nguoi-gui.test.js, và đảo có lý do: hồi đó
    // USER_SELECT không trả `title` nên modal không dựng nổi ô, "" không phải ý định của ai cả.
    // Nay ô đã có và nạp sẵn giá trị đang có, admin nhìn thấy "Account" rồi mới xoá ⇒ kỳ vọng duy
    // nhất là nó biến mất. Giữ luật cũ ở đây là "lưu mà không ăn": toast báo Đã lưu, cột vẫn nguyên.
    await datMoc();
    const r = await quanTri.put(`/api/users/${nhanVienId}`).send({ title: "", senderName: "", phone: "" });
    expect(r.status).toBe(200);

    const sau = await doc(nhanVienId);
    expect(sau.title, "xoá trắng ô Chức danh mà cột vẫn còn — lưu mà không ăn").toBe(null);
    expect(r.body.title, "phản hồi 200 vẫn trả giá trị CŨ").toBe(null);
    // Ba ô cùng điều kiện (đều nạp sẵn) thì phải cùng một luật; để lệch nhau là đúng cái bất đối
    // xứng đã từng có ở POST /api/auth/profile.
    expect(sau.senderName).toBe(null);
    expect(sau.phone).toBe(null);
  }, 60_000);

  it("vế đối trọng: KHÔNG gửi khoá `title` thì chức danh KHÔNG đổi", async () => {
    // Nếu khoá vắng mặt cũng bị quy về null thì mọi client gửi thiếu trường là xoá dữ liệu — đó
    // chính là hình dạng của sự cố xoá trắng 5/10 hồ sơ, chỉ khác cột.
    await datMoc();
    const r = await quanTri.put(`/api/users/${nhanVienId}`).send({ phone: "0911222333" });
    expect(r.status).toBe(200);
    expect((await doc(nhanVienId)).title, "client không gửi `title` mà chức danh bị XOÁ").toBe("Account");
  }, 60_000);

  it("vế đối trọng: giá trị thật vẫn đi qua, và trần 120 ký tự vẫn giữ", async () => {
    // Vá thành "luôn giữ giá trị cũ" thì đổi chức danh trở nên bất khả — vá xong lại hỏng đúng công
    // dụng chính. Và trần phải vẫn đi ra từ helper dùng chung của validators.ts.
    await datMoc();
    const ok = await quanTri.put(`/api/users/${nhanVienId}`).send({ title: " Giám đốc sản xuất " });
    expect(ok.status).toBe(200);
    expect((await doc(nhanVienId)).title, "giá trị mới không ghi được, hoặc không được trim").toBe("Giám đốc sản xuất");

    const dai = await quanTri.put(`/api/users/${nhanVienId}`).send({ title: "x".repeat(121) });
    expect(dai.status, "chức danh dài quá vẫn được nhận → không còn đi qua helper chung").toBe(400);
    expect((await doc(nhanVienId)).title, "đã ghi đè dù payload bị từ chối").toBe("Giám đốc sản xuất");
  }, 60_000);

  it("TẠO: POST /api/users trả lại `title` vừa ghi", async () => {
    // Đường gọi API trực tiếp (không có trên giao diện). `createUser` đã ghi được title từ trước,
    // nhưng phản hồi thì không nói ra — người gọi không có cách nào xác nhận.
    const username = `${TAG}-tao`;
    const r = await quanTri.post("/api/users").send({
      username, password: "Nhan1234!vien", displayName: `${TAG} tao`, role: "manager", title: "Sale",
    });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
    expect(r.body.title, "phản hồi tạo tài khoản không có title").toBe("Sale");
  }, 60_000);
});
