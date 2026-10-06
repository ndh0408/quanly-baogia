// RID TRÙNG / THIẾU / CÓ KHOẢNG TRẮNG trong dữ liệu CŨ không được làm mất hay dời cờ "đã trả" + ảnh chứng từ —
// chốt hồi quy cho bốn lỗi người soát tìm ra 2026-10-06 (ATDL-1…4) sau khi chuyển việc "đã chi" sang kế toán.
//
//   ATDL-1  Hai hàng cùng rid trong một phía: mọi luật kế thừa (reconcileExtra* / reconcileHnApprovals) khoá theo rid, nên
//           lần Lưu dời cờ + ảnh của bản này sang bản kia hoặc làm mất hẳn — chốt "hàng đã chi biến mất" (so tập rid) không
//           thấy vì rid vẫn còn. Ở đường account phụ, khoản kế toán còn nhảy sang hàng khác. Vá: src/khoanChi.ts
//           chuanHoaRidTrung ghép từng bản CSDL ↔ payload theo thứ tự hiển thị TRƯỚC reconcile.
//   ATDL-2  rid "w1 " (thêm dấu cách, payload tự chế) lách chốt tiền + chốt hàng đã chi. Vá: zod + sanitize cắt khoảng trắng.
//   ATDL-3  Chốt xoá mềm báo giá chỉ xét bản ĐẦU của mỗi rid. Vá: tenHangDaChi xét mọi bản.
//   ATDL-4  Dọn rác xoá cứng báo giá đã xoá mềm mà JSON còn cờ "đã trả" cũ (chưa chép sang bảng khoản). Vá: purge bỏ qua.
// Cộng: hàng đã trả (cũ) THIẾU rid → đường Lưu từ chối (400) thay vì xoá im cờ; công cụ backfillKhoanChi --sua-rid chuẩn
// hoá mã giữ nguyên cờ + ảnh; --xac-nhan đánh dấu dòng lệch legacySeed đã rà.
//
// Trên mã CŨ (c44ae9a) các bài Lưu ĐỎ vì đúng lý do (cờ dời / mất, 200); các bài công cụ đỏ vì hàm chưa có.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { purgeSoftDeleted } from "../src/services/adminService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hddvrid${Date.now()}`;
const PWD = "Test1234!a";
const ANH = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const ANH2 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR42mNk+M9QzwAEjDAAGL0D/QAAAABJRU5ErkJggg==";
const PAID_AT = "2026-09-01T03:00:00.000Z";

describe.runIf(dbAvailable)("rid trùng / thiếu / khoảng trắng không làm mất cờ đã trả", () => {
  let app, companyId, templateId, adminU, managerU, phuU, hnU, admin, manager, phu, hn;

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
  const daTra = (anh = ANH) => ({ paid: true, paidAt: PAID_AT, paidById: adminU.id, paidProof: anh });
  const bang = (category, items) => ({ category, name: category === "khach" ? "Phí khách hàng" : "Chi phí HCM", templateId: null, groupSubtotal: false, items });
  const taoBaoGia = (ten, { chuId = adminU.id, trang = [[]], hnTables, members = [], hnStatus = null, hnAssigneeId = null } = {}) => prisma.quote.create({ data: {
    quoteNumber: `${TAG}-${ten}`, projectCode: `${TAG}_${ten}`, title: `${TAG} ${ten}`, searchText: TAG, toCompany: "Khách thử", companyId,
    fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: chuId, hnStatus, hnAssigneeId,
    ...(hnTables ? { hnTables } : {}),
    ...(members.length ? { members: { create: members } } : {}),
    sheets: { create: trang.map((extraTables, i) => ({
      templateId, order: i + 1, name: `Trang ${i + 1}`, codeNo: i + 1, extraTables,
      items: { create: [{ order: 1, kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10000 }] },
    })) },
  } });
  const tai = (id) => prisma.quote.findFirst({
    where: { id }, includeDeleted: true,
    include: { sheets: { orderBy: [{ order: "asc" }, { id: "asc" }], include: { items: { orderBy: { order: "asc" } } } } },
  });
  const thanLuu = (q) => ({
    baseUpdatedAt: q.updatedAt.toISOString(),
    sheets: q.sheets.map((s) => ({
      id: s.id, templateId: s.templateId, name: s.name, order: s.order,
      items: s.items.map((it) => ({ kind: it.kind, name: it.name, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice), order: it.order })),
      extraTables: structuredClone(Array.isArray(s.extraTables) ? s.extraTables : []),
    })),
  });
  const hangTheoTen = (q, ten) => q.sheets.flatMap((s) => (s.extraTables || []).flatMap((t) => t.items || [])).filter((it) => it.name === ten);

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    adminU = await taoNguoi("admin", "admin");
    managerU = await taoNguoi("manager", "manager");
    phuU = await taoNguoi("phu", "manager");
    hnU = await taoNguoi("hn", "account_hn");
    companyId =(await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `D${`${Date.now()}`.slice(-6)}` } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    admin = await dangNhap(adminU);
    manager = await dangNhap(managerU);
    phu = await dangNhap(phuU);
    hn = await dangNhap(hnU);
  });

  afterAll(async () => {
    const qs = await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, select: { id: true }, includeDeleted: true }).catch(() => []);
    const ids = qs.map((q) => q.id);
    await prisma.inputInvoiceProof?.deleteMany({ where: { entry: { quoteId: { in: ids } } } }).catch(() => {});
    await prisma.inputInvoiceEntry?.deleteMany({ where: { quoteId: { in: ids } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: ids } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    const uids = [adminU, managerU, phuU, hnU].filter(Boolean).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: uids } }, { resourceId: { in: ids.map(String) }, actorId: null }] } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("ATDL-1: hai hàng cùng rid (A chưa trả, B đã trả + ảnh) — Lưu nguyên vẹn: MỖI hàng giữ cờ của CHÍNH nó, rid được tách", async () => {
    const q0 = await taoBaoGia("dup-luu", { trang: [[bang("hcm", [hang("dup", "Hàng A"), hang("dup", "Hàng B", daTra())])]] });
    const r = await admin.put(`/api/quotes/${q0.id}`).send(thanLuu(await tai(q0.id)));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const sau = await tai(q0.id);
    const [a] = hangTheoTen(sau, "Hàng A");
    const [b] = hangTheoTen(sau, "Hàng B");
    expect(a, "bản ĐẦU giữ rid (chủ của khoản kế toán)").toMatchObject({ rid: "dup", paid: false, paidProof: null });
    expect(b, "bản SAU giữ đúng cờ + ảnh của chính nó (mã cũ: dời sang A hoặc mất)").toMatchObject({ paid: true, paidAt: PAID_AT, paidProof: ANH });
    expect(b.rid).not.toBe("dup");
  });

  it("ATDL-1: bản sau ĐÃ TRẢ bị xoá trong lúc còn bản trùng → 400 'hang-da-chi' (so theo từng bản, không theo tập rid)", async () => {
    const q0 = await taoBaoGia("dup-xoa", { trang: [[bang("hcm", [hang("dup", "Hàng A"), hang("dup", "Hàng B đã trả", daTra())])]] });
    const than = thanLuu(await tai(q0.id));
    than.sheets[0].extraTables[0].items = than.sheets[0].extraTables[0].items.filter((it) => it.name !== "Hàng B đã trả");
    const r = await admin.put(`/api/quotes/${q0.id}`).send(than);
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe("hang-da-chi");
    expect(r.body.error).toContain("Hàng B đã trả");
  });

  it("ATDL-1: hai bản cùng rid ĐỀU đã trả với ảnh khác nhau — Lưu nguyên vẹn không tráo ảnh giữa hai hàng", async () => {
    const q0 = await taoBaoGia("dup-hai-anh", { trang: [[bang("hcm", [hang("dup", "Một", daTra(ANH)), hang("dup", "Hai", daTra(ANH2))])]] });
    expect((await admin.put(`/api/quotes/${q0.id}`).send(thanLuu(await tai(q0.id)))).status).toBe(200);
    const sau = await tai(q0.id);
    expect(hangTheoTen(sau, "Một")[0].paidProof).toBe(ANH);
    expect(hangTheoTen(sau, "Hai")[0].paidProof).toBe(ANH2);
  });

  it("ATDL-1 (account phụ chỉ 'Chi phí HCM'): trùng rid hcm↔khach cùng trang — khoản kế toán vẫn ở hàng hcm (chủ), hàng Phí KH ngoài phạm vi giữ cờ + ảnh của nó", async () => {
    const q0 = await taoBaoGia("dup-phu", {
      trang: [[bang("hcm", [hang("dup", "Thuê xe (HCM)")]), bang("khach", [hang("dup", "Phí ship (KH)", daTra())])]],
      members: [{ userId: phuU.id, scopes: ["hcm"] }],
    });
    // Khoản đã chi của bản ĐẦU (hàng hcm) — công cụ chuyển dữ liệu / dịch vụ kế toán đều gắn khoản vào bản đầu.
    await prisma.inputInvoiceEntry.create({ data: { quoteId: q0.id, side: "sheet", rid: "dup", paid: true, paidAt: new Date(PAID_AT), rowSnapshot: { name: "Thuê xe (HCM)" } } });
    const r = await phu.put(`/api/quotes/${q0.id}`).send(thanLuu(await tai(q0.id)));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const sau = await tai(q0.id);
    expect(hangTheoTen(sau, "Thuê xe (HCM)")[0].rid, "hàng chủ khoản giữ rid — khoản không nhảy sang hàng khác").toBe("dup");
    const kh = hangTheoTen(sau, "Phí ship (KH)")[0];
    expect(kh).toMatchObject({ paid: true, paidProof: ANH, approved: true });
    expect(kh.rid).not.toBe("dup");
  });

  // Hàng CHƯA duyệt để cô lập đúng chốt TIỀN của khoản đã chi (hàng đã duyệt còn vướng chốt tiền của DUYỆT, chạy trước).
  const chuaDuyet = { approved: false, approvedAt: null, approvedBy: null };

  it("ATDL-2: rid 'w1 ' (thêm dấu cách) là CÙNG hàng 'w1' — người không có quyền tích đổi tiền hàng đã trả → 400; không đổi tiền → 200, cờ + ảnh giữ", async () => {
    const q0 = await taoBaoGia("rid-trang", { chuId: managerU.id, trang: [[bang("hcm", [hang("w1", "Thuê cẩu", { ...chuaDuyet, quantity: 2, unitPrice: 500000, ...daTra() })])]] });
    const doiTien = thanLuu(await tai(q0.id));
    doiTien.sheets[0].extraTables[0].items[0].rid = "w1 ";
    doiTien.sheets[0].extraTables[0].items[0].unitPrice = 999999;
    const r1 = await manager.put(`/api/quotes/${q0.id}`).send(doiTien);
    expect(r1.status, `mã cũ: rid lạ = hàng mới → 200, cờ + ảnh rơi im. ${JSON.stringify(r1.body)}`).toBe(400);
    expect(r1.body.error).toMatch(/đã chi/);
    const giuTien = thanLuu(await tai(q0.id));
    giuTien.sheets[0].extraTables[0].items[0].rid = " w1 ";
    const r2 = await manager.put(`/api/quotes/${q0.id}`).send(giuTien);
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    const [h] = hangTheoTen(await tai(q0.id), "Thuê cẩu");
    expect(h).toMatchObject({ rid: "w1", paid: true, paidProof: ANH, unitPrice: 500000 });
  });

  it("ATDL-2: rid trong CSDL dính khoảng trắng ('w1 ', dữ liệu cũ) — Lưu nguyên vẹn giữ cờ + ảnh (rid được cắt), đổi tiền → 400", async () => {
    const q0 = await taoBaoGia("rid-trang-db", { chuId: managerU.id, trang: [[bang("hcm", [hang("w1 ", "Thuê loa", { ...chuaDuyet, unitPrice: 300000, ...daTra() })])]] });
    const doiTien = thanLuu(await tai(q0.id));
    doiTien.sheets[0].extraTables[0].items[0].unitPrice = 1;
    expect((await manager.put(`/api/quotes/${q0.id}`).send(doiTien)).status).toBe(400);
    const r = await manager.put(`/api/quotes/${q0.id}`).send(thanLuu(await tai(q0.id)));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(hangTheoTen(await tai(q0.id), "Thuê loa")[0]).toMatchObject({ rid: "w1", paid: true, paidProof: ANH, unitPrice: 300000 });
  });

  it("PUT /:id/hn (account Hà Nội): hai hàng HN cùng rid, bản sau đã trả — Lưu nguyên vẹn giữ cờ + ảnh ĐÚNG hàng; hàng đã trả THIẾU rid → 400", async () => {
    const giao = { hnStatus: "assigned", members: [{ userId: hnU.id, scopes: ["hanoi"] }] };
    const q0 = await taoBaoGia("hn-dup", { ...giao, hnAssigneeId: hnU.id, hnTables: [{ name: "HN", items: [hang("hd", "Xe HN"), hang("hd", "Khách sạn HN", daTra())] }] });
    const hnTables = structuredClone((await tai(q0.id)).hnTables);
    const r = await hn.put(`/api/quotes/${q0.id}/hn`).send({ hnTables });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const items = (await tai(q0.id)).hnTables[0].items;
    expect(items[0]).toMatchObject({ name: "Xe HN", rid: "hd", paid: false, paidProof: null });
    expect(items[1], "mã cũ: cờ + ảnh dời sang 'Xe HN' hoặc mất").toMatchObject({ name: "Khách sạn HN", paid: true, paidProof: ANH });
    expect(items[1].rid).not.toBe("hd");

    const q1 = await taoBaoGia("hn-thieu-rid", { ...giao, hnAssigneeId: hnU.id, hnTables: [{ name: "HN", items: [hang(undefined, "Vé HN đã trả", daTra())] }] });
    const r1 = await hn.put(`/api/quotes/${q1.id}/hn`).send({ hnTables: structuredClone((await tai(q1.id)).hnTables) });
    expect(r1.status, JSON.stringify(r1.body)).toBe(400);
    expect(r1.body.code).toBe("hang-da-chi-thieu-ma");
    expect((await tai(q1.id)).hnTables[0].items[0]).toMatchObject({ paid: true, paidProof: ANH });
  });

  it("ATDL-3: báo giá mà BẢN SAU của một rid trùng đã trả → không xoá mềm được (400 'bao-gia-co-khoan-da-chi')", async () => {
    const q0 = await taoBaoGia("dup-xoa-mem", { trang: [[bang("hcm", [hang("dup", "Chưa trả"), hang("dup", "Đã trả bản sau", daTra())])]] });
    const r = await admin.delete(`/api/quotes/${q0.id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe("bao-gia-co-khoan-da-chi");
    expect((await tai(q0.id)).deletedAt).toBeNull();
  });

  it("ATDL-4: Dọn rác KHÔNG xoá cứng báo giá đã xoá mềm mà JSON còn cờ 'đã trả' cũ (chưa có khoản)", async () => {
    const qVet = await taoBaoGia("purge-vet", { trang: [[bang("hcm", [hang("p1", "Đã trả, chưa chép", daTra())])]] });
    const qHn = await taoBaoGia("purge-vet-hn", { hnTables: [{ name: "HN", items: [hang("h1", "HN đã trả", daTra())] }] });
    const qSach = await taoBaoGia("purge-sach", { trang: [[bang("hcm", [hang("p2", "Chưa trả")])]] });
    // Mốc 1851 (ngưỡng ~1876 với days 55 000): xa mọi hàng xoá mềm thật — chỉ các bài dọn rác khác mới dùng mốc thế kỷ 19.
    await prisma.$executeRaw`UPDATE "Quote" SET "deletedAt" = '1851-01-01T00:00:00Z' WHERE id IN (${qVet.id}, ${qHn.id}, ${qSach.id})`;
    await purgeSoftDeleted({ body: { days: 55_000 }, session: {}, ip: "127.0.0.1", headers: {} });
    expect(await tai(qVet.id), "cờ đã trả + ảnh cũ là chứng từ — không xoá cứng").toBeTruthy();
    expect(await tai(qHn.id), "phía HN cũng vậy").toBeTruthy();
    expect(await tai(qSach.id), "báo giá không có dấu vết kế toán vẫn dọn như cũ").toBeNull();
  });

  it("hàng ĐÃ TRẢ (cũ) THIẾU rid → Lưu bị từ chối 400 'hang-da-chi-thieu-ma', CSDL không đổi (thay vì xoá im cờ + ảnh)", async () => {
    const q0 = await taoBaoGia("thieu-rid", { trang: [[bang("hcm", [hang(undefined, "Không mã đã trả", daTra())])]] });
    const truoc = (await tai(q0.id)).sheets[0].extraTables;
    const r = await admin.put(`/api/quotes/${q0.id}`).send(thanLuu(await tai(q0.id)));
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.code).toBe("hang-da-chi-thieu-ma");
    expect(r.body.error).toContain("Không mã đã trả");
    expect((await tai(q0.id)).sheets[0].extraTables).toEqual(truoc);
  });

  it("công cụ --sua-rid: khô không ghi; ghi thật tách rid trùng + cấp rid cho hàng thiếu + cắt khoảng trắng, GIỮ nguyên cờ + ảnh, bump updatedAt, chạy lại 0; sau đó Lưu được", async () => {
    const { suaRidKhoanChi } = await import("../src/khoanChiBackfill.js");
    const q0 = await taoBaoGia("sua-rid", {
      trang: [[bang("hcm", [
        hang("dup", "Bản đầu"), hang("dup", "Bản sau đã trả", daTra()), hang(undefined, "Thiếu mã đã trả", daTra(ANH2)), hang(" sp ", "Mã dính dấu cách"),
      ])]],
      hnTables: [{ name: "HN", items: [hang("hd", "HN một"), hang("hd", "HN hai", daTra())] }],
    });
    const truoc = await tai(q0.id);
    const kho = await suaRidKhoanChi({ quoteIds: [q0.id] });
    expect(kho.map((d) => [d.side, d.ten]).sort()).toEqual([["hn", "HN hai"], ["sheet", "Bản sau đã trả"], ["sheet", "Mã dính dấu cách"], ["sheet", "Thiếu mã đã trả"]]);
    expect(kho.find((d) => d.ten === "Mã dính dấu cách")).toMatchObject({ ridCu: " sp ", ridMoi: "sp" });
    expect((await tai(q0.id)).sheets[0].extraTables, "chế độ khô không ghi").toEqual(truoc.sheets[0].extraTables);

    const ghi = await suaRidKhoanChi({ quoteIds: [q0.id], ghi: true });
    expect(ghi).toHaveLength(4);
    const sau = await tai(q0.id);
    expect(sau.updatedAt.getTime(), "màn soạn mở bản cũ phải nhận 409 khi Lưu").toBeGreaterThan(truoc.updatedAt.getTime());
    // Chỉ trường rid đổi — mọi thứ khác (cờ duyệt, cờ đã trả, ẢNH) giữ nguyên từng byte.
    const boRid = (tables) => JSON.stringify((tables || []).map((t) => ({ ...t, items: (t.items || []).map(({ rid: _r, ...con }) => con) })));
    expect(boRid(sau.sheets[0].extraTables)).toBe(boRid(truoc.sheets[0].extraTables));
    expect(boRid(sau.hnTables)).toBe(boRid(truoc.hnTables));
    const rids = sau.sheets[0].extraTables[0].items.map((it) => it.rid);
    expect(new Set(rids).size, "rid duy nhất, không còn hàng thiếu mã").toBe(4);
    expect(rids[0], "bản đầu giữ rid").toBe("dup");
    expect(rids[3]).toBe("sp");
    expect(await suaRidKhoanChi({ quoteIds: [q0.id], ghi: true }), "chạy lại không đổi gì").toHaveLength(0);
    // Lưu nguyên vẹn sau chuẩn hoá: 200, không mất cờ nào.
    expect((await admin.put(`/api/quotes/${q0.id}`).send(thanLuu(sau))).status).toBe(200);
    expect(hangTheoTen(await tai(q0.id), "Thiếu mã đã trả")[0]).toMatchObject({ paid: true, paidProof: ANH2 });
  });

  it("công cụ --xac-nhan: dòng lệch legacySeed (bản app cũ đổi cờ JSON) — xác nhận xong thì --kiem hết lệch, khoản không đổi", async () => {
    const { keHoachKhoanChi, xacNhanHatGiong } = await import("../src/khoanChiBackfill.js");
    const q0 = await taoBaoGia("xac-nhan", { trang: [[bang("hcm", [hang("x1", "Hàng lệch")])]] });
    await prisma.inputInvoiceEntry.create({ data: {
      quoteId: q0.id, side: "sheet", rid: "x1", paid: true, paidAt: new Date(PAID_AT), rowSnapshot: { name: "Hàng lệch" },
      legacySeed: { paid: false, paidAt: null, paidById: null, hasProof: false }, accountingNote: "giữ",
    } });
    // Giả lập bản app CŨ (lúc lùi ảnh) ghi cờ JSON sau khi khoản đã có.
    const s0 = (await tai(q0.id)).sheets[0];
    const et = structuredClone(s0.extraTables);
    Object.assign(et[0].items[0], daTra());
    await prisma.quoteSheet.update({ where: { id: s0.id }, data: { extraTables: et } });
    expect((await keHoachKhoanChi({ quoteIds: [q0.id] })).lechHatGiong).toHaveLength(1);
    const kq = await xacNhanHatGiong([`${q0.id}:sheet:x1`, `${q0.id}:sheet:khong-co`, "sai-dang"]);
    expect(kq.daXacNhan).toBe(1);
    expect(kq.boQua).toHaveLength(2);
    expect((await keHoachKhoanChi({ quoteIds: [q0.id] })).lechHatGiong).toHaveLength(0);
    expect(await prisma.inputInvoiceEntry.findUnique({ where: { quoteId_side_rid: { quoteId: q0.id, side: "sheet", rid: "x1" } } })).toMatchObject({ paid: true, accountingNote: "giữ" });
  });
});
