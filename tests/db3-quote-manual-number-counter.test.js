// Cụm csdl-truyvan — số báo giá NHẬP TAY làm lệch bộ đếm.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `createQuote` (src/services/quoteService.ts) lấy `b.quoteNumber ?? await nextQuoteNumber(...)`:
// số do client gửi KHÔNG hề đẩy `QuoteCounter`. Bộ đếm đứng yên trong khi các số thật đã bị dùng.
// Lần tạo TỰ ĐỘNG kế tiếp sinh lại đúng những số đó, đụng `Quote.quoteNumber @unique`, và ngân
// sách thử lại (`attempt < 3` = 4 lượt) đốt hết → người dùng nhận 409 "Số báo giá bị trùng" cho
// một thao tác hoàn toàn hợp lệ, và bấm lại vẫn hỏng y như vậy cho tới khi bộ đếm bò qua vùng đã dùng.
//
// KHẢ NĂNG VỚI TỚI: cả hai giao diện đều khoá ô "Số báo giá" lúc tạo, nên chỉ API/script trực
// tiếp mới gửi được `quoteNumber` — nhưng ĐÓ LÀ đường nhập liệu có thật (chuyển dữ liệu cũ, sửa
// hàng loạt bằng script), và hậu quả rơi lên NGƯỜI KHÁC đang tạo báo giá bình thường.
//
// ── HAI KHẲNG ĐỊNH ──────────────────────────────────────────────────────────
// 1. TRIỆU CHỨNG người dùng thấy: 5 số nhập tay liên tiếp → lần tạo tự động kế tiếp phải THÀNH
//    CÔNG và ra số 006 (không đè lên vùng đã dùng).
// 2. NGUYÊN NHÂN, đo thẳng ở CSDL: sau một lần nhập tay, `QuoteCounter.value` phải ≥ phần số của
//    số đó. Khẳng định này KHÔNG thể xanh nhờ việc nới ngân sách thử lại — nó chốt đúng cơ chế.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `db3num${Date.now()}`;
const PWD = "Test1234!a";
// Prefix RIÊNG cho lần chạy này → bộ đếm (prefix, năm) khởi đầu từ 0 và không đụng agent khác.
const PREFIX = `Z${String(Date.now()).slice(-7)}`;
const YY = String(new Date().getFullYear()).slice(-2);
const so = (n) => `${PREFIX}${YY}${String(n).padStart(3, "0")}`;

describe.runIf(dbAvailable)("Số báo giá nhập tay phải đẩy bộ đếm", () => {
  let app, admin, companyId, templateId;

  const tao = (body) => admin.post("/api/quotes").send({
    title: `${TAG} bg`, companyId, toCompany: "Khách thử", vatPercent: 8,
    sheets: [{ name: "Trang 1", order: 1, templateId, items: [{ kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10_000, order: 1 }] }],
    ...body,
  });

  const dem = () => prisma.quoteCounter.findUnique({ where: { prefix_year: { prefix: PREFIX, year: new Date().getFullYear() } } });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: PREFIX } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: `${TAG}-admin`, password: PWD })).status).toBe(200);
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("một lần nhập tay đẩy QuoteCounter lên ít nhất phần số của nó", async () => {
    const r = await tao({ quoteNumber: so(7) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const c = await dem();
    expect(c?.value ?? 0, `bộ đếm phải đuổi kịp ${so(7)}, đang là ${c?.value ?? 0}`).toBeGreaterThanOrEqual(7);
  });

  it("số nhập tay theo quy ước KHÁC không làm bộ đếm nhảy bậy", async () => {
    const truoc = (await dem())?.value ?? 0;
    const r = await tao({ quoteNumber: `${TAG}-tay-khac` });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await dem())?.value ?? 0, "không bóc được phần số thì phải để bộ đếm nguyên").toBe(truoc);
  });

  it("nhập tay liên tiếp rồi tạo TỰ ĐỘNG → vẫn cấp được số, không 409", async () => {
    // Bắt đầu lại từ 0 để dựng đúng ca xấu: 5 số 001..005 đã dùng, bộ đếm vẫn ở 0.
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } });
    for (let i = 1; i <= 5; i++) {
      const r = await tao({ quoteNumber: so(i) });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const tuDong = await tao({});
    expect(tuDong.status, `tạo tự động phải chạy được, nhận: ${JSON.stringify(tuDong.body)}`).toBe(201);
    expect(tuDong.body.quoteNumber, "phải cấp số kế tiếp vùng đã dùng").toBe(so(6));
  }, 30_000);

  // Phát hiện THÊM khi dựng bài này: vòng thử lại `attempt < 3` VÔ TÁC DỤNG. `nextQuoteNumber`
  // tăng bộ đếm TRONG chính transaction tạo (chủ ý "không đốt số"), nên khi P2002 làm transaction
  // rollback thì lần tăng đó cũng mất → lượt sau sinh LẠI ĐÚNG số vừa đụng, bốn lượt cùng một số,
  // rồi 409. Ca này với tới được mà không cần API nhập tay: bất kỳ báo giá nào mang số không do bộ
  // đếm cấp (dữ liệu chuyển từ hệ cũ, sửa thẳng CSDL) là chặn đứng việc tạo báo giá mới.
  it("số đã bị chiếm nằm ngay trên bộ đếm → vẫn tạo được (thử lại phải THOÁT ra được)", async () => {
    const year = new Date().getFullYear();
    await prisma.quoteCounter.upsert({ where: { prefix_year: { prefix: PREFIX, year } }, create: { prefix: PREFIX, year, value: 199 }, update: { value: 199 } });
    // Chèn thẳng CSDL, KHÔNG qua API: đúng hình dạng dữ liệu chuyển từ hệ cũ.
    const mau = await prisma.quote.findFirst({ where: { title: { startsWith: TAG } } });
    const { id: _id, quoteNumber: _qn, createdAt: _ca, updatedAt: _ua, ...conLai } = mau;
    await prisma.quote.create({ data: { ...conLai, quoteNumber: so(200), title: `${TAG} legacy`, projectCode: null } });
    const r = await tao({});
    expect(r.status, `phải thoát khỏi số đã chiếm, nhận: ${JSON.stringify(r.body)}`).toBe(201);
    expect(r.body.quoteNumber).toBe(so(201));
  }, 30_000);

  it("ĐỔI số báo giá sang số cao hơn cũng đẩy bộ đếm", async () => {
    const r = await tao({});
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const doi = await admin.put(`/api/quotes/${r.body.id}`).send({ quoteNumber: so(500) });
    expect(doi.status, JSON.stringify(doi.body)).toBe(200);
    expect((await dem())?.value ?? 0).toBeGreaterThanOrEqual(500);
  });
});
