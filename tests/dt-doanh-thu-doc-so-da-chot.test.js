/**
 * ============================================================================
 * BÁO CÁO DOANH THU PHẢI ĐỌC SỐ ĐÃ CHỐT, KHÔNG ĐỌC TỔNG BẢN CHÀO.
 *
 * ── LỖ ─────────────────────────────────────────────────────────────────────
 * Ngày 2026-09-17 thêm cột `Quote.convertedTotal` = số tiền THẬT SỰ chốt, đã trừ những trang
 * khách bấm "Không duyệt". Chính migration đặt ra luật:
 *
 *     20260917030000_.../migration.sql:15
 *     "Mọi nơi đọc phải dùng COALESCE(\"convertedTotal\", \"total\")"
 *
 * Nhưng luật đó KHÔNG được thi hành ở đâu cả: `grep -rn convertedTotal src/` chỉ ra chỗ GHI
 * (quoteService), webhook, và một dòng toast trên SPA. `analyticsService.ts` — nơi sinh ra MỌI
 * con số tiền mà người dùng nhìn thấy — vẫn cộng `Quote.total`.
 *
 * Nghĩa là: báo giá 12 trang, khách gạt 2 trang, bấm "Khách chốt" → CSDL lưu đúng số đã trừ,
 * webhook gửi đúng số đã trừ, còn bảng điều khiển vẫn hiện số ĐẦY ĐỦ. Cột được ghi mà không ai
 * đọc thì lỗi vẫn y nguyên ở chỗ người ta thật sự nhìn.
 *
 * ── BỐN CHỖ ĐỌC, BÀI NÀY KHOÁ CẢ BỐN ───────────────────────────────────────
 *   · kpi.approvedAmount  → ô "Doanh số đã chốt"  (Dashboard.tsx:355)
 *   · kpi.avgDealSize     → ô "Deal trung bình"   (Dashboard.tsx:357)
 *   · sums.converted      → bậc cuối của phễu     (Dashboard.tsx:163)
 *   · revenue-by-day      → biểu đồ doanh số theo ngày
 *   · top-sales           → bảng xếp hạng
 *
 * ── VẾ PHẢI GIỮ: convertedTotal NULL ───────────────────────────────────────
 * 12 báo giá đã chốt TRƯỚC 2026-09-17 có `convertedTotal` NULL vì cột chưa tồn tại. Chúng phải
 * rơi về `total` — đúng con số hệ thống vẫn báo cho tới nay. Đọc thành 0 sẽ xoá trắng lịch sử
 * doanh thu, một lỗi TO HƠN lỗi đang vá.
 *
 * ── CỬA SỔ THỜI GIAN RIÊNG ─────────────────────────────────────────────────
 * CSDL test dùng chung, nên bài này đặt `createdAt` vào một tháng không ai dùng rồi hỏi đúng
 * khoảng đó. So số tuyệt đối trên toàn bảng sẽ chập chờn theo thứ tự chạy của các tệp khác —
 * đúng lớp lỗi đã cắn tests/bearer-no-session.test.js hai lần.
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

const TAG = `dtchot${Date.now()}`;
const PWD = "Test1234!a";

// Cửa sổ RIÊNG của bài này. Năm 2031 để không đụng dữ liệu của bất kỳ tệp test nào khác.
const KHI = new Date("2031-03-05T08:00:00Z");
const TU = "2031-03-01T00:00:00.000Z";
const DEN = "2031-03-31T23:59:59.000Z";

// Hai báo giá đã chốt:
//   A — chốt SAU bản vá: bản chào 10tr, khách gạt bớt còn 6tr.
//   B — chốt TRƯỚC bản vá: convertedTotal NULL → phải rơi về total 4tr.
const A_TOTAL = 10_000_000;
const A_CHOT = 6_000_000;
const B_TOTAL = 4_000_000;
const DUNG = A_CHOT + B_TOTAL;        // 10tr — số ĐÚNG
const SAI = A_TOTAL + B_TOTAL;        // 14tr — số của bản lỗi

describe.runIf(dbAvailable)("Báo cáo doanh thu đọc COALESCE(convertedTotal, total)", () => {
  let app, admin, userId, companyId;

  async function taoBaoGia(nhan, { total, convertedTotal, status }) {
    return prisma.quote.create({
      data: {
        quoteNumber: `${TAG}-${nhan}`,
        title: `${TAG} ${nhan}`,
        searchText: TAG,
        companyId,
        createdById: userId,
        toCompany: "Khách thử",
        fromContact: "x",
        fromAddress: "x",
        city: "TP. Hồ Chí Minh",
        quoteDate: KHI,
        createdAt: KHI,
        status,
        vatPercent: 0,
        subtotal: total,
        total,
        ...(convertedTotal === null ? {} : { convertedTotal }),
        ...(status === "converted" ? { convertedAt: KHI } : {}),
      },
    });
  }

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const u = await prisma.user.create({
      data: { username: `${TAG}-ad`, displayName: `${TAG} ad`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) },
    });
    userId = u.id;
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử" } })).id;

    await taoBaoGia("A", { total: A_TOTAL, convertedTotal: A_CHOT, status: "converted" });
    await taoBaoGia("B", { total: B_TOTAL, convertedTotal: null, status: "converted" });
    // Một bản nháp trong cùng cửa sổ: KHÔNG được lọt vào doanh thu đã chốt.
    await taoBaoGia("C", { total: 99_000_000, convertedTotal: null, status: "draft" });

    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: `${TAG}-ad`, password: PWD })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it('ô "Doanh số đã chốt" trừ phần khách không duyệt', async () => {
    const r = await admin.get(`/api/analytics/overview?from=${TU}&to=${DEN}`);
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(200);
    expect(r.body.kpi.approvedAmount, `đang cộng total (${SAI}) thay vì số đã chốt`).toBe(DUNG);
    expect(r.body.kpi.approvedAmount).not.toBe(SAI);
  }, 60_000);

  it('ô "Deal trung bình" là trung bình của CHÍNH con số đang báo', async () => {
    // Dễ sai: giữ `_avg` của một trong hai vế → ra trung bình của nửa tập.
    const r = await admin.get(`/api/analytics/overview?from=${TU}&to=${DEN}`);
    expect(r.body.kpi.avgDealSize).toBe(DUNG / 2);
  }, 60_000);

  it("bậc cuối của PHỄU nói cùng con số với ô bên cạnh", async () => {
    // Hai ô cạnh nhau trên cùng màn hình mà lệch nhau thì người đọc không biết tin ô nào.
    const r = await admin.get(`/api/analytics/overview?from=${TU}&to=${DEN}`);
    expect(r.body.sums.converted).toBe(DUNG);
    expect(r.body.sums.draft, "bản nháp lọt vào doanh thu đã chốt").toBe(99_000_000);
    expect(r.body.counts.converted).toBe(2);
  }, 60_000);

  it("biểu đồ doanh số theo ngày trừ đúng phần đó", async () => {
    const r = await admin.get(`/api/analytics/revenue-by-day?from=${TU}&to=${DEN}`);
    expect(r.status).toBe(200);
    const tong = r.body.data.reduce((a, d) => a + Number(d.amount), 0);
    expect(tong, `biểu đồ cộng ${tong}, phải là ${DUNG}`).toBe(DUNG);
  }, 60_000);

  it("bảng xếp hạng dùng số đã chốt", async () => {
    // Xếp theo `total` sẽ cho người bán một báo giá lớn bị gạt quá nửa đứng trên người bán một
    // báo giá nhỏ hơn nhưng khách lấy hết.
    const r = await admin.get(`/api/analytics/top-sales?from=${TU}&to=${DEN}&limit=50`);
    expect(r.status).toBe(200);
    const toi = r.body.data.find((d) => d.userId === userId);
    expect(toi, "không thấy người tạo trong bảng xếp hạng").toBeTruthy();
    expect(toi.amount).toBe(DUNG);
    expect(toi.count).toBe(2);
  }, 60_000);

  it("báo giá chốt TRƯỚC 2026-09-17 (convertedTotal NULL) VẪN tính bằng total", async () => {
    // Vế đối trọng, quan trọng hơn vế chính: lọc `convertedTotal: { not: null }` rồi quên nhóm
    // còn lại sẽ XOÁ TRẮNG doanh thu lịch sử — 12 báo giá trên production đều NULL.
    await prisma.quote.deleteMany({ where: { quoteNumber: `${TAG}-A` }, hardDelete: true, includeDeleted: true });
    const r = await admin.get(`/api/analytics/overview?from=${TU}&to=${DEN}`);
    expect(r.body.kpi.approvedAmount, "báo giá cũ (convertedTotal NULL) bị đọc thành 0").toBe(B_TOTAL);
    expect(r.body.kpi.avgDealSize).toBe(B_TOTAL);
  }, 60_000);
});
