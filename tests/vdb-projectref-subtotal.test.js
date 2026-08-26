// Tham chiếu Dự án (cột HỒNG trang Nhân sự) tính LẠI tiền từ items thay vì đọc cột đã materialized.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `buildProjectRef` (src/services/projectRef.ts) kéo `sheets.items` của tới 1000 báo giá rồi gọi
// `computeQuoteTotals` để dựng lại `sheetTotals`. Nhưng `QuoteSheet.subtotal` ĐÃ là cột
// materialized đúng cho mục đích đó (prisma/schema.prisma — ghi lúc save, backfill bởi
// prisma/backfill-sheet-subtotal.mjs), và trang Quản lý dự án (`listProjects` trong
// src/services/quoteService.ts) ĐÃ chuyển sang đọc cột này.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// 1. HAI TRANG, HAI NGUỒN SỐ TIỀN. Cùng một "mã sản xuất": trang Quản lý dự án hiện
//    `QuoteSheet.subtotal`, trang Nhân sự hiện số tính lại từ items. Hai số lệch nhau là lỗi
//    người dùng nhìn thấy, và không ai biết số nào đúng.
// 2. Lãng phí: mỗi lần mở trang Nhân sự kéo toàn bộ hàng items của mọi báo giá đã chốt khớp mã.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Dựng báo giá đã chốt có `QuoteSheet.subtotal` KHÁC tổng tính từ items (đúng tình huống dữ liệu
// cũ/lệch). Trước khi vá, `buildProjectRef` trả số tính từ items; sau khi vá trả đúng cột
// subtotal — cùng số mà trang Quản lý dự án đang hiện.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Bỏ `items` khỏi `sheets.select`, lấy `subtotal`, bỏ `computeQuoteTotals`.
// (Đã đối chiếu: `computeQuoteTotals` CHỈ dùng kind/quantity/quantityExact/unitPrice/days +
// groupSubtotal — đúng bộ trường app ghi vào cột lúc save, nên với dữ liệu lưu bình thường hai
// cách cho số Y HỆT; test dưới có một ca chứng minh điều đó.)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { buildProjectRef } from "../src/services/projectRef.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `vdbpref${Date.now()}`;
const MA_LECH = `${TAG}-LECH`;
const MA_KHOP = `${TAG}-KHOP`;
const MA_DOI = `${TAG}-DOI`;

describe.runIf(dbAvailable)("buildProjectRef lấy tiền từ cột subtotal đã materialized", () => {
  let userId, companyId, templateId;
  const quoteIds = [];

  const taoBaoGia = async (projectCode, sheets) => {
    const q = await prisma.quote.create({
      data: {
        quoteNumber: `${projectCode}-Q`, projectCode, title: "Báo giá thử projectRef", toCompany: "Khách thử",
        companyId, fromContact: "Người gửi", fromAddress: "2 Thử", city: "TP. Hồ Chí Minh",
        quoteDate: new Date(), createdById: userId, status: "converted", subtotal: "1",
        sheets: {
          create: sheets.map((s, i) => ({
            templateId, order: i, name: `Sheet ${i + 1}`, subtotal: s.subtotal, invoiceNo: s.invoiceNo ?? null,
            items: { create: s.items.map((it, j) => ({ order: j, kind: "item", name: `HM ${j}`, unit: "cái", quantity: it.qty, unitPrice: it.price })) },
          })),
        },
      },
    });
    quoteIds.push(q.id);
    return q.id;
  };

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "admin", passwordHash: "x" } });
    userId = u.id;
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử projectRef", address: "1 Thử", quotePrefix: "VP" } });
    companyId = co.id;
    const tpl = await prisma.quoteTemplate.create({ data: { code: `${TAG}TPL`, name: "Mẫu thử", companyId, filePath: "x.xlsx" } });
    templateId = tpl.id;

    // Cột materialized LỆCH khỏi tổng items (777.000 vs 1.000.000) → phân biệt được nguồn số.
    await taoBaoGia(MA_LECH, [{ subtotal: "777000", invoiceNo: "HD-777", items: [{ qty: "1", price: "1000000" }] }]);
    // Dữ liệu lưu bình thường: cột KHỚP tổng items → số ra phải y hệt dù đọc bằng cách nào.
    await taoBaoGia(MA_KHOP, [{ subtotal: "1500000", items: [{ qty: "2", price: "500000" }, { qty: "1", price: "500000" }] }]);
    // Nhiều sheet → mã sản xuất có hậu tố _1/_2, mỗi sheet lấy subtotal của CHÍNH nó.
    await taoBaoGia(MA_DOI, [
      { subtotal: "111000", items: [{ qty: "1", price: "999999" }] },
      { subtotal: "222000", items: [{ qty: "1", price: "888888" }] },
    ]);
  });

  afterAll(async () => {
    const sheets = await prisma.quoteSheet.findMany({ where: { quoteId: { in: quoteIds } }, select: { id: true } });
    await prisma.quoteItem.deleteMany({ where: { sheetId: { in: sheets.map((s) => s.id) } } });
    await prisma.quoteSheet.deleteMany({ where: { quoteId: { in: quoteIds } } });
    await prisma.quoteVersion.deleteMany({ where: { quoteId: { in: quoteIds } } });
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } } });
    await prisma.quoteTemplate.deleteMany({ where: { id: templateId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("tiền trước thuế = QuoteSheet.subtotal, KHÔNG tính lại từ items", async () => {
    const ref = await buildProjectRef([MA_LECH]);
    expect(ref.get(MA_LECH)).toBeTruthy();
    expect(ref.get(MA_LECH).preTaxAmount).toBe(777000);
    expect(ref.get(MA_LECH).salesContractNo).toBe("HD-777");
  });

  it("dữ liệu lưu bình thường: số KHÔNG đổi so với cách tính cũ", async () => {
    const ref = await buildProjectRef([MA_KHOP]);
    expect(ref.get(MA_KHOP).preTaxAmount).toBe(1500000);
  });

  it("báo giá nhiều sheet: mỗi hậu tố _N lấy subtotal của đúng sheet đó", async () => {
    const ref = await buildProjectRef([`${MA_DOI}_1`, `${MA_DOI}_2`]);
    expect(ref.get(`${MA_DOI}_1`).preTaxAmount).toBe(111000);
    expect(ref.get(`${MA_DOI}_2`).preTaxAmount).toBe(222000);
  });
});
