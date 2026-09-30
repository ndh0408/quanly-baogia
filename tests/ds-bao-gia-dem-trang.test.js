// DANH SÁCH báo giá đếm TRANG bằng cách gộp TOÀN BẢNG QuoteSheet.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `QUOTE_LIST_SELECT` (src/quoteUtils.ts) từng có `_count: { select: { sheets: true } }`. Prisma dịch
// nó thành
//   LEFT JOIN (SELECT "quoteId", COUNT(*) FROM "QuoteSheet" WHERE 1=1 GROUP BY "quoteId") …
// — gộp MỌI trang của MỌI báo giá rồi mới JOIN vào 20 báo giá của trang danh sách. Postgres không đẩy
// được khoá JOIN vào một subquery có GROUP BY, nên không index nào cứu được: đo trên 5.000 báo giá ×
// 2 trang, kế hoạch là Seq Scan "QuoteSheet" (10.000 dòng) + HashAggregate + Seq Scan "Quote", chi phí
// 859; ép tắt seqscan còn đắt hơn (1509). Cổng scripts/db/explain-hot-paths.mjs không thấy vì nó
// không dựng trang nào — Seq Scan trên bảng rỗng thì rẻ (người soát chỉ ra, 2026-09-29).
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// 1. Hành vi giữ nguyên: `sheetCount` mà màn danh sách hiện ra vẫn đúng cho từng báo giá, ở cả vai
//    trò thường lẫn vai trò xem nội bộ (nhánh đó gắn thêm `sheets` giả vào dòng).
// 2. Hình dạng truy vấn: nghe ĐÚNG câu SQL Prisma chạy (PRISMA_LOG_QUERIES, cùng đường với cổng
//    explain-hot-paths) — mọi câu chạm "QuoteSheet" phải lọc theo danh sách quoteId của trang.
// 3. Cổng explain-hot-paths SOI được câu đếm trang: luật miễn trừ "ĐẾM TỔNG" từng tha MỌI câu mở đầu
//    bằng COUNT(*) — câu groupBy đếm trang cũng mở đầu như thế, nên nó có quét cả bảng thì cổng vẫn
//    xanh (người soát, vòng 2). Đối chiếu luật với CHÍNH câu Prisma chạy, không với chuỗi chép tay.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { daChapNhan } from "../scripts/db/explain-hot-paths.mjs";

// PHẢI đặt TRƯỚC khi nạp src/db.js: mức log `query` là tham số DỰNG client, db.ts đọc biến này đúng
// một lần lúc nạp module. Trả lại ngay sau đó để không lọt sang thứ gì khác trong tiến trình.
const logCu = process.env.PRISMA_LOG_QUERIES;
process.env.PRISMA_LOG_QUERIES = "1";
const { prisma, ngheTruyVan } = await import("../src/db.js");
const { listQuotes } = await import("../src/services/quoteService.js");
const { presentQuoteRow } = await import("../src/quoteUtils.js");
if (logCu === undefined) delete process.env.PRISMA_LOG_QUERIES;
else process.env.PRISMA_LOG_QUERIES = logCu;

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `dsdt${Date.now()}`;
// Số trang của từng báo giá thử — khác nhau để một bộ đếm trả hằng số (hay đếm nhầm báo giá) lộ ra.
const SO_TRANG = { A: 1, B: 3, C: 2 };

let batDuoc = [];
const daNghe = dbAvailable && ngheTruyVan((e) => batDuoc.push(e.query));

const reqGia = (permissions) => ({
  query: { page: 1, size: 20, sort: "createdAt", order: "desc", q: TAG },
  session: { userId: 0, role: "employee", permissions },
});

describe.runIf(dbAvailable)("Danh sách báo giá — số trang đếm theo id của trang, không gộp toàn bảng QuoteSheet", () => {
  beforeAll(async () => {
    const u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "admin", passwordHash: "x" } });
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `X${TAG.slice(-5)}` } });
    const templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    for (const [ten, n] of Object.entries(SO_TRANG)) {
      await prisma.quote.create({ data: {
        quoteNumber: `${TAG}-${ten}`, title: `${TAG} bg ${ten}`, searchText: TAG, toCompany: "Khách",
        companyId: co.id, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: u.id,
        sheets: { create: Array.from({ length: n }, (_, i) => ({ templateId, order: i + 1, name: `Trang ${i + 1}`, extraTables: [] })) },
      } });
    }
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  for (const [vaiTro, perms, cach] of [
    ["vai trò thường", ["quote:read:all"], {}],
    ["vai trò xem nội bộ", ["quote:read:all", "quote:internal:view"], { internalOnly: true }],
  ]) {
    it(`${vaiTro}: sheetCount đúng cho TỪNG báo giá`, async () => {
      const { rows } = await listQuotes(reqGia(perms));
      const dem = Object.fromEntries(rows.map((r) => [r.quoteNumber.slice(TAG.length + 1), presentQuoteRow(r, cach).sheetCount]));
      expect(dem).toEqual(SO_TRANG);
    }, 60_000);

    it(`${vaiTro}: mọi câu SQL chạm "QuoteSheet" đều lọc theo quoteId của trang`, async () => {
      expect(daNghe, "không nghe được câu SQL (PRISMA_LOG_QUERIES)").toBe(true);
      batDuoc = [];
      await listQuotes(reqGia(perms));
      const cham = batDuoc.filter((s) => s.includes('"QuoteSheet"'));
      expect(cham.length, "không câu nào đếm trang — listQuotes không còn trả số trang?").toBeGreaterThan(0);
      for (const s of cham) {
        expect(s, `câu này gộp/quét QuoteSheet mà không giới hạn theo quoteId:\n${s}`).toMatch(/"quoteId"\s+IN\s*\(|"quoteId"\s*=\s*ANY\s*\(/);
      }
    }, 60_000);

    it(`${vaiTro}: cổng explain-hot-paths KHÔNG tha Seq Scan cho câu nào chạm "QuoteSheet"`, async () => {
      batDuoc = [];
      await listQuotes(reqGia(perms));
      const cham = batDuoc.filter((s) => s.includes('"QuoteSheet"'));
      expect(cham.length, "không câu nào chạm QuoteSheet — bài này không còn đo gì").toBeGreaterThan(0);
      for (const s of cham) {
        expect(daChapNhan("QuoteSheet", s), `CHAP_NHAN tha Seq Scan QuoteSheet cho câu này — cổng mù trước nó:\n${s}`).toBe(false);
      }
    }, 60_000);
  }

  // Chiều ngược lại: thu hẹp luật mà khuôn không còn khớp câu đếm TỔNG thật thì cổng ĐỎ OAN ở mọi lượt
  // (đếm tổng buộc phải đọc mọi dòng — xem lý do ở mục CHAP_NHAN). Không tìm kiếm: chắc chắn là luật
  // đếm tổng tha, không phải luật tìm không dấu.
  it("câu đếm TỔNG thật của listQuotes vẫn được luật đếm tổng tha — đúng bảng Quote, không bảng nào khác", async () => {
    batDuoc = [];
    await listQuotes({ query: { page: 1, size: 20, sort: "createdAt", order: "desc" }, session: { userId: 0, role: "employee", permissions: ["quote:read:all"] } });
    const tong = batDuoc.filter((s) => /^\s*SELECT COUNT\(\*\)/.test(s) && !s.includes('"QuoteSheet"'));
    expect(tong, `không nghe được đúng MỘT câu đếm tổng:\n${batDuoc.join("\n")}`).toHaveLength(1);
    expect(tong[0]).not.toMatch(/searchText/);
    expect(daChapNhan("Quote", tong[0]), `luật đếm tổng không khớp câu Prisma sinh:\n${tong[0]}`).toBe(true);
    expect(daChapNhan("QuoteSheet", tong[0])).toBe(false);
  }, 60_000);
});
