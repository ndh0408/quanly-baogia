/**
 * ============================================================================
 * CỤM gd — BẢN XUẤT GDPR PHẢI CÓ TRẦN, MÀ KHÔNG ĐƯỢC TỪ CHỐI QUYỀN.
 *
 * ── LỖ ─────────────────────────────────────────────────────────────────────
 * `exportUser` trước đây là một `findMany({ take: 1000, include: { sheets: { include: { items } } } })`
 * — trần 1000 BÁO GIÁ, KHÔNG có trần nào trên số DÒNG. Sức chứa schema là 60 trang × 1000 dòng mỗi
 * báo giá, nên một lượt xuất kéo về tới 60 TRIỆU dòng và dựng tất cả thành đối tượng JS cùng lúc.
 * Rồi `serializeExport` còn `JSON.stringify(..., 2)` — IN THỤT LỀ — toàn bộ thành MỘT chuỗi giữ
 * trọn trong bộ nhớ, và `res.end()` giữ tiếp.
 *
 * Đây là đường OOM cuối cùng còn lại sau đợt vá tháng 9: cùng hình dạng với đường lưu
 * (`saveBudget`) và đường nhập Excel (`zipSafety`), chỉ khác là chưa ai chạm tới.
 *
 * ── HAI VẾ, VÀ VẾ THỨ HAI MỚI KHÓ ─────────────────────────────────────────
 * 1. Phải có trần — và trần phải áp lúc NẠP THEO LÔ, không phải cắt sau khi đã nạp xong. Cắt sau
 *    là vô nghĩa: đỉnh bộ nhớ nằm ở chính lúc nạp. (Bài học đã trả giá ở src/excelImport.ts: bản
 *    vá đầu cắt sau vòng quét, ĐO ĐƯỢC RSS 1.887 MB, vẫn bị nhân giết.)
 * 2. KHÔNG ĐƯỢC từ chối. Đây là quyền truy cập dữ liệu cá nhân; trả lỗi "dữ liệu của bạn quá lớn"
 *    là từ chối một quyền. Nên danh sách báo giá vẫn ĐẦY ĐỦ, chỉ phần dòng chi tiết bị bỏ, và
 *    khối `gioiHan` phải nói rõ báo giá nào thiếu và lấy nốt ở đâu.
 *
 * Cắt mà IM LẶNG còn tệ hơn không cắt: người nhận tưởng mình đã có đủ dữ liệu.
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";

const dbAvailable = await prisma
  .$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `gdtran${Date.now()}`;

describe("Hằng số trần xuất GDPR", () => {
  it("tồn tại và ở mức rộng rãi cho dùng thật, nhưng vẫn là trần THẬT", () => {
    // Production đo được: 756 hạng mục trên TOÀN BỘ 12 báo giá. Trần phải lớn hơn mức đó rất xa để
    // không ai gặp nó trong đời thường…
    expect(config.GDPR_EXPORT_MAX_ROWS).toBeGreaterThan(10_000);
    // …nhưng phải nhỏ hơn HẲN sức chứa schema (60 trang × 1000 dòng × 1000 báo giá = 60 triệu),
    // tức thứ nó sinh ra để chặn.
    expect(config.GDPR_EXPORT_MAX_ROWS).toBeLessThan(1_000_000);
  });
});

describe.runIf(dbAvailable)("Bản xuất GDPR khi chạm trần", () => {
  let userId, companyId, templateId, svc;
  const ID_BAO_GIA = [];

  beforeAll(async () => {
    svc = await import("../src/services/gdprService.js");
    const u = await prisma.user.create({
      data: {
        username: `${TAG}-u`,
        displayName: `${TAG} u`,
        role: "admin",
        passwordHash: await bcrypt.hash("Test1234!a", 4),
      },
    });
    userId = u.id;
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử" } });
    companyId = co.id;
    templateId = (
      await prisma.quoteTemplate.create({
        data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" },
      })
    ).id;

    // Dựng THẲNG bằng Prisma (không qua HTTP): bài này đo hành vi của `exportUser`, không đo
    // đường tạo báo giá — và dựng qua HTTP sẽ chậm gấp nhiều lần mà không kiểm thêm được gì.
    for (let i = 0; i < 6; i++) {
      const q = await prisma.quote.create({
        data: {
          quoteNumber: `${TAG}-${i}`,
          title: `${TAG} bg ${i}`,
          searchText: TAG,
          companyId,
          createdById: userId,
          toCompany: "Khách thử",
          fromContact: "x",
          fromAddress: "x",
          city: "TP. Hồ Chí Minh",
          quoteDate: new Date(),
          status: "draft",
          subtotal: 1000,
          total: 1080,
          sheets: {
            create: [
              {
                name: "Trang 1",
                order: 1,
                subtotal: 1000,
                templateId,
                items: {
                  create: Array.from({ length: 40 }, (_, j) => ({
                    order: j + 1,
                    kind: "item",
                    name: `Hạng mục ${j + 1}`,
                    quantity: 1,
                    unitPrice: 1000,
                  })),
                },
              },
            ],
          },
        },
        select: { id: true },
      });
      ID_BAO_GIA.push(q.id);
    }
  }, 120_000);

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("DƯỚI trần: xuất đầy đủ, KHÔNG có khối `gioiHan`", async () => {
    const d = await svc.exportUser(userId);
    expect(d.quotes).toHaveLength(6);
    expect(d.gioiHan, "chưa chạm trần mà đã báo bị cắt").toBeUndefined();
    const dong = d.quotes.reduce((n, q) => n + q.sheets.reduce((m, s) => m + s.items.length, 0), 0);
    expect(dong, "mất dòng chi tiết dù chưa chạm trần").toBe(6 * 40);
  }, 60_000);

  it("VƯỢT trần: danh sách báo giá vẫn ĐỦ, chỉ dòng chi tiết bị bỏ", async () => {
    // Hạ trần xuống dưới tổng số dòng thật để chạm trần mà không phải dựng hàng chục nghìn dòng.
    const cu = config.GDPR_EXPORT_MAX_ROWS;
    config.GDPR_EXPORT_MAX_ROWS = 50; // < 6×40 = 240
    try {
      const d = await svc.exportUser(userId);
      // VẾ QUAN TRỌNG NHẤT: không được mất báo giá nào. Bản xuất GDPR là một QUYỀN.
      expect(d.quotes, "mất báo giá khỏi bản xuất — đó là từ chối quyền, không phải tiết kiệm bộ nhớ")
        .toHaveLength(6);
      expect(d.gioiHan, "đã cắt mà KHÔNG khai báo — người nhận tưởng mình có đủ dữ liệu").toBeTruthy();
      expect(d.gioiHan.soBaoGiaThieuChiTiet).toBeGreaterThan(0);
      expect(d.gioiHan.baoGiaThieuChiTiet.length).toBe(d.gioiHan.soBaoGiaThieuChiTiet);
      // Phải nói được LẤY NỐT Ở ĐÂU, không chỉ "đã cắt".
      expect(d.gioiHan.huongDan).toMatch(/\/api\/quotes\/:id/);

      // Báo giá bị cắt thì `items` rỗng, nhưng phần metadata (số, tiêu đề, ngày…) vẫn còn.
      const biCat = d.quotes.filter((q) => d.gioiHan.baoGiaThieuChiTiet.includes(q.id));
      expect(biCat.length).toBeGreaterThan(0);
      for (const q of biCat) {
        expect(q.quoteNumber, "cắt mất cả số báo giá — vậy thì danh sách còn vô dụng").toBeTruthy();
        expect(q.sheets.every((s) => (s.items?.length ?? 0) === 0)).toBe(true);
      }

      // Và những báo giá TRONG ngân sách vẫn có đủ chi tiết.
      const conDu = d.quotes.filter((q) => !d.gioiHan.baoGiaThieuChiTiet.includes(q.id));
      expect(conDu.length, "cắt sạch mọi báo giá dù ngân sách còn chỗ").toBeGreaterThan(0);
      expect(conDu.some((q) => q.sheets.some((s) => (s.items?.length ?? 0) > 0))).toBe(true);
    } finally {
      config.GDPR_EXPORT_MAX_ROWS = cu;
    }
  }, 60_000);

  it("ảnh vẫn bị cắt khỏi bản xuất (không phá hành vi cũ)", async () => {
    // b5-gdpr-export-anh đã khoá việc này ở đường cũ; lặp lại ở đây vì đường nạp đã viết lại hoàn
    // toàn, và `omit` đặt nhầm chỗ sẽ kéo ảnh base64 trở lại mà không cổng nào khác đỏ.
    const d = await svc.exportUser(userId);
    const chuoi = svc.serializeExport(d);
    expect(chuoi).not.toMatch(/"images"\s*:/);
    expect(chuoi).not.toMatch(/"customerLogo"\s*:/);
  }, 60_000);
});
