// Cụm B2 (báo giá / khoá / lưu) — MỘT lần PUT /api/quotes/:id đọc ẢNH base64 của hạng mục HAI LẦN.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `updateQuote` (src/services/quoteService.ts) mở đầu bằng
// `prisma.quote.findFirst({ where: { id }, include: QUOTE_INCLUDE })`. `QUOTE_INCLUDE`
// (src/quoteUtils.ts) lấy `items` bằng `include`/không `select`, tức MỌI cột của QuoteItem — kể cả
// `images` (mảng data-URL base64, tối đa 10 ảnh/hạng mục) và `QuoteSheet.extraTables` (jsonb có
// `paidProof` base64). Bản đọc đó CHỈ dùng cho: kiểm quyền sửa, mốc `updatedAt`, vài cột vô hướng,
// và (khi payload KHÔNG có `sheets`) tính lại tổng tiền từ `items`. KHÔNG dòng nào đụng `images`.
// Cuối hàm còn một lần đọc nữa (`tx.quote.update(... include: QUOTE_INCLUDE)`) — lần này BẮT BUỘC
// phải có ảnh vì đó là phản hồi mà editor lấy nguyên về làm state (web/src/pages/QuoteEditor.tsx:265
// `qRef.current = { ...saved }`), bỏ ảnh ở đó là xoá trắng ảnh trên màn hình sau mỗi lần Lưu.
// Vậy chi phí ĐÚNG của một lần Lưu là MỘT lần đọc ảnh, không phải hai.
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// Postgres cất giá trị lớn ra bảng TOAST; đọc cột `images` bắt buộc phải "giải TOAST". Đếm block
// TOAST mà bảng `QuoteItem` phải đụng (`pg_statio_all_tables`) là đo đúng chỗ phát sinh chi phí.
// Ngưỡng KHÔNG chọn bừa: bài test tự đo trước MỘT lần đọc đầy đủ (đúng hình dạng `QUOTE_INCLUDE`
// mà phản hồi vẫn cần) rồi đòi cả lượt PUT không được vượt 1,6 lần con số đó. Bản cũ đọc hai lượt
// nên nằm quanh 2,0 lần → đỏ; bản vá đọc một lượt → xanh. Cách này miễn nhiễm với việc máy/CI có
// block size hay mức nén khác nhau.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { QUOTE_INCLUDE } from "../src/quoteUtils.js";
import { randomBytes } from "node:crypto";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "QuoteItem" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `b2upd${Date.now()}`;
const PWD = "Test1234!a";
const SO_HANG_MUC = 12;
// ~400KB/ảnh, NGẪU NHIÊN chứ không phải ký tự lặp: chuỗi lặp bị pglz nén còn vài trăm byte và nằm
// gọn TRONG hàng, không hề ra bảng TOAST — bộ đo sẽ ra 0 ở mọi phép đo và bài test xanh giả.
const ANH = `data:image/png;base64,${randomBytes(300_000).toString("base64")}`;

const nghi = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Số block TOAST mà bảng đã đụng. Postgres gom thống kê trong TỪNG backend và chỉ đẩy lên bộ nhớ
 * chung sau PGSTAT_MIN_INTERVAL (1 giây), mà kết nối của Prisma nằm trong pool nên đo liền tay sẽ
 * ra 0 ở MỌI phép đo. Nghỉ hơn một giây rồi bắn vài truy vấn rỗng để các backend đó đẩy thống kê.
 * (Cùng cách đo với tests/db3-snapshot-no-images.test.js.)
 */
async function toastBlocks(bang) {
  await nghi(1200);
  for (let i = 0; i < 8; i++) await prisma.$queryRawUnsafe("SELECT 1");
  const c = new (await import("pg")).default.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("SELECT pg_stat_force_next_flush()");
    const r = await c.query("SELECT coalesce(toast_blks_hit,0) + coalesce(toast_blks_read,0) AS n FROM pg_statio_all_tables WHERE relname = $1", [bang]);
    return Number(r.rows[0]?.n ?? 0);
  } finally { await c.end(); }
}

describe.runIf(dbAvailable)("PUT /api/quotes/:id — chỉ được đọc ảnh hạng mục MỘT lần", () => {
  let app, admin, quoteId, motLanDoc;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const u = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: `${TAG}-admin`, password: PWD })).status).toBe(200);

    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `B${TAG.slice(-5)}` } });
    const tpl = await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } });
    const q = await prisma.quote.create({ data: {
      quoteNumber: `${TAG}-1`, title: `${TAG} bg`, searchText: TAG, toCompany: "Khách",
      companyId: co.id, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh",
      quoteDate: new Date(), createdById: u.id, currentVersion: 1,
      sheets: { create: [{ templateId: tpl.id, order: 1, name: "Trang 1", showImages: true,
        items: { create: Array.from({ length: SO_HANG_MUC }, (_, i) => ({
          order: i + 1, kind: "item", name: `Hạng mục ${i + 1}`, quantity: 1, unitPrice: 1000, images: [ANH],
        })) } }] },
    } });
    quoteId = q.id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("bảo hiểm bộ đo: MỘT lần đọc QUOTE_INCLUDE làm block TOAST nhảy", async () => {
    const truoc = await toastBlocks("QuoteItem");
    const q = await prisma.quote.findFirst({ where: { id: quoteId }, include: QUOTE_INCLUDE });
    expect(q.sheets[0].items.length).toBe(SO_HANG_MUC);
    motLanDoc = (await toastBlocks("QuoteItem")) - truoc;
    expect(motLanDoc, "đọc 12 ảnh 400KB mà TOAST không nhúc nhích ⇒ bộ đo hỏng, khẳng định dưới vô nghĩa").toBeGreaterThan(200);
  }, 90_000);

  it("một lần Lưu (không đổi sheets) chỉ đọc ảnh MỘT lượt, không hai", async () => {
    const truoc = await toastBlocks("QuoteItem");
    const r = await admin.put(`/api/quotes/${quoteId}`).send({ title: `${TAG} bg đã sửa` });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const tang = (await toastBlocks("QuoteItem")) - truoc;
    // Bản cũ: findFirst(QUOTE_INCLUDE) + tx.quote.update(include QUOTE_INCLUDE) ≈ 2,0 lần.
    expect(tang, `PUT làm TOAST nhảy ${tang} block trong khi một lần đọc chỉ tốn ${motLanDoc} — vẫn đang đọc ảnh hai lượt`)
      .toBeLessThan(motLanDoc * 1.6);

    // Phản hồi VẪN phải có đủ ảnh: editor lấy nguyên phản hồi làm state, thiếu ảnh là xoá trắng màn hình.
    expect(r.body.sheets[0].items.length).toBe(SO_HANG_MUC);
    expect(r.body.sheets[0].items[0].images[0]).toBe(ANH);
    expect(r.body.title).toBe(`${TAG} bg đã sửa`);
  }, 90_000);

  it("Lưu có đổi VAT vẫn tính lại tổng tiền đúng (bản đọc rút gọn còn đủ cột tiền)", async () => {
    const r = await admin.put(`/api/quotes/${quoteId}`).send({ vatPercent: 10 });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    // 12 hạng mục × 1 × 1000 = 12.000; VAT 10% = 1.200; tổng = 13.200.
    expect(Number(r.body.subtotal)).toBe(12_000);
    expect(Number(r.body.vat)).toBe(1_200);
    expect(Number(r.body.total)).toBe(13_200);
  }, 90_000);
});
