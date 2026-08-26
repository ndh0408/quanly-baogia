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

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `vdbsnap${Date.now()}`;
// Chuỗi đủ dài để tìm thấy chắc chắn trong JSON, và đủ đặc trưng để không trùng dữ liệu khác.
const ANH_BASE64 = `data:image/png;base64,${"QUJD".repeat(2000)}${TAG}`;

describe.runIf(dbAvailable)("snapshot phiên bản không được chép ảnh chứng từ", () => {
  let userId, companyId, templateId, quoteId, sheetId;

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
          }],
        },
      },
      include: { sheets: true },
    });
    quoteId = q.id;
    sheetId = q.sheets[0].id;
  });

  afterAll(async () => {
    await prisma.quoteVersion.deleteMany({ where: { quoteId } });
    await prisma.quoteItem.deleteMany({ where: { sheetId } });
    await prisma.quoteSheet.deleteMany({ where: { quoteId } });
    await prisma.quote.deleteMany({ where: { id: quoteId } });
    await prisma.quoteTemplate.deleteMany({ where: { id: templateId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
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
});
