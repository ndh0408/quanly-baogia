// `PUT /api/quotes/:id/hn` KHÔNG có body schema → account Hà Nội tự giả mạo trạng thái
// duyệt/thanh toán. Chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Route khai `validate({ params: idParam })` — chỉ kiểm `:id`, KHÔNG kiểm body. `saveHn`
// (src/hnWorkflow.ts) đọc thẳng `req.body?.hnSheets` rồi đưa vào `sanitizeExtraTables`, mà hàm đó
// persist NGUYÊN TRẠNG các cờ do server sở hữu:
//     approved / approvedAt / approvedBy / paid / paidAt / paidById / paidProof
// Chú thích ngay trong `sanitizeExtraTables` ghi rõ giả định của nó: `reconcileExtra*` đã chạy
// TRƯỚC. `updateQuote` có gọi hai hàm đó. `saveHn` thì KHÔNG gọi hàm nào cả.
//
// Người gọi được endpoint này chỉ có account Hà Nội — vai trò có ĐÚNG BA quyền
// (`quote:read:own`, `quote:update:own`, `quote:hn:fill`), KHÔNG `quote:internal:pay`, KHÔNG
// `quote:internal:approve`. Nghĩa là họ tự làm được bốn việc mà phân quyền cấm:
//   1. Đánh dấu chính bảng chi phí của mình là ĐÃ THANH TOÁN.
//   2. Đặt `paidAt` tuỳ ý (lùi ngày) và trỏ `paidById` sang NGƯỜI KHÁC — kế toán mở sổ ra thấy
//      một khoản đã trả mang tên người không hề bấm nút nào.
//   3. Nhét thẳng chuỗi `paidProof` vào cột Json. Route /pay chặn ở 900KB + bắt buộc data-URL ảnh
//      (`z.string().max(900_000).regex(...)`); đường này không chặn gì.
//   4. Tự đóng dấu DUYỆT cho hàng của chính mình.
//
// Thiếu schema còn có nghĩa là KHÔNG có cap nào: số bảng, số dòng, độ dài chuỗi đều không giới hạn,
// trong khi đường lưu báo giá chính cap ở 20 bảng/sheet và 1000 dòng/bảng.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Hai lớp, bổ sung nhau:
//   - `HnSaveSchema` (src/validators.ts) chặn HÌNH DẠNG + kích thước.
//   - `saveHn` gọi `reconcileExtraPayments` + `reconcileHanoiApprovals` để lấy lại cờ từ CSDL —
//     schema một mình KHÔNG đủ, vì các khoá đó là khoá HỢP LỆ, chỉ là client không được đặt.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `hnforge${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("PUT /quotes/:id/hn — account HN không giả mạo được trạng thái server", () => {
  let app, acc, accU, adminU, companyId, templateId, quoteId, sheetId;

  /** Đọc lại bảng "hanoi" THẲNG TỪ CSDL — không qua presentQuote (nó lược paidProof). */
  const hanoiTuDB = async () => {
    const s = await prisma.quoteSheet.findFirst({ where: { id: sheetId }, select: { extraTables: true } });
    return (s.extraTables || []).filter((t) => t.category === "hanoi");
  };

  /** Dựng lại báo giá về trạng thái gốc trước mỗi kịch bản (r1 chưa trả, chưa duyệt). */
  const datLaiBaoGia = async () => {
    await prisma.quoteSheet.update({
      where: { id: sheetId },
      data: {
        extraTables: [
          { category: "hcm", name: "Chi phí HCM", templateId, groupSubtotal: true, items: [{ kind: "item", rid: "hcm1", name: "Thuê kho", quantity: 1, unitPrice: 1000, approved: false, paid: false, paidAt: null, paidById: null, paidProof: null }] },
          { category: "hanoi", name: "Giá HN", templateId, groupSubtotal: true, items: [{ kind: "item", rid: "r1", name: "Thuê xe HN", quantity: 1, unitPrice: 2000, approved: false, approvedAt: null, approvedBy: null, paid: false, paidAt: null, paidById: null, paidProof: null }] },
        ],
      },
    });
    await prisma.quote.update({ where: { id: quoteId }, data: { hnStatus: "assigned", hnAssigneeId: accU.id } });
  };

  const guiHn = (items) =>
    acc.put(`/api/quotes/${quoteId}/hn`).send({
      hnSheets: [{ sheetId, hnTables: [{ category: "hanoi", name: "Giá HN", templateId, groupSubtotal: true, items }] }],
    });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();

    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    accU = await prisma.user.create({ data: { username: `${TAG}-acc`, displayName: `${TAG} acc`, role: "account_hn", passwordHash: await bcrypt.hash(PWD, 4) } });

    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: "HF" } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    // Admin tạo báo giá + giao phần HN cho account (đi qua API thật để trạng thái đúng như production).
    const admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: adminU.username, password: PWD })).status).toBe(200);
    const r = await admin.post("/api/quotes").send({
      title: `${TAG} báo giá`, companyId, toCompany: "Khách thử", vatPercent: 8,
      sheets: [{ name: "Trang 1", order: 0, templateId, items: [{ kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10_000, order: 0 }] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    quoteId = r.body.id;
    sheetId = r.body.sheets[0].id;
    expect((await admin.post(`/api/quotes/${quoteId}/hn/assign`).send({ accountId: accU.id })).status).toBe(200);

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

  it("giả mạo paid/paidAt/paidById/paidProof → BỊ BỎ QUA, hàng vẫn CHƯA thanh toán", async () => {
    await datLaiBaoGia();
    const r = await guiHn([{
      kind: "item", rid: "r1", name: "Thuê xe HN", quantity: 1, unitPrice: 2000,
      paid: true, paidAt: "2020-01-01T00:00:00Z", paidById: adminU.id,
      paidProof: "data:image/png;base64,AAAA",
    }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const [t] = await hanoiTuDB();
    const row = t.items.find((x) => x.rid === "r1");
    expect(row.paid, "account HN KHÔNG có quote:internal:pay → không được đánh dấu đã trả").toBe(false);
    expect(row.paidAt).toBe(null);
    expect(row.paidById, "không được vu cho người khác đã trả").toBe(null);
    expect(row.paidProof, "ảnh chứng từ chỉ đi qua route /pay").toBe(null);
  });

  it("giả mạo approved/approvedAt/approvedBy → BỊ BỎ QUA", async () => {
    await datLaiBaoGia();
    const r = await guiHn([{
      kind: "item", rid: "r1", name: "Thuê xe HN", quantity: 1, unitPrice: 2000,
      approved: true, approvedAt: "2020-01-01T00:00:00Z", approvedBy: adminU.id,
    }]);
    expect(r.status).toBe(200);

    const row = (await hanoiTuDB())[0].items.find((x) => x.rid === "r1");
    expect(row.approved, "duyệt phần HN là quyền của quản lý (hnStatus), không phải cờ client đặt").toBe(false);
    expect(row.approvedAt).toBe(null);
    expect(row.approvedBy).toBe(null);
  });

  it("hàng ĐÃ trả trước đó KHÔNG bị account HN xoá cờ khi lưu", async () => {
    await datLaiBaoGia();
    // Kế toán (quyền internal:pay) đã đánh dấu r1 đã trả — ghi thẳng vào CSDL cho gọn.
    const tables = await prisma.quoteSheet.findFirst({ where: { id: sheetId }, select: { extraTables: true } });
    const daTra = tables.extraTables.map((t) =>
      t.category !== "hanoi" ? t : { ...t, items: t.items.map((it) => ({ ...it, paid: true, paidAt: "2026-08-01T00:00:00Z", paidById: adminU.id, paidProof: "data:image/png;base64,BBBB" })) }
    );
    await prisma.quoteSheet.update({ where: { id: sheetId }, data: { extraTables: daTra } });

    // Account sửa tên hàng rồi Lưu, gửi paid:false (client cũ không biết cờ này).
    const r = await guiHn([{ kind: "item", rid: "r1", name: "Thuê xe HN (sửa)", quantity: 1, unitPrice: 2000, paid: false }]);
    expect(r.status).toBe(200);

    const row = (await hanoiTuDB())[0].items.find((x) => x.rid === "r1");
    expect(row.paid, "cờ đã-trả phải GIỮ NGUYÊN theo CSDL").toBe(true);
    expect(row.paidAt).toBe("2026-08-01T00:00:00Z");
    expect(row.paidById).toBe(adminU.id);
    expect(row.paidProof, "ảnh phải còn").toBe("data:image/png;base64,BBBB");
    expect(row.name, "phần account ĐƯỢC sửa vẫn phải lưu").toBe("Thuê xe HN (sửa)");
  });

  it("việc account HN ĐƯỢC làm vẫn chạy: sửa giá/tên/thêm dòng, và KHÔNG đụng bảng hcm", async () => {
    await datLaiBaoGia();
    const r = await guiHn([
      { kind: "item", rid: "r1", name: "Thuê xe HN v2", quantity: 3, unitPrice: 5000 },
      { kind: "item", name: "Phát sinh HN", quantity: 1, unitPrice: 700 },
    ]);
    expect(r.status).toBe(200);

    const items = (await hanoiTuDB())[0].items;
    expect(items).toHaveLength(2);
    expect(items[0].name).toBe("Thuê xe HN v2");
    expect(items[0].quantity).toBe(3);
    expect(items[0].unitPrice).toBe(5000);
    expect(items[1].rid, "dòng mới phải được cấp rid").toBeTruthy();
    expect(items[1].paid, "dòng mới mặc định chưa trả").toBe(false);

    const s = await prisma.quoteSheet.findFirst({ where: { id: sheetId }, select: { extraTables: true } });
    const hcm = s.extraTables.find((t) => t.category === "hcm");
    expect(hcm, "bảng HCM KHÔNG được biến mất").toBeTruthy();
    expect(hcm.items[0].name).toBe("Thuê kho");
  });

  it("payload quá khổ → 400 (trước đây không có cap nào)", async () => {
    await datLaiBaoGia();
    const bang = (n) => ({ category: "hanoi", name: "B", templateId, items: Array.from({ length: n }, (_, i) => ({ kind: "item", name: `d${i}`, quantity: 1, unitPrice: 1 })) });

    const nhieuBang = await acc.put(`/api/quotes/${quoteId}/hn`).send({ hnSheets: [{ sheetId, hnTables: Array.from({ length: 21 }, () => bang(1)) }] });
    expect(nhieuBang.status, "21 bảng > cap 20").toBe(400);

    const nhieuDong = await acc.put(`/api/quotes/${quoteId}/hn`).send({ hnSheets: [{ sheetId, hnTables: [bang(1001)] }] });
    expect(nhieuDong.status, "1001 dòng > cap 1000").toBe(400);

    const anhKhungLo = await guiHn([{ kind: "item", rid: "r1", name: "x".repeat(2001), quantity: 1, unitPrice: 1 }]);
    expect(anhKhungLo.status, "tên 2001 ký tự > cap 2000").toBe(400);

    // Không lần nào trong ba lần trên được ghi xuống CSDL.
    const items = (await hanoiTuDB())[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Thuê xe HN");
  });

  it("hnSheets trỏ sang sheet của báo giá KHÁC → bỏ qua, không ghi lẫn", async () => {
    await datLaiBaoGia();
    const r = await acc.put(`/api/quotes/${quoteId}/hn`).send({
      hnSheets: [{ sheetId: sheetId + 999_999, hnTables: [{ category: "hanoi", name: "Lạ", templateId, items: [{ kind: "item", name: "chèn", quantity: 1, unitPrice: 1 }] }] }],
    });
    expect(r.status).toBe(200);
    const items = (await hanoiTuDB())[0].items;
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Thuê xe HN");
  });
});
