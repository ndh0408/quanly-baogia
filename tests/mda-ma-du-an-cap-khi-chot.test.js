// MÃ DỰ ÁN CHỈ CẤP LÚC KHÁCH CHỐT (chủ repo 2026-11-25): "tạo mới chưa duyệt thì không có mã nào, duyệt khách chốt thì
// mới tạo mã dự án nhé, để khỏi rác mã dự án".
//
// Hợp đồng (src/maDuAn.ts, quoteService.createQuote / duplicateQuote / markConverted):
//   · Tạo mới / Nhân bản / Bản mới → projectCode NULL (nhãn "NHÁP <số BG>" ở giao diện + file xuất: tests/mda-nhap-hien-thi.test.js).
//   · Chốt → cấp mã kế tiếp theo tiền tố NGƯỜI TẠO, liền số, CÙNG transaction; chốt lỗi → không tiêu số.
//   · Hai báo giá chốt song song: không trùng, không lỗ.
//   · "Bản mới" của dự án đã chốt: nháp không mã, nhớ gốc (projectRootId); chốt → mã gốc + phiên bản kế (không số mới).
//   · Người tạo không có tiền tố: chốt xong vẫn không mã (hiện số BG); "Bản mới" của nó chốt → số BG gốc + _v2 như trước.
//   · Trang Quản lý dự án / Hóa đơn đầu vào / tìm kiếm chịu được projectCode null.
// ĐỎ trên 7a6ce18: createQuote / duplicateQuote cấp mã ngay lúc tạo (projectCode ≠ null), chốt không cấp gì.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `mdachot${Date.now()}`;
const PWD = "Test1234!a";
// Tiền tố RIÊNG cho lượt chạy → bộ đếm (tiền tố, năm) bắt đầu từ 0, không đụng tệp test khác.
const TIEN_TO = `M${String(Date.now()).slice(-6)}_A`;
const YY = String(new Date().getFullYear()).slice(-2);
const NAM = new Date().getFullYear();
const ma = (n) => `${TIEN_TO}${YY}_${String(n).padStart(3, "0")}`;

describe.runIf(dbAvailable)("mã dự án cấp lúc khách chốt", () => {
  let app, chu, khongTienTo, admin, companyId, templateId;

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    const r = await a.post("/api/auth/login").send({ username: u.username, password: PWD });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return a;
  };
  const taoUser = async (ten, role, projectCode = null) => prisma.user.create({
    data: { username: `${TAG}-${ten}`, displayName: `${TAG} ${ten}`, role, projectCode, passwordHash: await bcrypt.hash(PWD, 4) },
  });
  const taoBaoGia = async (agent, title, soSheet = 1, them = {}) => {
    const sh = (i) => ({ name: `Trang ${i + 1}`, order: i + 1, templateId, items: [{ kind: "item", name: `HM ${i}`, quantity: 1, unitPrice: 1_000_000, order: 1 }], ...them });
    const r = await agent.post("/api/quotes").send({ title: `${TAG} ${title}`, companyId, toCompany: "Khách thử", vatPercent: 8, sheets: Array.from({ length: soSheet }, (_, i) => sh(i)) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  const chot = (agent, id, body = {}) => agent.post(`/api/quotes/${id}/mark-converted`).send(body);
  const doc = (id) => prisma.quote.findFirst({ where: { id }, includeDeleted: true });
  const boDem = async () => (await prisma.quoteCounter.findUnique({ where: { prefix_year: { prefix: TIEN_TO, year: NAM } } }))?.value ?? 0;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `Y${String(Date.now()).slice(-5)}` } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    chu = await dangNhap(await taoUser("chu", "manager", TIEN_TO));
    khongTienTo = await dangNhap(await taoUser("ktt", "manager", null));
    admin = await dangNhap(await taoUser("admin", "admin"));
  }, 120_000);

  afterAll(async () => {
    await prisma.inputInvoiceEntry.deleteMany({ where: { quote: { title: { startsWith: TAG } } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: TIEN_TO } }).catch(() => {});
  });

  it("tạo mới → KHÔNG có mã dự án, bộ đếm mã KHÔNG tăng; danh sách trả projectCode null", async () => {
    const q = await taoBaoGia(chu, "moi");
    expect(q.projectCode, "tạo mới mà đã có mã — mã rác cho báo giá chưa chốt").toBeNull();
    expect(q.status).toBe("draft");
    expect(await boDem(), "tạo mới đã tiêu một số mã dự án").toBe(0);
    const ds = await chu.get(`/api/quotes?q=${encodeURIComponent(q.quoteNumber)}`);
    expect(ds.status).toBe(200);
    const hang = ds.body.data.find((x) => x.id === q.id);
    expect(hang).toMatchObject({ projectCode: null, status: "draft", quoteNumber: q.quoteNumber });
  });

  it("chốt → cấp mã kế tiếp đúng tiền tố người tạo, LIỀN SỐ, kể cả khi có nháp xen giữa; searchText + nhật ký có mã", async () => {
    const a = await taoBaoGia(chu, "a");
    await taoBaoGia(chu, "nhap-xen");
    const b = await taoBaoGia(chu, "b");
    const rb = await chot(chu, b.id);
    expect(rb.status, JSON.stringify(rb.body)).toBe(200);
    expect(rb.body.projectCode).toBe(ma(1));
    const ra = await chot(admin, a.id);   // ADMIN bấm chốt — mã vẫn theo tiền tố NGƯỜI TẠO
    expect(ra.status, JSON.stringify(ra.body)).toBe(200);
    expect(ra.body.projectCode).toBe(ma(2));
    expect(ra.body.projectVersion).toBe(1);
    expect(await boDem()).toBe(2);
    expect((await doc(a.id)).searchText, "tìm theo mã dự án phải ra").toContain(ma(2).toLowerCase().replace(/_/g, " "));
    const nk = await prisma.auditEvent.findFirst({ where: { action: "quote.convert", resourceId: String(a.id) }, orderBy: { id: "desc" } });
    expect(nk?.after).toMatchObject({ projectCode: ma(2), projectVersion: 1 });
    const tim = await chu.get(`/api/search?q=${encodeURIComponent(ma(2))}&types=quote`);
    expect(tim.status).toBe(200);
    expect(tim.body.results.quotes.map((x) => x.id)).toContain(a.id);
  }, 60_000);

  it("HAI báo giá chốt SONG SONG → hai mã liền nhau, không trùng, không lỗ", async () => {
    const truoc = await boDem();
    const [c, d] = [await taoBaoGia(chu, "song-c"), await taoBaoGia(chu, "song-d")];
    expect([c.projectCode, d.projectCode, await boDem()], "mã phải sinh lúc CHỐT, không phải lúc tạo").toEqual([null, null, truoc]);
    const kq = await Promise.all([chot(chu, c.id), chot(chu, d.id)]);
    for (const r of kq) expect(r.status, JSON.stringify(r.body)).toBe(200);
    const mas = kq.map((r) => r.body.projectCode).sort();
    expect(mas).toEqual([ma(truoc + 1), ma(truoc + 2)]);
    expect(await boDem()).toBe(truoc + 2);
  }, 60_000);

  it("chốt LỖI (phép chia hóa đơn sai) → không chốt, KHÔNG cấp mã, bộ đếm đứng yên", async () => {
    const q = await taoBaoGia(chu, "loi", 3);
    const sheets = await prisma.quoteSheet.findMany({ where: { quoteId: q.id }, orderBy: { order: "asc" } });
    const truoc = await boDem();
    // Thiếu một sheet trong phép chia → 409 từ BÊN TRONG transaction chốt (sau khi đã đổi trạng thái).
    const r = await chot(chu, q.id, { invoiceSplit: sheets.slice(0, 2).map((s) => ({ sheetId: s.id, group: 1, hold: null })) });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    const sau = await doc(q.id);
    expect(sau.status).not.toBe("converted");
    expect(sau.projectCode).toBeNull();
    expect(await boDem(), "chốt hỏng mà vẫn tiêu một số → lỗ trong dãy mã").toBe(truoc);
    // Chốt lại cho đúng → nhận ĐÚNG số kế tiếp (không bị nhảy).
    const ok = await chot(chu, q.id);
    expect(ok.body.projectCode).toBe(ma(truoc + 1));
  }, 60_000);

  it("BẢN MỚI của dự án đã chốt: nháp KHÔNG mã + nhớ gốc; chốt → LẤY LẠI mã gốc + phiên bản kế, không tiêu số mới", async () => {
    const goc = await taoBaoGia(chu, "goc");
    const rg = await chot(chu, goc.id);
    const maGoc = rg.body.projectCode;
    const truoc = await boDem();

    const v = await chu.post(`/api/quotes/${goc.id}/duplicate`).send({ sameProject: true });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(v.body.projectCode, "bản nháp phiên bản mới vẫn mang mã").toBeNull();
    expect((await doc(v.body.id)).projectRootId).toBe(goc.id);
    // "Bản mới" CỦA BẢN MỚI vẫn trỏ thẳng về gốc dự án.
    const v3 = await chu.post(`/api/quotes/${v.body.id}/duplicate`).send({ sameProject: true });
    expect((await doc(v3.body.id)).projectRootId).toBe(goc.id);

    const cv = await chot(chu, v.body.id);
    expect(cv.status, JSON.stringify(cv.body)).toBe(200);
    expect([cv.body.projectCode, cv.body.projectVersion]).toEqual([maGoc, 2]);
    const cv3 = await chot(chu, v3.body.id);
    expect([cv3.body.projectCode, cv3.body.projectVersion]).toEqual([maGoc, 3]);
    expect(await boDem(), "phiên bản mới tiêu số mã mới").toBe(truoc);

    // "Nhân bản" (không cùng dự án) → nháp không mã, không gốc; chốt → mã MỚI.
    const nb = await chu.post(`/api/quotes/${goc.id}/duplicate`).send({});
    expect(nb.body.projectCode).toBeNull();
    expect((await doc(nb.body.id)).projectRootId).toBeNull();
    expect((await chot(chu, nb.body.id)).body.projectCode).toBe(ma(truoc + 1));
  }, 60_000);

  it("người tạo KHÔNG có tiền tố: chốt xong vẫn không mã (hiện số BG); Bản mới của nó chốt → số BG gốc + v2 (như trước)", async () => {
    const q = await taoBaoGia(khongTienTo, "ktt");
    const r = await chot(khongTienTo, q.id);
    expect(r.status).toBe(200);
    expect(r.body.projectCode).toBeNull();
    const v = await khongTienTo.post(`/api/quotes/${q.id}/duplicate`).send({ sameProject: true });
    expect(v.body.projectCode).toBeNull();
    const cv = await chot(khongTienTo, v.body.id);
    expect([cv.body.projectCode, cv.body.projectVersion]).toEqual([q.quoteNumber, 2]);
  }, 60_000);

  it("Quản lý dự án / Hóa đơn đầu vào / tìm kiếm chịu được projectCode null — nháp hiện 'NHÁP <số BG>'", async () => {
    // Báo giá đã chốt KHÔNG mã (người tạo không có tiền tố) trên trang Quản lý dự án / Hóa đơn đầu ra.
    const q = await taoBaoGia(khongTienTo, "du-an-null");
    await chot(khongTienTo, q.id);
    const da = await admin.get("/api/quotes/projects");
    expect(da.status).toBe(200);
    expect(da.body.data.find((x) => x.id === q.id)).toMatchObject({ projectCode: null, quoteNumber: q.quoteNumber });

    // Nháp có bảng chi phí nội bộ → trang Hóa đơn đầu vào: mã hiện NHÁP <số BG>, không "null".
    // Admin tạo (có quyền duyệt nội bộ) để hàng chi phí ở trạng thái ĐÃ DUYỆT — trang chỉ liệt kê hàng đã duyệt.
    const n = await taoBaoGia(admin, "dau-vao", 1, { extraTables: [{ category: "hcm", name: "Chi phí", items: [{ kind: "item", name: "Thuê xe", quantity: 1, unitPrice: 500_000, approved: true }] }] });
    const dv = await admin.get("/api/quotes/input-invoices");
    expect(dv.status).toBe(200);
    const hang = dv.body.data.filter((x) => x.quoteId === n.id);
    expect(hang.length).toBeGreaterThan(0);
    for (const h of hang) {
      expect(h.quoteCode).toBe(`NHÁP ${n.quoteNumber}`);
      expect(String(h.sheetCode)).not.toMatch(/null|^_/);
    }

    const tim = await admin.get(`/api/search?q=${encodeURIComponent(n.quoteNumber)}&types=quote`);
    expect(tim.status).toBe(200);
    expect(tim.body.results.quotes.find((x) => x.id === n.id)).toMatchObject({ projectCode: null, status: "draft" });
  }, 60_000);
});
