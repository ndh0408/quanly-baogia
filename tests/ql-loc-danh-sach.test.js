// BỘ LỌC ĐẦY ĐỦ + TÌM KIẾM THÔNG MINH của DANH SÁCH BÁO GIÁ (chủ repo 2026-09-30: "bộ lọc cũng chưa đầy đủ … và
// bộ lọc trên kia cũng chưa đầy đủ và thông minh"). Trước đó chỉ có: một ô tìm (MỘT chuỗi con, đúng thứ tự, chỉ
// trên mã/tiêu đề/khách gõ tay), một ô trạng thái, và sắp xếp ở 4 cột.
//
// Bài này khoá ba thứ dễ vỡ âm thầm:
//   · TÌM THÔNG MINH = mọi từ khoá phải khớp (AND), mỗi từ khớp ở BẤT KỲ nơi nào trong: mã/tiêu đề/khách gõ tay,
//     khách TRONG DANH MỤC (mã, tên, SĐT…), người tạo, công ty, ghi chú dòng — không dấu, không cần đúng thứ tự;
//   · bộ lọc có cấu trúc (trạng thái nhiều, người tạo, công ty, ngày, tiền, ghi chú/màu) KẾT HỢP AND với nhau và với
//     phạm vi quyền; sắp xếp mọi cột có thứ tự ổn định khi phân trang;
//   · VIEW BỊ LƯỢC (account HN / tài khoản chi phí) KHÔNG được tìm/lọc xuyên qua trường họ bị giấu (khách danh mục,
//     tổng tiền, ghi chú): lọc theo thứ họ không thấy là cách đọc trộm thứ đó bằng cách dò.
// Và số đếm (facets) cho từng nhóm lọc: đếm theo MỌI bộ lọc KHÁC (trừ chính nhóm đó) — nếu không, bấm "Đã chốt" là
// các nhóm còn lại đếm sai và người dùng không biết lọc thêm sẽ ra bao nhiêu.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { agentWithCsrf } from "./helpers/agent.js";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";
import { PERMISSIONS as P } from "../src/permissions.js";
import { tachTuKhoa, docBoLoc, locTheoChieu, orderByTheoCot, tieuDeHienThi, sapIdTheoTieuDe, TRANG_THAI_BAO_GIA, COT_SAP_XEP } from "../src/quoteListFilter.js";
import { QUOTE_STATUSES } from "../src/validators.js";
import { normalizeSearch } from "../src/searchText.js";

// ═════════ THUẦN ═════════
describe("hằng số khớp schema", () => {
  it("TRANG_THAI_BAO_GIA (module lọc) = QUOTE_STATUSES (validators) — không import chéo vì vòng, nên khoá ở đây", () => {
    expect([...TRANG_THAI_BAO_GIA]).toEqual(QUOTE_STATUSES);
  });
  it("COT_SAP_XEP có đủ bốn cột cũ trước các cột mới (link/dấu trang cũ còn chạy)", () => {
    expect(COT_SAP_XEP.slice(0, 4)).toEqual(["createdAt", "quoteDate", "total", "quoteNumber"]);
  });
});

describe("tachTuKhoa", () => {
  it("bỏ dấu, thường hoá, tách từ, bỏ trùng, giữ thứ tự xuất hiện", () => {
    expect(tachTuKhoa("  Nguyễn  Đức  nguyen ")).toEqual(["nguyen", "duc"]);
    expect(tachTuKhoa("Sao-Mai, 26001!")).toEqual(["sao", "mai", "26001"]);
  });
  it("rỗng / chỉ ký tự lạ → []; quá 8 từ → cắt 8; mỗi từ tối đa 40 ký tự", () => {
    expect(tachTuKhoa("")).toEqual([]);
    expect(tachTuKhoa("   !!! ")).toEqual([]);
    expect(tachTuKhoa("a b c d e f g h i j")).toHaveLength(8);
    expect(tachTuKhoa("x".repeat(100))[0]).toHaveLength(40);
  });
});

describe("docBoLoc (đọc query đã qua zod, chịu cả mảng lặp khoá và chuỗi phẩy)", () => {
  it("status/company/creator/noteColor: chuỗi phẩy HOẶC khoá lặp → mảng, bỏ rỗng và trùng", () => {
    const b = docBoLoc({ status: "draft,converted", companyId: ["1", "2,3"], creator: "7", noteColor: "red,blue,red" });
    expect(b.status).toEqual(["draft", "converted"]);
    expect(b.companyIds).toEqual([1, 2, 3]);
    expect(b.creatorIds).toEqual([7]);
    expect(b.noteColors).toEqual(["red", "blue"]);
  });
  it("tiền + ngày + ghi chú", () => {
    const b = docBoLoc({ minTotal: "1000000", maxTotal: 5e9, from: new Date("2026-09-01"), to: new Date("2026-09-30"), note: "has" });
    expect(b).toMatchObject({ minTotal: 1000000, maxTotal: 5e9, note: "has" });
    expect(b.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
  it("rác → bỏ qua chứ không ném (route đã validate; đây là lớp phòng thủ cuối)", () => {
    const b = docBoLoc({ status: "x,draft", companyId: "abc,4", noteColor: "hotpink,red", note: "zzz", minTotal: "abc" });
    expect(b.status).toEqual(["draft"]);
    expect(b.companyIds).toEqual([4]);
    expect(b.noteColors).toEqual(["red"]);
    expect(b.note).toBeUndefined();
    expect(b.minTotal).toBeUndefined();
  });
});

describe("locTheoChieu — mỗi chiều một điều kiện riêng để đếm facets bỏ được CHÍNH nó", () => {
  const ctx = { nguoi: [{ id: 1, ten: "nguyen van a" }, { id: 2, ten: "tran thi b" }], congTy: [{ id: 9, ten: "gia nguyen gn" }], bienLuoc: false };
  it("không lọc gì → mọi chiều null", () => {
    expect(Object.values(locTheoChieu({}, ctx)).every((v) => v === null)).toBe(true);
  });
  it("từng chiều có mặt đúng khi được yêu cầu", () => {
    const p = locTheoChieu({ q: "mai", status: ["draft"], companyIds: [9], creatorIds: [1], from: new Date("2026-09-01"), minTotal: 5, note: "has" }, ctx);
    for (const k of ["q", "status", "company", "creator", "date", "total", "note"]) expect(p[k], k).not.toBeNull();
    expect(locTheoChieu({ status: ["draft"] }, ctx).creator).toBeNull();
  });
  it("tìm thông minh: mỗi từ là một OR; tên người/công ty khớp được giải ra id", () => {
    const { q } = locTheoChieu({ q: "nguyen mai" }, ctx);
    expect(q.AND).toHaveLength(2);
    const hinh = JSON.stringify(q.AND[0]);
    expect(hinh).toContain('"createdById":{"in":[1]}');     // "nguyen" khớp người tạo #1
    expect(hinh).toContain('"companyId":{"in":[9]}');       // …và công ty #9
    expect(hinh).toContain("searchText");                   // …và chữ trên báo giá / khách / ghi chú
    expect(JSON.stringify(q.AND[1])).not.toContain("createdById");   // "mai" không khớp ai
  });
  it("VIEW LƯỢC: q giữ NGUYÊN cách cũ (một chuỗi con trên searchText), mọi bộ lọc chạm trường bị giấu bị BỎ", () => {
    const p = locTheoChieu({ q: "sao mai", creatorIds: [1], minTotal: 5, maxTotal: 9, note: "has", noteColors: ["red"], status: ["draft"], companyIds: [9], from: new Date("2026-09-01") }, { ...ctx, bienLuoc: true });
    expect(p.q).toEqual({ searchText: { contains: "sao mai" } });
    expect(p.creator).toBeNull();
    expect(p.total).toBeNull();
    expect(p.note).toBeNull();
    expect(p.status).not.toBeNull();   // trạng thái / công ty / ngày đã có từ trước cho mọi người
    expect(p.company).not.toBeNull();
    expect(p.date).not.toBeNull();
  });
  it("q chỉ ký tự lạ → không khớp gì (như cũ), KHÔNG nuốt cả danh sách", () => {
    expect(JSON.stringify(locTheoChieu({ q: "!!!" }, ctx).q)).toContain("~no~match~");
  });
});

describe("orderByTheoCot", () => {
  it("bốn cột cũ: một khoá như cũ (không đổi kế hoạch truy vấn đường nóng)", () => {
    for (const c of ["createdAt", "quoteDate", "total", "quoteNumber"]) expect(orderByTheoCot(c, "desc")).toEqual({ [c]: "desc" });
  });
  it("cột mới: khoá quan hệ đúng + id làm khoá phụ (trang không trùng/sót dòng khi nhiều dòng bằng nhau)", () => {
    expect(orderByTheoCot("company", "asc")).toEqual([{ company: { name: "asc" } }, { id: "desc" }]);
    expect(orderByTheoCot("creator", "desc")).toEqual([{ createdBy: { displayName: "desc" } }, { id: "desc" }]);
    expect(orderByTheoCot("customerCode", "asc")).toEqual([{ customer: { code: "asc" } }, { id: "desc" }]);
    expect(orderByTheoCot("status", "asc")).toEqual([{ status: "asc" }, { id: "desc" }]);
    expect(orderByTheoCot("toCompany", "asc")).toEqual([{ toCompany: "asc" }, { id: "desc" }]);
  });
  it("cột lạ → lùi về createdAt (không ném)", () => {
    expect(orderByTheoCot("khong-co", "asc")).toEqual({ createdAt: "asc" });
  });
  it("'title' KHÔNG do SQL sắp (lùi về createdAt): cột Tiêu đề sắp theo chữ ô HIỆN — xem sapIdTheoTieuDe. Ai thêm lại nhánh title ở đây sẽ làm dòng có tiêu đề rút gọn nằm sai chỗ", () => {
    expect(orderByTheoCot("title", "asc")).toEqual({ createdAt: "asc" });
    expect(COT_SAP_XEP).toContain("title");   // nhưng vẫn là cột sắp xếp HỢP LỆ (validators) — do quoteService xử lý riêng
  });
});

describe("tieuDeHienThi + sapIdTheoTieuDe — cột Tiêu đề sắp theo CHỮ Ô HIỆN, không theo cột gốc", () => {
  it("tieuDeHienThi: tiêu đề rút gọn thắng; không có thì cắt tiền tố 'Bảng báo giá –' (mọi kiểu gạch); rỗng thì giữ nguyên", () => {
    expect(tieuDeHienThi({ title: "BẢNG BÁO GIÁ - Zoo", shortTitle: "  Alpha " })).toBe("Alpha");
    expect(tieuDeHienThi({ title: "BẢNG BÁO GIÁ - Zoo", shortTitle: "   " })).toBe("Zoo");
    expect(tieuDeHienThi({ title: "Bảng báo giá – Sao Mai", shortTitle: null })).toBe("Sao Mai");
    expect(tieuDeHienThi({ title: "bảng  báo  giá : X" })).toBe("X");
    expect(tieuDeHienThi({ title: "Bảng báo giá" }), "chỉ có tiền tố thì giữ nguyên thay vì ra chuỗi rỗng").toBe("Bảng báo giá");
    expect(tieuDeHienThi({})).toBe("");
  });
  it("khớp hàm cùng tên của web (hai nơi phải luôn cho cùng chữ): CÙNG bộ ca với web/src/lib/format.tieuDe.test.ts", () => {
    // Web là gói riêng, không import được từ đây → khoá hai bản bằng MỘT bộ ca chép ở cả hai bài. Sửa bộ ca thì sửa cả hai.
    const ca = [["BẢNG BÁO GIÁ - A", null, "A"], ["Bảng báo giá | B", "", "B"], ["C", "  c rút gọn ", "c rút gọn"], ["BẢNG BÁO GIÁ — D", undefined, "D"]];
    for (const [title, shortTitle, ra] of ca) expect(tieuDeHienThi({ title, shortTitle })).toBe(ra);
  });
  it("sắp theo CHỮ HIỆN: dòng có tiêu đề rút gọn đứng theo RÚT GỌN; dòng có tiền tố đứng theo phần SAU tiền tố", () => {
    const ds = [
      { id: 1, title: "Khai trương", shortTitle: null },
      { id: 2, title: "BẢNG BÁO GIÁ - Zoo", shortTitle: null },        // hiện "Zoo"
      { id: 3, title: "Zebra events", shortTitle: "Alpha" },            // hiện "Alpha"
      { id: 4, title: "Activation", shortTitle: null },
    ];
    expect(sapIdTheoTieuDe(ds, "asc")).toEqual([4, 3, 1, 2]);   // Activation < Alpha < Khai < Zoo
    expect(sapIdTheoTieuDe(ds, "desc")).toEqual([2, 1, 3, 4]);
  });
  it("thứ tự tiếng Việt (dấu, đ) và số TỰ NHIÊN; bằng nhau → id MỚI trước", () => {
    const t = (...ten) => ten.map((title, i) => ({ id: i + 1, title }));
    const theo = (ten, order = "asc") => sapIdTheoTieuDe(t(...ten), order).map((i) => ten[i - 1]);
    // Chữ cái GỐC quyết định trước, dấu chỉ là tiêu chí phụ: "Sáng" (sang) đứng trước "Sao" (sao) vì n < o, dù á có dấu.
    expect(theo(["Sự kiện", "Standee", "Sao Mai", "Sáng tạo"])).toEqual(["Sáng tạo", "Sao Mai", "Standee", "Sự kiện"]);
    expect(theo(["Sáo", "Sao", "Sa"]), "cùng chữ gốc thì không dấu đứng trước có dấu").toEqual(["Sa", "Sao", "Sáo"]);
    expect(theo(["Đông", "Dương", "Em"]), "đ đứng ngay SAU d, trước e").toEqual(["Dương", "Đông", "Em"]);
    expect(sapIdTheoTieuDe(t("Sự kiện 10", "Sự kiện 2", "Sự kiện 1"), "asc")).toEqual([3, 2, 1]);
    expect(sapIdTheoTieuDe([{ id: 5, title: "Giống" }, { id: 9, title: "Giống" }, { id: 7, title: "Giống" }], "asc"), "bằng nhau: id giảm dần, cả hai chiều").toEqual([9, 7, 5]);
    expect(sapIdTheoTieuDe([{ id: 5, title: "Giống" }, { id: 9, title: "Giống" }], "desc")).toEqual([9, 5]);
  });
});

// ═════════ TÍCH HỢP ═════════
const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kiểm tra được Postgres");

const TAG = `qlloc${Date.now()}`;
const PWD = "Test1234!a";

describe.runIf(dbAvailable)("GET /api/quotes — lọc + tìm thông minh + sắp xếp + facets", () => {
  let app, admin, nguyenA, tranB, hn, chiPhi, coA, coB, tplId, kh1, kh2;
  let q1, q2, q3, q4, q5;
  const dangNhap = async (u) => { const a = agentWithCsrf(app); expect((await a.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200); return a; };
  const user = (ten, ten2, role, permissions) => bcrypt.hash(PWD, 4).then((passwordHash) => prisma.user.create({ data: { username: `${TAG}-${ten}`, displayName: ten2, role, passwordHash, ...(permissions ? { permissions } : {}) } }));
  const bg = (ten, o) => prisma.quote.create({ data: {
    quoteNumber: `${TAG}-${ten}`, projectCode: `${TAG}_${ten}`, title: o.title, shortTitle: o.rutGon, searchText: normalizeSearch(`${TAG}-${ten}`, `${TAG}_${ten}`, o.title, o.toCompany), toCompany: o.toCompany,
    companyId: o.co, fromContact: "x", fromAddress: "x", city: "TP. Hồ Chí Minh", quoteDate: new Date(o.ngay), createdById: o.by, status: o.st, total: o.total, subtotal: o.total,
    ...(o.kh ? { customerId: o.kh } : {}), sheets: { create: [{ templateId: tplId, order: 1, name: "T1", extraTables: [] }] }, ...(o.members ? { members: { create: o.members } } : {}),
  } });
  const ghiChu = (quoteId, note, color) => prisma.quoteListNote.create({ data: { quoteId, note, searchText: normalizeSearch(note), color } });
  const ds = async (agent, qs) => { const r = await agent.get(`/api/quotes?${qs}&size=50`); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.data.filter((x) => String(x.projectCode).startsWith(TAG)).map((x) => x.projectCode.slice(TAG.length + 1)); };
  const ra = (...t) => t.sort();

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    admin = await user("admin", `${TAG} Admin`, "admin");
    nguyenA = await user("nga", "Nguyễn Văn Ánh", "manager");
    tranB = await user("trb", "Trần Thị Bình", "manager");
    hn = await user("hn", "Hà Nội Account", "account_hn");
    chiPhi = await user("cp", "Chi Phí Account", "hr", [P.QUOTE_READ_OWN, P.QUOTE_INTERNAL_VIEW]);
    coA = (await prisma.company.create({ data: { code: `${TAG}A`, name: "Gia Nguyễn", shortName: "GN", address: "1", quotePrefix: `L${`${Date.now()}`.slice(-5)}A` } })).id;
    coB = (await prisma.company.create({ data: { code: `${TAG}B`, name: "Colorfull Decor", shortName: "CLF", address: "2", quotePrefix: `L${`${Date.now()}`.slice(-5)}B` } })).id;
    tplId = (await prisma.quoteTemplate.create({ data: { companyId: coA, name: "Mẫu", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" } })).id;
    kh1 = (await prisma.customer.create({ data: { code: `${TAG}KH1`, name: "Công ty Sao Mai", phone: "0901234567", searchText: normalizeSearch("Công ty Sao Mai", `${TAG}KH1`, "0901234567") } })).id;
    kh2 = (await prisma.customer.create({ data: { code: `${TAG}KH2`, name: "Bí Mật Holdings", searchText: normalizeSearch("Bí Mật Holdings", `${TAG}KH2`) } })).id;
    //            mã    tiêu đề                   khách gõ tay        ngày          người tạo  cty  trạng thái   tổng
    q1 = await bg("q1", { title: "Khai trương cửa hàng", toCompany: "Khách Một", ngay: "2026-09-01", by: nguyenA.id, co: coA, st: "draft", total: 100_000_000, kh: kh1 });
    q2 = await bg("q2", { title: "Sự kiện tri ân", toCompany: "Ngân hàng ABC", ngay: "2026-09-10", by: tranB.id, co: coB, st: "converted", total: 250_000_000, kh: kh2, members: [{ userId: hn.id, scopes: ["hanoi"] }, { userId: chiPhi.id, scopes: [] }] });
    // q3: tiêu đề mang tiền tố → ô danh sách hiện "Zoo họp báo" (đứng CUỐI khi sắp A→Z, dù cột gốc bắt đầu bằng "BẢNG…").
    q3 = await bg("q3", { title: "BẢNG BÁO GIÁ - Zoo họp báo", toCompany: "Vinamilk", ngay: "2026-08-20", by: nguyenA.id, co: coA, st: "lost", total: 35_000_000 });
    q4 = await bg("q4", { title: "Activation siêu thị", toCompany: "Masan", ngay: "2026-09-25", by: tranB.id, co: coA, st: "draft", total: 1_500_000_000 });
    // q5: có tiêu đề RÚT GỌN → ô hiện "Alpha hè" (đứng thứ hai), dù tiêu đề chính "Standee…" sẽ đứng gần cuối nếu sắp theo cột gốc.
    q5 = await bg("q5", { title: "Standee mùa hè", rutGon: "Alpha hè", toCompany: "Pepsi", ngay: "2026-09-05", by: nguyenA.id, co: coB, st: "converted", total: 18_000_000 });
    await ghiChu(q1.id, "Chờ khách duyệt bản hai", "red");
    await ghiChu(q2.id, "Gọi lại thứ Hai", "blue");
    await ghiChu(q4.id, "", "purple");
    await prisma.quote.updateMany({ where: { id: { in: [q1.id, q2.id, q3.id, q4.id, q5.id] } }, data: {} });
  });
  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { in: ["Khai trương cửa hàng", "Sự kiện tri ân", "BẢNG BÁO GIÁ - Zoo họp báo", "Activation siêu thị", "Standee mùa hè"] }, projectCode: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    const ids = [admin, nguyenA, tranB, hn, chiPhi].filter(Boolean).map((u) => u.id);
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  // ── TÌM THÔNG MINH ────────────────────────────────────────────────────────────────────────────────
  it("nhiều từ KHÔNG cần đúng thứ tự và KHÔNG dấu: 'mai sao' ra khách danh mục Sao Mai", async () => {
    const a = await dangNhap(admin);
    expect(await ds(a, `q=${encodeURIComponent(`${TAG} mai sao`)}`), "q1 chỉ có 'Sao Mai' ở khách TRONG DANH MỤC (toCompany là 'Khách Một')").toEqual(["q1"]);
  });
  it("khớp theo MÃ khách danh mục, SĐT khách, người tạo (không dấu), công ty, và chữ trong GHI CHÚ", async () => {
    const a = await dangNhap(admin);
    expect(await ds(a, `q=${TAG}kh2`.toLowerCase())).toEqual(["q2"]);                   // mã khách
    expect(await ds(a, `q=0901234567`)).toContain("q1");                                  // SĐT khách danh mục
    expect(ra(...await ds(a, `q=nguyen+anh`))).toEqual(ra("q1", "q3", "q5"));             // người tạo "Nguyễn Văn Ánh" (cũng là "Gia Nguyễn"? không: 'anh' chỉ ở người tạo)
    expect(ra(...await ds(a, `q=colorfull`))).toEqual(ra("q2", "q5"));                    // tên công ty
    expect(await ds(a, `q=goi+lai+thu+hai`)).toEqual(["q2"]);                             // ghi chú, không dấu, nhiều từ
    expect(await ds(a, `q=cho+khach+duyet`)).toEqual(["q1"]);
  });
  it("mọi từ phải khớp (AND): thêm một từ không liên quan → 0 kết quả", async () => {
    const a = await dangNhap(admin);
    expect(await ds(a, `q=${encodeURIComponent(`${TAG} mai zzzkhongco`)}`)).toEqual([]);
  });
  it("cách tìm cũ vẫn chạy: một cụm liền ('khai truong') vẫn ra đúng báo giá", async () => {
    const a = await dangNhap(admin);
    expect(await ds(a, `q=khai+truong`)).toEqual(["q1"]);
  });

  // ── BỘ LỌC CÓ CẤU TRÚC ────────────────────────────────────────────────────────────────────────────
  it("trạng thái NHIỀU (phẩy) và một (như cũ)", async () => {
    const a = await dangNhap(admin);
    expect(ra(...await ds(a, `q=${TAG}&status=draft,lost`))).toEqual(ra("q1", "q3", "q4"));
    expect(ra(...await ds(a, `q=${TAG}&status=converted`))).toEqual(ra("q2", "q5"));
  });
  it("người tạo nhiều; công ty nhiều/một (companyId cũ vẫn chạy)", async () => {
    const a = await dangNhap(admin);
    expect(ra(...await ds(a, `q=${TAG}&creator=${tranB.id}`))).toEqual(ra("q2", "q4"));
    expect(ra(...await ds(a, `q=${TAG}&creator=${tranB.id},${nguyenA.id}`))).toEqual(ra("q1", "q2", "q3", "q4", "q5"));
    expect(ra(...await ds(a, `q=${TAG}&companyId=${coB}`))).toEqual(ra("q2", "q5"));
    expect(ra(...await ds(a, `q=${TAG}&companyId=${coA},${coB}`))).toHaveLength(5);
  });
  it("khoảng ngày (gồm cả hai đầu) và khoảng tiền", async () => {
    const a = await dangNhap(admin);
    expect(ra(...await ds(a, `q=${TAG}&from=2026-09-01&to=2026-09-10`))).toEqual(ra("q1", "q2", "q5"));
    expect(ra(...await ds(a, `q=${TAG}&minTotal=100000000&maxTotal=250000000`))).toEqual(ra("q1", "q2"));
    expect(await ds(a, `q=${TAG}&minTotal=1000000000`)).toEqual(["q4"]);
    expect(ra(...await ds(a, `q=${TAG}&maxTotal=35000000`))).toEqual(ra("q3", "q5"));
  });
  it("ghi chú: có / chưa có / theo MÀU (gồm ca chỉ có màu, chữ rỗng)", async () => {
    const a = await dangNhap(admin);
    expect(ra(...await ds(a, `q=${TAG}&note=has`))).toEqual(ra("q1", "q2", "q4"));
    expect(ra(...await ds(a, `q=${TAG}&note=none`))).toEqual(ra("q3", "q5"));
    expect(await ds(a, `q=${TAG}&noteColor=purple`)).toEqual(["q4"]);
    expect(ra(...await ds(a, `q=${TAG}&noteColor=red,blue`))).toEqual(ra("q1", "q2"));
  });
  it("các nhóm KẾT HỢP AND với nhau", async () => {
    const a = await dangNhap(admin);
    expect(await ds(a, `q=${TAG}&status=draft&creator=${nguyenA.id}&note=has`)).toEqual(["q1"]);
    expect(await ds(a, `q=${TAG}&status=converted&companyId=${coA}`)).toEqual([]);
    expect(await ds(a, `q=${TAG}&status=converted&minTotal=200000000&noteColor=blue`)).toEqual(["q2"]);
  });
  it("đầu vào xấu → 400: trạng thái lạ, công ty không phải số, màu ngoài bảng, note lạ, tiền âm, cột sắp xếp lạ", async () => {
    const a = await dangNhap(admin);
    for (const qs of ["status=xyz", "companyId=abc", "creator=1,x", "noteColor=hotpink", "note=maybe", "minTotal=-5", "maxTotal=abc", "sort=password", "from=khong-phai-ngay"]) {
      expect((await a.get(`/api/quotes?${qs}`)).status, qs).toBe(400);
    }
  });

  // ── SẮP XẾP MỌI CỘT ───────────────────────────────────────────────────────────────────────────────
  // id GIẢM DẦN làm khoá phụ → thứ tự xác định hoàn toàn (q5 tạo sau cùng nên đứng trước q2 khi bằng nhau).
  it("sắp xếp theo từng cột mới, cả hai chiều, thứ tự XÁC ĐỊNH nhờ khoá phụ id", async () => {
    const a = await dangNhap(admin);
    const theo = (sort, order) => ds(a, `q=${TAG}&sort=${sort}&order=${order}`);
    // TIÊU ĐỀ sắp theo CHỮ Ô HIỆN: Activation (q4) < Alpha hè (q5, tiêu đề RÚT GỌN) < Khai (q1) < Sự kiện (q2) < Zoo họp báo (q3, đã cắt
    // tiền tố "BẢNG BÁO GIÁ -"). Sắp theo cột gốc sẽ ra q4,q3,q1,q5,q2 — đỏ ngay.
    expect(await theo("title", "asc")).toEqual(["q4", "q5", "q1", "q2", "q3"]);
    expect(await theo("title", "desc")).toEqual(["q3", "q2", "q1", "q5", "q4"]);
    expect(await theo("toCompany", "asc")).toEqual(["q1", "q4", "q2", "q5", "q3"]);   // Khách Một < Masan < Ngân hàng ABC < Pepsi < Vinamilk
    expect(await theo("company", "asc")).toEqual(["q5", "q2", "q4", "q3", "q1"]);   // Colorfull Decor (q2,q5) < Gia Nguyễn (q1,q3,q4)
    expect(await theo("creator", "asc")).toEqual(["q5", "q3", "q1", "q4", "q2"]);   // Nguyễn Văn Ánh < Trần Thị Bình
    expect(await theo("creator", "desc")).toEqual(["q4", "q2", "q5", "q3", "q1"]);
    expect(await theo("status", "asc")).toEqual(["q4", "q1", "q5", "q2", "q3"]);    // enum: draft < … < converted < lost
    expect(await theo("customerCode", "asc")).toEqual(["q1", "q2", "q5", "q4", "q3"]);   // KH1 < KH2; không gắn khách xuống cuối
    expect(await theo("customerCode", "desc")).toEqual(["q5", "q4", "q3", "q2", "q1"]);  // DESC: rỗng lên đầu (mặc định Postgres)
  });
  it("phân trang theo cột nhiều dòng bằng nhau (status) duyệt đủ 5 dòng, không trùng, không sót", async () => {
    const a = await dangNhap(admin);
    const thay = [];
    for (let trang = 1; trang <= 3; trang++) {
      const r = await a.get(`/api/quotes?q=${TAG}&sort=status&order=asc&size=2&page=${trang}`);
      expect(r.status).toBe(200);
      thay.push(...r.body.data.map((x) => x.projectCode.slice(TAG.length + 1)));
    }
    expect(thay).toEqual(["q4", "q1", "q5", "q2", "q3"]);
  });
  it("sắp theo TIÊU ĐỀ (sắp ở JS, nạp dòng theo trang) vẫn phân trang đúng: cắt trên thứ tự chữ hiển thị, tổng đúng, không trùng/sót", async () => {
    const a = await dangNhap(admin);
    const trangs = []; let tong;
    for (let trang = 1; trang <= 3; trang++) {
      const r = await a.get(`/api/quotes?q=${TAG}&sort=title&order=asc&size=2&page=${trang}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      trangs.push(r.body.data.map((x) => x.projectCode.slice(TAG.length + 1)));
      tong = r.body.meta.total;
    }
    expect(trangs).toEqual([["q4", "q5"], ["q1", "q2"], ["q3"]]);
    expect(tong, "meta.total phải là số báo giá khớp bộ lọc, không phải số dòng của trang").toBe(5);
    // Trang vượt quá → rỗng (không ném), như các cột khác.
    const qua = await a.get(`/api/quotes?q=${TAG}&sort=title&order=asc&size=2&page=9`);
    expect(qua.status).toBe(200);
    expect(qua.body.data).toEqual([]);
  });
  it("sắp theo TIÊU ĐỀ vẫn CHỈ trong phạm vi quyền: người thường không thấy báo giá người khác dù cùng bộ lọc", async () => {
    const a = await dangNhap(tranB);
    expect(await ds(a, `q=${TAG}&sort=title&order=asc`)).toEqual(["q4", "q2"]);
    expect(await ds(a, `q=${TAG}&sort=title&order=desc`)).toEqual(["q2", "q4"]);
  });

  // ── PHẠM VI QUYỀN + VIEW LƯỢC ─────────────────────────────────────────────────────────────────────
  it("người thường CHỈ lọc/tìm trong báo giá của MÌNH: người tạo khác không chen vào kết quả", async () => {
    const a = await dangNhap(tranB);
    expect(ra(...await ds(a, `q=${TAG}`))).toEqual(ra("q2", "q4"));
    expect(await ds(a, `q=${TAG}&creator=${nguyenA.id}`), "lọc theo người tạo KHÁC không mở rộng phạm vi").toEqual([]);
  });
  it("account HN: tìm theo khách TRONG DANH MỤC không ra gì (đó là thứ họ bị giấu); bộ lọc tiền/ghi chú/người tạo bị bỏ qua", async () => {
    const a = await dangNhap(hn);
    expect(await ds(a, `q=bi+mat`), "khách danh mục 'Bí Mật Holdings' bị dò ra qua q").toEqual([]);
    expect(await ds(a, `q=${TAG}kh2`.toLowerCase())).toEqual([]);
    // Họ CÓ thể tìm bằng tiêu đề (hiện trên màn của họ — hành vi cũ).
    expect(await ds(a, `q=tri+an`)).toEqual(["q2"]);
    // Bộ lọc dò tiền / ghi chú / người tạo bị BỎ QUA: dòng của họ vẫn hiện dù điều kiện không khớp.
    expect(await ds(a, `q=${TAG}&minTotal=999999999999`), "lọc tổng tiền xuyên view lược = đọc trộm tổng tiền").toEqual(["q2"]);
    expect(await ds(a, `q=${TAG}&noteColor=red`)).toEqual(["q2"]);
    expect(await ds(a, `q=${TAG}&creator=${nguyenA.id}`)).toEqual(["q2"]);
  });
  it("tài khoản chi phí: như account HN — không dò khách danh mục / tổng tiền", async () => {
    const a = await dangNhap(chiPhi);
    expect(await ds(a, `q=bi+mat`)).toEqual([]);
    expect(await ds(a, `q=${TAG}&maxTotal=1`)).toEqual(["q2"]);
  });
  it("sắp xếp cột MỚI cũng bị từ chối ở view lược (lùi về createdAt) — không sắp theo trường họ không thấy", async () => {
    const a = await dangNhap(hn);
    const r = await a.get(`/api/quotes?q=${TAG}&sort=creator&order=asc`);
    expect(r.status).toBe(200);   // không 400: client cũ / link đã lưu vẫn mở được
    expect(r.body.data.map((x) => x.projectCode.slice(TAG.length + 1))).toEqual(["q2"]);
  });

  // ── FACETS ────────────────────────────────────────────────────────────────────────────────────────
  it("facets: đếm theo MỌI bộ lọc KHÁC (trừ chính nhóm đó) trong phạm vi của người xem", async () => {
    const a = await dangNhap(admin);
    const r = await a.get(`/api/quotes/facets?q=${TAG}&status=draft`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const f = r.body;
    // Trạng thái: KHÔNG áp chính bộ lọc status → vẫn đếm đủ cả converted / lost.
    expect(Object.fromEntries(f.status.map((x) => [x.value, x.count]))).toMatchObject({ draft: 2, converted: 2, lost: 1 });
    // Người tạo / công ty / ghi chú: CÓ áp status=draft → chỉ q1, q4 (draft).
    expect(Object.fromEntries(f.creators.map((x) => [x.name, x.count]))).toMatchObject({ "Nguyễn Văn Ánh": 1, "Trần Thị Bình": 1 });
    expect(Object.fromEntries(f.companies.map((x) => [x.name, x.count])), "tên công ty hiển thị = tên NGẮN như cột Công ty của bảng").toMatchObject({ GN: 2 });
    expect(f.note).toMatchObject({ has: 2, none: 0, colors: { red: 1, purple: 1 } });
    expect(f.total).toBe(2);
  });
  it("facets 'mine': số báo giá của CHÍNH người xem trong bộ lọc hiện tại", async () => {
    const a = await dangNhap(nguyenA);
    const r = await a.get(`/api/quotes/facets?q=${TAG}`);
    expect(r.status).toBe(200);
    expect(r.body.mine).toBe(3);
    expect(r.body.total).toBe(3);   // phạm vi của Nguyễn Văn Ánh chỉ có q1, q3, q5
    expect(r.body.creators.map((x) => x.name)).toEqual(["Nguyễn Văn Ánh"]);
  });
  it("facets: view lược bị 403 (không có gì để đếm và không được dò); chưa đăng nhập 401", async () => {
    for (const u of [hn, chiPhi]) expect((await (await dangNhap(u)).get(`/api/quotes/facets`)).status).toBe(403);
    const request = (await import("supertest")).default;
    expect((await request(app).get("/api/quotes/facets")).status).toBe(401);
  });
  it("facets nhận cùng bộ tham số với danh sách và từ chối tham số xấu", async () => {
    const a = await dangNhap(admin);
    expect((await a.get("/api/quotes/facets?status=xyz")).status).toBe(400);
    expect((await a.get("/api/quotes/facets?noteColor=hotpink")).status).toBe(400);
  });
});
