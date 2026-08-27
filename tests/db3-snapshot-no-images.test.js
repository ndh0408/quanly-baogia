// Cụm csdl-truyvan — bản chụp phiên bản kéo ẢNH base64 của hạng mục qua dây, TRONG transaction lưu.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `snapshotQuoteVersion` (src/quoteVersion.ts) đọc lại báo giá bằng `include: { items: {...} }`
// KHÔNG có `select`, tức lấy MỌI cột của QuoteItem — kể cả `images`, mảng data-URL base64 (tối đa
// 10 ảnh/hạng mục). Payload phiên bản CỐ Ý không chứa ảnh (chú thích ở chính hàm đó nói vậy), nên
// toàn bộ khối base64 được đọc lên rồi vứt. Lần đọc này nằm BÊN TRONG transaction lưu báo giá,
// tức nó kéo dài đúng transaction đang giữ khoá hàng Quote + toàn bộ QuoteSheet.
//
// ── ĐO CÁI GÌ ───────────────────────────────────────────────────────────────
// Postgres cất giá trị lớn ra bảng TOAST; đọc cột `images` bắt buộc phải "giải TOAST". Đếm block
// TOAST mà bảng QuoteItem phải đụng (`pg_statio_all_tables`) trước/sau khi gọi snapshot cho biết
// ảnh CÓ bị đọc hay không — đo ở tầng CSDL, đúng nơi chi phí phát sinh.
//
// BẢO HIỂM CHO CHÍNH BỘ ĐO: một phép đọc ĐỐI CHỨNG (chủ ý `select: { images: true }`) phải cho
// thấy con số NHẢY. Không có nó thì một bộ đo hỏng (thống kê chưa flush, tên bảng sai) sẽ ra 0 ở
// mọi phép đo và bài test XANH vĩnh viễn mà chẳng kiểm gì.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { snapshotQuoteVersion } from "../src/quoteVersion.js";
import { randomBytes } from "node:crypto";
import { doSach } from "./helpers/toast.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "QuoteItem" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `db3snap${Date.now()}`;
const SO_HANG_MUC = 12;
// ~400KB/ảnh. NGẪU NHIÊN chứ không phải một ký tự lặp: chuỗi lặp bị pglz nén còn vài trăm byte và
// nằm gọn TRONG hàng, không hề ra bảng TOAST — bộ đo sẽ đọc ra 0 ở mọi phép đo và bài test XANH giả.
const ANH = `data:image/png;base64,${randomBytes(300_000).toString("base64")}`;

describe.runIf(dbAvailable)("Bản chụp phiên bản không được đọc ảnh hạng mục", () => {
  let quoteId, sheetId;

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "admin", passwordHash: "x" } });
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `Y${TAG.slice(-5)}` } });
    const tpl = await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } });
    const q = await prisma.quote.create({ data: {
      quoteNumber: `${TAG}-1`, title: `${TAG} bg`, searchText: TAG, toCompany: "Khách",
      companyId: co.id, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh",
      quoteDate: new Date(), createdById: u.id, currentVersion: 1,
      sheets: { create: [{ templateId: tpl.id, order: 1, name: "Trang 1", showImages: true,
        items: { create: Array.from({ length: SO_HANG_MUC }, (_, i) => ({
          order: i + 1, kind: "item", name: `Hạng mục ${i + 1}`, quantity: 1, unitPrice: 1000, images: [ANH],
        })) } }] },
    }, include: { sheets: true } });
    quoteId = q.id;
    sheetId = q.sheets[0].id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("đọc ảnh THẬT làm block TOAST nhảy (bảo hiểm: bộ đo có hoạt động)", async () => {
    const { tang, kq: rows } = await doSach("QuoteItem", () =>
      prisma.quoteItem.findMany({ where: { sheetId }, select: { images: true } }));
    expect(rows.length).toBe(SO_HANG_MUC);
    expect(tang, "đọc 12 ảnh 400KB mà TOAST không nhúc nhích ⇒ bộ đo hỏng, mọi khẳng định dưới vô nghĩa").toBeGreaterThan(200);
  }, 180_000);

  it("snapshot phiên bản KHÔNG đụng tới ảnh", async () => {
    const { tang, kq: v } = await doSach("QuoteItem", () =>
      prisma.$transaction((tx) => snapshotQuoteVersion(tx, quoteId, null, "db3-test")));
    // Bản cũ (`include` không `select`): xấp xỉ bằng phép đọc đối chứng ở trên (600+ block).
    expect(tang, `snapshot làm TOAST nhảy ${tang} block — vẫn đang kéo ảnh về`).toBeLessThan(100);
    // Và payload vẫn đủ dữ liệu để đối chiếu phiên bản (không cắt nhầm thứ đang dùng).
    expect(v.payload.sheets[0].items.length).toBe(SO_HANG_MUC);
    expect(v.payload.sheets[0].items[0]).toMatchObject({ order: 1, kind: "item", name: "Hạng mục 1", quantity: "1", unitPrice: "1000" });
    expect(JSON.stringify(v.payload).includes("data:image")).toBe(false);
  }, 180_000);
});
