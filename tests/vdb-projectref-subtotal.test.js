// Cột HỒNG "Tiền trước thuế" ở trang Nhân sự (web/src/lib/fields.ts) được tra từ báo giá ĐÃ CHỐT
// qua `buildProjectRef` (src/services/projectRef.ts). Đây là TIỀN — không được phép ra số sai.
//
// ── LỖI (hồi quy do vòng vá trước) ──────────────────────────────────────────
// Vòng trước đổi nguồn số từ "tính lại từ items" sang "đọc cột materialized `QuoteSheet.subtotal`".
// Cột đó do migration 20260625000003 thêm với `NOT NULL DEFAULT 0`, nên MỌI sheet lưu TRƯỚC ngày
// đó mang giá trị 0 cho tới khi ai đó chạy tay `prisma/backfill-sheet-subtotal.mjs`.
// `buildProjectRef` CHỈ đọc báo giá `status:"converted"`, mà converted là BẤT BIẾN
// (canEdit ở src/quoteUtils.ts (hàm `canEdit`) trả false) ⇒ những sheet đó KHÔNG BAO GIỜ được lưu lại để cột
// được ghi. Cột là NOT NULL nên nhánh dự phòng `sh.subtotal != null ? … : q.subtotal` không bao
// giờ chạy: 0 được coi là số hợp lệ.
//
// ── HẬU QUẢ ─────────────────────────────────────────────────────────────────
// Báo giá chốt trước 2026-06-25, items cộng lại 500.000.000 đ → trang Nhân sự hiện "0 đ" (KHÔNG
// phải "—", vì có entry nên personnelService.ts:50 `ref?.preTaxAmount ?? null` không rơi về null).
// Im lặng, sai, và không bao giờ tự lành.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Giữ đường nhanh (đọc cột) cho dữ liệu đã có số, nhưng khi cột = 0 thì KÉO ITEMS CỦA RIÊNG SHEET
// ĐÓ và tính lại bằng `computeQuoteTotals` — đúng hàm mà cột được ghi ra từ đó. Sheet rỗng thật sự
// cũng cho 0, nên nhánh dự phòng không thể làm số đang đúng thành sai; nó chỉ tốn thêm một truy vấn
// hẹp cho phần dữ liệu chưa backfill.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { buildProjectRef } from "../src/services/projectRef.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

// TAG có dấu thời gian → không đụng dữ liệu của agent/bộ test khác trên cùng CSDL dùng chung.
// KHÔNG được kết thúc bằng `_NNN`: validator projectCode (src/validators.ts:46) cắt hậu tố đó.
const TAG = `vdbpref${Date.now()}`;
const MA_CHUA_BACKFILL = `${TAG}-CB`;   // subtotal = 0 (dữ liệu cũ), items có tiền thật
const MA_KHOP = `${TAG}-KHOP`;          // cột khớp items (dữ liệu lưu bình thường)
const MA_LECH = `${TAG}-LECH`;          // cột KHÁC items và KHÁC 0 → cột thắng (cùng nguồn với trang Dự án)
const MA_DOI = `${TAG}-DOI`;            // 2 sheet: một sheet chưa backfill, một sheet đã có số
const MA_NHOM = `${TAG}-NHOM`;          // hệ số nhóm (groupSubtotal) — chứng minh nhánh dự phòng dùng đúng computeQuoteTotals
const PASSWORD = "Test1234!a";

describe.runIf(dbAvailable)("buildProjectRef — nguồn tiền cột HỒNG trang Nhân sự", () => {
  let app, userId, companyId, templateId, adminU, admin;
  const quoteIds = [];

  /** Tạo báo giá ĐÃ CHỐT. `sheets[i]` = { subtotal (giá trị cột), items, groupSubtotal, invoiceNo }. */
  const taoBaoGia = async (projectCode, sheets) => {
    const q = await prisma.quote.create({
      data: {
        quoteNumber: `${projectCode}-Q`, projectCode, title: "Báo giá thử projectRef", toCompany: "Khách thử",
        companyId, fromContact: "Người gửi", fromAddress: "2 Thử", city: "TP. Hồ Chí Minh",
        quoteDate: new Date(), createdById: userId, status: "converted", subtotal: "1",
        sheets: {
          create: sheets.map((s, i) => ({
            templateId, order: i, name: `Sheet ${i + 1}`, subtotal: s.subtotal,
            groupSubtotal: !!s.groupSubtotal, invoiceNo: s.invoiceNo ?? null,
            items: {
              create: s.items.map((it, j) => ({
                order: j, kind: it.kind ?? "item", name: `HM ${j}`, unit: "cái",
                quantity: it.qty, unitPrice: it.price ?? "0",
              })),
            },
          })),
        },
      },
    });
    quoteIds.push(q.id);
    return q.id;
  };

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const u = await prisma.user.create({ data: { username: `${TAG}-u`, displayName: `${TAG} u`, role: "admin", passwordHash: "x" } });
    userId = u.id;
    adminU = await prisma.user.create({
      data: { username: `${TAG}-ad`, displayName: `${TAG} ad`, role: "admin", passwordHash: await bcrypt.hash(PASSWORD, 4) },
    });
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử projectRef", address: "1 Thử", quotePrefix: "VP" } });
    companyId = co.id;
    const tpl = await prisma.quoteTemplate.create({ data: { code: `${TAG}TPL`, name: "Mẫu thử", companyId, filePath: "x.xlsx" } });
    templateId = tpl.id;

    // DỮ LIỆU CŨ chưa backfill: cột = 0 (mặc định của ALTER TABLE), items cộng lại 500 triệu.
    await taoBaoGia(MA_CHUA_BACKFILL, [{ subtotal: "0", invoiceNo: "HD-CB", items: [{ qty: "1", price: "500000000" }] }]);
    // Dữ liệu lưu bình thường: cột KHỚP tổng items.
    await taoBaoGia(MA_KHOP, [{ subtotal: "1500000", items: [{ qty: "2", price: "500000" }, { qty: "1", price: "500000" }] }]);
    // Cột khác items nhưng KHÁC 0 → chính sách: tin cột (đúng con số trang Quản lý dự án đang hiện).
    await taoBaoGia(MA_LECH, [{ subtotal: "777000", items: [{ qty: "1", price: "1000000" }] }]);
    // Nhiều sheet → hậu tố _1/_2; sheet 1 chưa backfill, sheet 2 đã có số.
    await taoBaoGia(MA_DOI, [
      { subtotal: "0", items: [{ qty: "1", price: "999999" }] },
      { subtotal: "222000", items: [{ qty: "1", price: "888888" }] },
    ]);
    // Hệ số nhóm: dòng section SL=2 nhân đôi các dòng phía sau (computeQuoteTotals) → 2×(3×100.000).
    await taoBaoGia(MA_NHOM, [{
      subtotal: "0", groupSubtotal: true,
      items: [{ kind: "section", qty: "2", price: "0" }, { qty: "3", price: "100000" }],
    }]);

    // Hồ sơ nhân sự trỏ tới báo giá CHƯA BACKFILL — đây là đường mà người dùng thật đi qua.
    admin = agentWithCsrf(app);
    const r = await admin.post("/api/auth/login").send({ username: adminU.username, password: PASSWORD });
    expect(r.status).toBe(200);
    const c = await admin.post("/api/personnel").send({
      fullName: `${TAG} Nhân công`, salary: 9_000_000, projectName: "Dự án thử", projectCode: MA_CHUA_BACKFILL,
    });
    expect(c.status).toBe(201);
  });

  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true });
    await prisma.quoteVersion.deleteMany({ where: { quoteId: { in: quoteIds } } });
    // Quote hard-delete → QuoteSheet/QuoteItem tự xoá theo (onDelete: Cascade).
    await prisma.quote.deleteMany({ where: { id: { in: quoteIds } }, hardDelete: true });
    await prisma.quoteTemplate.deleteMany({ where: { id: templateId }, hardDelete: true });
    await prisma.company.deleteMany({ where: { id: companyId }, hardDelete: true });
    await prisma.user.deleteMany({ where: { id: { in: [userId, adminU.id] } }, hardDelete: true });
  });

  it("DỮ LIỆU CŨ (subtotal=0, chưa backfill): trả tiền THẬT tính từ items, KHÔNG trả 0", async () => {
    const ref = await buildProjectRef([MA_CHUA_BACKFILL]);
    expect(ref.get(MA_CHUA_BACKFILL)).toBeTruthy();
    expect(ref.get(MA_CHUA_BACKFILL).preTaxAmount).toBe(500_000_000);
    expect(ref.get(MA_CHUA_BACKFILL).salesContractNo).toBe("HD-CB");
  });

  it("GET /api/personnel: cột HỒNG preTaxAmount của hồ sơ ra đúng số, không phải 0/null", async () => {
    const r = await admin.get("/api/personnel").query({ q: TAG });
    expect(r.status).toBe(200);
    const row = r.body.data.find((x) => x.projectCode === MA_CHUA_BACKFILL);
    expect(row).toBeTruthy();
    expect(Number(row.preTaxAmount)).toBe(500_000_000);
  });

  it("dữ liệu lưu bình thường: cột khớp items → số không đổi", async () => {
    const ref = await buildProjectRef([MA_KHOP]);
    expect(ref.get(MA_KHOP).preTaxAmount).toBe(1_500_000);
  });

  it("cột đã có số (≠0) thì TIN CỘT — cùng nguồn với trang Quản lý dự án", async () => {
    const ref = await buildProjectRef([MA_LECH]);
    expect(ref.get(MA_LECH).preTaxAmount).toBe(777_000);
  });

  it("nhiều sheet: sheet chưa backfill tự tính lại, sheet đã có số giữ nguyên", async () => {
    const ref = await buildProjectRef([`${MA_DOI}_1`, `${MA_DOI}_2`]);
    expect(ref.get(`${MA_DOI}_1`).preTaxAmount).toBe(999_999);
    expect(ref.get(`${MA_DOI}_2`).preTaxAmount).toBe(222_000);
  });

  it("nhánh dự phòng dùng ĐÚNG computeQuoteTotals (hệ số nhóm, bỏ dòng section)", async () => {
    const ref = await buildProjectRef([MA_NHOM]);
    expect(ref.get(MA_NHOM).preTaxAmount).toBe(600_000);
  });
});
