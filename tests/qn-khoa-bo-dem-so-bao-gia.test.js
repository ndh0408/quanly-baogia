/**
 * ============================================================================
 * CỤM qn — BỘ ĐẾM SỐ BÁO GIÁ KHÔNG ĐƯỢC KHOÁ SUỐT LƯỢT TẠO.
 *
 * ── LỖI ────────────────────────────────────────────────────────────────────
 * `nextQuoteNumber` là một UPDATE lên MỘT hàng của `QuoteCounter`, khoá theo (prefix, năm).
 * Postgres giữ khoá hàng đó tới HẾT transaction. Trước 2026-09-16 nó là câu lệnh ĐẦU TIÊN trong
 * transaction của `createQuote`, nên khoá bị giữ suốt cả lượt tạo — phần nặng nhất của ứng dụng.
 *
 * Mọi báo giá của công ty dùng CHUNG một hàng (prefix "GN"), nên đây là điểm tuần tự hoá TOÀN CỤC:
 * một người lưu báo giá lớn là cả công ty không tạo nổi báo giá nào.
 *
 * ── SỐ ĐO (dev, 2026-09-16) ────────────────────────────────────────────────
 *   · giao dịch giữ hàng bộ đếm 6s  → giao dịch xin số kế tiếp CHỜ 5.077 ms
 *   · POST /api/quotes 20.000 dòng  → 13,1s  ⇒ cả công ty bị chặn 13 giây
 *   · nhưng phần CHÈN ở tầng CSDL cho đúng 20.000 dòng đó chỉ mất 752 ms
 *     (`INSERT … SELECT generate_series` rồi ROLLBACK)
 * Tức ~94% thời gian giữ khoá là vòng gọi Prisma và việc JS — công việc không cần giữ khoá.
 *
 * ── BẢN VÁ ─────────────────────────────────────────────────────────────────
 * Tạo báo giá với SỐ TẠM trước (phần nặng, không chạm bộ đếm), rồi mới cấp số thật và cập nhật một
 * hàng. Cấp số VẪN nằm trong transaction nên lượt tạo hỏng vẫn cuốn theo lần tăng bộ đếm — không
 * "đốt số", đúng tính chất mà `nextQuoteNumber` cố ý giữ.
 *
 * ── BÀI NÀY ĐO, KHÔNG ĐỌC MÃ ───────────────────────────────────────────────
 * Trong lúc một lượt tạo NẶNG đang chạy, lấy mẫu liên tục bằng `SELECT … FOR UPDATE NOWAIT` từ một
 * kết nối KHÁC: khoá rảnh thì câu lệnh chạy được, bị giữ thì Postgres ném 55P03 ngay lập tức.
 * Đếm tỉ lệ mẫu rảnh. Đọc mã nguồn không chứng minh được điều này; đảo lại thứ tự hai câu lệnh là
 * bài này đỏ.
 *
 * ĐO ĐƯỢC bằng chính bài này, cùng một lượt tạo 8.000 dòng (~1,7s):
 *     mã CŨ (cấp số ở câu lệnh đầu)          → khoá rảnh 22%  (4/18 mẫu)
 *     dời cấp số xuống cuối                   → khoá rảnh 75%  (15/20 mẫu)
 *     + bỏ `include` nặng khỏi lượt update    → khoá rảnh 79%  (15/19 mẫu)
 *
 * 21% CÒN LẠI là `snapshotQuoteVersion`: nó đọc lại toàn bộ báo giá rồi ghi một payload JSON, và
 * nó BUỘC phải nằm trong cùng transaction (mất nó là mất phiên bản v1 nếu tiến trình chết giữa
 * chừng). Đây là phần chưa gỡ được, và nói rõ ở đây để không ai tưởng đã xong: với một lượt tạo
 * 13,1s thì người khác vẫn chờ ~2,7s thay vì ~13s.
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma
  .$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1')
  .then(() => true)
  .catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") {
  throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");
}

const TAG = `qnlock${Date.now()}`;
const PWD = "Test1234!a";
// Prefix RIÊNG cho lượt chạy này → bộ đếm (prefix, năm) bắt đầu từ 0 và không đụng bài khác.
const PREFIX = `Q${String(Date.now()).slice(-7)}`;
const NAM = new Date().getFullYear();

describe.runIf(dbAvailable)("Khoá bộ đếm số báo giá", () => {
  let app, admin, companyId, templateId;

  /**
   * Thân request tạo báo giá với `soDong` hạng mục, CHIA RA NHIỀU TRANG.
   * `sheetSchema.items` chặn 1000 dòng MỖI TRANG (src/validators.ts) — dồn hết vào một trang thì
   * request bị 400 trước khi chạm tới đường mà bài này đang đo.
   */
  const than = (soDong, nhan) => {
    const MOI_TRANG = 1000;
    const soTrang = Math.max(1, Math.ceil(soDong / MOI_TRANG));
    return {
      title: `${TAG} ${nhan}`,
      companyId,
      toCompany: "Khách thử",
      vatPercent: 8,
      sheets: Array.from({ length: soTrang }, (_, t) => {
        const conLai = soDong - t * MOI_TRANG;
        return {
          name: `Trang ${t + 1}`,
          order: t + 1,
          templateId,
          items: Array.from({ length: Math.min(MOI_TRANG, conLai) }, (_, i) => ({
            kind: "item",
            name: `Hạng mục ${t * MOI_TRANG + i + 1}`,
            quantity: 1,
            unitPrice: 10_000,
            order: i + 1,
          })),
        };
      }),
    };
  };

  /** true = khoá hàng bộ đếm ĐANG RẢNH. NOWAIT nên không bao giờ tự nó chờ. */
  async function khoaDangRanh() {
    try {
      await prisma.$queryRawUnsafe(
        `SELECT 1 FROM "QuoteCounter" WHERE "prefix" = $1 AND "year" = $2 FOR UPDATE NOWAIT`,
        PREFIX,
        NAM,
      );
      return true;
    } catch (e) {
      // 55P03 = lock_not_available. Lỗi khác thì ném ra — đừng đọc nhầm một lỗi cú pháp thành
      // "khoá đang bận", vì như thế bài kiểm sẽ XANH nhờ một lý do sai.
      const ma = e?.meta?.driverAdapterError?.cause?.code ?? e?.code;
      if (String(ma) === "55P03" || /could not obtain lock|lock_not_available/i.test(String(e?.message))) return false;
      throw e;
    }
  }

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    await prisma.user.create({
      data: {
        username: `${TAG}-admin`,
        displayName: `${TAG} admin`,
        role: "admin",
        passwordHash: await bcrypt.hash(PWD, 4),
      },
    });
    const co = await prisma.company.create({
      data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: PREFIX },
    });
    companyId = co.id;
    templateId = (
      await prisma.quoteTemplate.create({
        data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" },
      })
    ).id;
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: `${TAG}-admin`, password: PWD })).status).toBe(200);

    // Bộ đếm phải TỒN TẠI trước khi lấy mẫu: `FOR UPDATE` trên 0 hàng luôn thành công và bài kiểm
    // sẽ xanh mà không đo gì cả.
    expect((await admin.post("/api/quotes").send(than(1, "mo-bo-dem"))).status).toBe(201);
    expect(await prisma.quoteCounter.findUnique({ where: { prefix_year: { prefix: PREFIX, year: NAM } } })).toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
  });

  it("khoá bộ đếm RẢNH trong phần lớn thời gian của một lượt tạo NẶNG", async () => {
    const mau = [];
    let xong = false;
    const lay = (async () => {
      while (!xong) {
        mau.push(await khoaDangRanh());
        await new Promise((r) => setTimeout(r, 10));
      }
    })();

    const t0 = Date.now();
    const r = await admin.post("/api/quotes").send(than(8_000, "nang"));
    xong = true;
    await lay;
    const giay = (Date.now() - t0) / 1000;

    expect(r.status, `tạo báo giá nặng hỏng: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(201);
    expect(mau.length, `lượt tạo quá nhanh (${giay.toFixed(2)}s) để lấy đủ mẫu — tăng số dòng`).toBeGreaterThan(10);

    const ranh = mau.filter(Boolean).length;
    const tiLe = ranh / mau.length;
    // Trước bản vá tỉ lệ này ≈ 0: khoá bị giữ từ câu lệnh đầu tới lúc commit.
    // Ngưỡng 0,5 chừa chỗ cho phần cuối transaction (cấp số → cập nhật → snapshot → commit). Bản
    // trước đặt 0,7: chạy riêng đo được > 0,9, nhưng trong lượt test đầy đủ (vitest chạy song song,
    // CPU tranh nhau) phần đuôi dài ra và đo được ĐÚNG 0,70 (35/50) → đỏ chập chờn dù mã không đổi
    // (2026-09-23). 0,5 vẫn tách bạch hẳn với ≈ 0 của lỗi thật.
    expect(tiLe, `khoá chỉ rảnh ${(tiLe * 100).toFixed(0)}% thời gian (${ranh}/${mau.length} mẫu, lượt tạo ${giay.toFixed(2)}s) — bộ đếm đang bị giữ gần như suốt lượt tạo`)
      .toBeGreaterThan(0.5);
  }, 120_000);

  it("KHÔNG báo giá nào giữ lại số tạm", async () => {
    // Số tạm chỉ sống giữa hai câu lệnh của cùng một transaction chưa commit. Nếu nó lọt ra CSDL
    // thì người dùng thấy một mã vô nghĩa trên màn hình và trong file xuất ra.
    const tam = await prisma.quote.findMany({
      where: { quoteNumber: { startsWith: "__TAM__" } },
      select: { id: true, quoteNumber: true },
      includeDeleted: true,
    });
    expect(tam, `có ${tam.length} báo giá mang số tạm: ${tam.map((q) => q.quoteNumber).join(", ")}`).toEqual([]);
  });

  it("số vẫn cấp LIÊN TIẾP, không đốt số — tính chất cũ phải giữ nguyên", async () => {
    // Cấp số vẫn nằm TRONG transaction, nên đây là vế phải chứng minh: dời nó xuống cuối KHÔNG
    // được đổi thành "cấp trước, hỏng thì bỏ số".
    const truoc = (await prisma.quoteCounter.findUnique({ where: { prefix_year: { prefix: PREFIX, year: NAM } } })).value;
    const so = [];
    for (let i = 0; i < 3; i++) {
      const r = await admin.post("/api/quotes").send(than(1, `lientiep${i}`));
      expect(r.status).toBe(201);
      so.push(r.body.quoteNumber);
    }
    const sau = (await prisma.quoteCounter.findUnique({ where: { prefix_year: { prefix: PREFIX, year: NAM } } })).value;
    expect(sau - truoc, "bộ đếm nhảy nhiều hơn số báo giá tạo ra → đang đốt số").toBe(3);

    const phanSo = so.map((s) => Number(s.slice(-3)));
    expect(phanSo[1] - phanSo[0], `số không liên tiếp: ${so.join(", ")}`).toBe(1);
    expect(phanSo[2] - phanSo[1], `số không liên tiếp: ${so.join(", ")}`).toBe(1);
  }, 60_000);
});
