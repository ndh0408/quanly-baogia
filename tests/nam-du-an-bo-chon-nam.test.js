// NĂM DỰ ÁN cho BỘ CHỌN NĂM (2026-11-26, chủ repo chuyển lời: "sau 1 năm thì data mình có cách nào gom vô 1 thư mục … click
// vô năm 2026 thì chỉ thể hiện 2026 thôi"). Trang Quản lý dự án / Hóa đơn đầu ra / Hóa đơn đầu vào lọc theo `projectYear`
// máy chủ trả: năm KHÁCH CHỐT theo GIỜ VN (đúng năm in trong mã dự án), chưa chốt / chốt trước khi có cột convertedAt thì
// năm của ngày báo giá. Bẫy dễ vỡ: chốt lúc 01:00 sáng 01/01 giờ VN là 18:00 ngày 31/12 UTC — đọc năm UTC là lệch một năm.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/db.js";
import { listProjects } from "../src/services/quoteService.js";
import { hangHoaDonDauVao } from "../src/inputInvoices.js";

const TAG = `NAMDA${Date.now().toString(36)}`;
const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kiểm tra được Postgres");

describe("hangHoaDonDauVao — projectYear theo năm chốt (giờ VN), chưa chốt thì năm ngày báo giá", () => {
  const bg = { id: 5, companyId: 7, projectCode: "FP_A26_005", projectVersion: 1, quoteNumber: "GN26005", title: "Sự kiện", shortTitle: null, status: "converted", hnStatus: null, hnReviewedAt: null, hnReviewerId: null, customer: { code: "KH1", name: "Khách 1" }, company: { shortName: "GN", name: "Gia Nguyễn" }, createdBy: { displayName: "Lan" } };
  const hang = { kind: "item", rid: "r1", name: "Thuê xe", quantity: 2, unitPrice: 500000, approved: true, approvedAt: "2026-09-20T03:00:00.000Z", approvedBy: 9 };
  const dung = (q) => hangHoaDonDauVao({
    quote: { ...bg, ...q }, sheets: [{ id: 50, order: 1, name: "Trang A", codeNo: 1 }],
    sheetTables: [{ sheetId: 50, tables: [{ category: "hcm", name: "Chi phí HCM", items: [hang] }] }], bangHn: [],
    dsMau: [{ id: 1, companyId: 7, hasDays: false }], tenNguoi: new Map([[9, "Admin"]]),
  });
  it("chốt 01:00 sáng 01/01/2026 giờ VN (= 18:00 31/12/2025 UTC) → 2026, không phải 2025", () => {
    expect(dung({ convertedAt: new Date("2025-12-31T18:00:00.000Z"), quoteDate: new Date("2025-12-20T00:00:00.000Z") })[0].projectYear).toBe(2026);
  });
  it("chưa chốt → năm ngày báo giá; không có ngày nào → null (chỉ hiện ở 'Tất cả')", () => {
    expect(dung({ status: "draft", convertedAt: null, quoteDate: new Date("2025-06-01T00:00:00.000Z") })[0].projectYear).toBe(2025);
    expect(dung({ convertedAt: null, quoteDate: null })[0].projectYear).toBeNull();
  });
});

describe.runIf(dbAvailable)("listProjects — projectYear", () => {
  let userId, coId, tplId;
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "manager", passwordHash: "x" } })).id;
    coId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1", quotePrefix: `N${Date.now().toString().slice(-5)}` } })).id;
    tplId = (await prisma.quoteTemplate.create({ data: { companyId: coId, name: "Mẫu", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    const tao = (ten, quoteDate, convertedAt) => prisma.quote.create({ data: {
      quoteNumber: `${TAG}-${ten}`, title: `${TAG} ${ten}`, searchText: TAG, toCompany: "Khách", companyId: coId, fromContact: "x", fromAddress: "x",
      city: "TP. Hồ Chí Minh", quoteDate, convertedAt, createdById: userId, status: "converted", subtotal: 1000, total: 1080,
      sheets: { create: [{ templateId: tplId, order: 1, name: "Trang 1", subtotal: 1000 }] },
    } });
    await tao("giao-thua", new Date("2025-12-20T00:00:00.000Z"), new Date("2025-12-31T18:00:00.000Z"));
    await tao("chot-cu", new Date("2025-06-01T00:00:00.000Z"), null);
  });
  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });
  it("năm chốt theo giờ VN; chốt trước khi có convertedAt → năm ngày báo giá", async () => {
    const { data } = await listProjects({ query: {}, session: { userId, role: "manager", permissions: ["quote:read:own"] } });
    const nam = Object.fromEntries(data.filter((d) => d.title.startsWith(TAG)).map((d) => [d.title.slice(TAG.length + 1), d.projectYear]));
    expect(nam).toEqual({ "giao-thua": 2026, "chot-cu": 2025 });
  });
});
