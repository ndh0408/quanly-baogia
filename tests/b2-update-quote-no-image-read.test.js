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
import { QUOTE_UPDATE_STATE_SELECT } from "../src/quoteUtils.js";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { QUOTE_INCLUDE } from "../src/quoteUtils.js";
import { randomBytes } from "node:crypto";
import { doSach } from "./helpers/toast.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "QuoteItem" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

/**
 * ⚠️ PHÉP ĐO TOAST CHẠY SAU MỘT CỜ — VÀ ĐÂY LÀ LÝ DO, KHÔNG PHẢI SỰ LƯỜI.
 *
 * `pg_statio_all_tables` là bộ đếm CẤP CƠ SỞ DỮ LIỆU cho CẢ BẢNG `QuoteItem`. Vitest chạy các FILE
 * test SONG SONG trên cùng một Postgres, nên bất kỳ file nào khác đọc ảnh hạng mục trong cùng cửa
 * sổ đo đều CỘNG vào `tang` — và `tests/db3-snapshot-no-images.test.js` dùng đúng kỹ thuật này trên
 * đúng bảng này. ĐÃ ĐO: bài này xanh 3/3 khi chạy RIÊNG, nhưng đỏ trong lượt chạy đầy đủ.
 *
 * Một bài test chập chờn tệ hơn không có bài test nào: nó dạy người ta bấm "chạy lại". Nên phép đo
 * chỉ chạy khi được gọi tường minh (`DO_TOAST_MEASURE=1 npx vitest run <file>` — có sẵn ở
 * `npm run test:toast`), còn thứ gác trong CI là chốt chặn TIỀN ĐỊNH ngay dưới: hình dạng của
 * `QUOTE_UPDATE_STATE_SELECT`. Chốt đó bắt đúng lớp lỗi (đọc thừa ảnh) mà không phụ thuộc thời điểm.
 */
const DO_TOAST = process.env.DO_TOAST_MEASURE === "1";

const TAG = `b2upd${Date.now()}`;
const PWD = "Test1234!a";
const SO_HANG_MUC = 12;
// ~400KB/ảnh, NGẪU NHIÊN chứ không phải ký tự lặp: chuỗi lặp bị pglz nén còn vài trăm byte và nằm
// gọn TRONG hàng, không hề ra bảng TOAST — bộ đo sẽ ra 0 ở mọi phép đo và bài test xanh giả.
const ANH = `data:image/png;base64,${randomBytes(300_000).toString("base64")}`;

/**
 * CHỐT CHẶN TIỀN ĐỊNH — không cần CSDL, không phụ thuộc thời điểm, LUÔN chạy trong CI.
 *
 * Nó gác đúng hai chiều của bản vá:
 *   · KHÔNG được kéo cột nặng ở bản đọc đầu (`images`, `extraTables`) — đó là lỗ đang vá;
 *   · PHẢI còn đủ mọi cột mà nhánh "payload không có sheets" cần để TÍNH LẠI TIỀN
 *     (`computeQuoteTotals` ở src/money.ts:52-76 đọc groupSubtotal/id + kind/quantity/
 *     quantityExact/unitPrice/days; `assertTotalsStorable` ở src/money.ts:110-118 đọc `name`).
 * Thiếu vế thứ hai thì một lượt "tối ưu" sau này cắt thêm cột là TIỀN SAI mà không ai thấy.
 */
describe("QUOTE_UPDATE_STATE_SELECT — hình dạng bản đọc đầu của updateQuote", () => {
  const sheet = QUOTE_UPDATE_STATE_SELECT.sheets.select;
  const item = sheet.items.select;

  it("KHÔNG kéo ảnh hạng mục hay bảng nội bộ (cột nặng, bản đọc này không dùng tới)", () => {
    expect(item).not.toHaveProperty("images");
    expect(sheet).not.toHaveProperty("extraTables");
    // Cũng không được quay về `include` (kéo MỌI cột) — đó chính là bản cũ.
    expect(QUOTE_UPDATE_STATE_SELECT).not.toHaveProperty("include");
  });

  it("còn ĐỦ cột cho computeQuoteTotals — cắt thêm là TIỀN SAI", () => {
    for (const c of ["kind", "quantity", "quantityExact", "unitPrice", "days"]) {
      expect(item, `thiếu QuoteItem.${c} → computeQuoteTotals tính sai tổng tiền`).toHaveProperty(c, true);
    }
    expect(sheet, "thiếu QuoteSheet.groupSubtotal → hệ số nhóm mất, tổng sai").toHaveProperty("groupSubtotal", true);
    expect(sheet, "thiếu QuoteSheet.id → sheetTotals mất định danh").toHaveProperty("id", true);
    expect(sheet, "thiếu QuoteSheet.name → assertTotalsStorable không nêu được trang nào âm").toHaveProperty("name", true);
  });

  it("còn đủ cột cho kiểm quyền + khoá lạc quan + đánh số", () => {
    for (const c of ["id", "updatedAt", "status", "hnStatus", "createdById", "currentVersion", "companyId", "quoteNumber", "projectCode", "vatPercent", "discount", "total"]) {
      expect(QUOTE_UPDATE_STATE_SELECT, `thiếu Quote.${c}`).toHaveProperty(c, true);
    }
    expect(QUOTE_UPDATE_STATE_SELECT.members, "thiếu members → canEdit không kiểm được thành viên").toBeTruthy();
  });
});

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

  it.runIf(DO_TOAST)("bảo hiểm bộ đo: MỘT lần đọc QUOTE_INCLUDE làm block TOAST nhảy", async () => {
    const { tang, kq } = await doSach("QuoteItem", () =>
      prisma.quote.findFirst({ where: { id: quoteId }, include: QUOTE_INCLUDE }));
    expect(kq.sheets[0].items.length).toBe(SO_HANG_MUC);
    motLanDoc = tang;
    expect(motLanDoc, "đọc 12 ảnh 400KB mà TOAST không nhúc nhích ⇒ bộ đo hỏng, khẳng định dưới vô nghĩa").toBeGreaterThan(200);
  }, 180_000);

  it.runIf(DO_TOAST)("một lần Lưu (không đổi sheets) chỉ đọc ảnh MỘT lượt, không hai", async () => {
    let lan = 0;
    const { tang, kq: r } = await doSach("QuoteItem", () =>
      admin.put(`/api/quotes/${quoteId}`).send({ title: `${TAG} bg đã sửa ${++lan}` }));
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    // Bản cũ: findFirst(QUOTE_INCLUDE) + tx.quote.update(include QUOTE_INCLUDE) ≈ 2,0 lần.
    expect(tang, `PUT làm TOAST nhảy ${tang} block trong khi một lần đọc chỉ tốn ${motLanDoc} — vẫn đang đọc ảnh hai lượt`)
      .toBeLessThan(motLanDoc * 1.6);

  }, 180_000);

  // LUÔN CHẠY. Đây là nửa "không được mất gì" của bản vá: rút gọn bản đọc ĐẦU không được làm
  // phản hồi thiếu ảnh — editor lấy nguyên phản hồi làm state (web/src/pages/QuoteEditor.tsx),
  // thiếu ảnh là xoá trắng màn hình sau mỗi lần Lưu.
  it("phản hồi của PUT vẫn đủ ảnh và đúng tiêu đề", async () => {
    const r = await admin.put(`/api/quotes/${quoteId}`).send({ title: `${TAG} bg đã sửa` });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
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
