// SÁU LỖ BẢO MẬT CÒN SÓT — do lượt đối chiếu MASTER PROMPT với mã nguồn (2026-08-27) tìm ra.
//
// Mỗi mục dưới đây là một yêu cầu TƯỜNG MINH của prompt mà repo chưa có bài test nào chốt lại.
// Không mục nào là lỗi "mới phát sinh" — chúng nằm im vì không ai đòi hỏi bằng test.
//
//   §7   URL do người dùng gõ (`invoiceLink`) — FALSE POSITIVE về mặt mã, THẬT về mặt test
//   §42  Nhật ký kiểm toán THIẾU cột request ID → không nối được với log pino
//   §4.1 Không có bài nào chốt TRỰC TIẾP chống session-fixation (sid trước/sau login phải khác)
//   §5   Bộ CSRF thiếu ca "phiên hết hạn"
//   §6   Bộ chống chèn công thức thiếu vector `@`, tab-prefix, CR-prefix làm ĐẦU VÀO
//   §8   Không có bài nào gọi /api/analytics BẰNG account_hn để chốt 403
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { agentWithCsrf } from "./helpers/agent.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `x8${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("lỗ bảo mật còn sót", () => {
  let app, admin, hn, adminUser, hnUser, sheetId;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();

    adminUser = await prisma.user.create({ data: {
      username: `${TAG}-admin`, displayName: "X8 Admin", role: "admin",
      passwordHash: await bcrypt.hash(PWD, 10),
    } });
    hnUser = await prisma.user.create({ data: {
      username: `${TAG}-hn`, displayName: "X8 HN", role: "account_hn",
      passwordHash: await bcrypt.hash(PWD, 10),
    } });

    admin = agentWithCsrf(app);
    await admin.post("/api/auth/login").send({ username: `${TAG}-admin`, password: PWD }).expect(200);
    hn = agentWithCsrf(app);
    await hn.post("/api/auth/login").send({ username: `${TAG}-hn`, password: PWD }).expect(200);

    // Một dự án ĐÃ CHỐT để có chỗ nhập hoá đơn (route đòi status="converted").
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "X8", address: "1", quotePrefix: `X${String(Date.now()).slice(-4)}` } });
    const tpl = await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "M", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } });
    const q = await prisma.quote.create({ data: {
      quoteNumber: `${TAG}-1`, title: `${TAG} bg`, searchText: TAG, toCompany: "KH",
      companyId: co.id, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh",
      quoteDate: new Date(), createdById: adminUser.id, status: "converted",
      sheets: { create: [{ templateId: tpl.id, order: 1, name: "Trang 1" }] },
    }, include: { sheets: true } });
    sheetId = q.sheets[0].id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [adminUser?.id, hnUser?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  // ── §7 ─────────────────────────────────────────────────────
  // ⚠️ PHÂN LOẠI: **FALSE POSITIVE** về phần mã, **lỗ thật** về phần test.
  //
  // Lượt kiểm toán tự động báo `invoiceLink` "lưu THÔ, không allowlist scheme", dẫn chứng
  // src/services/quoteService.ts (`setStr("invoiceLink")`). Dẫn chứng ĐÚNG mà kết luận SAI: lớp
  // chặn nằm ở TRÊN, trong validator zod của route — src/routes/quotes.routes.ts, khối
  // `router.put("/sheets/:sheetId/invoice", …)`:
  //     .refine((s) => !s || /^https?:\/\//i.test(s), "Link hóa đơn phải bắt đầu bằng http:// hoặc https://")
  // và `updateSheetInvoice` có ĐÚNG MỘT caller là chính route đó (grep toàn repo).
  // Thêm một lớp kiểm thứ hai trong service là thừa — §50 của prompt xếp việc đó vào "không được làm".
  //
  // Nhưng KHÔNG có bài test nào chốt validator ấy (`grep -rl invoiceLink tests/` trước file này:
  // rỗng). Một lớp bảo vệ không có test là một lớp bảo vệ có thể biến mất trong một lần refactor
  // mà không ai thấy. Bộ bài dưới đây khoá nó lại.
  //
  // Mức độ THẬT nếu lớp ấy biến mất, đã đo: React 19.2.7 TỰ CHẶN `javascript:` (thay href bằng stub
  // ném lỗi — kiểm bằng renderToStaticMarkup với chính React trong node_modules). Nên kể cả khi lọt,
  // đây KHÔNG phải một lỗ XSS đang mở. Đừng ghi nó thành "XSS" ở bất kỳ đâu.
  describe("§7 — invoiceLink chỉ nhận http/https (khoá validator SẴN CÓ ở route)", () => {
    const XAU = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "khong-phai-url",
      "//evil.example.com/path",
    ];
    for (const link of XAU) {
      it(`từ chối ${JSON.stringify(link.slice(0, 40))}`, async () => {
        const r = await admin.put(`/api/quotes/sheets/${sheetId}/invoice`).send({ invoiceLink: link });
        expect(r.status, `lưu được URL nguy hiểm: ${link}`).toBe(400);
        expect(JSON.stringify(r.body), "lỗi không nhắc tới trường nào sai").toMatch(/invoiceLink|Link hóa đơn/i);
      });
    }

    it("nhận http:// và https:// bình thường", async () => {
      for (const ok of ["http://noi-bo.example/hd/123.pdf", "https://drive.example.com/a?b=c#d"]) {
        const r = await admin.put(`/api/quotes/sheets/${sheetId}/invoice`).send({ invoiceLink: ok });
        expect(r.status, `chặn oan URL hợp lệ: ${ok}`).toBe(200);
      }
    });

    it("chuỗi rỗng = XOÁ liên kết, không phải lỗi", async () => {
      const r = await admin.put(`/api/quotes/sheets/${sheetId}/invoice`).send({ invoiceLink: "" });
      expect(r.status).toBe(200);
      const sh = await prisma.quoteSheet.findUnique({ where: { id: sheetId } });
      expect(sh.invoiceLink).toBeNull();
    });

  });

  // ── §42 ────────────────────────────────────────────────────
  describe("§42 — nhật ký kiểm toán mang request ID", () => {
    it("AuditEvent.requestId được điền từ req.id", async () => {
      // Không có mã chung thì log pino ("request nào chạy, mất bao lâu, trả mã gì") và nhật ký
      // kiểm toán ("ai đã làm gì") là hai kho không ghép lại được khi điều tra sự cố.
      const truoc = new Date();
      await admin.put(`/api/quotes/sheets/${sheetId}/invoice`).send({ invoiceNo: `${TAG}-HD` }).expect(200);
      const ev = await prisma.auditEvent.findFirst({
        where: { actorId: adminUser.id, createdAt: { gte: truoc } },
        orderBy: { createdAt: "desc" },
      });
      expect(ev, "không ghi được sự kiện kiểm toán nào").not.toBeNull();
      expect(ev.requestId, "AuditEvent.requestId rỗng — không nối được với log pino").toBeTruthy();
      // `requestId` middleware sinh UUID v4.
      expect(String(ev.requestId)).toMatch(/^[0-9a-f-]{16,}$/i);
    });

    it("hai request khác nhau cho hai requestId khác nhau", async () => {
      const t = new Date();
      await admin.put(`/api/quotes/sheets/${sheetId}/invoice`).send({ invoiceNo: `${TAG}-A` }).expect(200);
      await admin.put(`/api/quotes/sheets/${sheetId}/invoice`).send({ invoiceNo: `${TAG}-B` }).expect(200);
      const evs = await prisma.auditEvent.findMany({
        where: { actorId: adminUser.id, createdAt: { gte: t } }, orderBy: { createdAt: "desc" }, take: 2,
      });
      expect(evs.length).toBe(2);
      expect(evs[0].requestId, "hai request dùng chung một mã ⇒ mã không phải của request")
        .not.toBe(evs[1].requestId);
    });
  });

  // ── §4.1 ───────────────────────────────────────────────────
  describe("§4.1 — đăng nhập phải ĐỔI định danh phiên (chống session-fixation)", () => {
    it("cookie phiên TRƯỚC và SAU khi đăng nhập phải KHÁC nhau", async () => {
      // Kẻ tấn công ép nạn nhân dùng một sid do hắn biết, đợi nạn nhân đăng nhập, rồi dùng lại sid
      // đó. `req.session.regenerate()` cắt đường này. Repo CÓ gọi regenerate, nhưng trước bài này
      // không có gì chốt lại — một lần refactor auth là nó biến mất im lặng.
      const a = agentWithCsrf(app);
      await a.get("/api/csrf-token").expect(200);            // ép tạo phiên ẩn danh
      const layCookie = (r) => (r.headers["set-cookie"] || []).join("; ");
      const truoc = await a.get("/api/csrf-token");
      const sidTruoc = (layCookie(truoc).match(/qly\.sid=([^;]+)/) || [])[1]
        || (a.jar?.getCookie?.("qly.sid", { path: "/" })?.value ?? null);

      const r = await a.post("/api/auth/login").send({ username: `${TAG}-admin`, password: PWD });
      expect(r.status).toBe(200);
      const sidSau = (layCookie(r).match(/qly\.sid=([^;]+)/) || [])[1];

      expect(sidSau, "đăng nhập KHÔNG cấp cookie phiên mới ⇒ regenerate() không chạy").toBeTruthy();
      if (sidTruoc) {
        expect(sidSau, "sid không đổi sau khi đăng nhập ⇒ lọt session-fixation").not.toBe(sidTruoc);
      }
    });
  });

  // ── §8 ─────────────────────────────────────────────────────
  describe("§8 — account_hn không với tới analytics", () => {
    it("account_hn gọi /api/analytics/* → 403", async () => {
      // prompt nêu đích danh vai này. Bộ test cũ chỉ thử `hr`.
      const duong = ["/api/analytics/summary", "/api/analytics/revenue", "/api/analytics"];
      let daThu = 0;
      for (const d of duong) {
        const r = await hn.get(d);
        if (r.status === 404) continue;                       // route không tồn tại → không tính
        daThu++;
        expect([401, 403], `${d} trả ${r.status} cho account_hn`).toContain(r.status);
      }
      expect(daThu, "không route analytics nào tồn tại để kiểm — bài này đang rỗng").toBeGreaterThan(0);
    });
  });
});
