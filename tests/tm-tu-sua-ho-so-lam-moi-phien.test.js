/**
 * ============================================================================
 * ADMIN SỬA HỒ SƠ CỦA CHÍNH MÌNH → STATE `me` Ở CLIENT GIỮ GIÁ TRỊ CŨ TỚI HẾT PHIÊN.
 *
 * ── LỖI THẬT ───────────────────────────────────────────────────────────────
 * `updateUser` chỉ bắn `refreshSession` khi `role` HOẶC `permissions` đổi. Nhưng client chỉ có ĐÚNG
 * HAI đường nạp `me`: `App.tsx` gọi `api.me()` một lần lúc đăng nhập, và `Shell.tsx` gọi lại KHI VÀ
 * CHỈ KHI nhận sự kiện SSE `session:refresh`. Nút "Sửa" ở trang Quản lý nhân viên KHÔNG bị chặn cho
 * chính mình (khác nút "Hủy lời mời"), nên admin sửa chức danh/SĐT/email/tên-người-gửi của CHÍNH
 * MÌNH thì: CSDL đúng, phiên đúng, mà `me` ở client giữ giá trị CŨ tới hết phiên.
 *
 * ── HẬU QUẢ NẶNG HƠN "HIỂN THỊ SAI": MỘT LỆNH XOÁ NGẦM ĐANG CHỜ ───────────
 * Trang "Tài khoản" khởi tạo ô bằng `useState(me.phone || "")` — MỘT LẦN, không `useEffect` nào đồng
 * bộ lại. Ba ô đó là ô NẠP SẴN, và theo luật của repo nội dung ô CHÍNH LÀ lệnh ghi. Nên nếu admin
 * vừa tự sửa mình qua modal rồi mở trang Hồ sơ trong CÙNG phiên:
 *   · ô hiện giá trị CŨ → bấm Lưu là GHI ĐÈ giá trị vừa sửa;
 *   · trường vừa đi từ rỗng thành có giá trị → ô hiện RỖNG → bấm Lưu là XOÁ THẬT.
 * Đúng lớp lỗi mà tests/hs-cap-phien-tra-du-truong.test.js gọi là "một lệnh xoá ngầm", chỉ khác cửa
 * vào: lần đó thiếu trường trong phản hồi cấp phiên, lần này là `me` không được làm mới.
 * Wizard tạo báo giá cũng đọc `me.senderName`/`me.phone`/`me.title` để tự điền người gửi, nên phần
 * còn lại của phiên in ra báo giá bằng giá trị cũ.
 *
 * ── VÌ SAO VÁ Ở MÁY CHỦ, KHÔNG VÁ Ở CLIENT ────────────────────────────────
 * Vá ở client thì phải xâu `onMe` qua ba tệp (`Shell.tsx` hiện KHÔNG truyền `onMe` cho `UsersPage`),
 * chỉ vá đúng một màn hình, và có một cái bẫy chết người: mẫu `onMe({ ...me, ...u })` của Profile.tsx
 * ĐÚNG ở đó (đường /auth/profile trả quyền HIỆU LỰC) nhưng SAI nếu bê sang — `USER_SELECT.permissions`
 * là mảng quyền per-user THÔ (`[]` với người dùng quyền mặc định theo role), merge cái thô lên cái
 * hiệu lực là admin MẤT SẠCH MENU tới khi F5, tức biến một lỗi hiển thị thành một lỗi chặn việc.
 * `USER_SELECT` cũng không có `mfaEnabled`.
 * Đường máy chủ dùng lại nguyên dây đã nối sẵn, client gọi `api.me()` nên nhận payload CHUẨN, một
 * tệp một điều kiện, và có tiền lệ: `refreshRoleUsers` bắn đúng sự kiện này cho mọi user của một vai trò.
 *
 * ── BÀI NÀY KHOÁ ───────────────────────────────────────────────────────────
 * Phần A: DÂY Ở CLIENT còn nguyên — `Shell.tsx` vẫn nghe `session:refresh` và vẫn gọi lại `api.me()`.
 *         Không có mắt này thì sự kiện ở phần B bay vào hư không, và bài kiểm đo một cơ chế đã chết.
 * Phần B: máy chủ THẬT SỰ bắn sự kiện cho ĐÚNG người, kể cả khi lượt sửa không đụng role/permissions —
 *         kèm vế đối trọng: sửa hồ sơ NGƯỜI KHÁC thì KHÔNG bắn (nếu không thì mỗi lượt admin sửa một
 *         nhân viên là bắt cả tab của người đó tải lại /me vô cớ).
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

// Chặn ngay tại `refreshSession` — nơi userService gọi — chứ không đi đo đầu dây SSE: đầu dây cần một
// kết nối `text/event-stream` sống, và một bài kiểm phụ thuộc thời gian giữ kết nối là bài kiểm sẽ
// chập chờn. `importOriginal` để mọi export khác của sse.js (attach/publish/presence…) vẫn là bản thật.
const h = vi.hoisted(() => ({ daBan: [] }));
vi.mock("../src/sse.js", async (importOriginal) => {
  const that = await importOriginal();
  return {
    ...that,
    refreshSession: (userId) => { h.daBan.push(userId); return that.refreshSession(userId); },
  };
});

const SHELL = readFileSync(new URL("../web/src/components/Shell.tsx", import.meta.url), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// PHẦN A — dây ở client, KHÔNG cần CSDL
// ─────────────────────────────────────────────────────────────────────────────
describe("Client phải còn nghe `session:refresh` và còn gọi lại /auth/me", () => {
  it("Shell.tsx nghe `session:refresh` VÀ gọi lại api.me() trong chính handler đó", () => {
    // Hai khẳng định gộp làm một là hỏng: nghe sự kiện mà không gọi lại `api.me()` (vd chỉ re-fetch
    // danh sách) thì `me` vẫn cũ y nguyên, mà grep "session:refresh" vẫn thấy.
    const khoi = SHELL.match(/addEventListener\(\s*"session:refresh"[\s\S]{0,220}?\)\s*;/u);
    expect(khoi, "Shell.tsx không còn nghe `session:refresh` — mọi refreshSession ở máy chủ bay vào hư không").toBeTruthy();
    expect(khoi[0], "handler `session:refresh` không gọi lại api.me() → state `me` vẫn giữ giá trị cũ").toMatch(/api\.me\(\)/u);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHẦN B — đi đường HTTP thật
// ─────────────────────────────────────────────────────────────────────────────
const dbAvailable = await prisma
  .$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `tmhs${Date.now()}`;
const MAT_KHAU = "TuSua1234!hs";

describe.runIf(dbAvailable)("Tự sửa hồ sơ của mình → máy chủ bắn session:refresh", () => {
  let app, quanTri, adminId, nhanVienId;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    const ad = await prisma.user.create({
      data: {
        username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin",
        passwordHash: await bcrypt.hash(MAT_KHAU, 4), title: "Account", phone: "0909123456",
      },
    });
    adminId = ad.id;
    const nv = await prisma.user.create({
      data: { username: `${TAG}-nv`, displayName: `${TAG} nv`, role: "manager", passwordHash: await bcrypt.hash(MAT_KHAU, 4), title: "Sale" },
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
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("admin sửa CHỨC DANH của chính mình (không đụng role/permissions) → có session:refresh cho chính id đó", async () => {
    // Vế chính. Trước bản vá: 200, CSDL đúng, và KHÔNG một sự kiện nào — `me` ở client giữ "Account"
    // tới hết phiên, rồi trang Hồ sơ ghi đè lại bằng chính giá trị cũ đó.
    h.daBan.length = 0;
    const r = await quanTri.put(`/api/users/${adminId}`).send({ title: "Giám đốc sản xuất", phone: "0909123456" });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(h.daBan, "tự sửa hồ sơ mà KHÔNG bắn session:refresh — client giữ `me` cũ tới hết phiên").toContain(adminId);

    // Và dữ liệu client sẽ nhận được ở lượt api.me() đó phải là dữ liệu MỚI, không phải bản cache nào.
    const me = await quanTri.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.title, "/auth/me trả chức danh CŨ → làm mới cũng vô ích").toBe("Giám đốc sản xuất");
  }, 60_000);

  it("/auth/me trả đủ hình dạng mà client cần — quyền HIỆU LỰC, không phải mảng per-user thô", async () => {
    // Đây là lý do chọn đường máy chủ. Nếu ai đó đổi sang cách merge phản hồi PUT ở client, ca này chỉ
    // ra ngay cái mất: `USER_SELECT.permissions` của một admin là `[]`, còn /auth/me trả tập hiệu lực.
    const me = await quanTri.get("/api/auth/me");
    expect(Array.isArray(me.body.permissions)).toBe(true);
    expect(me.body.permissions.length, "/auth/me trả mảng quyền RỖNG cho admin → merge payload này vào `me` là mất sạch menu").toBeGreaterThan(0);
    expect(me.body, "/auth/me thiếu `mfaEnabled` — phần Bảo mật 2 lớp của trang Hồ sơ đọc sai theo").toHaveProperty("mfaEnabled");

    const ds = await quanTri.get("/api/users");
    const hang = ds.body.find((u) => u.id === adminId);
    expect(hang.permissions, "mốc của ca này sai: USER_SELECT.permissions phải là mảng per-user THÔ").toEqual([]);
  }, 60_000);

  it("vế đối trọng: sửa hồ sơ NGƯỜI KHÁC (không đụng role/permissions) thì KHÔNG bắn", async () => {
    // Nới điều kiện thành "luôn bắn" là bắt mọi tab của mọi nhân viên tải lại /me mỗi lần admin sửa
    // một số điện thoại — và làm chính điều kiện này mất nghĩa.
    h.daBan.length = 0;
    const r = await quanTri.put(`/api/users/${nhanVienId}`).send({ title: "Trưởng phòng KD" });
    expect(r.status).toBe(200);
    expect(h.daBan, "sửa hồ sơ người khác cũng bắn session:refresh — điều kiện đã bị nới thành luôn-bắn").toEqual([]);
  }, 60_000);

  it("vế đối trọng: đổi `role`/`permissions` của người khác thì VẪN bắn (hành vi cũ còn nguyên)", async () => {
    // Bản vá không được đánh đổi hành vi đang chạy: đây là lý do `refreshSession` tồn tại từ đầu.
    h.daBan.length = 0;
    const r = await quanTri.put(`/api/users/${nhanVienId}`).send({ permissions: ["quote:read:own"] });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(h.daBan, "đổi quyền per-user mà không còn bắn session:refresh — hành vi cũ bị vá mất").toContain(nhanVienId);
  }, 60_000);

  it("đổi RIÊNG `canSign` của người khác cũng bắn — quyền ký đổi thật ở máy chủ ngay request kế", async () => {
    // Trước bản vá, điều kiện chỉ so `role` và `permissions`, nên một lượt PUT chỉ đổi `canSign` đổi
    // QUYỀN THẬT (middleware resolve mỗi request) mà nút "Ký" không mọc ra cho tới khi họ F5.
    h.daBan.length = 0;
    const r = await quanTri.put(`/api/users/${nhanVienId}`).send({ canSign: true });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body.canSign).toBe(true);
    expect(h.daBan, "đổi riêng canSign không bắn session:refresh — quyền đổi rồi mà giao diện chưa biết").toContain(nhanVienId);
  }, 60_000);

  it("vế đối trọng: KHOÁ tài khoản vẫn bắn `session:revoked`, KHÔNG phải refresh", async () => {
    // Nhánh khoá phải thắng nhánh refresh. Nếu điều kiện mới lọt lên trước, người bị khoá nhận lệnh
    // "tải lại /me" thay vì lệnh "đăng xuất" — và tab của họ ở lại thay vì bị đá ra.
    h.daBan.length = 0;
    const r = await quanTri.put(`/api/users/${nhanVienId}`).send({ active: false });
    expect(r.status).toBe(200);
    expect(h.daBan, "khoá tài khoản mà bắn session:refresh — người bị khoá được mời tải lại thay vì bị đăng xuất").toEqual([]);
  }, 60_000);
});
