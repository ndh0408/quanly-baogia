// CÔNG CỤ DỌN MÃ DỰ ÁN CŨ (src/maDuAnDonDep.ts, CLI src/tools/donMaDuAn.ts) — chủ repo 2026-11-25 chọn "làm sạch hết":
//   · gỡ mã khỏi mọi báo giá chưa chốt / đã xoá (giữ liên kết phiên bản về gốc),
//   · đánh lại mã đã chốt liền số theo (tiền tố, năm), giữ thứ tự số cũ, các phiên bản chung mã mới,
//   · mã kiểu cũ (không theo tiền tố người tạo) chỉ liệt kê, không đánh lại,
//   · bộ đếm về số lớn nhất còn lại; hồ sơ nhân sự (mã sản xuất lưu cứng) đổi theo; QuoteVersion.payload giữ nguyên,
//   · mỗi báo giá đổi mã có một dòng nhật ký; chạy lần hai không đổi gì.
// Chạy GIỚI HẠN vào người tạo của bài (chiNguoiTao): CSDL test dùng chung với các tệp test khác chạy song song.
// ĐỎ trên 7a6ce18: công cụ + cột projectRootId chưa có.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { normalizeSearch } from "../src/searchText.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `mdadon${Date.now()}`;
const PA = `D${String(Date.now()).slice(-6)}_A`;
const m26 = (n) => `${PA}26_${String(n).padStart(3, "0")}`;
const m25 = (n) => `${PA}25_${String(n).padStart(3, "0")}`;

describe.runIf(dbAvailable)("công cụ dọn mã dự án", () => {
  let D, uA, uC, companyId, tplId, q = {}, ns = {};

  const taoQ = async (ten, user, data) => prisma.quote.create({
    data: {
      quoteNumber: `${TAG}-${ten}`, title: `${TAG} ${ten}`, searchText: "", companyId, createdById: user.id, toCompany: `Khách ${ten}`,
      fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), subtotal: 0, total: 0, ...data,
    },
  });
  const phamVi = () => ({ chiNguoiTao: [uA.id, uC.id] });
  const doc = (id) => prisma.quote.findFirst({ where: { id }, includeDeleted: true });

  beforeAll(async () => {
    D = await import("../src/maDuAnDonDep.js");
    const pw = await bcrypt.hash("Test1234!a", 4);
    uA = await prisma.user.create({ data: { username: `${TAG}-a`, displayName: "A", role: "manager", projectCode: PA, passwordHash: pw } });
    uC = await prisma.user.create({ data: { username: `${TAG}-c`, displayName: "C", role: "manager", projectCode: null, passwordHash: pw } });
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1", quotePrefix: `W${String(Date.now()).slice(-5)}` } })).id;
    tplId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    q.c1 = await taoQ("c1", uA, { status: "converted", projectCode: m26(1) });
    q.n2 = await taoQ("n2", uA, { status: "draft", projectCode: m26(2) });                          // nháp xen giữa
    q.c4 = await taoQ("c4", uA, { status: "converted", projectCode: m26(4) });
    q.n4v2 = await taoQ("n4v2", uA, { status: "draft", projectCode: m26(4), projectVersion: 2 });   // nháp = phiên bản của c4
    q.c4v3 = await taoQ("c4v3", uA, { status: "converted", projectCode: m26(4), projectVersion: 3 });
    q.l5 = await taoQ("l5", uA, { status: "lost", projectCode: m26(5) });                            // khách không chốt
    q.c6 = await taoQ("c6", uA, {
      status: "converted", projectCode: m26(6),
      sheets: { create: [1, 2].map((n) => ({ templateId: tplId, order: n, codeNo: n, ...(n === 1 ? { invoiceNo: "HD-77", invoiceDate: new Date(), paidAt: new Date() } : {}) })) },
    });
    q.x7 = await taoQ("x7", uA, { status: "draft", projectCode: m26(7), deletedAt: new Date() });  // đã xoá mềm
    q.c25 = await taoQ("c25", uA, { status: "converted", projectCode: m25(3) });                    // năm khác
    q.cu = await taoQ("cu", uA, { status: "converted", projectCode: `OLDX${String(Date.now()).slice(-4)}26_002` });   // không theo tiền tố
    // Người KHÔNG tiền tố: gốc đã chốt không mã (mã hiển thị = số BG), "Bản mới" kiểu cũ lấy số BG làm mã chung.
    q.g = await taoQ("g", uC, { status: "converted", projectCode: null });
    q.gv2 = await taoQ("gv2", uC, { status: "converted", projectCode: q.g.quoteNumber, projectVersion: 2 });
    q.gv3 = await taoQ("gv3", uC, { status: "draft", projectCode: q.g.quoteNumber, projectVersion: 3 });

    await prisma.inputInvoiceEntry.create({ data: { quoteId: q.c6.id, side: "sheet", rid: "r1", paid: true, paidAt: new Date(), rowSnapshot: { name: "Thuê xe" } } });
    await prisma.quoteVersion.create({ data: { quoteId: q.c4.id, versionNo: 1, payload: { projectCode: m26(4) }, total: 0 } });
    ns.v3 = await prisma.personnelRecord.create({ data: { createdById: uA.id, fullName: `${TAG} Nguyễn Văn Ba`, projectCode: `${m26(4)}_v3` } });
    ns.s2 = await prisma.personnelRecord.create({ data: { createdById: uA.id, fullName: `${TAG} Trần Thị Tư`, projectCode: `${m26(6)}_02` } });
    ns.moCoi = await prisma.personnelRecord.create({ data: { createdById: uA.id, fullName: `${TAG} Lê Năm`, projectCode: m26(2) } });
    ns.khac = await prisma.personnelRecord.create({ data: { createdById: uA.id, fullName: `${TAG} Sáu`, projectCode: `${m26(1)}` } });
    await prisma.quoteCounter.createMany({ data: [{ prefix: PA, year: 2026, value: 9 }, { prefix: PA, year: 2025, value: 3 }] });
  }, 120_000);

  afterAll(async () => {
    const ids = Object.values(q).map((x) => x.id);
    await prisma.inputInvoiceEntry.deleteMany({ where: { quoteId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: ids } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PA } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { action: { in: ["quote.ma-du-an.don", "personnel.ma-du-an.don"] }, resourceId: { in: [...ids, ...Object.values(ns).map((n) => n.id)].map(String) } } }).catch(() => {});
  });

  it("--kiem: bảng đầy đủ — đánh lại liền số, nháp → NHÁP (giữ liên kết gốc), kiểu cũ chỉ liệt kê, cảnh báo chứng từ, bộ đếm, nhân sự", async () => {
    const kh = await D.keHoachMaDuAn(undefined, phamVi());
    const dong = (x) => kh.baoGia.find((b) => b.id === x.id);
    // Đã chốt: 001, 004, 006 → 001, 002, 003 (giữ thứ tự số cũ); phiên bản c4v3 CHUNG mã mới với c4.
    expect(dong(q.c1)).toMatchObject({ loai: "giu", maMoi: m26(1) });
    expect(dong(q.c4)).toMatchObject({ loai: "doi", maCu: m26(4), maMoi: m26(2) });
    expect(dong(q.c4v3)).toMatchObject({ loai: "doi", maMoi: m26(2), gocMoi: q.c4.id });
    expect(dong(q.c6)).toMatchObject({ loai: "doi", maMoi: m26(3) });
    expect(dong(q.c25)).toMatchObject({ loai: "doi", maMoi: m25(1) });
    // Chưa chốt / xoá mềm → gỡ; nháp phiên bản giữ liên kết về gốc dự án.
    for (const x of [q.n2, q.l5, q.x7, q.gv3]) expect(dong(x)).toMatchObject({ loai: "go", maMoi: null });
    expect(dong(q.n4v2)).toMatchObject({ loai: "go", maMoi: null, gocMoi: q.c4.id });
    expect(dong(q.gv3).gocMoi).toBe(q.g.id);
    // Kiểu cũ: giữ nguyên, chỉ liệt kê.
    expect(dong(q.cu)).toMatchObject({ loai: "kieu-cu", maMoi: q.cu.projectCode });
    expect(dong(q.gv2)).toMatchObject({ loai: "kieu-cu", maMoi: q.g.quoteNumber, gocMoi: q.g.id });
    // Cảnh báo: chứng từ thật đã mang mã cũ.
    expect(dong(q.c6).canhBao.join(" ")).toMatch(/số HĐ.*ngày HĐ.*đã thu.*khoản chi kế toán: 1 \(1 đã chi\)/);
    expect(dong(q.c4).canhBao).toEqual([]);
    // Nhân sự đổi theo (giữ đuôi _vN / _NN); mã đã gỡ chỉ liệt kê; mã giữ nguyên không đụng.
    expect(kh.nhanSu).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ns.v3.id, maMoi: `${m26(2)}_v3` }),
      expect.objectContaining({ id: ns.s2.id, maMoi: `${m26(3)}_02` }),
    ]));
    expect(kh.nhanSu.find((n) => n.id === ns.khac.id)).toBeUndefined();
    expect(kh.nhanSuMoCoi.map((n) => n.id)).toContain(ns.moCoi.id);
    // Bộ đếm về số lớn nhất còn lại.
    expect(kh.boDem).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: PA, year: 2026, cu: 9, moi: 3, ghiChu: null }),
      expect.objectContaining({ prefix: PA, year: 2025, cu: 3, moi: 1, ghiChu: null }),
    ]));
    // Bảng in: có cột mã cũ → mã mới, NHÁP, cảnh báo.
    const bang = D.inKeHoach(kh).join("\n");
    expect(bang).toContain(`${m26(4)} → ${m26(2)}`);
    expect(bang).toContain(`${m26(4)} (v3) → ${m26(2)} (v3)`);
    expect(bang).toContain(`${m26(2)} → NHÁP ${q.n2.quoteNumber}`);
    expect(bang).toContain("MÃ KIỂU CŨ");
    expect(bang).toMatch(/⚠ có số HĐ/);
    // --kiem CHỈ ĐỌC.
    expect((await doc(q.n2.id)).projectCode).toBe(m26(2));
    expect(D.coViec(kh)).toBe(true);
  });

  it("--ap-dung: ghi đúng (một transaction), searchText + nhân sự + bộ đếm + nhật ký; lịch sử phiên bản giữ nguyên", async () => {
    await D.apDungMaDuAn(phamVi());
    const ma = async (x) => { const r = await doc(x.id); return [r.projectCode, r.projectVersion, r.projectRootId]; };
    expect(await ma(q.c1)).toEqual([m26(1), 1, null]);
    expect(await ma(q.c4)).toEqual([m26(2), 1, null]);
    expect(await ma(q.c4v3)).toEqual([m26(2), 3, q.c4.id]);
    expect(await ma(q.n4v2)).toEqual([null, 2, q.c4.id]);
    expect(await ma(q.c6)).toEqual([m26(3), 1, null]);
    expect(await ma(q.c25)).toEqual([m25(1), 1, null]);
    for (const x of [q.n2, q.l5, q.x7]) expect((await doc(x.id)).projectCode).toBeNull();
    expect(await ma(q.gv2)).toEqual([q.g.quoteNumber, 2, q.g.id]);
    expect(await ma(q.gv3)).toEqual([null, 3, q.g.id]);
    expect((await doc(q.cu.id)).projectCode).toBe(q.cu.projectCode);
    // searchText theo mã MỚI (công thức của createQuote/updateQuote).
    const c4 = await doc(q.c4.id);
    expect(c4.searchText).toBe(normalizeSearch(c4.quoteNumber, m26(2), c4.title, c4.toCompany, c4.toContact));
    const n2 = await doc(q.n2.id);
    expect(n2.searchText).toBe(normalizeSearch(n2.quoteNumber, null, n2.title, n2.toCompany, n2.toContact));
    // Nhân sự.
    const v3 = await prisma.personnelRecord.findUnique({ where: { id: ns.v3.id } });
    expect(v3.projectCode).toBe(`${m26(2)}_v3`);
    expect(v3.searchText).toContain(normalizeSearch(`${m26(2)}_v3`));
    expect((await prisma.personnelRecord.findUnique({ where: { id: ns.moCoi.id } })).projectCode, "mồ côi: chỉ liệt kê").toBe(m26(2));
    // Bộ đếm.
    const dem = await prisma.quoteCounter.findMany({ where: { prefix: PA }, orderBy: { year: "asc" } });
    expect(dem.map((d) => [d.year, d.value])).toEqual([[2025, 1], [2026, 3]]);
    // Lịch sử giữ nguyên.
    expect((await prisma.quoteVersion.findFirst({ where: { quoteId: q.c4.id } })).payload).toEqual({ projectCode: m26(4) });
    // Nhật ký: mỗi báo giá đổi mã một dòng, mã cũ → mới.
    const nk = await prisma.auditEvent.findFirst({ where: { action: "quote.ma-du-an.don", resourceId: String(q.c4.id) } });
    expect(nk).toMatchObject({ actorId: null, before: { projectCode: m26(4) }, after: { projectCode: m26(2), viec: "doi" } });
    const nkGo = await prisma.auditEvent.findFirst({ where: { action: "quote.ma-du-an.don", resourceId: String(q.n4v2.id) } });
    expect(nkGo).toMatchObject({ before: { projectCode: m26(4), projectRootId: null }, after: { projectCode: null, projectRootId: q.c4.id } });
    expect(await prisma.auditEvent.count({ where: { action: "personnel.ma-du-an.don", resourceId: String(ns.v3.id) } })).toBe(1);
  });

  it("chạy lại lần hai: KHÔNG còn việc, không ghi gì (idempotent)", async () => {
    const kh = await D.keHoachMaDuAn(undefined, phamVi());
    expect(D.coViec(kh), D.inKeHoach(kh).join("\n")).toBe(false);
    const truoc = await prisma.auditEvent.count({ where: { action: "quote.ma-du-an.don" } });
    await D.apDungMaDuAn(phamVi());
    expect(await prisma.auditEvent.count({ where: { action: "quote.ma-du-an.don" } })).toBe(truoc);
    expect((await doc(q.c6.id)).projectCode).toBe(m26(3));
  });

  it("sau khi dọn: chốt nháp phiên bản → LẤY LẠI mã mới của dự án + phiên bản kế; dự án mới nối tiếp bộ đếm liền số", async () => {
    const { capMaDuAnKhiChot } = await import("../src/maDuAn.js");
    const chotThu = (id) => prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "Quote" SET status = 'converted' WHERE id = ${id}`;
      return capMaDuAnKhiChot(tx, id);
    });
    expect(await chotThu(q.n4v2.id)).toMatchObject({ projectCode: m26(2), projectVersion: 4, cach: "phien-ban" });
    // Mã mới theo NĂM LÚC CHỐT: năm nay là 2026 thì nối tiếp bộ đếm đã dọn (3 → 004), năm khác thì bắt đầu 001.
    const nam = new Date().getFullYear();
    const maMoi = nam === 2026 ? m26(4) : `${PA}${String(nam).slice(-2)}_001`;
    expect(await chotThu(q.n2.id)).toMatchObject({ projectCode: maMoi, projectVersion: 1, cach: "moi" });
    expect(await chotThu(q.gv3.id)).toMatchObject({ projectCode: q.g.quoteNumber, projectVersion: 3, cach: "phien-ban" });
  });
});
