// Cụm B5 — bản xuất GDPR không được kéo ảnh base64 về bộ nhớ tiến trình.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `exportUser` (src/services/gdprService.ts) nạp `quote.findMany({ include: { sheets: { include:
// { items: true } } }, take: 1000 })`. Ba cột blob đi kèm theo hợp đồng `true`/`include`:
//   · QuoteItem.images     — MẢNG data-URL base64 (validators.ts: 10 ảnh × 2,8 triệu ký tự MỖI item)
//   · QuoteSheet.extraTables — jsonb chứa `paidProof`, ảnh chứng từ thanh toán base64
//   · Quote.customerLogo   — data-URL base64
// Khối đó rồi đi qua `bigIntToString` (một lần JSON.stringify + một lần JSON.parse trên TOÀN BỘ cây)
// rồi `JSON.stringify(data, null, 2)` ở route — tức nhân thêm hai bản sao đầy đủ nữa trong heap.
// Chốt duy nhất đang có là rate-limit 8 lần/giờ: đó là TẦN SUẤT, không phải bộ nhớ.
//
// Ngoài chuyện bộ nhớ, `extraTables.paidProof` là ảnh chứng từ của CÔNG TY/người khác chứ không
// phải dữ liệu cá nhân của người đang xin bản xuất — đưa nó vào một tệp tải-về là tự tạo rò rỉ.
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// SỐ BYTE Postgres gửi về cho Node, đếm ngay tại socket (cùng cách tests/b2-projects-no-proof.test.js
// dùng): đó đúng là phần đi qua dây và nằm trong heap. Bài đối chứng đọc thẳng ba cột blob để chứng
// minh bộ đếm có nhảy. Kèm một khẳng định nội dung: chuỗi JSON xuất ra KHÔNG chứa tiền tố data-URL
// của bài test, mà các trường nghiệp vụ (tiêu đề báo giá, tên hạng mục) thì vẫn còn.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import { randomBytes } from "node:crypto";

let byteNhan = 0;
const connectGoc = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  this.on("data", (b) => { byteNhan += b.length; });
  return connectGoc.apply(this, a);
};
// Nạp SAU khi đã bọc socket — nếu không, kết nối đầu tiên của pool sinh ra trước lớp đếm.
const { prisma } = await import("../src/db.js");
const { exportUser, serializeExport } = await import("../src/services/gdprService.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "QuoteItem" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `b5gdpr${Date.now()}`;
const SO_BAO_GIA = 6;
// ~400KB/ảnh, NGẪU NHIÊN: chuỗi lặp bị nén ở tầng cột lẫn tầng giao thức nên số đo mất sức phân biệt.
const TIEN_TO = `data:image/png;base64,${TAG}`;
const ANH = () => `${TIEN_TO}${randomBytes(300_000).toString("base64")}`;

describe.runIf(dbAvailable)("Xuất GDPR — không kéo ảnh base64", () => {
  let userId;
  const quoteIds = [];
  let doiChung = 0;

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "manager", passwordHash: "x" } });
    userId = u.id;
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `P${TAG.slice(-5)}` } });
    const tpl = await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } });
    for (let i = 1; i <= SO_BAO_GIA; i++) {
      const q = await prisma.quote.create({ data: {
        quoteNumber: `${TAG}-${i}`, title: `${TAG} bg ${i}`, searchText: TAG, toCompany: "Khách",
        companyId: co.id, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh",
        quoteDate: new Date(), createdById: userId, status: "draft", subtotal: 1000, total: 1080,
        customerLogo: ANH(),
        sheets: { create: [{
          templateId: tpl.id, order: 1, name: "Trang 1", subtotal: 1000, showImages: true,
          extraTables: [{ category: "hcm", name: "A", items: [{ kind: "item", rid: "r1", name: "Thuê xe", quantity: 1, unitPrice: 1000, paid: true, paidProof: ANH() }] }],
          items: { create: [{ order: 1, kind: "item", name: `${TAG} hang muc`, quantity: 1, unitPrice: 1000, images: [ANH()] }] },
        }] },
      } });
      quoteIds.push(q.id);
    }
  });

  afterAll(async () => {
    net.Socket.prototype.connect = connectGoc;
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: userId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("bảo hiểm bộ đếm: đọc thẳng ba cột blob kéo về hàng MB", async () => {
    const truoc = byteNhan;
    const rows = await prisma.quoteSheet.findMany({
      where: { quoteId: { in: quoteIds } },
      select: { extraTables: true, items: { select: { images: true } }, quote: { select: { customerLogo: true } } },
    });
    expect(rows.length).toBe(SO_BAO_GIA);
    doiChung = byteNhan - truoc;
    // 6 báo giá × 3 ảnh 400KB ≈ 7,2 MB.
    expect(doiChung, "đọc 18 ảnh 400KB mà socket không nhận thêm byte nào ⇒ bộ đếm hỏng").toBeGreaterThan(4_000_000);
  }, 90_000);

  it("exportUser không kéo ảnh, mà dữ liệu nghiệp vụ vẫn còn", async () => {
    const truoc = byteNhan;
    const data = await exportUser(userId);
    const tang = byteNhan - truoc;
    expect(tang, `exportUser kéo về ${(tang / 1e6).toFixed(1)} MB (đối chứng ${(doiChung / 1e6).toFixed(1)} MB) — vẫn kéo ảnh base64`)
      .toBeLessThan(doiChung * 0.05);

    // Dùng đúng hàm tuần tự hoá của đường xuất thật — id BigInt làm JSON.stringify trần ném lỗi.
    const chuoi = serializeExport(data);
    expect(chuoi.includes(TIEN_TO), "chuỗi xuất ra vẫn chứa data-URL ảnh").toBe(false);
    expect(chuoi.includes(`${TAG} bg 1`), "mất tiêu đề báo giá — vá đã cắt nhầm dữ liệu nghiệp vụ").toBe(true);
    expect(chuoi.includes(`${TAG} hang muc`), "mất tên hạng mục — vá đã cắt nhầm dữ liệu nghiệp vụ").toBe(true);
    expect(data.quotes.length).toBe(SO_BAO_GIA);
  }, 90_000);
});
