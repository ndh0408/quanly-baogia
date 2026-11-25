// ============================================================================
// MẪU CINETOUR — đường LƯU thật qua máy chủ + CSDL (chủ repo 2026-11-25).
//
//   1. Migration 20261125090300_cinetour_templates chèn đúng bốn mẫu (tra công ty theo MÃ), chạy lại không nhân đôi,
//      và mẫu đầu theo tên của mỗi công ty — mẫu DỰ PHÒNG của bảng nội bộ thiếu templateId — KHÔNG đổi.
//   2. /api/meta/templates trả `layout.hasShifts` cho đúng bốn mẫu đó.
//   3. Lưu báo giá sheet CINETOUR (không ngày + có ngày): cột QuoteItem.shifts, Tổng / VAT / Thành Tiền lưu = lưới web.
//   4. Đổi sheet sang mẫu thường: máy chủ ép shifts = null, tổng thôi nhân Số Ca (lưới web đã hỏi trước khi đổi).
//   5. Phiên bản (QuoteVersion) chụp Số Ca; nhân bản báo giá giữ Số Ca và tiền; xuất Excel qua route ra cột SỐ CA.
// ĐỎ trên 7a6ce18: chưa có cột `shifts`, chưa có mẫu, tiền không nhân Số Ca.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";
import { dsMauBangNoiBo, bangNoiBoCoNgay, bangNoiBoCoCa } from "../src/quoteUtils.js";
import { sheetTotals, quoteTotals } from "../shared/quote-math.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `cine${Date.now()}`;
const PWD = "Test1234!a";
const MA_CINE = ["gn_cinetour", "gn_cinetour_conngay", "clofull_cinetour", "clofull_cinetour_conngay"];
const SQL = readFileSync(new URL("../prisma/migrations/20261125090300_cinetour_templates/migration.sql", import.meta.url), "utf8");

describe.runIf(dbAvailable)("CINETOUR — lưu báo giá qua máy chủ", () => {
  let app, admin;
  const taoCty = [], taoMau = [];
  let gn, clf, mau = {};

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    // Công ty theo MÃ như production; chỉ tạo (và dọn) khi CSDL test chưa có.
    for (const [code, name, prefix] of [["gia_nguyen", "Công ty Gia Nguyễn", "GN"], ["clofull", "Công ty TNHH Colorfull", "CLF"]]) {
      let c = await prisma.company.findFirst({ where: { code } });
      if (!c) { c = await prisma.company.create({ data: { code, name, quotePrefix: prefix, address: "34 Đào Trí" } }); taoCty.push(c.id); }
      if (code === "gia_nguyen") gn = c; else clf = c;
    }
    // Mẫu thường của mỗi công ty (để kiểm thứ tự + đổi mẫu) — có rồi thì dùng, chưa thì tạo như seed.
    for (const [code, name, cty] of [
      ["marico_decor", "GN (không ngày)", gn], ["unibenfood", "GN (có ngày)", gn], ["gn_banner", "GN Banner (không ngày)", gn],
      ["clofull_decor", "CLF (không ngày)", clf], ["clofull_conngay", "CLF (có ngày)", clf], ["clofull_banner", "CLF Banner (không ngày)", clf],
    ]) {
      let t = await prisma.quoteTemplate.findUnique({ where: { code } });
      if (!t) { t = await prisma.quoteTemplate.create({ data: { code, name, companyId: cty.id, filePath: "templates/GN_KhongNgay.xlsx" } }); taoMau.push(t.id); }
      mau[code] = t;
    }
    await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: `${TAG}-admin`, password: PWD })).status).toBe(200);
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    const conMoi = await prisma.quoteTemplate.findMany({ where: { code: { in: MA_CINE }, companyId: { in: taoCty } }, select: { id: true } });
    await prisma.quoteTemplate.deleteMany({ where: { id: { in: [...taoMau, ...conMoi.map((x) => x.id)] } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { id: { in: taoCty } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("migration chèn đúng bốn mẫu theo MÃ công ty; chạy lại không nhân đôi", async () => {
    await prisma.$executeRawUnsafe(SQL);
    await prisma.$executeRawUnsafe(SQL);
    const ds = await prisma.quoteTemplate.findMany({ where: { code: { in: MA_CINE } }, include: { company: { select: { code: true } } } });
    expect(ds.map((t) => t.code).sort()).toEqual([...MA_CINE].sort());
    const theoMa = Object.fromEntries(ds.map((t) => [t.code, t]));
    expect(theoMa.gn_cinetour.company.code).toBe("gia_nguyen");
    expect(theoMa.gn_cinetour_conngay.company.code).toBe("gia_nguyen");
    expect(theoMa.clofull_cinetour.company.code).toBe("clofull");
    expect(theoMa.clofull_cinetour_conngay.company.code).toBe("clofull");
    expect(theoMa.gn_cinetour.name).toBe("GN CINETOUR (không ngày)");
    expect(theoMa.clofull_cinetour_conngay.name).toBe("CLF CINETOUR (có ngày)");
    for (const t of ds) mau[t.code] = t;
  });

  it("mẫu đầu theo tên của mỗi công ty (dự phòng bảng nội bộ thiếu templateId) KHÔNG phải mẫu CINETOUR", async () => {
    const ds = await dsMauBangNoiBo();   // ORDER BY name theo collation THẬT của CSDL
    for (const cty of [gn, clf]) {
      const dau = ds.find((m) => m.companyId === cty.id);
      expect(MA_CINE.map((c) => mau[c]?.id)).not.toContain(dau.id);
      expect(bangNoiBoCoCa({}, cty.id, ds), "bảng cũ thiếu templateId bỗng nhân Số Ca").toBe(false);
    }
    // Tiền của bảng cũ thiếu mẫu: luật Số Ngày vẫn theo mẫu dự phòng y như trước khi có CINETOUR.
    const dauGn = ds.find((m) => m.companyId === gn.id);
    expect(bangNoiBoCoNgay({}, gn.id, ds)).toBe(dauGn.hasDays);
  });

  it("/api/meta/templates: hasShifts đúng bốn mẫu CINETOUR", async () => {
    const r = await admin.get(`/api/meta/templates?companyId=${gn.id}`);
    expect(r.status).toBe(200);
    const theoMa = Object.fromEntries(r.body.map((t) => [t.code, t.layout]));
    expect(theoMa.gn_cinetour).toMatchObject({ hasShifts: true, hasDays: false });
    expect(theoMa.gn_cinetour_conngay).toMatchObject({ hasShifts: true, hasDays: true });
    expect(theoMa.marico_decor.hasShifts).toBe(false);
    expect(theoMa.unibenfood.hasShifts).toBe(false);
  });

  const cacHang = (coNgay) => [
    { kind: "item", name: "Bảo vệ", unit: "người", quantity: 2, unitPrice: 150_000, shifts: 3, days: coNgay ? 2 : null, order: 1 },
    { kind: "item", name: "Lễ tân", unit: "người", quantity: 1.5, unitPrice: 333_333, shifts: null, days: null, order: 2 },
    { kind: "section", name: "Kỹ thuật", quantity: 2, unitPrice: 0, order: 3 },
    { kind: "item", name: "Ánh sáng", unit: "bộ", quantity: 3, unitPrice: 15, shifts: 0.5, days: coNgay ? 1 : null, formulas: { shifts: "=1/2" }, order: 4 },
  ];
  let quoteId, payloadSheets;

  it("lưu sheet GN CINETOUR không ngày + có ngày: shifts vào CSDL; Tổng/VAT/Thành Tiền = lưới web", async () => {
    payloadSheets = [
      { name: "Rạp KN", order: 1, templateId: mau.gn_cinetour.id, groupSubtotal: true, discount: 0, items: cacHang(false) },
      { name: "Rạp CN", order: 2, templateId: mau.gn_cinetour_conngay.id, groupSubtotal: false, discount: 100_000, items: cacHang(true) },
    ];
    const r = await admin.post("/api/quotes").send({ title: `${TAG} cine`, companyId: gn.id, toCompany: "CGV", vatPercent: 8, sheets: payloadSheets });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    quoteId = r.body.id;
    const web = quoteTotals([sheetTotals(payloadSheets[0], false, true), sheetTotals(payloadSheets[1], true, true)], 8);
    expect([r.body.subtotal, r.body.vat, r.body.total]).toEqual([web.subtotal, web.vat, web.total]);
    const q = await prisma.quote.findUnique({ where: { id: quoteId }, include: { sheets: { orderBy: { order: "asc" }, include: { items: { orderBy: { order: "asc" } } } } } });
    expect(Number(q.subtotal)).toBe(web.subtotal);
    expect(Number(q.total)).toBe(web.total);
    expect(q.sheets.map((s) => Number(s.subtotal))).toEqual([sheetTotals(payloadSheets[0], false, true).net, sheetTotals(payloadSheets[1], true, true).net]);
    expect(q.sheets[0].items.map((i) => (i.shifts == null ? null : Number(i.shifts)))).toEqual([3, null, null, 0.5]);
    expect(q.sheets[0].items[3].formulas).toEqual({ shifts: "=1/2" });
    // Đọc lại (presentQuote) trả số, không phải Decimal.
    const g = await admin.get(`/api/quotes/${quoteId}`);
    expect(g.body.sheets[1].items[0].shifts).toBe(3);
    expect(g.body.total).toBe(web.total);
  });

  it("phiên bản chụp Số Ca; nhân bản giữ Số Ca và tiền", async () => {
    const v = await admin.get(`/api/quotes/${quoteId}/versions`);
    expect(v.status).toBe(200);
    const so = (v.body.data || v.body)[0].versionNo;
    const ban = await admin.get(`/api/quotes/${quoteId}/versions/${so}`);
    expect(ban.body.payload.sheets[0].items[0].shifts, "ảnh chụp phiên bản mất Số Ca").toBe("3");
    expect("shifts" in ban.body.payload.sheets[0].items[1], "hàng không có số ca: ảnh chụp y như trước").toBe(false);
    const d = await admin.post(`/api/quotes/${quoteId}/duplicate`).send({});
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const goc = await admin.get(`/api/quotes/${quoteId}`);
    expect(d.body.total).toBe(goc.body.total);
    expect(d.body.sheets[0].items.map((i) => i.shifts)).toEqual([3, null, null, 0.5]);
    await prisma.quote.update({ where: { id: d.body.id }, data: { title: `${TAG} ban sao` } });
  });

  it("xuất Excel qua route: sheet CINETOUR có cột SỐ CA, Thành Tiền nhân Số Ca", async () => {
    const r = await admin.get(`/api/export/${quoteId}.xlsx`).buffer(true).parse((res, cb) => { const ds = []; res.on("data", (c) => ds.push(c)); res.on("end", () => cb(null, Buffer.concat(ds))); });
    expect(r.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    const ws = wb.worksheets[0];
    expect(String(ws.getCell("F11").value).trim()).toBe("SỐ CA");
    let bv = null;
    ws.eachRow((row, i) => { if (String(row.getCell("C").value ?? "").trim() === "Bảo vệ") bv = i; });
    expect(ws.getCell(`F${bv}`).value).toBe(3);
    expect(ws.getCell(`H${bv}`).result ?? ws.getCell(`H${bv}`).value?.result).toBe(900_000);
  });

  it("đổi sheet sang mẫu THƯỜNG: máy chủ ép shifts = null, tổng thôi nhân Số Ca", async () => {
    const g = await admin.get(`/api/quotes/${quoteId}`);
    const sheets = g.body.sheets.map((s, i) => ({ id: s.id, name: s.name, order: i + 1, templateId: i === 0 ? mau.marico_decor.id : s.templateId,
      groupSubtotal: s.groupSubtotal, discount: s.discount, items: s.items.map(({ id: _i, sheetId: _s, ...it }) => it) }));
    const r = await admin.put(`/api/quotes/${quoteId}`).send({ ...g.body, sheets, baseUpdatedAt: g.body.updatedAt });
    expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200);
    const q = await prisma.quote.findUnique({ where: { id: quoteId }, include: { sheets: { orderBy: { order: "asc" }, include: { items: { orderBy: { order: "asc" } } } } } });
    expect(q.sheets[0].items.map((i) => i.shifts)).toEqual([null, null, null, null]);
    expect(q.sheets[1].items[0].shifts && Number(q.sheets[1].items[0].shifts), "sheet CINETOUR còn lại giữ Số Ca").toBe(3);
    const web = quoteTotals([sheetTotals(sheets[0], false, false), sheetTotals(sheets[1], true, true)], 8);
    expect(Number(q.total)).toBe(web.total);
    expect(r.body.total).toBe(web.total);
  });

  it("PUT thẳng (không qua màn soạn) Số Ca cho sheet mẫu thường: không thổi được tổng", async () => {
    const g = await admin.get(`/api/quotes/${quoteId}`);
    const truoc = g.body.total;
    const sheets = g.body.sheets.map((s, i) => ({ id: s.id, name: s.name, order: i + 1, templateId: s.templateId, groupSubtotal: s.groupSubtotal, discount: s.discount,
      items: s.items.map(({ id: _i, sheetId: _s, ...it }) => (i === 0 && it.kind === "item" ? { ...it, shifts: 30 } : it)) }));
    const r = await admin.put(`/api/quotes/${quoteId}`).send({ ...g.body, sheets, baseUpdatedAt: g.body.updatedAt });
    expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200);
    expect(r.body.total).toBe(truoc);
  });
});
