// KÉO ĐỔI THỨ TỰ SHEET — "thứ tự luôn, id luôn" (chủ repo 2026-09-24): kéo tab sheet sang chỗ khác thì
// số thứ tự VÀ mã sản xuất (_01, _02…) đi theo vị trí mới.
//
// Mã sản xuất được ĐÓNG BĂNG (capSoMaSheet) để một mã đã phát hành không bao giờ trỏ sang sheet khác.
// Đánh lại theo vị trí chỉ an toàn khi chưa mã nào của báo giá được dùng: không sheet nào có số hoá
// đơn / PO / ngày thu / chứng từ, và không hồ sơ nhân sự nào lưu mã của báo giá. Bài này chốt cả hai
// phía: đánh lại khi an toàn, giữ nguyên khi không — và trạng thái mức sheet (khách duyệt) luôn đi
// theo ĐÚNG sheet (máy chủ ghép theo id).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "User" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `ks${Date.now()}`;
const PWD = "KeoSheet1234!ok";

describe.runIf(dbAvailable)("kéo đổi thứ tự sheet — đánh lại mã sản xuất khi an toàn", () => {
  let app, u, co, tpl, ag;
  let dem = 0;

  beforeAll(async () => {
    app = (await import("../src/app.js")).createApp();
    u = await prisma.user.create({ data: { username: `${TAG}-a`, displayName: TAG, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    co = await prisma.company.create({ data: { code: `${TAG}-co`, name: "Cty thử kéo sheet", address: "1 Thử", quotePrefix: "KS" } });
    tpl = await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}-k`, filePath: "templates/GN_KhongNgay.xlsx" } });
    ag = agentWithCsrf(app);
    expect((await ag.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: u?.id } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  /** Báo giá có các sheet theo `ten` (mặc định A, B, C) mang mã 1..n (hoặc `codeNo` truyền vào). */
  const taoBaoGia = async ({ ten = ["A", "B", "C"], codeNo = null, seq = null, over = {} } = {}) => {
    dem++;
    const ma = codeNo || ten.map((_t, i) => i + 1);
    return prisma.quote.create({
      data: {
        quoteNumber: `${TAG}-${dem}`, projectCode: `KS_${TAG}_${dem}`, title: `${TAG} bg ${dem}`,
        toCompany: "Khách", companyId: co.id, fromContact: "A", fromAddress: "1 Thử", city: "TP. Hồ Chí Minh",
        quoteDate: new Date(), createdById: u.id, status: "draft", sheetCodeSeq: seq ?? Math.max(...ma),
        sheets: {
          create: ten.map((t, i) => ({
            templateId: tpl.id, order: i + 1, name: t, codeNo: ma[i],
            items: { create: [{ order: 1, kind: "item", name: `Hàng ${t}`, unit: "cái", quantity: 1, unitPrice: 1000 * (i + 1) }] },
          })),
        },
        ...over,
      },
    });
  };

  /** Lưu qua API với các sheet xếp theo `thuTu` (tên), giữ id như trình soạn gửi. Trả sheet theo `order`. */
  const luuTheoThuTu = async (q, thuTu, them = {}) => {
    const hien = (await ag.get(`/api/quotes/${q.id}`)).body;
    const theoTen = new Map(hien.sheets.map((s) => [s.name, s]));
    const sheets = thuTu.map((t, i) => {
      const s = theoTen.get(t);
      return {
        ...(s ? { id: s.id } : {}), templateId: tpl.id, name: t, order: i + 1, groupSubtotal: false,
        items: (s?.items || [{ kind: "item", name: `Hàng ${t}`, unit: "cái", quantity: 1, unitPrice: 500 }])
          .map((it, j) => ({ order: j + 1, kind: it.kind, name: it.name, unit: it.unit, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice) })),
      };
    });
    const r = await ag.put(`/api/quotes/${q.id}`).send({ sheets, baseUpdatedAt: hien.updatedAt, ...them });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    return prisma.quoteSheet.findMany({ where: { quoteId: q.id }, orderBy: { order: "asc" } });
  };
  const tomTat = (ds) => ds.map((s) => `${s.name}:${s.codeNo}`);

  it("kéo C lên đầu + danhLaiMaSheet → mã theo vị trí mới (C=_01) và 'khách duyệt' của C đi theo C", async () => {
    const q = await taoBaoGia();
    await prisma.quoteSheet.updateMany({ where: { quoteId: q.id, name: "C" }, data: { custStatus: "approved" } });
    const ds = await luuTheoThuTu(q, ["C", "A", "B"], { danhLaiMaSheet: true });
    expect(tomTat(ds)).toEqual(["C:1", "A:2", "B:3"]);
    expect(ds.find((s) => s.name === "C").custStatus, "trạng thái mức sheet phải đi theo đúng sheet").toBe("approved");
    expect(ds.find((s) => s.name === "A").custStatus).toBeNull();
    expect((await prisma.quote.findUnique({ where: { id: q.id } })).sheetCodeSeq).toBe(3);
  });

  it("KHÔNG gửi cờ → chỉ đổi thứ tự, mã đóng băng đi theo sheet như cũ", async () => {
    const q = await taoBaoGia();
    expect(tomTat(await luuTheoThuTu(q, ["C", "A", "B"]))).toEqual(["C:3", "A:1", "B:2"]);
  });

  it("một sheet đã có SỐ PO / ngày thu của khách → giữ nguyên mọi mã dù có cờ, PO đi theo sheet", async () => {
    const q = await taoBaoGia();
    await prisma.quoteSheet.updateMany({ where: { quoteId: q.id, name: "B" }, data: { poNumber: "PO-778" } });
    const ds = await luuTheoThuTu(q, ["C", "A", "B"], { danhLaiMaSheet: true });
    expect(tomTat(ds)).toEqual(["C:3", "A:1", "B:2"]);
    expect(ds.find((s) => s.name === "B").poNumber, "số PO phải đi theo sheet B").toBe("PO-778");
  });

  it("đã XUẤT HOÁ ĐƠN → báo giá khoá sửa (canEdit), không kéo đổi được gì — mã không thể bị đánh lại", async () => {
    const q = await taoBaoGia();
    await prisma.quoteSheet.updateMany({ where: { quoteId: q.id, name: "B" }, data: { invoiceNo: "HD-0001" } });
    const hien = (await ag.get(`/api/quotes/${q.id}`)).body;
    const sheets = ["C", "A", "B"].map((t, i) => {
      const sh = hien.sheets.find((x) => x.name === t);
      return { id: sh.id, templateId: tpl.id, name: t, order: i + 1, groupSubtotal: false,
        items: sh.items.map((it, j) => ({ order: j + 1, kind: it.kind, name: it.name, unit: it.unit, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice) })) };
    });
    const r = await ag.put(`/api/quotes/${q.id}`).send({ sheets, baseUpdatedAt: hien.updatedAt, danhLaiMaSheet: true });
    expect(r.status).toBe(403);
    const ds = await prisma.quoteSheet.findMany({ where: { quoteId: q.id }, orderBy: { order: "asc" } });
    expect(tomTat(ds)).toEqual(["A:1", "B:2", "C:3"]);
  });

  it("hồ sơ NHÂN SỰ đã lưu mã _02 của báo giá → giữ nguyên mọi mã dù có cờ", async () => {
    const q = await taoBaoGia();
    await prisma.personnelRecord.create({ data: { createdById: u.id, fullName: `${TAG} ns`, searchText: `${TAG} ns`, projectCode: `KS_${TAG}_${dem}_02` } });
    expect(tomTat(await luuTheoThuTu(q, ["C", "A", "B"], { danhLaiMaSheet: true }))).toEqual(["C:3", "A:1", "B:2"]);
  });

  it("hồ sơ nhân sự mang mã của bản _v2 (báo giá KHÁC) không chặn việc đánh lại", async () => {
    const q = await taoBaoGia();
    await prisma.personnelRecord.create({ data: { createdById: u.id, fullName: `${TAG} ns2`, searchText: `${TAG} ns2`, projectCode: `KS_${TAG}_${dem}_v2_01` } });
    expect(tomTat(await luuTheoThuTu(q, ["B", "A", "C"], { danhLaiMaSheet: true }))).toEqual(["B:1", "A:2", "C:3"]);
  });

  it("có khoảng trống do đã xoá sheet (mã 1 và 3, mốc 3) → đánh lại 1,2 và sheet thêm sau nối tiếp là 3", async () => {
    const q = await taoBaoGia({ ten: ["A", "C"], codeNo: [1, 3], seq: 3 });
    expect(tomTat(await luuTheoThuTu(q, ["C", "A"], { danhLaiMaSheet: true }))).toEqual(["C:1", "A:2"]);
    expect((await prisma.quote.findUnique({ where: { id: q.id } })).sheetCodeSeq).toBe(2);
    expect(tomTat(await luuTheoThuTu(q, ["C", "A", "D"]))).toEqual(["C:1", "A:2", "D:3"]);
  });
});
