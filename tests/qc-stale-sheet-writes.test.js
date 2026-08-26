// Cụm quote-concurrency — hai đường MẤT DỮ LIỆU IM LẶNG còn lại của lần vá trước.
//
// ══ LỖI 1: khoá lạc quan chỉ canh Quote, không canh QuoteSheet ══════════════
// `chotKhoaLacQuan` (src/services/quoteService.ts) so `Quote.updatedAt`. Nhưng có BA đường ghi
// QuoteSheet KHÔNG hề chạm Quote: customerDecision (custStatus…), signSheet (signedAt/signedBy…),
// updateSheetInvoice (invoiceNo/poNumber/hnInvoiceNo/paidAt/invoiceDate…) — đúng những field nằm
// trong SHEET_CARRY_FIELDS. `updateQuote` dựng `carry` từ ảnh chụp `existing` đọc NGOÀI transaction,
// nên việc kế toán ghi xen vào giữa không được thấy, mà mốc Quote thì không đổi → 200.
// TÁI HIỆN (tất định): giữ khoá hàng QuoteSheet bằng một transaction Postgres riêng, ghi số hoá đơn
// + chữ ký (đóng vai kế toán vừa lưu nhưng CHƯA commit), rồi bắn PUT lưu báo giá với mốc Quote CŨ.
// HẬU QUẢ: sheet được tạo lại MẤT số hoá đơn, ngày thanh toán, chữ ký — không ai được cảnh báo.
//
// ══ LỖI 2: saveHn bỏ qua im lặng sheetId đã bị xoá-tạo-lại ══════════════════
// `.filter((x) => x.sheet)` trong `saveHn` (src/hnWorkflow.ts) lọc sạch mọi sheetId không khớp rồi
// vẫn trả 200. Lưu báo giá là XOÁ SHEET + TẠO LẠI (id mới), nên chỉ cần quản lý bấm Lưu một lần là
// mọi sheetId mà màn hình Account Hà Nội đang giữ trở thành id CHẾT.
// TÁI HIỆN: account HN mở màn hình (giữ sheetId cũ) → quản lý Lưu báo giá → account HN bấm Lưu.
// HẬU QUẢ: 200 + toast "Đã lưu phần Hà Nội", dirty flag về false, rồi màn hình nạp lại bản CŨ —
// toàn bộ phần vừa gõ biến mất KÈM THÔNG BÁO THÀNH CÔNG. Đây là kiểu mất dữ liệu tệ nhất.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import pg from "pg";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `qcstale${Date.now()}`;
const PWD = "Test1234!a";
const nghi = (ms) => new Promise((r) => setTimeout(r, ms));
/** supertest gửi request LƯỜI (chỉ khi .then được gọi) — bài test đua phải BẮN NGAY rồi mới chờ. */
const banNgay = (t) => t.then((r) => r);

/** Mở một transaction Postgres RIÊNG (ngoài Prisma) để giữ khoá hàng — đóng vai "người kia". */
async function moKhoa() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("BEGIN");
  return client;
}

describe.runIf(dbAvailable)("ghi lên sheet cũ — không được mất im lặng", () => {
  let app, admin, acc, adminU, accU, companyId, templateId;

  const taoBaoGia = async (title) => {
    const r = await admin.post("/api/quotes").send({
      title: `${TAG} ${title}`, companyId, toCompany: "Khách thử", vatPercent: 8,
      sheets: [{ name: "Trang 1", order: 1, templateId, items: [{ kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10_000, order: 1 }] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return { id: r.body.id, sheetId: r.body.sheets[0].id };
  };

  const sheetHienTai = (quoteId) =>
    prisma.quoteSheet.findFirst({ where: { quoteId }, orderBy: { order: "asc" } });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    accU = await prisma.user.create({ data: { username: `${TAG}-acc`, displayName: `${TAG} acc`, role: "account_hn", passwordHash: await bcrypt.hash(PWD, 4) } });
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: "QS" } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: adminU.username, password: PWD })).status).toBe(200);
    acc = agentWithCsrf(app);
    expect((await acc.post("/api/auth/login").send({ username: accU.username, password: PWD })).status).toBe(200);
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  // ── LỖI 1 ────────────────────────────────────────────────────────────────
  it("kế toán ghi số hoá đơn/chữ ký xen vào giữa → lần Lưu báo giá KHÔNG được xoá mất", async () => {
    const { id, sheetId } = await taoBaoGia("hoadon");
    const moc = (await admin.get(`/api/quotes/${id}`)).body.updatedAt;

    const keToan = await moKhoa();
    try {
      // Kế toán vừa lưu số hoá đơn + chữ ký cho sheet này nhưng CHƯA commit.
      // Hai đường thật (updateSheetInvoice, signSheet) chỉ ghi QuoteSheet — Quote.updatedAt KHÔNG đổi.
      await keToan.query('SELECT id FROM "QuoteSheet" WHERE id = $1 FOR UPDATE', [sheetId]);
      await keToan.query(
        'UPDATE "QuoteSheet" SET "invoiceNo" = $2, "paidAt" = $3, "signedByName" = $4 WHERE id = $1',
        [sheetId, "HD-2026-001", "2026-08-01T00:00:00.000Z", "Chị Kế Toán"]
      );

      const dangLuu = banNgay(admin.put(`/api/quotes/${id}`).send({
        baseUpdatedAt: moc,
        title: `${TAG} sale sua`,
        sheets: [{ id: sheetId, templateId, name: "Trang 1", order: 1, items: [{ kind: "item", name: "Hạng mục", quantity: 2, unitPrice: 10_000, order: 1 }] }],
      }));
      await nghi(500);   // đủ để request đọc xong `existing` (chưa thấy số hoá đơn) rồi kẹt ở khoá
      await keToan.query("COMMIT");
      const r = await dangLuu;
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    } finally {
      await keToan.query("ROLLBACK").catch(() => {});
      await keToan.end().catch(() => {});
    }

    const s = await sheetHienTai(id);
    expect(s.invoiceNo, "số hoá đơn kế toán vừa ghi KHÔNG được biến mất sau khi sale bấm Lưu").toBe("HD-2026-001");
    expect(s.paidAt, "ngày thanh toán phải còn").not.toBeNull();
    expect(s.signedByName, "chữ ký phải còn").toBe("Chị Kế Toán");
    // Phần sale sửa vẫn phải lưu — vá xong không được biến thành "bỏ qua lần Lưu".
    expect(Number(s.subtotal)).toBe(20_000);
  }, 30_000);

  // ── LỖI 2 ────────────────────────────────────────────────────────────────
  it("account HN lưu bằng sheetId ĐÃ BỊ XOÁ-TẠO-LẠI → 409, KHÔNG được báo thành công suông", async () => {
    const { id, sheetId } = await taoBaoGia("stalehn");
    expect((await admin.post(`/api/quotes/${id}/hn/assign`).send({ accountId: accU.id })).status).toBe(200);

    // Quản lý bấm Lưu → xoá sheet cũ, tạo lại với id MỚI. Màn hình account HN vẫn giữ id cũ.
    const luu = await admin.put(`/api/quotes/${id}`).send({
      title: `${TAG} stalehn v2`,
      sheets: [{ id: sheetId, templateId, name: "Trang 1", order: 1, items: [{ kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10_000, order: 1 }] }],
    });
    expect(luu.status, JSON.stringify(luu.body)).toBe(200);
    const sheetMoi = await sheetHienTai(id);
    expect(sheetMoi.id, "lưu báo giá phải sinh sheet id MỚI (đúng tiền đề của lỗi)").not.toBe(sheetId);

    const r = await acc.put(`/api/quotes/${id}/hn`).send({
      hnSheets: [{ sheetId, hnTables: [{ category: "hanoi", name: "Giá HN", templateId, groupSubtotal: true, items: [{ kind: "item", rid: "hn1", name: "Thuê xe HN", quantity: 1, unitPrice: 5_000_000 }] }] }],
    });
    expect(r.status, "trả 200 mà không ghi gì = mất trắng phần vừa gõ, kèm toast 'Đã lưu'").toBe(409);
    expect(r.body.error).toMatch(/tải lại/i);
  }, 30_000);

  it("sheetId khớp thì vẫn lưu bình thường (không siết quá tay)", async () => {
    const { id } = await taoBaoGia("hnok");
    expect((await admin.post(`/api/quotes/${id}/hn/assign`).send({ accountId: accU.id })).status).toBe(200);
    const s = await sheetHienTai(id);
    const r = await acc.put(`/api/quotes/${id}/hn`).send({
      hnSheets: [{ sheetId: s.id, hnTables: [{ category: "hanoi", name: "Giá HN", templateId, groupSubtotal: true, items: [{ kind: "item", rid: "hn1", name: "Thuê xe HN", quantity: 1, unitPrice: 5_000_000 }] }] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const sau = await sheetHienTai(id);
    expect(sau.extraTables.find((t) => t.category === "hanoi").items[0].unitPrice).toBe(5_000_000);
  }, 30_000);

  it("sheetId BỊA (lớn hơn mọi sheet đang có) vẫn BỎ QUA + 200 — giữ hợp đồng cũ của endpoint", async () => {
    // tests/hn-save-forgery.test.js chốt hành vi này: id trỏ ra ngoài báo giá thì bỏ qua, không 409.
    // Phân biệt được với ca trên vì id sheet TĂNG DẦN: id nhỏ hơn mọi sheet hiện có = id đã CHẾT
    // (xoá-tạo-lại), id lớn hơn = client bịa ra, chưa từng tồn tại.
    const { id } = await taoBaoGia("hnbia");
    expect((await admin.post(`/api/quotes/${id}/hn/assign`).send({ accountId: accU.id })).status).toBe(200);
    const s = await sheetHienTai(id);
    const r = await acc.put(`/api/quotes/${id}/hn`).send({
      hnSheets: [{ sheetId: s.id + 999_999, hnTables: [{ category: "hanoi", name: "Lạ", templateId, items: [{ kind: "item", name: "chèn", quantity: 1, unitPrice: 1 }] }] }],
    });
    expect(r.status).toBe(200);
    const sau = await sheetHienTai(id);
    expect((sau.extraTables || []).length, "không được ghi lẫn sang sheet khác").toBe(0);
  }, 30_000);
});
