/**
 * ============================================================================
 * VÒNG THỬ LẠI MÃ DỰ ÁN PHẢI CẤP MÃ MỚI Ở MỖI LƯỢT.
 *
 * ── LỖI (hồi quy do chính đợt 2026-09-16 gây ra) ───────────────────────────
 * `createQuote` được đổi để cấp SỐ BÁO GIÁ ở CUỐI transaction (commit e222ead), nên `tx.quote.create`
 * nay chạy TRƯỚC `nextProjectCode`. Nhưng `create` vẫn `...draft`, mà `draft.projectCode` chỉ được
 * gán bởi `nextProjectCode` — tức SAU lượt create đó.
 *
 * Hệ quả ở LƯỢT THỬ LẠI: `draft.projectCode` còn nguyên giá trị của lần vừa hỏng, `create` ghi
 * thẳng mã đã đụng `@@unique([projectCode, projectVersion])` → P2002 ngay tại `create`, TRƯỚC khi
 * `nextProjectCode` kịp cấp mã kế tiếp. Bốn lượt thử y hệt nhau, rồi 409 "Số báo giá bị trùng" —
 * sai hẳn nguyên nhân. Và mỗi lượt còn chèn rồi rollback TOÀN BỘ hạng mục.
 *
 * Trước e222ead, `nextProjectCode` chạy TRƯỚC `create` nên mỗi lượt thử tự nhiên có mã mới.
 *
 * ── CA CÓ THẬT, KHÔNG PHẢI GIẢ ĐỊNH ────────────────────────────────────────
 * Cần một mã dự án đã tồn tại mà bộ đếm KHÔNG biết. Chú thích ở chính `createQuote` khai đây là ca
 * có thật: dữ liệu chuyển từ hệ cũ, hoặc bộ đếm vừa dựng lại bởi migration 20260907120000.
 * Bài này dựng đúng tình huống đó: tạo sẵn một báo giá mang mã `<prefix>26_001` rồi để bộ đếm ở 0.
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

const TAG = `qnmda${Date.now()}`;
const PWD = "Test1234!a";
// Prefix mã dự án RIÊNG cho lượt chạy này → bộ đếm (prefix, năm) bắt đầu từ 0.
const MA_NV = `P${String(Date.now()).slice(-6)}`;
const YY = String(new Date().getFullYear()).slice(-2);

describe.runIf(dbAvailable)("Thử lại khi đụng mã dự án", () => {
  let app, nv, companyId, templateId;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    await prisma.user.create({
      data: {
        username: `${TAG}-nv`,
        displayName: `${TAG} nv`,
        role: "admin",
        projectCode: MA_NV, // nhân viên CÓ mã dự án → createQuote sẽ gọi nextProjectCode
        passwordHash: await bcrypt.hash(PWD, 4),
      },
    });
    const co = await prisma.company.create({
      data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `Z${String(Date.now()).slice(-6)}` },
    });
    companyId = co.id;
    templateId = (
      await prisma.quoteTemplate.create({
        data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" },
      })
    ).id;

    // ── DỰNG ĐÚNG TÌNH HUỐNG: mã `<MA_NV>26_001` ĐÃ TỒN TẠI, bộ đếm vẫn ở 0 ──
    // Đây là hình dạng của dữ liệu chuyển từ hệ cũ / bộ đếm vừa dựng lại. Lượt tạo đầu tiên sẽ xin
    // `_001`, đụng, rồi phải tự nhảy sang `_002` ở lượt thử lại.
    await prisma.quote.create({
      data: {
        quoteNumber: `${TAG}-cu`,
        title: `${TAG} bg cũ`,
        searchText: TAG,
        companyId,
        createdById: (await prisma.user.findUnique({ where: { username: `${TAG}-nv` } })).id,
        toCompany: "Khách cũ",
        fromContact: "x",
        fromAddress: "x",
        city: "TP. Hồ Chí Minh",
        quoteDate: new Date(),
        status: "draft",
        subtotal: 0,
        total: 0,
        projectCode: `${MA_NV}${YY}_001`,
        projectVersion: 1,
      },
    });

    nv = agentWithCsrf(app);
    expect((await nv.post("/api/auth/login").send({ username: `${TAG}-nv`, password: PWD })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: MA_NV } }).catch(() => {});
  });

  it("đụng mã dự án đã tồn tại → lượt thử lại CẤP MÃ MỚI, không lặp lại mã cũ", async () => {
    const r = await nv.post("/api/quotes").send({
      title: `${TAG} bg moi`,
      companyId,
      toCompany: "Khách mới",
      vatPercent: 8,
      sheets: [
        {
          name: "Trang 1",
          order: 1,
          templateId,
          items: [{ kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10_000, order: 1 }],
        },
      ],
    });

    // Trước bản vá: 409 "Số báo giá bị trùng" — sai hẳn nguyên nhân, và sau 4 lượt chèn/rollback.
    expect(
      r.status,
      `tạo báo giá hỏng: ${JSON.stringify(r.body).slice(0, 220)}`,
    ).toBe(201);

    // Phải nhảy sang mã KẾ TIẾP, không phải mã đã bị chiếm.
    expect(r.body.projectCode, "cấp lại đúng mã đã tồn tại").not.toBe(`${MA_NV}${YY}_001`);
    expect(r.body.projectCode, `mã cấp ra không đúng khuôn: ${r.body.projectCode}`).toMatch(
      new RegExp(`^${MA_NV}${YY}_\\d{3}$`),
    );
  }, 60_000);

  it("KHÔNG để lại báo giá rác từ các lượt thử lại", async () => {
    // Mỗi lượt thử lại chèn rồi rollback cả báo giá. Rollback hỏng thì sẽ còn bản mồ côi mang số
    // tạm hoặc mang mã dự án trùng.
    const rac = await prisma.quote.findMany({
      where: { OR: [{ quoteNumber: { startsWith: "__TAM__" } }, { title: { startsWith: TAG } }] },
      select: { quoteNumber: true, projectCode: true, title: true },
      includeDeleted: true,
    });
    expect(rac.filter((q) => q.quoteNumber.startsWith("__TAM__")), "còn báo giá mang SỐ TẠM").toEqual([]);
    // Đúng 2: bản "cũ" dựng sẵn + bản vừa tạo. Nhiều hơn = lượt thử lại để lại rác.
    expect(rac.length, `có ${rac.length} báo giá mang tag, đáng lẽ 2`).toBe(2);
  }, 30_000);
});
