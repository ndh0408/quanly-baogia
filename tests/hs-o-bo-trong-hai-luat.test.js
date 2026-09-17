/**
 * ============================================================================
 * Ô BỎ TRỐNG CÓ HAI NGHĨA — VÀ NGHĨA NÀO ĐÚNG LÀ DO FORM CÓ NẠP SẴN HAY KHÔNG.
 *
 * ── LUẬT ───────────────────────────────────────────────────────────────────
 *     Form CÓ nạp sẵn giá trị đang có  →  bỏ trống = XOÁ  (ghi `null`)
 *     Form KHÔNG nạp sẵn               →  bỏ trống = KHÔNG ĐỔI
 *
 * ── HAI LỖI THẬT MÀ BÀI NÀY KHOÁ LẠI, MỖI VẾ MỘT LỖI ───────────────────────
 * (1) LƯU MÀ KHÔNG ĂN. `PUT /api/users/:id` và `POST /api/auth/profile` đều nạp sẵn ô rồi lại coi
 *     chuỗi rỗng là "không đổi". Admin NHÌN THẤY "Chị Lan" / "0909123456" trong ô, xoá trắng, bấm
 *     Lưu, giao diện toast "Đã lưu" — và cột vẫn y nguyên. Phản hồi 200 còn trả về giá trị CŨ. Một
 *     lời nói dối im lặng: người dùng không có cách nào biết thao tác của mình bị nuốt.
 *
 * (2) XOÁ TRẮNG HỒ SƠ. Chiều ngược lại đã nổ thật trên production: màn #/onboard dạng "Quên mật
 *     khẩu" có ba ô LUÔN RỖNG (lời mời không trả về SĐT/chức danh/tên người gửi), gửi "" lên là
 *     xoá sạch — 5/10 tài khoản mất cả ba trường (tests/dm-dat-lai-mat-khau-khong-xoa-ho-so.test.js).
 *
 * Nên không thể có MỘT luật cho mọi đường ghi, và cũng không được để luật trôi theo từng route:
 * nó phải nằm ở helper của src/validators.ts (`oGiuLai` vs `oXoaDuoc`), mỗi schema chọn helper hợp
 * với form của nó.
 *
 * ── VÌ SAO CÓ PHẦN KHÔNG CẦN CSDL ──────────────────────────────────────────
 * Phần A parse thẳng schema, nên nó chạy được ở MỌI nơi (kể cả máy Windows của tác giả, nơi test
 * tích hợp không dựng nổi Postgres). Đây là chỗ bắt được mẫu union CHẾT
 * `.optional().or(z.literal("").transform(() => null))`: trên zod 4.6.5 nhánh `.or(...)` KHÔNG BAO
 * GIỜ chạy (union thử nhánh đầu trước, mà `.optional()` coi "" là chuỗi hợp lệ), nên schema trông
 * như đã xử lý chuỗi rỗng trong khi "" đi thẳng xuống service. Mẫu đó từng nằm ở schema inline của
 * POST /api/auth/profile và đã khiến `title`/`senderName` được ghi thành CHUỖI RỖNG chứ không phải
 * `null` — hai giá trị khác nhau cho cùng một ý "không có", cắn ở bất cứ chỗ nào so `IS NULL`.
 *
 * ── PHẦN B KHOÁ THÊM MỘT BẤT ĐỐI XỨNG ──────────────────────────────────────
 * Trên chính `POST /api/auth/profile`, bản trước ghi `phone: req.body.phone || null` nên client
 * KHÔNG GỬI `phone` cũng bị XOÁ, trong khi không gửi `title`/`senderName` thì không đổi. Một route,
 * hai luật ngược nhau cho ba ô nằm cạnh nhau. Hôm nay chưa nổ chỉ vì web/src/lib/api.ts ép gửi đủ
 * bốn chuỗi — một client di động, một script, hay một PATCH tương lai gửi thiếu là mất dữ liệu.
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { UserUpdateSchema, AcceptInviteSchema, ProfileUpdateSchema } from "../src/validators.js";

// ─────────────────────────────────────────────────────────────────────────────
// PHẦN A — luật nằm ở SCHEMA, không cần CSDL
// ─────────────────────────────────────────────────────────────────────────────
// AcceptInviteSchema đòi `password` đi qua toàn bộ chính sách (độ dài, có chữ + số, KHÔNG nằm
// trong danh sách mật khẩu phổ biến). Đặt một hằng hợp lệ ở đây để mọi ca dưới đều ĐỎ/XANH vì lý
// do nó định đo — dùng "MatKhau123" thì schema ném ở `password` và ca `.toThrow()` xanh oan.
const MK_HOP_LE = "KichHoat2026";

describe("Hai luật cho ô bỏ trống — tầng schema", () => {
  it('form CÓ nạp sẵn: "" thành `null` THẬT, không phải `undefined`, không phải ""', () => {
    // `undefined` thì Prisma bỏ qua cột (lưu mà không ăn); "" thì cột mang chuỗi rỗng chứ không
    // phải null (hai loại "trống" trong cùng một cột). Chỉ `null` mới là XOÁ.
    const u = UserUpdateSchema.parse({ senderName: "", phone: "" });
    expect(u.senderName, 'UserUpdateSchema nuốt "" thành undefined → xoá không ăn').toBe(null);
    expect(u.phone, 'UserUpdateSchema nuốt "" ở SĐT').toBe(null);

    const p = ProfileUpdateSchema.parse({ displayName: "Nguyễn Văn A", senderName: "", phone: "", title: "" });
    expect(p.senderName, "Hồ sơ cá nhân ghi CHUỖI RỖNG thay vì null").toBe(null);
    expect(p.phone).toBe(null);
    expect(p.title).toBe(null);
  });

  it("form CÓ nạp sẵn: ô chỉ có KHOẢNG TRẮNG cũng là xoá", () => {
    // `.trim()` chạy TRƯỚC transform. Bỏ sót ca này thì một dấu cách vô tình biến thành dữ liệu.
    expect(UserUpdateSchema.parse({ senderName: "   " }).senderName).toBe(null);
    expect(ProfileUpdateSchema.parse({ displayName: "A", phone: "  " }).phone).toBe(null);
  });

  it("form CÓ nạp sẵn: KHÔNG gửi khoá vẫn là KHÔNG ĐỔI — xoá phải là ý định, không phải im lặng", () => {
    // Vế chặn của chính luật "rỗng = xoá": nếu khoá vắng mặt cũng bị quy về null thì mọi client gửi
    // thiếu trường là xoá dữ liệu. zod chỉ đặt khoá vào kết quả khi khoá đó có trong đầu vào.
    const u = UserUpdateSchema.parse({ displayName: "Nguyễn Văn A" });
    expect(Object.hasOwn(u, "senderName"), "khoá không gửi vẫn lọt vào kết quả parse").toBe(false);
    expect(Object.hasOwn(u, "phone")).toBe(false);

    const p = ProfileUpdateSchema.parse({ displayName: "Nguyễn Văn A" });
    for (const k of ["phone", "title", "senderName"]) {
      expect(Object.hasOwn(p, k), `ProfileUpdateSchema tự thêm khoá "${k}" dù client không gửi`).toBe(false);
    }
  });

  it('form KHÔNG nạp sẵn (#/onboard): "" là KHÔNG ĐỔI — đây là vế đã xoá trắng 5/10 hồ sơ', () => {
    // Ba ô này ở màn #/onboard luôn rỗng bất kể CSDL đang có gì (lời mời không trả chúng về), nên
    // "" KHÔNG phải ý định xoá của người dùng. Đổi AcceptInviteSchema sang `oXoaDuoc` là dựng lại
    // đúng sự cố cũ — kể cả khi lớp `|| user.x` trong acceptInvite vẫn còn đó.
    const a = AcceptInviteSchema.parse({
      token: "x".repeat(20), password: MK_HOP_LE, phone: "", title: "", senderName: "",
    });
    expect(a.phone, 'AcceptInviteSchema biến "" thành giá trị ghi được → xoá trắng hồ sơ').toBe(undefined);
    expect(a.title).toBe(undefined);
    expect(a.senderName).toBe(undefined);
  });

  it("vế đối trọng: giá trị THẬT vẫn đi qua nguyên vẹn ở cả hai luật", () => {
    // Sửa thành "luôn giữ giá trị cũ" thì đổi tên người gửi trở nên bất khả — vá xong lại hỏng đúng
    // công dụng chính. Hai vế phải cùng đúng.
    expect(UserUpdateSchema.parse({ senderName: " Chị Lan " }).senderName).toBe("Chị Lan");
    expect(ProfileUpdateSchema.parse({ displayName: "A", title: " Account " }).title).toBe("Account");
    expect(AcceptInviteSchema.parse({ token: "x".repeat(20), password: MK_HOP_LE, phone: " 0909 " }).phone).toBe("0909");
  });

  it("trần 120 ký tự vẫn giữ ở CẢ HAI helper", () => {
    // Đẻ một định nghĩa riêng cho mỗi schema (hoặc quên `.max`) là các nơi khai senderName trôi
    // khỏi nhau ngay. Cả hai helper phải cùng ra từ `oGiuLai`/`oXoaDuoc` với cùng con số.
    //
    // Soi ĐƯỜNG DẪN của lỗi chứ không chỉ `.toThrow()`: một schema ném vì `password` hay `token`
    // cũng làm `.toThrow()` xanh, và khi đó bài kiểm không còn đo cái nó nói là đang đo.
    const oLoi = (fn) => {
      try { fn(); } catch (e) { return (e.issues ?? []).map((i) => i.path.join(".")); }
      return [];
    };
    expect(oLoi(() => UserUpdateSchema.parse({ senderName: "x".repeat(121) }))).toContain("senderName");
    expect(oLoi(() => ProfileUpdateSchema.parse({ displayName: "A", senderName: "x".repeat(121) }))).toContain("senderName");
    expect(oLoi(() => AcceptInviteSchema.parse({ token: "x".repeat(20), password: MK_HOP_LE, senderName: "x".repeat(121) }))).toContain("senderName");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHẦN B — đi hết đường thật của trang "Tài khoản": HTTP → route → service → CSDL
// ─────────────────────────────────────────────────────────────────────────────
const dbAvailable = await prisma
  .$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `hsbt${Date.now()}`;
const MAT_KHAU = "HoSo1234!bt";

describe.runIf(dbAvailable)("Hồ sơ cá nhân: bỏ trống là XOÁ, và xoá ra NULL", () => {
  let app, toi, userId;

  const doc = () =>
    prisma.user.findUnique({ where: { id: userId }, select: { phone: true, title: true, senderName: true, displayName: true } });

  /** Về mốc đã biết trước mỗi kịch bản — mỗi `it` phải tự đứng được. */
  const datMoc = () =>
    prisma.user.update({
      where: { id: userId },
      data: { phone: "0909123456", title: "Account", senderName: "Chị Lan", displayName: `${TAG} tên` },
    });

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    const u = await prisma.user.create({
      data: {
        username: `${TAG}@thu.vn`,
        displayName: `${TAG} tên`,
        role: "manager",
        passwordHash: await bcrypt.hash(MAT_KHAU, 4),
        phone: "0909123456",
        title: "Account",
        senderName: "Chị Lan",
      },
    });
    userId = u.id;
    toi = agentWithCsrf(app);
    const r = await toi.post("/api/auth/login").send({ username: u.username, password: MAT_KHAU });
    expect(r.status, "không đăng nhập được bằng tài khoản vừa tạo").toBe(200);
  }, 60_000);

  afterAll(async () => {
    // AuditEvent trỏ tới user nên phải xoá TRƯỚC. hardDelete/includeDeleted vì prisma của repo có
    // phần mở rộng soft-delete (src/db.ts) — thiếu hai cờ này là rác đọng lại trong quanly_test.
    const ids = (
      await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true }, includeDeleted: true })
    ).map((x) => x.id);
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { resourceId: { in: ids.map(String) } }] } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("xoá trắng ô Tên người gửi → XOÁ THẬT, và giá trị ghi xuống là NULL", async () => {
    // Hai khẳng định là hai lỗi khác nhau: `undefined` thì Prisma bỏ qua cột (lưu mà không ăn), còn
    // "" thì cột mang chuỗi rỗng. Giao diện không phân biệt được ("" và null đều falsy nên wizard
    // báo giá đều lùi về displayName), nhưng CSDL thì có — và mọi truy vấn `IS NULL` đều đọc sai.
    await datMoc();
    const r = await toi.post("/api/auth/profile").send({ displayName: `${TAG} tên`, senderName: "", phone: "", title: "" });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);

    const sau = await doc();
    expect(sau.senderName, "xoá trắng ô mà tên người gửi VẪN CÒN — lưu mà không ăn").toBe(null);
    expect(sau.phone, "xoá trắng ô mà SĐT vẫn còn").toBe(null);
    expect(sau.title, 'chức danh bị ghi CHUỖI RỖNG thay vì null (mẫu union chết `.or(z.literal(""))`)').toBe(null);
    // Phản hồi phải nói đúng sự thật ngay lập tức: Profile.tsx làm `onMe({ ...me, ...u })`, trả về
    // giá trị CŨ là người vừa xoá lại thấy nó hiện lên như chưa hề bấm Lưu.
    expect(r.body.senderName, "phản hồi 200 vẫn trả giá trị CŨ").toBe(null);
  }, 60_000);

  it("KHÔNG gửi khoá nào thì KHÔNG cột nào đổi — kể cả `phone`", async () => {
    // Bất đối xứng cũ: `phone: req.body.phone || null` xoá SĐT của bất kỳ client nào không gửi
    // trường đó, trong khi `title`/`senderName` cạnh nó thì không đổi. Ca này khoá cả ba về MỘT luật.
    await datMoc();
    const r = await toi.post("/api/auth/profile").send({ displayName: `${TAG} tên` });
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);

    const sau = await doc();
    expect(sau.phone, "client không gửi `phone` mà SĐT bị XOÁ").toBe("0909123456");
    expect(sau.title).toBe("Account");
    expect(sau.senderName).toBe("Chị Lan");
  }, 60_000);

  it("gửi giá trị MỚI thì vẫn đổi — vế đối trọng", async () => {
    await datMoc();
    const r = await toi.post("/api/auth/profile").send({
      displayName: `${TAG} tên`, senderName: "Nguyễn Thị Lan Anh", phone: "0911222333", title: "Director",
    });
    expect(r.status).toBe(200);

    const sau = await doc();
    expect(sau.senderName).toBe("Nguyễn Thị Lan Anh");
    expect(sau.phone).toBe("0911222333");
    expect(sau.title).toBe("Director");
  }, 60_000);
});
