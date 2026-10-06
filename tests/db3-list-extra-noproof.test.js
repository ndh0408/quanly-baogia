// Cụm csdl-truyvan — DANH SÁCH báo giá kéo ảnh chứng từ base64 về rồi vứt.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `listQuotes` (src/services/quoteService.ts) thấy người xem có `quote:hn:fill` hoặc
// `quote:internal:view` thì nhét `sheets: { select: { extraTables: true } }` vào truy vấn danh
// sách. `extraTables` là cột Json chứa CẢ `paidProof` — ảnh chứng từ thanh toán dạng data-URL
// base64 (mỗi ảnh tới hàng trăm KB). Mà `presentQuoteRow` (src/quoteUtils.ts) chỉ dùng số hàng,
// số hàng đã trả và tổng tiền: KHÔNG dòng nào đụng `paidProof`. Toàn bộ base64 đi qua dây CSDL,
// nằm trong heap của tiến trình Node một lúc, rồi bị vứt — mỗi lần tải lại trang danh sách.
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// Gọi THẲNG `listQuotes` (không qua presenter) và cân đúng thứ nó nạp về: `JSON.stringify(rows)`.
// Đó chính là khối dữ liệu đã đi qua dây. Kèm hai khẳng định giữ NGUYÊN kết quả nghiệp vụ — số
// hàng nội bộ, số hàng đã trả, và TỔNG TIỀN Hà Nội phải y hệt trước khi vá (đây là số TIỀN, đổi
// cách lấy dữ liệu mà lệch số là hỏng nặng hơn cái đang chữa).
//
// ── 2026-10-06: "ĐÃ TRẢ" LÀ TRẠNG THÁI HIỆU LỰC ─────────────────────────────
// Việc tích đã chi chuyển sang kế toán ở trang Hóa đơn đầu vào (bảng InputInvoiceEntry); cờ `paid` cũ
// trong JSON hàng ĐÓNG BĂNG. Số "đã trả" của danh sách đếm theo LỚP PHỦ (src/khoanChi.ts trangThaiHieuLuc
// qua phuKeToanDanhSach): có khoản thì khoản thắng, không thì cờ JSON cũ — hai ca đầu vẫn đếm 2 vì chưa
// có khoản nào (đọc dự phòng), ca cuối khoá chiều ngược lại: kế toán BỎ tích thì số phải giảm dù JSON
// vẫn ghi paid:true.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { listQuotes } from "../src/services/quoteService.js";
import { presentQuoteRow } from "../src/quoteUtils.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `db3ls${Date.now()}`;
const SO_BAO_GIA = 12;
// ~300KB mỗi ảnh — cỡ thật của một ảnh chụp chứng từ chuyển khoản đã base64.
const ANH = `data:image/png;base64,${"A".repeat(300_000)}`;

// Bảng Hà Nội ở CẤP BÁO GIÁ từ 2026-09-15 — không còn khoá `category`.
const bangHN = (ten) => ({
  name: ten, templateId: null, groupSubtotal: false,
  items: [
    { kind: "section", name: "Nhóm A", quantity: 0, unitPrice: 0 },
    { kind: "item", rid: `${ten}-1`, name: "Thuê xe", quantity: 2, unitPrice: 1000, days: null, paid: true, paidAt: new Date().toISOString(), paidById: null, paidProof: ANH },
    { kind: "item", rid: `${ten}-2`, name: "Nhân công", quantity: 2, unitPrice: 1000, days: null, paid: false, paidProof: null },
  ],
});

/** req giả tối thiểu cho listQuotes: nó chỉ đọc req.query + req.session. */
const reqGia = (permissions) => ({
  query: { page: 1, size: 50, sort: "createdAt", order: "desc", q: TAG },
  session: { userId: 0, role: "employee", permissions },
});

describe.runIf(dbAvailable)("Danh sách báo giá cho vai trò nội bộ — không kéo ảnh chứng từ", () => {
  let companyId, templateId, userId;

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "admin", passwordHash: "x" } });
    userId = u.id;
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `X${TAG.slice(-5)}` } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    for (let i = 1; i <= SO_BAO_GIA; i++) {
      await prisma.quote.create({ data: {
        quoteNumber: `${TAG}-${i}`, title: `${TAG} bg ${i}`, searchText: TAG, toCompany: "Khách",
        companyId, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: userId,
        hnTables: [bangHN("A"), bangHN("B")],
        sheets: { create: [{ templateId, order: 1, name: "Trang 1", extraTables: [] }] },
      } });
    }
  });

  afterAll(async () => {
    // Khoản kế toán RESTRICT báo giá: dọn khoản TRƯỚC khi xoá cứng (Promise.resolve: bản mã chưa có model thì bỏ qua êm).
    const ids = (await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, includeDeleted: true, select: { id: true } })).map((q) => q.id);
    await Promise.resolve().then(() => prisma.inputInvoiceEntry.deleteMany({ where: { quoteId: { in: ids } } })).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("vai trò xem nội bộ: không một byte base64 nào được nạp về", async () => {
    const { rows } = await listQuotes(reqGia(["quote:read:all", "quote:internal:view"]));
    expect(rows.length).toBe(SO_BAO_GIA);
    const nang = JSON.stringify(rows).length;
    // Bản cũ: 12 báo giá × 2 bảng × 1 ảnh 300KB ≈ 7 MB cho MỘT trang danh sách.
    expect(nang, `danh sách nạp về ${(nang / 1e6).toFixed(1)} MB — vẫn kéo ảnh chứng từ`).toBeLessThan(300_000);
    expect(JSON.stringify(rows).includes("paidProof")).toBe(false);

    // Số nghiệp vụ KHÔNG được đổi: 2 bảng × 2 hàng (dòng "section" không tính) = 4 hàng, 2 đã trả.
    const r0 = presentQuoteRow(rows[0], { internalOnly: true });
    expect(r0.internalRows).toBe(4);
    expect(r0.internalPaidRows).toBe(2);
    expect(r0.sheetCount).toBe(1);
  }, 60_000);

  it("account Hà Nội: TỔNG TIỀN HN giữ nguyên", async () => {
    const { rows } = await listQuotes(reqGia(["quote:read:all", "quote:hn:fill"]));
    const r0 = presentQuoteRow(rows[0], { hnOnly: true });
    expect(r0.hnSheetCount, "2 bảng loại hanoi").toBe(2);
    // Mỗi bảng: 2 hàng × (2 × 1000) = 4000 → hai bảng = 8000.
    expect(r0.hnTotal).toBe(8000);
    expect(JSON.stringify(rows).includes("paidProof")).toBe(false);
  }, 60_000);

  it("vai trò thường: danh sách vẫn KHÔNG kèm bảng nội bộ", async () => {
    const { rows } = await listQuotes(reqGia(["quote:read:all"]));
    expect(rows.length).toBe(SO_BAO_GIA);
    expect(rows[0].sheets, "người không có quyền nội bộ thì không có lý do gì tải bảng nội bộ").toBeUndefined();
  });

  it("kế toán đã BỎ tích (khoản paid=false) trên hàng JSON cũ đã trả → 'Đã TT' của ĐÚNG báo giá đó giảm; báo giá khác không đổi; JSON vẫn paid:true; vẫn không kéo ảnh", async () => {
    const q = await prisma.quote.findFirst({ where: { title: `${TAG} bg 1` }, select: { id: true } });
    // Hàng "A-1" (bảng HN "A") đã trả trong JSON cũ; kế toán bỏ tích ở trang Hóa đơn đầu vào → khoản thắng.
    await prisma.inputInvoiceEntry.create({ data: {
      quoteId: q.id, side: "hn", rid: "A-1", paid: false, rowSnapshot: { name: "Thuê xe" }, source: "json-cu", version: 1,
      legacySeed: { paid: true, paidAt: null, paidById: null, hasProof: true },
    } });
    const { rows } = await listQuotes(reqGia(["quote:read:all", "quote:internal:view"]));
    expect(rows.length).toBe(SO_BAO_GIA);
    const theoId = new Map(rows.map((r) => [r.id, presentQuoteRow(r, { internalOnly: true })]));
    expect(theoId.get(q.id)).toMatchObject({ internalRows: 4, internalPaidRows: 1 });
    for (const [id, r] of theoId) if (id !== q.id) expect(r.internalPaidRows, `báo giá ${id} bị đếm lây`).toBe(2);
    expect(JSON.stringify(rows).includes("paidProof")).toBe(false);
    const db = await prisma.quote.findUnique({ where: { id: q.id }, select: { hnTables: true } });
    expect(db.hnTables[0].items.find((it) => it.rid === "A-1").paid, "lớp phủ chỉ ở phản hồi — JSON đóng băng").toBe(true);
  }, 60_000);
});
