/**
 * ============================================================================
 * KHỐI "NGƯỜI GỬI" TRÊN BÁO GIÁ PHẢI THEO NGƯỜI TẠO — KHÔNG PHẢI THEO CÔNG TY.
 *
 * ── LỖI, ĐO THẲNG TRÊN PRODUCTION NGÀY 2026-09-18 ──────────────────────────
 * `createQuote` (src/services/quoteService.ts) từng để đường lùi:
 *
 *     fromPhone: b.fromPhone || company.phone || null
 *
 * `company.phone` của cả hai công ty là 0914291951 — số tổng đài. Nên báo giá nào không kèm sẵn
 * SĐT trong payload đều in số đó ở dòng "Người gửi". Đếm được: **10 trên 15 báo giá** mang số tổng
 * đài thay vì số người tạo; riêng tài khoản lamlananh2512@gmail.com (SĐT thật 0902557988) có 9 báo
 * giá như vậy. Khách gọi lại theo số trên báo giá là gặp người khác.
 *
 * Trớ trêu: giao diện tạo báo giá LÀM ĐÚNG từ đầu — `NewQuoteWizard.tsx` điền
 * `me.phone` / `me.senderName` / `me.title`. Chỗ hỏng là đường lùi phía máy chủ, và nó nuốt đúng
 * những ca hồ sơ người dùng bị thiếu SĐT (chính là các tài khoản từng bị xoá trắng `phone` trong
 * sự cố hồ sơ trước đó).
 *
 * ── LUẬT ĐÃ CHỐT ───────────────────────────────────────────────────────────
 *   client gửi gì      → dùng đúng cái đó (người dùng có thể gõ đè);
 *   client KHÔNG gửi   → lấy từ HỒ SƠ NGƯỜI TẠO (senderName/displayName · phone · title);
 *   người tạo cũng trống → ĐỂ TRỐNG.
 * Thà một dòng trống — người đọc biết là thiếu — còn hơn số của người khác.
 *
 * `fromAddress` KHÔNG cùng loại và CỐ Ý vẫn lùi về `company.address`: địa chỉ là của công ty, không
 * phải của cá nhân. Ca cuối tệp này khoá điều đó, để bản vá sau không "dọn cho nhất quán" rồi làm
 * mất địa chỉ trên báo giá.
 * ============================================================================
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `ng${Date.now()}`;
const PWD = "Test1234!a";
const PREFIX = `N${String(Date.now()).slice(-7)}`;
const SO_TONG_DAI = "0999888777";   // "số công ty" của bài này — vai của 0914291951 trên production

describe.runIf(dbAvailable)("Người gửi theo người tạo", () => {
  let app, companyId, templateId;

  /** Tạo một tài khoản + phiên đăng nhập riêng cho từng ca. */
  async function taiKhoan(hau, dulieu) {
    const u = await prisma.user.create({
      data: {
        username: `${TAG}-${hau}`, displayName: `${TAG} ${hau}`, role: "admin",
        passwordHash: await bcrypt.hash(PWD, 4), ...dulieu,
      },
    });
    const ag = agentWithCsrf(app);
    const r = await ag.post("/api/auth/login").send({ username: u.username, password: PWD });
    expect(r.status, JSON.stringify(r.body).slice(0, 160)).toBe(200);
    return { u, ag };
  }

  const tao = (ag, body = {}) => ag.post("/api/quotes").send({
    title: `${TAG} bg`, companyId, toCompany: "Khách thử", vatPercent: 8,
    sheets: [{ name: "Trang 1", order: 1, templateId, items: [{ kind: "item", name: "Hạng mục", quantity: 1, unitPrice: 10_000, order: 1 }] }],
    ...body,
  });

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const co = await prisma.company.create({
      data: { code: `${TAG}CO`, name: "Cty thử", address: "99 Đường Công Ty", phone: SO_TONG_DAI, quotePrefix: PREFIX },
    });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({
      data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx" },
    })).id;
  }, 90_000);

  afterAll(async () => {
    // Xoá CỨNG: repo có lớp xoá-mềm, `deleteMany` thường chỉ đặt `deletedAt` → hàng vẫn còn và
    // bước xoá tài khoản bên dưới vỡ khoá ngoại `Quote_createdById_fkey`, để lại rác sau mỗi lần chạy.
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } } }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true }).catch(() => {});
  });

  it("payload KHÔNG kèm SĐT → lấy SĐT của NGƯỜI TẠO, tuyệt đối không phải số công ty", async () => {
    const { ag } = await taiKhoan("co-sdt", { phone: "0911222333", title: "Account", senderName: "Chị Thử" });
    const r = await tao(ag);
    expect(r.status, JSON.stringify(r.body).slice(0, 200)).toBe(201);
    expect(r.body.fromPhone, `in ra số ${r.body.fromPhone} — khách gọi lại sẽ gặp người khác`).toBe("0911222333");
    expect(r.body.fromPhone).not.toBe(SO_TONG_DAI);
    // Cùng luật cho hai trường còn lại của khối "Người gửi".
    expect(r.body.fromContact, "tên người gửi không theo hồ sơ người tạo").toBe("Chị Thử");
    expect(r.body.fromTitle).toBe("Account");
  }, 90_000);

  it("người tạo KHÔNG có SĐT → ĐỂ TRỐNG, không mượn số công ty", async () => {
    // Đây đúng là ca đã sinh ra 10 báo giá sai trên production: hồ sơ thiếu SĐT thì đường lùi cũ
    // rơi thẳng vào `company.phone`. Trống thì người đọc biết là thiếu; số người khác thì không.
    const { ag } = await taiKhoan("khong-sdt", { phone: null, title: null });
    const r = await tao(ag);
    expect(r.status).toBe(201);
    expect(r.body.fromPhone, "mượn số công ty cho một người không có số").toBeFalsy();
    expect(r.body.fromPhone).not.toBe(SO_TONG_DAI);
  }, 90_000);

  it("payload CÓ gửi SĐT → tôn trọng đúng thứ người dùng gõ", async () => {
    // Vế đối trọng: ô "SĐT người gửi" trên màn tạo báo giá phải sửa được (gửi hộ đồng nghiệp…).
    const { ag } = await taiKhoan("go-de", { phone: "0911222333" });
    const r = await tao(ag, { fromPhone: "0900000001", fromContact: "Người khác", fromTitle: "Senior" });
    expect(r.status).toBe(201);
    expect(r.body.fromPhone).toBe("0900000001");
    expect(r.body.fromContact).toBe("Người khác");
    expect(r.body.fromTitle).toBe("Senior");
  }, 90_000);

  it("senderName trống thì lùi về displayName, KHÔNG bỏ trống tên người gửi", async () => {
    const { u, ag } = await taiKhoan("khong-sendername", { phone: "0911222444", senderName: null });
    const r = await tao(ag);
    expect(r.status).toBe(201);
    expect(r.body.fromContact).toBe(u.displayName);
  }, 90_000);

  it("ĐỊA CHỈ thì VẪN lùi về công ty — cố ý khác với SĐT", async () => {
    // Địa chỉ là của CÔNG TY chứ không phải của cá nhân, nên đường lùi ở đây là đúng. Ghi thành một
    // ca riêng để bản vá sau không gộp nó vào cùng "cho nhất quán" rồi làm báo giá mất địa chỉ.
    const { ag } = await taiKhoan("dia-chi", { phone: "0911222555" });
    const r = await tao(ag);
    expect(r.status).toBe(201);
    expect(r.body.fromAddress).toBe("99 Đường Công Ty");
  }, 90_000);
});
