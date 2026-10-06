// CÔNG CỤ CHUYỂN DỮ LIỆU một lần: cờ "đã trả" + ảnh chứng từ CŨ trong JSON hàng (`QuoteSheet.extraTables`,
// `Quote.hnTables`) → bảng khoản chi InputInvoiceEntry / InputInvoiceProof của trang Hóa đơn đầu vào
// (src/khoanChiBackfill.ts; CLI src/tools/backfillKhoanChi.ts chạy ngay sau deploy: khô → --ghi → --kiem).
//
// ── BÀI NÀY KHOÁ HỢP ĐỒNG CỦA CÔNG CỤ ────────────────────────────────────────────────────────────────
//   · Chế độ KHÔ chỉ đọc: liệt kê việc + các chỗ phải rà tay, không ghi gì.
//   · GHI chỉ THÊM: tạo khoản (+ ảnh `json-cu`) cho hàng trang / Hà Nội / báo giá ĐÃ XOÁ MỀM (tiền đã chi vẫn phải đối
//     chiếu được) — và KHÔNG đụng một byte JSON nào; rid trùng → hàng ĐẦU; mỗi khoản một dòng nhật ký `json-cu`.
//   · Chạy lại bao nhiêu lần cũng vậy: lần hai tạo 0, không ghi đè khoản đã có (kể cả khi đưa vào kế hoạch cũ).
//   · Báo được: hàng có dấu vết mà thiếu rid / rid trùng / bản 'hanoi' cũ còn trong trang mà Quote.hnTables không có.
//   · --kiem (`conViec`) SẠCH sau khi chép, và bắt được JSON đổi SAU khi khoản đã có (lệch `legacySeed`) — dấu hiệu
//     bản app CŨ còn ghi JSON (khe migrate → recreate của deploy.sh, hoặc sau khi lùi ảnh).
//
// CSDL test có dữ liệu của bài khác: mọi lời gọi `keHoachKhoanChi` LUÔN truyền `quoteIds` của bài này. Không chạy CLI
// ở đây — CLI quét CẢ CSDL.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "../src/db.js";
import { keHoachKhoanChi, apDungKhoanChi, conViec } from "../src/khoanChiBackfill.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hddvjson${Date.now()}`;
// PNG thật 1x1.
const ANH_THAT =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const byteCua = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
const shaCua = (dataUrl) => createHash("sha256").update(byteCua(dataUrl)).digest("hex");

describe.runIf(dbAvailable)("backfillKhoanChi — chép cờ / ảnh JSON cũ sang bảng khoản chi", () => {
  let admin, companyId, templateId;
  let qSheet, qHn, qXoa, qSach, qHong;
  const IDS = () => [qSheet.id, qHn.id, qXoa.id];

  const hang = (rid, name, over = {}) => ({ kind: "item", rid, name, quantity: 1, unitPrice: 100000, approved: true, ...over });
  const daTra = (ngay) => ({ paid: true, paidAt: ngay, paidById: admin.id });
  const baoGia = (ten, { trang = [[]], ...extra } = {}) => prisma.quote.create({ data: {
    quoteNumber: `${TAG}-${ten}`, projectCode: `${TAG}_${ten}`, title: `${TAG} ${ten}`, searchText: TAG, toCompany: "Khách",
    companyId, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(), createdById: admin.id,
    sheets: { create: trang.map((extraTables, i) => ({ templateId, order: i + 1, name: `Trang ${i + 1}`, codeNo: i + 1, extraTables })) },
    ...extra,
  } });
  /** JSON hàng của các báo giá (mọi trang + Hà Nội), kể cả báo giá đã xoá mềm — để so "bằng nhau từng byte". */
  const jsonCua = async (ids) => JSON.stringify(await prisma.quote.findMany({
    where: { id: { in: ids } }, includeDeleted: true, orderBy: { id: "asc" },
    select: { id: true, hnTables: true, sheets: { orderBy: { id: "asc" }, select: { id: true, extraTables: true } } },
  }));
  const khoanCua = (ids) => prisma.inputInvoiceEntry.findMany({ where: { quoteId: { in: ids } }, orderBy: [{ quoteId: "asc" }, { side: "asc" }, { rid: "asc" }] });
  const khoan = (qid, side, rid) => prisma.inputInvoiceEntry.findUnique({ where: { quoteId_side_rid: { quoteId: qid, side, rid } } });
  const anhCua = (entryId) => prisma.inputInvoiceProof.findMany({ where: { entryId }, orderBy: { id: "asc" } });
  const trich = (e) => [e.id, e.version, e.paid, e.paidAt?.getTime() ?? null, e.currentProofId, e.updatedAt.getTime()];

  beforeAll(async () => {
    admin = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: "x" } });
    companyId = (await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: `J${`${Date.now()}`.slice(-6)}` } })).id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    qSheet = await baoGia("sheet", { trang: [
      [
        { category: "hcm", name: "HCM", items: [
          { kind: "section", name: "Nhóm", quantity: 0, unitPrice: 0 },
          hang("b-paid", "Thuê xe", { quantity: 2, unitPrice: 500000, ...daTra("2026-09-10T02:00:00.000Z"), paidProof: ANH_THAT }),
          hang("b-anh", "Chỉ có ảnh", { paid: false, paidProof: ANH_THAT }),
          hang("b-sach", "Không dấu vết"),
          { kind: "item", name: "Không mã", quantity: 1, unitPrice: 1000, ...daTra("2026-09-10T00:00:00.000Z") },   // THIẾU rid
          hang("b-dup", "Dup 1", daTra("2026-09-11T00:00:00.000Z")),
        ] },
        { category: "khach", name: "KH", items: [hang("b-kh", "Phí ship", daTra("2026-09-12T00:00:00.000Z"))] },
        // Bản CŨ của bảng HN còn nằm trong trang (migration 20260915140000 EXPAND-ONLY) mang cờ trả — Quote.hnTables
        // không có hàng nào cùng rid mang dấu vết → phải BÁO, và không được chép thành khoản phía "sheet".
        { category: "hanoi", name: "HN cũ", items: [hang("h-cu", "HN cũ đã trả", daTra("2026-09-01T00:00:00.000Z"))] },
      ],
      [
        { category: "hcm", name: "HCM 2", items: [
          hang("b-dup", "Dup 2", daTra("2026-09-13T00:00:00.000Z")),                          // rid TRÙNG khác trang
          hang("b-chua", "Chưa duyệt mà đã trả", { approved: false, ...daTra("2026-09-14T00:00:00.000Z") }),
        ] },
      ],
    ] });
    qHn = await baoGia("hn", {
      hnStatus: "approved",
      hnTables: [{ name: "Giá HN", items: [
        hang("hn-paid", "Thuê sàn", { ...daTra("2026-09-20T00:00:00.000Z"), paidProof: ANH_THAT }),
        hang("hn-sach", "HN không dấu vết"),
      ] }],
      // Bản cũ trong trang CÙNG rid với hàng HN đã mang dấu vết ở Quote.hnTables → KHÔNG báo.
      trang: [[{ category: "hanoi", name: "HN cũ", items: [hang("hn-paid", "Thuê sàn", daTra("2026-09-20T00:00:00.000Z"))] }]],
    });
    qXoa = await baoGia("xoa", { trang: [[{ category: "hcm", name: "HCM", items: [hang("x-paid", "Báo giá đã xoá", daTra("2026-09-05T00:00:00.000Z"))] }]] });
    await prisma.quote.delete({ where: { id: qXoa.id } });   // xoá MỀM
    qSach = await baoGia("sach", {
      trang: [[{ category: "hcm", name: "HCM", items: [hang("s-1", "Sạch 1", { ...daTra("2026-09-21T00:00:00.000Z"), paidProof: ANH_THAT })] }]],
      hnTables: [{ name: "HN", items: [hang("s-hn", "Sạch HN", daTra("2026-09-22T00:00:00.000Z"))] }],
    });
    // Cột Json TỰ DO đã qua nhiều đời mã: phần tử không phải object, items không phải mảng, hnTables không phải mảng.
    qHong = await baoGia("hong", {
      trang: [[null, "x", { category: "hcm", items: "hỏng" }, { category: "hcm", items: [null, 7, "chuỗi", hang("ok-1", "Hàng tốt", daTra("2026-09-23T00:00:00.000Z"))] }]],
      hnTables: { khong: "phải mảng" },
    });
  }, 60_000);

  afterAll(async () => {
    const ids = (await prisma.quote.findMany({ where: { title: { startsWith: TAG } }, includeDeleted: true, select: { id: true } })).map((q) => q.id);
    // Khoản kế toán RESTRICT báo giá: dọn ảnh → khoản TRƯỚC khi xoá cứng báo giá.
    await prisma.inputInvoiceProof.deleteMany({ where: { entry: { quoteId: { in: ids } } } }).catch(() => {});
    await prisma.inputInvoiceEntry.deleteMany({ where: { quoteId: { in: ids } } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { resource: "quote", resourceId: { in: ids.map(String) } } }).catch(() => {});
    await prisma.quote.deleteMany({ where: { id: { in: ids } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("CHẾ ĐỘ KHÔ (keHoachKhoanChi) chỉ ĐỌC: đúng danh sách cần chép + các chỗ phải rà; không tạo khoản, không đụng JSON", async () => {
    const jsonTruoc = await jsonCua(IDS());
    const kh = await keHoachKhoanChi({ quoteIds: IDS() });
    const nhan = (d) => `${d.quoteId === qSheet.id ? "S" : d.quoteId === qHn.id ? "H" : d.quoteId === qXoa.id ? "X" : "?"}:${d.side}:${d.rid}`;
    expect(kh.canChep.map(nhan).sort()).toEqual(["H:hn:hn-paid", "S:sheet:b-anh", "S:sheet:b-chua", "S:sheet:b-dup", "S:sheet:b-kh", "S:sheet:b-paid", "X:sheet:x-paid"]);
    const theo = (rid) => kh.canChep.find((d) => d.rid === rid);
    expect(theo("b-paid")).toEqual({ quoteId: qSheet.id, side: "sheet", rid: "b-paid", ten: "Thuê xe", paid: true, coAnh: true, daXoa: false });
    expect(theo("b-anh")).toMatchObject({ paid: false, coAnh: true });
    expect(theo("b-dup"), "rid trùng: chỉ hàng ĐẦU").toMatchObject({ ten: "Dup 1", paid: true, coAnh: false });
    expect(theo("hn-paid")).toMatchObject({ quoteId: qHn.id, side: "hn", coAnh: true, daXoa: false });
    expect(theo("x-paid"), "báo giá đã xoá mềm vẫn phải chép — tiền đã chi").toMatchObject({ quoteId: qXoa.id, daXoa: true });

    expect(kh.thieuRid).toEqual([{ quoteId: qSheet.id, side: "sheet", ten: "Không mã" }]);
    expect(kh.trungRid).toEqual([{ quoteId: qSheet.id, side: "sheet", rid: "b-dup", soLan: 2 }]);
    const s1 = (await prisma.quoteSheet.findFirst({ where: { quoteId: qSheet.id }, orderBy: { order: "asc" } })).id;
    expect(kh.hanoiCuTrongTrang, "bản HN cũ đã có ở Quote.hnTables thì không báo").toEqual([{ quoteId: qSheet.id, sheetId: s1, rid: "h-cu", ten: "HN cũ đã trả" }]);
    expect(kh.lechHatGiong).toEqual([]);
    expect(conViec(kh)).toBe(true);

    expect(await prisma.inputInvoiceEntry.count({ where: { quoteId: { in: IDS() } } }), "chế độ khô đã ghi").toBe(0);
    expect(await jsonCua(IDS())).toBe(jsonTruoc);
  });

  it("GHI (apDungKhoanChi): tạo khoản + ảnh 'json-cu' cho hàng trang / Hà Nội / báo giá đã xoá mềm; rid trùng → hàng ĐẦU; JSON trước / sau bằng nhau TỪNG BYTE; mỗi khoản một dòng nhật ký 'json-cu'", async () => {
    const jsonTruoc = await jsonCua(IDS());
    const n = await apDungKhoanChi(await keHoachKhoanChi({ quoteIds: IDS() }));
    expect(n).toBe(7);
    expect(await jsonCua(IDS()), "công cụ chuyển dữ liệu đụng vào JSON").toBe(jsonTruoc);

    const ds = await khoanCua(IDS());
    const e = Object.fromEntries(ds.map((x) => [`${x.quoteId}:${x.side}:${x.rid}`, x]));
    expect(Object.keys(e).sort()).toEqual([
      `${qHn.id}:hn:hn-paid`, `${qSheet.id}:sheet:b-anh`, `${qSheet.id}:sheet:b-chua`, `${qSheet.id}:sheet:b-dup`,
      `${qSheet.id}:sheet:b-kh`, `${qSheet.id}:sheet:b-paid`, `${qXoa.id}:sheet:x-paid`,
    ].sort());

    const paid = e[`${qSheet.id}:sheet:b-paid`];
    expect(paid).toMatchObject({ paid: true, paidById: admin.id, paidByName: `${TAG} admin`, source: "json-cu", version: 0, paidSnapshot: null, updatedById: null });
    expect(paid.paidAt.toISOString()).toBe("2026-09-10T02:00:00.000Z");
    expect(paid.legacySeed).toEqual({ paid: true, paidAt: "2026-09-10T02:00:00.000Z", paidById: admin.id, hasProof: true });
    expect(paid.rowSnapshot).toMatchObject({ name: "Thuê xe", quantity: 2, unitPrice: 500000, amount: 1000000, category: "hcm", tableName: "HCM" });
    const [pPaid, ...thua] = await anhCua(paid.id);
    expect(thua).toEqual([]);
    expect(pPaid).toMatchObject({ source: "json-cu", dataUrl: ANH_THAT, mime: "image/png", sha256: shaCua(ANH_THAT), size: byteCua(ANH_THAT).length, retiredAt: null, uploadedById: admin.id });
    expect(pPaid.uploadedAt.toISOString(), "ảnh cũ mang mốc lúc trả").toBe("2026-09-10T02:00:00.000Z");
    expect(paid.currentProofId).toBe(pPaid.id);

    // Chỉ có ảnh, chưa trả: ảnh vẫn được giữ — nhưng rút ngay vào lịch sử, không phải ảnh hiện tại.
    const anh = e[`${qSheet.id}:sheet:b-anh`];
    expect(anh).toMatchObject({ paid: false, paidAt: null, currentProofId: null, source: "json-cu" });
    const [pAnh] = await anhCua(anh.id);
    expect(pAnh).toMatchObject({ source: "json-cu", retiredReason: "bo-danh-dau", sha256: shaCua(ANH_THAT) });
    expect(pAnh.retiredAt).not.toBeNull();

    expect(e[`${qSheet.id}:sheet:b-dup`].paidAt.toISOString(), "rid trùng: chép hàng ĐẦU").toBe("2026-09-11T00:00:00.000Z");
    expect(e[`${qSheet.id}:sheet:b-dup`].rowSnapshot).toMatchObject({ name: "Dup 1" });
    expect(e[`${qSheet.id}:sheet:b-kh`]).toMatchObject({ paid: true, currentProofId: null });
    expect(e[`${qSheet.id}:sheet:b-kh`].rowSnapshot).toMatchObject({ category: "khach", tableName: "KH" });
    expect(e[`${qSheet.id}:sheet:b-chua`], "chép MỌI dấu vết, kể cả hàng nay chưa duyệt").toMatchObject({ paid: true });
    expect(e[`${qHn.id}:hn:hn-paid`]).toMatchObject({ paid: true, source: "json-cu" });
    expect(e[`${qHn.id}:hn:hn-paid`].rowSnapshot).toMatchObject({ name: "Thuê sàn", category: "hanoi" });
    expect((await anhCua(e[`${qHn.id}:hn:hn-paid`].id))[0]).toMatchObject({ source: "json-cu", retiredAt: null });
    expect(e[`${qXoa.id}:sheet:x-paid`]).toMatchObject({ paid: true, source: "json-cu" });

    const ev = await prisma.auditEvent.findMany({ where: { action: "quote.internal.ke-toan", actorId: null, resource: "quote", resourceId: { in: IDS().map(String) } } });
    expect(ev).toHaveLength(7);
    for (const x of ev) {
      expect(x.after).toMatchObject({ nguon: "json-cu" });
      expect(JSON.stringify(x.after), "nhật ký chép ảnh").not.toContain("data:image");
    }
    expect(ev.find((x) => x.after.rid === "b-paid").after).toMatchObject({ side: "sheet", paid: true, proofId: pPaid.id });
  });

  it("chạy lại lần hai: không còn gì để chép (chỗ phải rà vẫn được báo), ghi tạo 0 — kể cả khi đưa vào kế hoạch CŨ — không đổi khoản / ảnh / JSON nào", async () => {
    const truoc = await khoanCua(IDS());
    const soAnh = await prisma.inputInvoiceProof.count({ where: { entry: { quoteId: { in: IDS() } } } });
    const jsonTruoc = await jsonCua(IDS());

    const kh2 = await keHoachKhoanChi({ quoteIds: IDS() });
    expect(kh2.canChep).toEqual([]);
    expect(kh2.lechHatGiong).toEqual([]);
    expect([kh2.thieuRid.length, kh2.trungRid.length, kh2.hanoiCuTrongTrang.length], "công cụ không tự 'sửa' thiếu / trùng rid — chỉ báo").toEqual([1, 1, 1]);
    expect(await apDungKhoanChi(kh2)).toBe(0);
    // Kế hoạch CŨ (lập trước lần ghi): ON CONFLICT DO NOTHING — không ghi đè, không nhân đôi ảnh, không thêm nhật ký.
    const khCu = { ...kh2, canChep: truoc.map((x) => ({ quoteId: x.quoteId, side: x.side, rid: x.rid, ten: "", paid: true, coAnh: true, daXoa: false })) };
    expect(await apDungKhoanChi(khCu)).toBe(0);

    expect((await khoanCua(IDS())).map(trich)).toEqual(truoc.map(trich));
    expect(await prisma.inputInvoiceProof.count({ where: { entry: { quoteId: { in: IDS() } } } })).toBe(soAnh);
    expect(await jsonCua(IDS())).toBe(jsonTruoc);
    expect(await prisma.auditEvent.count({ where: { action: "quote.internal.ke-toan", actorId: null, resource: "quote", resourceId: { in: IDS().map(String) } } })).toBe(7);
  });

  it("--kiem (conViec): SẠCH sau khi chép; bắt được JSON đổi SAU khi khoản đã có (lệch legacySeed) ở cả phía trang lẫn Hà Nội — và công cụ KHÔNG ghi đè khoản", async () => {
    const ids = [qSach.id];
    expect(await apDungKhoanChi(await keHoachKhoanChi({ quoteIds: ids }))).toBe(2);
    const sach = await keHoachKhoanChi({ quoteIds: ids });
    expect(conViec(sach), JSON.stringify(sach)).toBe(false);

    // Bản app CŨ (khe migrate → recreate, hoặc sau khi lùi ảnh) còn ghi JSON: bỏ tích + gỡ ảnh hàng trang, đổi ngày trả
    // hàng Hà Nội.
    const s = await prisma.quoteSheet.findFirst({ where: { quoteId: qSach.id } });
    await prisma.quoteSheet.update({ where: { id: s.id }, data: { extraTables: s.extraTables.map((t) => ({ ...t, items: t.items.map((it) => ({ ...it, paid: false, paidAt: null, paidById: null, paidProof: null })) })) } });
    const q = await prisma.quote.findUnique({ where: { id: qSach.id }, select: { hnTables: true } });
    await prisma.quote.update({ where: { id: qSach.id }, data: { hnTables: q.hnTables.map((t) => ({ ...t, items: t.items.map((it) => ({ ...it, paidAt: "2026-09-30T00:00:00.000Z" })) })) } });

    const kh = await keHoachKhoanChi({ quoteIds: ids });
    expect(conViec(kh)).toBe(true);
    expect(kh.canChep).toEqual([]);
    expect(kh.lechHatGiong).toHaveLength(2);
    expect(kh.lechHatGiong.find((d) => d.side === "sheet")).toMatchObject({
      quoteId: qSach.id, rid: "s-1", hatGiong: { paid: true, hasProof: true }, jsonNay: { paid: false, paidAt: null, hasProof: false },
    });
    expect(kh.lechHatGiong.find((d) => d.side === "hn")).toMatchObject({
      quoteId: qSach.id, rid: "s-hn", hatGiong: { paid: true, paidAt: "2026-09-22T00:00:00.000Z" }, jsonNay: { paid: true, paidAt: "2026-09-30T00:00:00.000Z" },
    });
    const truoc = await khoanCua(ids);
    expect(await apDungKhoanChi(kh)).toBe(0);
    expect((await khoanCua(ids)).map(trich), "--ghi không được đè khoản theo JSON mới").toEqual(truoc.map(trich));
    expect(truoc.find((x) => x.rid === "s-1")).toMatchObject({ paid: true });
  });

  it("JSON lệch kiểu (bảng không phải object, items không phải mảng, phần tử vô hướng, hnTables là object) không làm vỡ công cụ — hàng hợp lệ vẫn được chép", async () => {
    const kh = await keHoachKhoanChi({ quoteIds: [qHong.id] });
    expect(kh.canChep.map((d) => d.rid)).toEqual(["ok-1"]);
    expect([kh.thieuRid, kh.trungRid, kh.lechHatGiong, kh.hanoiCuTrongTrang]).toEqual([[], [], [], []]);
    expect(await apDungKhoanChi(kh)).toBe(1);
    expect(await khoan(qHong.id, "sheet", "ok-1")).toMatchObject({ paid: true, source: "json-cu", currentProofId: null });
  });
});
