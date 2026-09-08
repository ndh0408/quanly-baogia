// reviewHn (duyệt/trả phần giá Hà Nội) PHẢI nguyên tử — chốt hồi quy (ultracode audit 2026-09-09,
// finding M-CONC).
//
// ── LỖI ──────────────────────────────────────────────────────────────────────
// `src/hnWorkflow.ts` đọc `hnStatus` rồi `prisma.quote.update` KHÔNG kèm lại điều kiện đó (check-
// then-update). Hai lượt duyệt/trả gần như đồng thời (hai tab, double-click, hoặc hai quản lý HN
// cùng bấm) đều đọc thấy "submitted" và đều ghi đè — kết quả cuối phụ thuộc ai ghi SAU, trong khi
// audit log + thông báo cho account lại ghi CẢ HAI quyết định như thể đều hợp lệ.
//
// TÁI HIỆN TẤT ĐỊNH (đúng kỹ thuật tests/qc-quote-concurrency.test.js dùng cho chotKhoaLacQuan):
// một client pg RIÊNG giữ khoá hàng Quote (SELECT ... FOR UPDATE, CHƯA commit) để chặn UPDATE của
// request đang test ngay tại lệnh ghi cuối — không cần đoán giờ giấc của Promise.all. Trong lúc
// request bị chặn, client đó tự đổi hnStatus (đóng vai "người kia vừa duyệt xong") rồi COMMIT.
// Request bị chặn mới được tiếp tục — hành vi phụ thuộc CHÍNH XÁC vào có nguyên tử hay không.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import pg from "pg";
import { agentWithCsrf } from "./helpers/agent.js";

const { prisma } = await import("../src/db.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `zmhn${Date.now()}`;
const PWD = "Test1234!a";
const nghi = (ms) => new Promise((r) => setTimeout(r, ms));
/** supertest gửi request LƯỜI (chỉ khi .then được gọi) — bài test đua phải BẮN NGAY rồi mới chờ. */
const banNgay = (t) => t.then((r) => r);

async function moKhoa() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("BEGIN");
  return client;
}

describe.runIf(dbAvailable)("reviewHn — hai lượt duyệt/trả đồng thời (integration)", () => {
  let app, mgr, mgrU, coId;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    mgrU = await prisma.user.create({ data: { username: `${TAG}-mgr`, displayName: `${TAG} mgr`, role: "manager", passwordHash: await bcrypt.hash(PWD, 4) } });
    mgr = agentWithCsrf(app);
    expect((await mgr.post("/api/auth/login").send({ username: mgrU.username, password: PWD })).status).toBe(200);
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `H${TAG.slice(-5)}` } });
    coId = co.id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { quoteNumber: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  const quoteDangSubmitted = async (soHieu) => {
    const q = await prisma.quote.create({ data: {
      quoteNumber: `${TAG}-${soHieu}`, title: `${TAG} bg`, searchText: TAG, toCompany: "Khách",
      companyId: coId, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh",
      quoteDate: new Date(), createdById: mgrU.id, status: "draft", subtotal: 0, total: 0,
      hnStatus: "submitted", hnAssigneeId: mgrU.id, hnSubmittedAt: new Date(),
    } });
    return q.id;
  };

  it("người kia duyệt XEN VÀO GIỮA lúc mình đang trả → 409, KHÔNG ghi đè quyết định của người kia", async () => {
    const id = await quoteDangSubmitted(1);
    const kia = await moKhoa();
    try {
      // Giữ khoá hàng Quote — CHƯA đổi hnStatus, chỉ chặn request dưới ngay tại lệnh UPDATE cuối.
      await kia.query('SELECT id FROM "Quote" WHERE id = $1 FOR UPDATE', [id]);

      // Bắn request "reject" NGAY (đừng chờ) — findFirst đọc snapshot (vẫn thấy "submitted", plain
      // read không bị khoá hàng chặn), qua được kiểm 400, rồi BỊ CHẶN đúng ở updateMany vì đụng
      // khoá hàng mà `kia` đang giữ.
      const p = banNgay(mgr.post(`/api/quotes/${id}/hn/review`).send({ decision: "reject" }));
      await nghi(500); // đủ để request đọc xong `existing` (thấy "submitted") rồi kẹt ở updateMany — khớp mốc chờ của tests/qc-quote-concurrency.test.js

      // "Người kia" đã giữ khoá này TỪ TRƯỚC KHI request trên bắt đầu — tức người kia duyệt TRƯỚC,
      // request trên phải thấy trạng thái đã đổi khi tới lượt nó ghi.
      await kia.query('UPDATE "Quote" SET "hnStatus" = \'approved\', "hnReviewedAt" = now() WHERE id = $1', [id]);
      await kia.query("COMMIT");

      const r = await p; // giờ mới được tiếp tục
      expect(r.status, JSON.stringify(r.body)).toBe(409);
      expect(r.body.error).toMatch(/vừa được xử lý/);
    } finally {
      await kia.query("ROLLBACK").catch(() => {});
      await kia.end();
    }

    // Quyết định của "người kia" (approved) phải CÒN NGUYÊN — không bị request "reject" ghi đè.
    const cuoi = await prisma.quote.findUnique({ where: { id }, select: { hnStatus: true } });
    expect(cuoi.hnStatus, "trước bản vá: update KHÔNG điều kiện sẽ ghi đè 'approved' thành 'rejected'").toBe("approved");
  });

  it("KHÔNG race (tuần tự): lượt thứ hai luôn 400 'chưa gửi duyệt' — hành vi bình thường không đổi", async () => {
    const id = await quoteDangSubmitted(2);
    const r1 = await mgr.post(`/api/quotes/${id}/hn/review`).send({ decision: "approve" });
    expect(r1.status).toBe(200);
    const r2 = await mgr.post(`/api/quotes/${id}/hn/review`).send({ decision: "approve" });
    expect(r2.status).toBe(400);
    expect(r2.body.error).toMatch(/chưa được gửi duyệt/);
  });
});
