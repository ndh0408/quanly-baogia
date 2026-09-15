// "ACCOUNT PHỤ": người được CHỦ báo giá thêm vào làm cùng, có PHẠM VI sửa theo từng vùng.
//
// ── VÌ SAO CÓ TÍNH NĂNG NÀY ─────────────────────────────────────────────────
// Trước 2026-09-15 tư cách thành viên là MỘT BIT trên bảng nối ngầm `_QuoteMembers(A,B)`: ai được
// thêm vào là sửa được TOÀN BỘ báo giá — mọi hạng mục, mọi đơn giá, thông tin khách, và cả dòng
// "Người gửi" in ra Excel. Chủ dự án cần giao TỪNG PHẦN ("người này chỉ điền bảng Hà Nội") mà chỗ
// đựng điều đó không tồn tại. Nay `QuoteMember.scopes` giữ tập con của 4 vùng:
//   main (báo giá chính + thông tin khách) · hcm · hanoi · khach
// Hai khoá `hcm`/`khach` trùng tên `QuoteSheet.extraTables[].category` (bảng nội bộ theo TRANG);
// còn `hanoi` từ 2026-09-15 trỏ tới cột RIÊNG `Quote.hnTables` ở cấp báo giá — cùng một tên vùng,
// hai chỗ lưu khác nhau, nên đường ghi cũng khác (xem chotHnTables / ghiVungNoiBoDuocGiao).
//
// ── HAI LỚP, HAI KIỂU LỖI KHÁC NHAU ─────────────────────────────────────────
// 1. Có vùng "main" nhưng thiếu vài bảng nội bộ → payload VẪN xoá-tạo-lại sheet như thường, nên
//    phải LẤY LẠI bản CSDL cho những bảng ngoài phạm vi (`reconcilePhamViTables`). Thiếu bước này
//    thì client cũ (không round-trip `extraTables`) xoá trắng bảng của người khác, im lặng, 200.
// 2. KHÔNG có vùng "main" → đi hẳn đường của `saveHn`: KHÔNG đụng sheet, không tính lại tiền,
//    không bump `currentVersion`. Lý do ở `ghiVungNoiBoDuocGiao` (src/services/quoteService.ts).
//
// ── ĐIỀU DỄ HIỂU NHẦM NHẤT ──────────────────────────────────────────────────
// Membership KHÔNG tự cấp quyền: nhánh thành viên trong `canOnQuote` nằm BÊN TRONG
// `if (can(session, quote:<action>:own))`. Thêm một tài khoản hr/kế toán làm account phụ là
// VÔ TÁC DỤNG hoàn toàn im lặng — đó là chốt bảo mật cố ý (tests/security-regression.test.js),
// không phải thiếu sót. Giao diện nói trước bằng cờ `coTheLamPhu` của /quotes/assignable-users.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";
import { reconcilePhamViTables } from "../src/services/quoteService.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `tvphu${Date.now()}`;
const PWD = "Test1234!a";

// ── LỚP 1: hàm thuần, chạy được cả trên máy không có CSDL ───────────────────
describe("reconcilePhamViTables: bảng ngoài phạm vi phải lấy lại bản CSDL", () => {
  const banCSDL = () => [{
    extraTables: [
      { category: "hcm", name: "HCM gốc", items: [] },
      { category: "hanoi", name: "HN gốc", items: [] },
      { category: "khach", name: "Khách gốc", items: [] },
    ],
  }];

  it("chỉ được giao 'hanoi' → hcm/khach quay về bản CSDL, hanoi giữ nguyên bản người đó gõ", () => {
    const sheets = [{ extraTables: [
      { category: "hcm", name: "HCM BỊ SỬA", items: [] },
      { category: "hanoi", name: "HN vừa gõ", items: [] },
      { category: "khach", name: "Khách BỊ SỬA", items: [] },
    ] }];
    reconcilePhamViTables(sheets, banCSDL(), new Set(["hanoi"]));
    expect(sheets[0].extraTables.map((t) => t.name)).toEqual(["HCM gốc", "HN vừa gõ", "Khách gốc"]);
  });

  it("đủ 4 vùng (chủ báo giá) → không đụng gì", () => {
    const sheets = [{ extraTables: [{ category: "hcm", name: "HCM sửa", items: [] }] }];
    reconcilePhamViTables(sheets, banCSDL(), new Set(["hcm", "hanoi", "khach"]));
    expect(sheets[0].extraTables[0].name).toBe("HCM sửa");
  });

  it("client CŨ không gửi kèm bảng nào → bảng trong CSDL vẫn còn (không xoá trắng)", () => {
    const sheets = [{ extraTables: [] }];
    reconcilePhamViTables(sheets, banCSDL(), new Set(["hanoi"]));
    expect(sheets[0].extraTables.map((t) => t.name)).toEqual(["HCM gốc", "Khách gốc"]);
  });

  it("thêm bảng vào vùng KHÔNG được giao → 409 chứ không vứt im lặng", () => {
    const sheets = [{ extraTables: [
      { category: "hcm", name: "HCM gốc", items: [] },
      { category: "hcm", name: "HCM bảng bịa thêm", items: [] },
      { category: "hanoi", name: "HN gốc", items: [] },
      { category: "khach", name: "Khách gốc", items: [] },
    ] }];
    expect(() => reconcilePhamViTables(sheets, banCSDL(), new Set(["hanoi"]))).toThrowError(/Chi phí HCM/);
  });
});

// ── LỚP 2: đi qua HTTP thật, cần CSDL ───────────────────────────────────────
describe.runIf(dbAvailable)("PUT /api/quotes/:id/members + phạm vi khi account phụ bấm Lưu", () => {
  let app, chuU, phuU, companyId, templateId, quoteId;
  const PREFIX = `T${`${Date.now()}`.slice(-6)}`;

  const dangNhap = async (u) => {
    const a = agentWithCsrf(app);
    expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
    return a;
  };
  const datPhamVi = async (agent, members) =>
    agent.put(`/api/quotes/${quoteId}/members`).send({ members, memberIds: members.map((m) => m.userId) });
  const docBaoGia = async () => (await (await dangNhap(chuU)).get(`/api/quotes/${quoteId}`)).body;
  const bang = (q, cat) => (cat === "hanoi"
    ? (q.hnTables || [])[0]
    : (q.sheets[0].extraTables || []).find((t) => t.category === cat));

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const hash = await bcrypt.hash(PWD, 4);
    chuU = await prisma.user.create({ data: { username: `${TAG}-chu`, displayName: `${TAG} chu`, role: "admin", passwordHash: hash } });
    // Hồ sơ ĐÚNG của một "account phụ": đọc/sửa báo giá CỦA MÌNH + xuất file + gửi khách, nhưng
    // KHÔNG có quote:create (không tự mở báo giá riêng). `quote:send` cố ý có mặt: nó là thứ duy
    // nhất gác /mark-converted ở tầng route, nên nếu thiếu thì bài 403 bên dưới sẽ xanh vì lý do
    // SAI và không chứng minh được cổng mới có chạy hay không.
    phuU = await prisma.user.create({ data: {
      username: `${TAG}-phu`, displayName: `${TAG} phu`, role: "manager", passwordHash: hash,
      permissions: [P.QUOTE_READ_OWN, P.QUOTE_UPDATE_OWN, P.QUOTE_EXPORT, P.QUOTE_SEND],
    } });

    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: PREFIX } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;

    const chu = await dangNhap(chuU);
    const r = await chu.post("/api/quotes").send({
      title: `${TAG} báo giá`, companyId, toCompany: "Khách GỐC", fromContact: "Người gửi GỐC", vatPercent: 8,
      sheets: [{
        name: "Trang 1", order: 0, templateId,
        items: [{ kind: "item", name: "Màn LED GỐC", quantity: 1, unitPrice: 1000, order: 0 }],
        extraTables: [
          { category: "hcm", name: "HCM gốc", items: [{ kind: "item", name: "Thuê xe", quantity: 1, unitPrice: 500 }] },
          { category: "khach", name: "Khách gốc", items: [{ kind: "item", name: "Phí ship", quantity: 1, unitPrice: 300 }] },
        ],
      }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    quoteId = r.body.id;
    // Bảng Hà Nội ở CẤP BÁO GIÁ nên gieo qua đường lưu, không nhét vào sheet được nữa.
    const q0 = (await chu.get(`/api/quotes/${quoteId}`)).body;
    const seed = await chu.put(`/api/quotes/${quoteId}`).send({
      ...q0, baseUpdatedAt: q0.updatedAt,
      hnTables: [{ name: "HN gốc", items: [{ kind: "item", name: "Nhân công HN", quantity: 1, unitPrice: 700 }] }],
    });
    expect(seed.status, JSON.stringify(seed.body)).toBe(200);
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteCounter.deleteMany({ where: { prefix: PREFIX } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [chuU?.id, phuU?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: [chuU?.id, phuU?.id].filter(Boolean) } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("nền: chưa được thêm thì KHÔNG thấy báo giá của người khác", async () => {
    const phu = await dangNhap(phuU);
    // 403 chứ không phải 404: getQuote đọc được hàng rồi mới hỏi canOnQuote (chỉ báo giá ĐÃ XOÁ
    // MỀM mới ra 404). Danh sách thì lọc ở tầng WHERE nên báo giá không hề xuất hiện.
    expect((await phu.get(`/api/quotes/${quoteId}`)).status).toBe(403);
    expect((await phu.get("/api/quotes")).body.data.some((q) => q.id === quoteId)).toBe(false);
  });

  it("chỉ CHỦ báo giá (hoặc quản trị) sửa được danh sách account phụ", async () => {
    const phu = await dangNhap(phuU);
    expect((await datPhamVi(phu, [{ userId: phuU.id, scopes: ["main"] }])).status).toBe(403); // chưa được thêm
    const chu = await dangNhap(chuU);
    const r = await datPhamVi(chu, [{ userId: phuU.id, scopes: ["hanoi"] }]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const tv = r.body.members.find((m) => m.id === phuU.id);
    expect(tv.scopes).toEqual(["hanoi"]);
    // Người tạo LUÔN nằm trong danh sách và luôn đủ 4 vùng — không tick bớt được.
    expect(r.body.members.find((m) => m.id === chuU.id).scopes).toEqual(["main", "hcm", "hanoi", "khach"]);
    // Và account phụ vẫn KHÔNG được sửa danh sách, dù nay đã thấy báo giá.
    expect((await datPhamVi(await dangNhap(phuU), [])).status).toBe(403);
  });

  it("account phụ XEM ĐẦY ĐỦ báo giá (không lược gì) dù chỉ được giao một vùng", async () => {
    const phu = await dangNhap(phuU);
    const r = await phu.get(`/api/quotes/${quoteId}`);
    expect(r.status).toBe(200);
    expect(r.body.toCompany).toBe("Khách GỐC");
    expect(r.body.sheets[0].items[0].name).toBe("Màn LED GỐC");
    // Bảng theo TRANG nay chỉ còn hai loại; "hanoi" ở cột riêng cấp báo giá.
    expect((r.body.sheets[0].extraTables || []).map((t) => t.category).sort()).toEqual(["hcm", "khach"]);
    expect(Array.isArray(r.body.hnTables) && r.body.hnTables.length, "vẫn thấy đủ phần Hà Nội").toBeTruthy();
    expect((await phu.get("/api/quotes")).body.data.some((q) => q.id === quoteId)).toBe(true);
  });

  it("được giao 'hanoi' → Lưu chỉ đổi bảng Hà Nội; khách/người gửi/hạng mục/HCM/Phí KH KHÔNG đổi", async () => {
    const phu = await dangNhap(phuU);
    const truoc = await docBaoGia();
    const sheet = JSON.parse(JSON.stringify(truoc.sheets[0]));
    sheet.items[0].name = "Màn LED BỊ SỬA";
    sheet.items[0].unitPrice = 999999;
    for (const t of sheet.extraTables) t.name = `${t.category} BỊ SỬA`;
    const hnSua = JSON.parse(JSON.stringify(truoc.hnTables || []));
    hnSua[0].name = "hanoi BỊ SỬA";
    const r = await phu.put(`/api/quotes/${quoteId}`).send({
      ...truoc, toCompany: "Khách BỊ SỬA", fromContact: "Người gửi BỊ SỬA", vatPercent: 99,
      sheets: [sheet], hnTables: hnSua, baseUpdatedAt: truoc.updatedAt,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const sau = await docBaoGia();
    expect(sau.toCompany, "thông tin khách thuộc vùng main").toBe("Khách GỐC");
    expect(sau.fromContact, "'Người gửi' in ra Excel là danh tính của CHỦ").toBe("Người gửi GỐC");
    expect(Number(sau.vatPercent)).toBe(8);
    expect(sau.sheets[0].items[0].name).toBe("Màn LED GỐC");
    expect(Number(sau.sheets[0].items[0].unitPrice)).toBe(1000);
    expect(bang(sau, "hcm").name).toBe("HCM gốc");
    expect(bang(sau, "khach").name).toBe("Khách gốc");
    expect(bang(sau, "hanoi").name, "đúng vùng được giao thì PHẢI lưu được").toBe("hanoi BỊ SỬA");
    // Không đụng sheet → id trang giữ nguyên (đường saveHn, không xoá-tạo-lại).
    expect(sau.sheets[0].id).toBe(truoc.sheets[0].id);
    expect(sau.createdById, "báo giá vẫn của chủ").toBe(chuU.id);
  });

  it("account phụ KHÔNG nhân bản, KHÔNG chốt/huỷ deal — cả ba đều 403", async () => {
    const phu = await dangNhap(phuU);
    const nb = await phu.post(`/api/quotes/${quoteId}/duplicate`).send({});
    expect(nb.status, JSON.stringify(nb.body)).toBe(403);
    expect((await phu.post(`/api/quotes/${quoteId}/mark-converted`).send({})).status).toBe(403);
    expect((await phu.post(`/api/quotes/${quoteId}/mark-lost`).send({ reason: "thử" })).status).toBe(403);
    expect((await docBaoGia()).status).toBe("draft");
  });

  it("không tick vùng nào = CHỈ XEM: đọc được, Lưu thì 403", async () => {
    expect((await datPhamVi(await dangNhap(chuU), [{ userId: phuU.id, scopes: [] }])).status).toBe(200);
    const phu = await dangNhap(phuU);
    const q = await phu.get(`/api/quotes/${quoteId}`);
    expect(q.status).toBe(200);
    expect((await phu.put(`/api/quotes/${quoteId}`).send({ ...q.body, toCompany: "X", baseUpdatedAt: q.body.updatedAt })).status).toBe(403);
  });

  it("client CŨ gửi `memberIds` cho người MỚI → đủ 4 vùng, đúng hành vi trước đây", async () => {
    const chu = await dangNhap(chuU);
    expect((await datPhamVi(chu, [])).status).toBe(200);   // gỡ hẳn: lượt sau mới là "thêm MỚI"
    const r = await chu.put(`/api/quotes/${quoteId}/members`).send({ memberIds: [phuU.id] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.members.find((m) => m.id === phuU.id).scopes).toEqual(["main", "hcm", "hanoi", "khach"]);

    const phu = await dangNhap(phuU);
    const truoc = await docBaoGia();
    const ok = await phu.put(`/api/quotes/${quoteId}`).send({ ...truoc, toCompany: "Khách ĐỔI ĐƯỢC", baseUpdatedAt: truoc.updatedAt });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await docBaoGia()).toCompany).toBe("Khách ĐỔI ĐƯỢC");
  });

  // ── Hai lỗ do chính bản vá này đẻ ra, tìm thấy ở vòng soi đối kháng 2026-09-15 ──────────────
  it("giá Hà Nội ĐÃ DUYỆT: account phụ vùng 'hanoi' KHÔNG ghi đè được", async () => {
    // Bỏ vùng "main" khỏi phạm vi từng NỚI quyền: đường lưu riêng của account phụ
    // (ghiVungNoiBoDuocGiao) thiếu chốt reconcileHanoiTables mà nhánh có "main" vẫn gọi — nên
    // người CHỈ được giao bảng Hà Nội lại sửa được đúng phần giá đã chốt.
    await prisma.quote.update({ where: { id: quoteId }, data: { hnStatus: "approved" } });
    expect((await datPhamVi(await dangNhap(chuU), [{ userId: phuU.id, scopes: ["hanoi"] }])).status).toBe(200);

    const truoc = await docBaoGia();
    const tenHnCu = bang(truoc, "hanoi").name;
    const hnSua = JSON.parse(JSON.stringify(truoc.hnTables || []));
    hnSua[0].name = "HN GHI ĐÈ SAU KHI DUYỆT";
    const phu = await dangNhap(phuU);
    const r = await phu.put(`/api/quotes/${quoteId}`).send({ ...truoc, hnTables: hnSua, baseUpdatedAt: truoc.updatedAt });
    // Nay chặn THẲNG bằng 409 thay vì âm thầm lấy lại bản CSDL: người ta vừa gõ, im lặng bỏ đi là
    // kiểu mất dữ liệu tệ nhất (xem chotHnTables).
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(bang(await docBaoGia(), "hanoi").name, "giá HN đã duyệt phải giữ nguyên").toBe(tenHnCu);

    await prisma.quote.update({ where: { id: quoteId }, data: { hnStatus: null } });
  });

  it("account phụ KHÔNG xoá/thêm được TRANG (xoá trang là cuốn theo bảng nội bộ ngoài phạm vi)", async () => {
    // Người chỉ có vùng "main" bấm ✕ xoá trang: lưu = deleteMany rồi tạo lại, nên trang biến mất
    // kéo theo cả bảng hcm/hanoi/khach của trang đó — gồm hàng đã duyệt, đã trả và ảnh chứng từ —
    // mà reconcilePhamViTables không cứu được (nó ghép theo VỊ TRÍ).
    const chu = await dangNhap(chuU);
    expect((await datPhamVi(chu, [{ userId: phuU.id, scopes: ["main"] }])).status).toBe(200);

    // CHỦ thêm trang thứ hai (payload rỗng thì zod chặn trước ở "phải có ít nhất 1 trang", không
    // chứng minh được gì về phạm vi) — trang này mang một bảng nội bộ để thấy rõ cái sẽ mất.
    const q0 = await docBaoGia();
    const themCuaChu = await chu.put(`/api/quotes/${quoteId}`).send({
      ...q0,
      sheets: [...q0.sheets, {
        name: "Trang 2", order: 2, templateId, items: [{ kind: "item", name: "Hạng mục T2", quantity: 1, unitPrice: 100, order: 0 }],
        extraTables: [{ category: "hcm", name: "HCM trang 2", items: [{ kind: "item", name: "Xe T2", quantity: 1, unitPrice: 50 }] }],
      }],
      baseUpdatedAt: q0.updatedAt,
    });
    expect(themCuaChu.status, JSON.stringify(themCuaChu.body)).toBe(200);

    const truoc = await docBaoGia();
    expect(truoc.sheets.length).toBe(2);

    const phu = await dangNhap(phuU);
    const xoaTrang = await phu.put(`/api/quotes/${quoteId}`).send({ ...truoc, sheets: [truoc.sheets[0]], baseUpdatedAt: truoc.updatedAt });
    expect(xoaTrang.status, JSON.stringify(xoaTrang.body)).toBe(409);

    const themTrang = await phu.put(`/api/quotes/${quoteId}`).send({
      ...truoc,
      sheets: [...truoc.sheets, { name: "Trang bịa", order: 9, templateId, items: [], extraTables: [] }],
      baseUpdatedAt: truoc.updatedAt,
    });
    expect(themTrang.status, JSON.stringify(themTrang.body)).toBe(409);

    const sau = await docBaoGia();
    expect(sau.sheets.length, "hai trang còn nguyên").toBe(2);
    expect((sau.sheets[1].extraTables || []).find((t) => t.category === "hcm")?.name).toBe("HCM trang 2");
  });

  it("ý kiến khách theo trang là dữ liệu vùng 'main' — account phụ vùng 'hanoi' bị 403", async () => {
    const chu = await dangNhap(chuU);
    expect((await datPhamVi(chu, [{ userId: phuU.id, scopes: ["hanoi"] }])).status).toBe(200);
    const q = await docBaoGia();
    const phu = await dangNhap(phuU);
    const r = await phu.post(`/api/quotes/sheets/${q.sheets[0].id}/customer-decision`).send({ status: "rejected", note: "thử" });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
  });

  it("giao/duyệt phần Hà Nội là việc của chủ báo giá — account phụ 403", async () => {
    const phu = await dangNhap(phuU);
    const r = await phu.post(`/api/quotes/${quoteId}/hn/assign`).send({ accountId: chuU.id });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
  });

  it("client CŨ gửi memberIds KHÔNG âm thầm nới phạm vi người đang có", async () => {
    const chu = await dangNhap(chuU);
    expect((await datPhamVi(chu, [{ userId: phuU.id, scopes: ["hanoi"] }])).status).toBe(200);
    // Một tab đang chạy bundle cũ bấm Lưu: nó chỉ biết danh sách NGƯỜI, không biết phạm vi.
    const r = await chu.put(`/api/quotes/${quoteId}/members`).send({ memberIds: [phuU.id] });
    expect(r.status).toBe(200);
    expect(r.body.members.find((m) => m.id === phuU.id).scopes, "giữ nguyên phần đã tick").toEqual(["hanoi"]);
  });

  it("thêm tài khoản không tồn tại / đã khoá → 400 nói rõ, không phải 404 'không tìm thấy bản ghi'", async () => {
    const chu = await dangNhap(chuU);
    const r = await datPhamVi(chu, [{ userId: 2147483600, scopes: ["main"] }]);
    expect(r.status).toBe(400);
    expect(String(r.body.error || r.body.message || "")).toMatch(/không tồn tại|đã bị khoá/i);
  });
});
