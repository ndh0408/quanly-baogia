// Snapshot phiên bản báo giá CHÉP NGUYÊN ảnh chứng từ thanh toán (base64) — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `snapshotQuoteVersion` (src/quoteVersion.ts) CỐ Ý bỏ `item.images` khỏi payload, và chú thích
// ngay tại đó nói rõ lý do: "ảnh base64 nặng, mỗi lần lưu tạo snapshot → phình DB". Nhưng ngay
// dòng dưới lại `extraTables: s.extraTables ?? null` — chép NGUYÊN khối JSON của các bảng nội bộ.
// Mà `extraTables` thật sự đang giữ ảnh base64: `sanitizeExtraTables` (src/quoteUtils.ts) persist
// `paidProof` dạng chuỗi, route `/pay` ghi thẳng chuỗi đó vào cột Json, trần mỗi ảnh ~900.000 ký tự.
//
// ── TÁI HIỆN ────────────────────────────────────────────────────────────────
// Tạo báo giá có 1 sheet, `extraTables` chứa một hàng đã thanh toán kèm `paidProof` là data-URL
// base64. Gọi `snapshotQuoteVersion` → đọc `QuoteVersion.payload`. Trước khi vá, chuỗi base64
// nằm nguyên trong payload.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Mỗi lần Lưu có ảnh hưởng giá đều bump `currentVersion` → sinh MỘT hàng QuoteVersion mới mang
// trọn bộ ảnh đó. Giữ tới RETAIN_VERSION_KEEP (mặc định 100) phiên bản ⇒ một ảnh 900KB có thể
// nằm 100 lần trong DB cho MỘT báo giá: phình DB, phình bản sao lưu, kéo dài transaction lưu.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Lược `paidProof` khỏi extraTables trong snapshot, giữ cờ `hasPaidProof` (đúng hình dạng
// `stripExtraProofs` đã dùng khi gửi client). Ảnh vẫn sống ở bản HIỆN TẠI của báo giá và tải
// được qua GET /:id/extra/:sheetId/:rid/proof — snapshot chỉ để đối chiếu cấu trúc/giá.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { snapshotQuoteVersion } from "../src/quoteVersion.js";
import { presentQuote } from "../src/quoteUtils.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `vdbsnap${Date.now()}`;
// Chuỗi đủ dài để tìm thấy chắc chắn trong JSON, và đủ đặc trưng để không trùng dữ liệu khác.
const ANH_BASE64 = `data:image/png;base64,${"QUJD".repeat(2000)}${TAG}`;

describe.runIf(dbAvailable)("snapshot phiên bản không được chép ảnh chứng từ", () => {
  let userId, companyId, templateId, quoteId, sheetId, sheetLaId;

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "admin", passwordHash: "x" } });
    userId = u.id;
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử snapshot", address: "1 Thử", quotePrefix: "VS" } });
    companyId = co.id;
    const tpl = await prisma.quoteTemplate.create({ data: { code: `${TAG}TPL`, name: "Mẫu thử", companyId, filePath: "x.xlsx" } });
    templateId = tpl.id;

    const q = await prisma.quote.create({
      data: {
        quoteNumber: `${TAG}-Q`, title: "Báo giá thử snapshot", toCompany: "Khách thử",
        companyId, fromContact: "Người gửi", fromAddress: "2 Thử", city: "TP. Hồ Chí Minh",
        quoteDate: new Date(), createdById: userId,
        sheets: {
          create: [{
            templateId, order: 0, name: "Sheet 1",
            extraTables: [{
              category: "hcm", name: "Chi phí HCM",
              items: [
                { kind: "item", name: "Thuê xe", unit: "chuyến", quantity: "1", unitPrice: "500000", rid: "r1", paid: true, paidAt: new Date().toISOString(), paidById: userId, paidProof: ANH_BASE64 },
                { kind: "item", name: "Ăn uống", unit: "suất", quantity: "2", unitPrice: "100000", rid: "r2", paid: false, paidProof: null },
              ],
            }],
            items: { create: [{ order: 0, kind: "item", name: "Hạng mục A", unit: "cái", quantity: "1", unitPrice: "1000000" }] },
          }, {
            // Sheet 2: extraTables DỊ DẠNG. `extraTables` là cột Json TỰ DO — đường ghi ở
            // src/hnWorkflow.ts và lúc nhân bản báo giá KHÔNG đi qua sanitizeExtraTables, nên dữ
            // liệu lịch sử có thể có hình dạng khác hẳn. Snapshot phải chịu được, không được ném.
            templateId, order: 1, name: "Sheet 2",
            extraTables: [
              { category: "hcm", name: "Bảng KHÔNG có khoá items" },
              { category: "hanoi", name: "items SAI KIỂU", items: { r9: { name: "hàng lạc" } } },
            ],
            items: { create: [{ order: 0, kind: "item", name: "Hạng mục B", unit: "cái", quantity: "1", unitPrice: "2000000" }] },
          }],
        },
      },
      include: { sheets: { orderBy: { order: "asc" } } },
    });
    quoteId = q.id;
    sheetId = q.sheets[0].id;
    sheetLaId = q.sheets[1].id;
  });

  afterAll(async () => {
    await prisma.quoteVersion.deleteMany({ where: { quoteId } });
    await prisma.quoteItem.deleteMany({ where: { sheetId: { in: [sheetId, sheetLaId] } } });
    await prisma.quoteSheet.deleteMany({ where: { quoteId } });
    // hardDelete: Quote/QuoteTemplate/Company/User là model SOFT-DELETE — deleteMany thường chỉ
    // đặt deletedAt, để lại rác vĩnh viễn trong CSDL test dùng chung.
    await prisma.quote.deleteMany({ where: { id: quoteId }, hardDelete: true });
    await prisma.quoteTemplate.deleteMany({ where: { id: templateId }, hardDelete: true });
    await prisma.company.deleteMany({ where: { id: companyId }, hardDelete: true });
    await prisma.user.deleteMany({ where: { id: userId }, hardDelete: true });
  });

  it("payload KHÔNG chứa chuỗi base64 của paidProof", async () => {
    await prisma.$transaction((tx) => snapshotQuoteVersion(tx, quoteId, userId, "thử"));
    const ver = await prisma.quoteVersion.findFirst({ where: { quoteId }, orderBy: { versionNo: "desc" } });
    expect(ver).toBeTruthy();
    const raw = JSON.stringify(ver.payload);
    expect(raw).not.toContain("data:image/png;base64");
    expect(raw).not.toContain(ANH_BASE64);
    expect(raw).not.toContain("paidProof");
  });

  it("vẫn giữ cấu trúc bảng nội bộ + cờ hasPaidProof để đối chiếu phiên bản", async () => {
    await prisma.$transaction((tx) => snapshotQuoteVersion(tx, quoteId, userId, "thử"));
    const ver = await prisma.quoteVersion.findFirst({ where: { quoteId }, orderBy: { versionNo: "desc" } });
    const et = ver.payload.sheets[0].extraTables;
    expect(Array.isArray(et)).toBe(true);
    expect(et[0].category).toBe("hcm");
    expect(et[0].items).toHaveLength(2);
    // Giá + định danh hàng PHẢI còn nguyên: đó chính là thứ diffVersions cần để so hai bản.
    expect(et[0].items[0].rid).toBe("r1");
    expect(et[0].items[0].unitPrice).toBe("500000");
    expect(et[0].items[0].paid).toBe(true);
    expect(et[0].items[0].hasPaidProof).toBe(true);
    expect(et[0].items[1].hasPaidProof).toBe(false);
  });

  it("ảnh gốc vẫn còn ở bản HIỆN TẠI của báo giá (snapshot không được xoá dữ liệu sống)", async () => {
    const sh = await prisma.quoteSheet.findUnique({ where: { id: sheetId }, select: { extraTables: true } });
    expect(sh.extraTables[0].items[0].paidProof).toBe(ANH_BASE64);
  });

  // ── extraTables dị dạng: KHÔNG được làm ngã lần Lưu ────────────────────────────────────────
  // snapshotQuoteVersion chạy BÊN TRONG transaction lưu báo giá (src/services/quoteService.ts).
  // Một TypeError ở đây không phải lỗi cosmetic: nó rollback cả transaction ⇒ HTTP 500 và người
  // dùng MẤT TRẮNG lần sửa, lặp lại mãi mãi vì dữ liệu hỏng vẫn nằm đó.
  it("bảng có `items` SAI KIỂU (không phải mảng): snapshot không ném, giữ nguyên dữ liệu", async () => {
    await expect(prisma.$transaction((tx) => snapshotQuoteVersion(tx, quoteId, userId, "dị dạng"))).resolves.toBeTruthy();
    const ver = await prisma.quoteVersion.findFirst({ where: { quoteId }, orderBy: { versionNo: "desc" } });
    const et = ver.payload.sheets[1].extraTables;
    expect(et[1].items).toEqual({ r9: { name: "hàng lạc" } });   // để nguyên, không đụng tới
  });

  it("bảng KHÔNG có khoá `items`: payload không được BỊA thêm `items: []`", async () => {
    // diffVersions so bằng JSON.stringify trên khoá `sheets`. Thêm một khoá không có trong dữ liệu
    // gốc làm mọi lần diff giữa bản cũ và bản mới báo "sheets đã đổi" cho một thay đổi không hề có.
    await prisma.$transaction((tx) => snapshotQuoteVersion(tx, quoteId, userId, "dị dạng"));
    const ver = await prisma.quoteVersion.findFirst({ where: { quoteId }, orderBy: { versionNo: "desc" } });
    const et = ver.payload.sheets[1].extraTables;
    expect(Object.prototype.hasOwnProperty.call(et[0], "items")).toBe(false);
  });

  // ── Khoá hai bản lược ảnh vào nhau ─────────────────────────────────────────────────────────
  // `stripProofsForSnapshot` (src/quoteVersion.ts) và `stripExtraProofs` (src/quoteUtils.ts, dùng
  // ở presentQuote) là HAI bản cùng một logic. Nếu mai này thêm một trường ảnh thứ hai mà chỉ sửa
  // một bên, đường còn lại lặng lẽ chép base64 trở lại — đúng lỗi vừa vá quay về. Bài này bắt
  // điều đó thay cho kỷ luật con người.
  it("hai đường lược ảnh (snapshot ↔ presentQuote) cho CÙNG kết quả trên bảng có items", async () => {
    await prisma.$transaction((tx) => snapshotQuoteVersion(tx, quoteId, userId, "đối chiếu"));
    const ver = await prisma.quoteVersion.findFirst({ where: { quoteId }, orderBy: { versionNo: "desc" } });
    const q = await prisma.quote.findFirst({
      where: { id: quoteId },
      include: { sheets: { orderBy: { order: "asc" }, include: { items: true, template: true } } },
    });
    // CHỈ đưa sheet 1 (bảng đúng hình dạng) vào presentQuote: `stripExtraProofs` bên quoteUtils
    // CHƯA có lá chắn Array.isArray nên nó NGÃ trên sheet 2 dị dạng — đó là lỗi riêng của
    // src/quoteUtils.ts (ngoài phạm vi cụm này, đã ghi vào bàn giao), không phải thứ bài đối chiếu
    // này đo. Ở đây chỉ chốt: cùng dữ liệu ĐÚNG hình dạng thì hai đường phải ra y hệt nhau.
    const trinhBay = presentQuote({ ...q, sheets: [q.sheets[0]] }, { internalOnly: true });
    expect(trinhBay.internalSheets[0].tables).toEqual(ver.payload.sheets[0].extraTables);
  });
});
