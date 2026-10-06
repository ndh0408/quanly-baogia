// ĐỒNG THỜI giữa ĐƯỜNG LƯU báo giá và KẾ TOÁN ghi khoản chi (trang Hóa đơn đầu vào, chủ repo 2026-10-06) — ma trận
// H1–H5 của thiết kế, chạy thật trên Postgres thay cho "ngữ nghĩa FOR SHARE / FOR UPDATE là chuẩn" (giả định chưa đo).
//
// ── HAI ĐƯỜNG GHI, MỘT THỨ TỰ KHOÁ (KT-5) ───────────────────────────────────────────────────────────────
//   Đường Lưu (updateQuote / ghiVungNoiBoDuocGiao / saveHn): QuoteSheet FOR UPDATE (nếu có) → Quote FOR UPDATE →
//     RỒI MỚI đọc khoản (chỉ ĐỌC — KT-1). Chốt "hàng đã chi không được biến mất" (KT-4) đọc bản TƯƠI sau khoá.
//   Kế toán (ghiKhoanChi): Quote FOR SHARE → đọc hàng → khoản FOR UPDATE. KHÔNG BAO GIỜ xin khoá QuoteSheet, không
//     ghi Quote (KT-8: không bump `updatedAt` — người đang soạn không ăn 409 vì một ô kế toán).
// Hai chiều không bao giờ ngược nhau nên không có vòng khoá (deadlock).
//
// ── CÁCH TÁI HIỆN TẤT ĐỊNH ──────────────────────────────────────────────────────────────────────────────
// Một transaction Postgres RIÊNG (pg.Client, ngoài Prisma) giữ khoá hàng — đóng vai "người kia đang ghi". Không đoán
// giờ bằng `sleep`: một kết nối GIÁM SÁT hỏi `pg_blocking_pids()` cho tới khi thấy đúng số request đang xếp hàng sau
// khoá đó, rồi mới làm bước kế. Kết nối giám sát chạy NGOÀI transaction (mỗi câu một ảnh chụp mới của bảng khoá).
// Mọi pg.Client đóng trong `finally` — bài đỏ giữa chừng cũng không để khoá treo cho bài sau.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import pg from "pg";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hddvdt${Date.now()}`;
const PWD = "Test1234!a";
const ANH = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const nghi = (ms) => new Promise((r) => setTimeout(r, ms));
/** supertest gửi request LƯỜI (chỉ khi .then được gọi) — bài test đua phải BẮN NGAY rồi mới chờ. */
const banNgay = (t) => t.then((r) => r);
/** Chờ `p` nhưng có trần: request bị một khoá KHÔNG được phép chặn nó thì bài đỏ rõ lý do, không treo tới hết giờ. */
const trongHan = (p, ms, loi) => {
  let hen;
  const het = new Promise((_, reject) => { hen = setTimeout(() => reject(new Error(loi)), ms); });
  return Promise.race([p, het]).finally(() => clearTimeout(hen));
};

/** Mở một transaction Postgres RIÊNG để giữ khoá hàng — đóng vai "người kia". */
async function moKhoa() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("BEGIN");
  return client;
}
async function dongKhoa(client) {
  await client.query("ROLLBACK").catch(() => {});
  await client.end().catch(() => {});
}

describe.runIf(dbAvailable)("Lưu báo giá và kế toán ghi khoản chi song song — không mất khoản, không 409 oan, không deadlock", () => {
  let app, companyId, templateId, giamSat;
  let adminU, ketoanU, ketoan2U, hnU;
  let admin, ketoan, ketoan2, hn;

  /**
   * Chờ tới khi có ≥ `n` tiến trình CSDL bị khoá của `kia` chặn — trực tiếp, hoặc gián tiếp qua một tiến trình đang bị
   * `kia` chặn (H5: account HN chờ Quote FOR UPDATE sau lượt FOR SHARE của kế toán, mà kế toán thì đang chờ `kia`).
   */
  const choBiChan = async (kia, n, tran = 10_000) => {
    const het = Date.now() + tran;
    for (;;) {
      const { rows } = await giamSat.query(
        `WITH cho AS (SELECT DISTINCT pid FROM pg_locks WHERE NOT granted AND pid IS NOT NULL),
              truc_tiep AS (SELECT pid FROM cho WHERE $1::int = ANY (pg_blocking_pids(pid)))
         SELECT (SELECT count(*) FROM truc_tiep)::int
              + (SELECT count(*) FROM cho c
                  WHERE c.pid NOT IN (SELECT pid FROM truc_tiep)
                    AND pg_blocking_pids(c.pid) && ARRAY(SELECT pid FROM truc_tiep))::int AS n`,
        [kia.processID],
      );
      if (rows[0].n >= n) return;
      if (Date.now() > het) throw new Error(`Hết ${tran}ms mà mới thấy ${rows[0].n}/${n} request xếp hàng sau khoá`);
      await nghi(25);
    }
  };

  const taoNguoi = (ten, role) => bcrypt.hash(PWD, 4).then((passwordHash) => prisma.user.create({
    data: { username: `${TAG}-${ten}`, displayName: `${TAG} ${ten}`, role, passwordHash },
  }));
  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const hang = (rid, name, over = {}) => ({
    kind: "item", rid, name, quantity: 1, unitPrice: 1000,
    approved: true, approvedAt: "2026-09-20T03:00:00.000Z", approvedBy: adminU.id,
    paid: false, paidAt: null, paidById: null, paidProof: null, ...over,
  });
  const bang = (items) => ({ category: "hcm", name: "Chi phí HCM", templateId: null, groupSubtotal: false, items });
  const bangHn = (items) => ({ name: "Giá HN", templateId: null, groupSubtotal: false, items });
  const taoBaoGia = (ten, { trang = [[]], hnTables, hnStatus = null } = {}) => prisma.quote.create({ data: {
    quoteNumber: `${TAG}-${ten}`, projectCode: `${TAG}_${ten}`, title: `${TAG} ${ten}`, searchText: TAG, toCompany: "Khách thử", companyId,
    fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: adminU.id, status: "draft",
    hnStatus, ...(hnTables ? { hnTables } : {}),
    sheets: { create: trang.map((extraTables, i) => ({
      templateId, order: i + 1, name: `Trang ${i + 1}`, codeNo: i + 1, extraTables,
      items: { create: [{ order: 1, kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10000 }] },
    })) },
  } });
  const tai = (id) => prisma.quote.findFirst({
    where: { id }, include: { sheets: { orderBy: [{ order: "asc" }, { id: "asc" }], include: { items: { orderBy: { order: "asc" } } } } },
  });
  /** Thân PUT /:id như màn soạn gửi. `moc: false` = client không gửi mốc khoá lạc quan. */
  const thanLuu = (q, { moc = true } = {}) => ({
    ...(moc ? { baseUpdatedAt: q.updatedAt.toISOString() } : {}),
    sheets: q.sheets.map((s) => ({
      id: s.id, templateId: s.templateId, name: s.name, order: s.order,
      items: s.items.map((it) => ({ kind: it.kind, name: it.name, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice), order: it.order })),
      extraTables: structuredClone(Array.isArray(s.extraTables) ? s.extraTables : []),
    })),
  });
  const hangSheet = (q) => q.sheets.flatMap((s) => (Array.isArray(s.extraTables) ? s.extraTables : [])).flatMap((t) => t.items || []);
  const tich = (agent, qid, side, rid, body) => agent.put(`/api/quotes/input-invoices/${qid}/${side}/${encodeURIComponent(rid)}`).send(body);
  const khoan = (qid, side, rid) => prisma.inputInvoiceEntry.findUnique({ where: { quoteId_side_rid: { quoteId: qid, side, rid } } });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    giamSat = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await giamSat.connect();
    adminU = await taoNguoi("admin", "admin");
    ketoanU = await taoNguoi("ketoan", "accountant");
    ketoan2U = await taoNguoi("ketoan2", "accountant");
    hnU = await taoNguoi("hn", "account_hn");
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `D${`${Date.now()}`.slice(-6)}` } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    admin = await dangNhap(adminU);
    ketoan = await dangNhap(ketoanU);
    ketoan2 = await dangNhap(ketoan2U);
    hn = await dangNhap(hnU);
  });

  afterAll(async () => {
    await giamSat?.end().catch(() => {});
    const ids = (await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, select: { id: true }, includeDeleted: true }).catch(() => [])).map((q) => q.id);
    // Khoản kế toán RESTRICT báo giá: dọn ảnh → khoản TRƯỚC khi xoá cứng báo giá.
    await prisma.inputInvoiceProof?.deleteMany({ where: { entry: { quoteId: { in: ids } } } }).catch(() => {});
    await prisma.inputInvoiceEntry?.deleteMany({ where: { quoteId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: ids } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    const uids = [adminU, ketoanU, ketoan2U, hnU].filter(Boolean).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: uids } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  // ── H1 ──────────────────────────────────────────────────────────────────────────────────────────────
  it("H1 màn soạn mở TRƯỚC lần tích, Lưu SAU lần tích → 200 không 409, khoản nguyên vẹn; bỏ đúng hàng đã chi → 400 chứ không 409", async () => {
    const q0 = await taoBaoGia("h1", { trang: [[bang([hang("r1", "Thuê xe"), hang("r2", "Nước uống")])]] });
    const q = await tai(q0.id);   // màn soạn nạp ở đây — mốc T0
    expect((await tich(ketoan, q.id, "sheet", "r1", { baseVersion: 0, paid: true, paidProof: ANH })).status).toBe(200);
    const e0 = await khoan(q.id, "sheet", "r1");
    // (1) Người soạn không thấy hàng nào đã chi (màn soạn không còn cột thanh toán) và xoá đúng r1. Mốc T0 vẫn khớp vì
    //     lần tích không bump → lỗi phải là 400 nêu tên hàng (toast, giữ phần đang soạn), không phải 409 "tải lại".
    const boR1 = thanLuu(q);
    boR1.sheets[0].extraTables[0].items = boR1.sheets[0].extraTables[0].items.filter((it) => it.rid !== "r1");
    const r = await admin.put(`/api/quotes/${q.id}`).send(boR1);
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe("hang-da-chi");
    expect(r.body.error).toContain("Thuê xe");
    // (2) Cùng màn soạn đó (vẫn mốc T0) sửa hàng khác rồi Lưu → 200.
    const sua = thanLuu(q);
    sua.sheets[0].extraTables[0].items[1].unitPrice = 2500;
    const ok = await admin.put(`/api/quotes/${q.id}`).send(sua);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await khoan(q.id, "sheet", "r1")).toEqual(e0);
    const sau = hangSheet(await tai(q.id));
    expect(sau.find((it) => it.rid === "r2").unitPrice).toBe(2500);
    expect(sau.find((it) => it.rid === "r1"), "hàng đã chi còn nguyên trong báo giá").toBeTruthy();
  }, 30_000);

  // ── H2 ──────────────────────────────────────────────────────────────────────────────────────────────
  it("H2 Lưu đã đứng ở khoá QuoteSheet (chưa tới Quote): kế toán tích + commit KHÔNG bị chặn; lần Lưu bỏ đúng hàng đó thấy khoản → 400", async () => {
    const q0 = await taoBaoGia("h2", { trang: [[bang([hang("r1", "Thuê nhà bạt"), hang("r2", "Bảo vệ")])]] });
    const q = await tai(q0.id);
    const than = thanLuu(q);
    than.sheets[0].extraTables[0].items = than.sheets[0].extraTables[0].items.filter((it) => it.rid !== "r1");
    const kia = await moKhoa();
    let luu;
    let luuXong = false;
    try {
      await kia.query('SELECT id FROM "QuoteSheet" WHERE "quoteId" = $1 ORDER BY id FOR UPDATE', [q.id]);
      luu = banNgay(admin.put(`/api/quotes/${q.id}`).send(than));
      luu.then(() => { luuXong = true; }, () => { luuXong = true; });
      // Lần Lưu đã làm xong mọi việc NGOÀI transaction (đọc `existing`, tính tổng) và đang xếp hàng ở khoá QuoteSheet.
      await choBiChan(kia, 1);
      const t = await trongHan(tich(ketoan, q.id, "sheet", "r1", { baseVersion: 0, paid: true }), 8_000,
        "kế toán bị khoá QuoteSheet của đường Lưu chặn — KT-5 nói kế toán không bao giờ xin khoá đó");
      expect(t.status, JSON.stringify(t.body)).toBe(200);
      expect(luuXong, "lần Lưu vẫn đang chờ — tức nó BẮT ĐẦU trước khi khoản được commit").toBe(false);
    } finally {
      await dongKhoa(kia);
    }
    const r = await luu;
    expect(r.status, `đường Lưu phải đọc khoản SAU khi khoá Quote: ${JSON.stringify(r.body)}`).toBe(400);
    expect(r.body.code).toBe("hang-da-chi");
    expect(r.body.error).toContain("Thuê nhà bạt");
    expect(hangSheet(await tai(q.id)).map((it) => it.rid)).toEqual(["r1", "r2"]);
    expect(await khoan(q.id, "sheet", "r1")).toMatchObject({ paid: true, version: 1 });
  }, 30_000);

  // ── H3 ──────────────────────────────────────────────────────────────────────────────────────────────
  it("H3 Lưu đã giữ Quote FOR UPDATE và XOÁ hàng: kế toán chờ ở FOR SHARE; Lưu commit → kế toán đọc bản tươi → 404, không tạo khoản", async () => {
    const q0 = await taoBaoGia("h3", { trang: [[bang([hang("r1", "Thuê sàn"), hang("r2", "Thảm")])]] });
    const id = q0.id;
    const kia = await moKhoa();
    let t;
    let tXong = false;
    try {
      // Đóng vai đường Lưu đúng thứ tự KT-5: QuoteSheet → Quote FOR UPDATE, rồi ghi bảng đã bỏ r1 — CHƯA commit.
      await kia.query('SELECT id FROM "QuoteSheet" WHERE "quoteId" = $1 ORDER BY id FOR UPDATE', [id]);
      await kia.query('SELECT id FROM "Quote" WHERE id = $1 FOR UPDATE', [id]);
      await kia.query('UPDATE "QuoteSheet" SET "extraTables" = $2::jsonb WHERE "quoteId" = $1', [id, JSON.stringify([bang([hang("r2", "Thảm")])])]);
      t = banNgay(tich(ketoan, id, "sheet", "r1", { baseVersion: 0, paid: true }));
      t.then(() => { tXong = true; }, () => { tXong = true; });
      await choBiChan(kia, 1);
      expect(tXong, "kế toán phải CHỜ ở Quote FOR SHARE, không đọc hàng khi lần Lưu chưa xong").toBe(false);
      await kia.query("COMMIT");
    } finally {
      await dongKhoa(kia);
    }
    const r = await t;
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect(r.body.code).toBe("khong-thay-hang");
    expect(await khoan(id, "sheet", "r1"), "không mở khoản cho hàng vừa bị xoá").toBeNull();
  }, 30_000);

  // ── H4 ──────────────────────────────────────────────────────────────────────────────────────────────
  it("H4 hai kế toán cùng MỘT khoản chưa có (cùng baseVersion 0, bắn cùng lúc) → một 200 + một 409 'khoan-chi-da-doi'; hai khoản KHÁC nhau → 200 + 200", async () => {
    const q0 = await taoBaoGia("h4", { trang: [[bang([hang("r1", "Thuê xe"), hang("r2", "In ấn"), hang("r3", "Ăn trưa")])]] });
    const [a, b] = await Promise.all([
      tich(ketoan, q0.id, "sheet", "r1", { baseVersion: 0, accountingNote: "Kế toán A" }),
      tich(ketoan2, q0.id, "sheet", "r1", { baseVersion: 0, accountingNote: "Kế toán B" }),
    ]);
    expect([a.status, b.status].sort(), `${JSON.stringify(a.body)} | ${JSON.stringify(b.body)}`).toEqual([200, 409]);
    const thang = a.status === 200 ? a : b;
    const thua = a.status === 200 ? b : a;
    expect(thua.body.code).toBe("khoan-chi-da-doi");
    const e = await khoan(q0.id, "sheet", "r1");
    expect(e.version, "đúng MỘT lần ghi được áp — không ghi đè im lặng").toBe(1);
    expect(e.accountingNote).toBe(thang.body.row.accountingNote);
    expect(await prisma.inputInvoiceEntry.count({ where: { quoteId: q0.id, side: "sheet", rid: "r1" } })).toBe(1);

    const [c, d] = await Promise.all([
      tich(ketoan, q0.id, "sheet", "r2", { baseVersion: 0, paid: true }),
      tich(ketoan2, q0.id, "sheet", "r3", { baseVersion: 0, paid: true }),
    ]);
    expect([c.status, d.status], `${JSON.stringify(c.body)} | ${JSON.stringify(d.body)}`).toEqual([200, 200]);
    expect(await khoan(q0.id, "sheet", "r2")).toMatchObject({ paid: true, version: 1 });
    expect(await khoan(q0.id, "sheet", "r3")).toMatchObject({ paid: true, version: 1 });
  }, 30_000);

  it("H4 (xếp hàng có kiểm soát) khoản đang bị giữ FOR UPDATE: hai kế toán cùng chờ; nhả khoá → người đầu 200, người sau đọc version mới → 409", async () => {
    const q0 = await taoBaoGia("h4b", { trang: [[bang([hang("r1", "Thuê xe")])]] });
    expect((await tich(ketoan, q0.id, "sheet", "r1", { baseVersion: 0, paid: true })).status).toBe(200);
    const e = await khoan(q0.id, "sheet", "r1");
    const kia = await moKhoa();
    let a;
    let b;
    try {
      await kia.query('SELECT id FROM "InputInvoiceEntry" WHERE id = $1 FOR UPDATE', [e.id]);
      a = banNgay(tich(ketoan, q0.id, "sheet", "r1", { baseVersion: e.version, accountingNote: "A" }));
      b = banNgay(tich(ketoan2, q0.id, "sheet", "r1", { baseVersion: e.version, accountingNote: "B" }));
      await choBiChan(kia, 2);   // cả hai đã giữ Quote FOR SHARE (tương thích nhau) và đứng ở khoá của RIÊNG khoản này
    } finally {
      await dongKhoa(kia);
    }
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status].sort(), `${JSON.stringify(ra.body)} | ${JSON.stringify(rb.body)}`).toEqual([200, 409]);
    expect((ra.status === 409 ? ra : rb).body.code).toBe("khoan-chi-da-doi");
    expect(await khoan(q0.id, "sheet", "r1")).toMatchObject({ paid: true, version: e.version + 1 });
  }, 30_000);

  // ── H5 ──────────────────────────────────────────────────────────────────────────────────────────────
  it("H5 account HN Lưu (KHÔNG baseUpdatedAt / baseHnRev) chen với kế toán TÍCH khoản HN → cả hai 200, khoản nguyên vẹn, không deadlock", async () => {
    // Phần HN đã duyệt → kế toán tích h1 → quản lý GIAO LẠI phần HN (không bị chặn) → account HN sửa bảng lần nữa, trong
    // lúc kế toán tích lại h1 ("xác nhận số tiền hiện tại" — hợp lệ với khoản ĐÃ chi kể cả khi phần HN không còn duyệt).
    // Duyệt từng hàng (2026-10-06): h1 đã duyệt (dữ liệu cũ — theo cả phần), h2 đã được bỏ duyệt nên account HN sửa được.
    const q0 = await taoBaoGia("h5", { hnStatus: "approved", hnTables: [bangHn([hang("h1", "Xe HN"), hang("h2", "Khách sạn HN", { trangThaiDuyet: "dang-lam" })])] });
    expect((await tich(ketoan, q0.id, "hn", "h1", { baseVersion: 0, paid: true, paidProof: ANH })).status).toBe(200);
    expect((await admin.post(`/api/quotes/${q0.id}/hn/assign`).send({ accountId: hnU.id })).status).toBe(200);
    const e0 = await khoan(q0.id, "hn", "h1");
    const thanHn = (tenH2) => ({ hnTables: [bangHn([hang("h1", "Xe HN"), hang("h2", tenH2)])] });

    // (a) Có kiểm soát: kế toán đứng ở khoá khoản (đang giữ Quote FOR SHARE); account HN xin Quote FOR UPDATE → xếp
    //     sau kế toán. Nhả khoá → kế toán xong trước, account HN đọc khoản TƯƠI rồi ghi. Không ai chờ ngược ai.
    const kia = await moKhoa();
    let ghiChu;
    let luuHn;
    try {
      await kia.query('SELECT id FROM "InputInvoiceEntry" WHERE id = $1 FOR UPDATE', [e0.id]);
      ghiChu = banNgay(tich(ketoan, q0.id, "hn", "h1", { baseVersion: e0.version, paid: true, accountingNote: "Đã nhận HĐ" }));
      await choBiChan(kia, 1);
      luuHn = banNgay(hn.put(`/api/quotes/${q0.id}/hn`).send(thanHn("Khách sạn HN (sửa)")));
      await choBiChan(kia, 2);
    } finally {
      await dongKhoa(kia);
    }
    const [rg, rl] = await trongHan(Promise.all([ghiChu, luuHn]), 15_000, "treo — nghi deadlock giữa đường Lưu HN và kế toán");
    expect(rg.status, JSON.stringify(rg.body)).toBe(200);
    expect(rl.status, JSON.stringify(rl.body)).toBe(200);
    let e = await khoan(q0.id, "hn", "h1");
    // Tích lại khoản đã chi giữ NGUYÊN ngày chi + ảnh hiện tại (chỉ chụp lại số tiền).
    expect(e).toMatchObject({ paid: true, accountingNote: "Đã nhận HĐ", version: e0.version + 1, currentProofId: e0.currentProofId, paidAt: e0.paidAt });
    let qSau = await prisma.quote.findFirst({ where: { id: q0.id }, select: { hnTables: true } });
    expect(qSau.hnTables[0].items.map((it) => [it.rid, it.name])).toEqual([["h1", "Xe HN"], ["h2", "Khách sạn HN (sửa)"]]);

    // (b) Thả tự do: bắn cùng lúc vài lượt — thứ tự nào thì kết quả cũng phải như nhau.
    for (let i = 1; i <= 3; i++) {
      const [g, l] = await trongHan(Promise.all([
        tich(ketoan, q0.id, "hn", "h1", { baseVersion: e.version, paid: true, accountingNote: `Lượt ${i}` }),
        hn.put(`/api/quotes/${q0.id}/hn`).send(thanHn(`Khách sạn HN v${i}`)),
      ]), 15_000, `treo ở lượt ${i} — nghi deadlock`);
      expect([g.status, l.status], `${JSON.stringify(g.body)} | ${JSON.stringify(l.body)}`).toEqual([200, 200]);
      e = await khoan(q0.id, "hn", "h1");
      expect(e).toMatchObject({ paid: true, accountingNote: `Lượt ${i}`, currentProofId: e0.currentProofId, paidAt: e0.paidAt });
    }
    qSau = await prisma.quote.findFirst({ where: { id: q0.id }, select: { hnTables: true } });
    expect(qSau.hnTables[0].items.map((it) => it.rid)).toEqual(["h1", "h2"]);
    expect(qSau.hnTables[0].items[0].paid, "JSON hàng HN không mang cờ — trạng thái nằm ở khoản (KT-1)").toBe(false);
  }, 60_000);

  it("H5 chủ báo giá Lưu bảng HN (KHÔNG baseUpdatedAt) đang đứng ở khoá QuoteSheet — kế toán tích HN không bị chặn; Lưu giữ hàng → 200, khoản nguyên vẹn", async () => {
    // h2 chưa duyệt (trạng thái riêng) — hàng đã duyệt bị khoá với mọi người từ 2026-10-06, bài này đo khoá / khoản.
    const q0 = await taoBaoGia("h5b", { hnStatus: "approved", hnTables: [bangHn([hang("h1", "Xe HN"), hang("h2", "Vé máy bay", { trangThaiDuyet: "dang-lam" })])] });
    const q = await tai(q0.id);
    const than = { ...thanLuu(q, { moc: false }), hnTables: [bangHn([hang("h1", "Xe HN"), hang("h2", "Vé máy bay khứ hồi")])] };
    const kia = await moKhoa();
    let luu;
    try {
      await kia.query('SELECT id FROM "QuoteSheet" WHERE "quoteId" = $1 ORDER BY id FOR UPDATE', [q.id]);
      luu = banNgay(admin.put(`/api/quotes/${q.id}`).send(than));
      await choBiChan(kia, 1);
      const t = await trongHan(tich(ketoan, q.id, "hn", "h1", { baseVersion: 0, paid: true, paidProof: ANH }), 8_000,
        "kế toán bị khoá QuoteSheet của đường Lưu chặn");
      expect(t.status, JSON.stringify(t.body)).toBe(200);
    } finally {
      await dongKhoa(kia);
    }
    const r = await trongHan(luu, 15_000, "lần Lưu treo sau khi nhả khoá — nghi deadlock");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const e = await khoan(q.id, "hn", "h1");
    expect(e).toMatchObject({ paid: true, version: 1 });
    expect(e.currentProofId).not.toBeNull();
    const qSau = await prisma.quote.findFirst({ where: { id: q.id }, select: { hnTables: true } });
    expect(qSau.hnTables[0].items.map((it) => [it.rid, it.name])).toEqual([["h1", "Xe HN"], ["h2", "Vé máy bay khứ hồi"]]);
    // Phản hồi của lần Lưu đọc khoản SAU commit (lớp phủ) — màn soạn thấy ngay hàng vừa được tích.
    expect(r.body.hnTables[0].items[0]).toMatchObject({ rid: "h1", paid: true, hasPaidProof: true });
  }, 30_000);
});
