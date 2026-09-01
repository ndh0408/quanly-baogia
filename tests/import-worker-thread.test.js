// NHẬP EXCEL nạp cả workbook TRÊN LUỒNG CHÍNH — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `POST /api/import-excel` gọi thẳng `await parseQuoteWorkbook(req.file.buffer)`, mà hàm đó gọi
// `workbook.xlsx.load()` của exceljs — GIẢI NÉN và dựng TOÀN BỘ workbook trong bộ nhớ TRƯỚC khi
// bất kỳ trần nào của app có tác dụng: `MAX_SHEETS` (30) và `MAX_SCAN_ROWS` (200.000) chỉ được
// kiểm SAU KHI đã có object trong tay.
//
// Trần tải lên là 10MB, nhưng `.xlsx` là ZIP và XML thưa nén cực tốt — 10MB nén bung ra hàng trăm
// MB. Hai hậu quả xảy ra cùng lúc:
//   1. CẢ SERVER ĐỨNG. Không phải "chậm": event loop bị chiếm, nên mọi request khác, mọi kết nối
//      SSE và mọi nhịp tim presence đều xếp hàng sau nó. Người dùng khác tưởng hệ thống chết.
//   2. Vượt RAM là V8 giết TIẾN TRÌNH, không phải một request. Từ khi compose đặt trần cgroup thì
//      kernel còn SIGKILL cả container — mọi request đang bay đứt, lần Lưu báo giá đang gửi dở mất.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Đọc workbook trong WORKER THREAD kèm `resourceLimits.maxOldGenerationSizeMb` và timeout. Luồng
// chính rảnh, và chạm trần heap trở thành lỗi BẮT ĐƯỢC (hỏng đúng một lần nhập) thay vì giết tiến
// trình. CỐ Ý không có đường rơi về nội tuyến — nội tuyến chính là thứ đang bỏ đi.
//
// `parseQuoteWorkbook` KHÔNG hề đổi, nên hành vi đọc Excel (round-trip mẫu, nhận cột theo hàng tiêu
// đề, dựng lại nhóm) giữ nguyên — tests/excelImport.test.js vẫn là chốt cho phần đó.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Worker } from "node:worker_threads";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { buildQuoteBuffer } from "../src/excel.js";
import { prisma } from "../src/db.js";

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `impw${Date.now()}`;
const PWD = "Test1234!a";
const WORKER_URL = new URL("../src/importWorker.js", import.meta.url);

/** Chạy worker nhập đúng như route làm, để đo hành vi thật chứ không đo mock. */
function chayWorker(buffer, { heapMb = 512 } = {}) {
  return new Promise((resolve) => {
    const w = new Worker(WORKER_URL, { workerData: { buffer }, resourceLimits: { maxOldGenerationSizeMb: heapMb } });
    let xong = false;
    const ket = (v) => { if (xong) return; xong = true; void w.terminate(); resolve(v); };
    w.once("message", (m) => ket(m));
    w.once("error", (e) => ket({ ok: false, error: e.message, chet: true }));
    w.once("exit", (code) => { if (!xong) ket({ ok: false, error: "exit " + code, chet: true }); });
  });
}

const baoGia = (soDong) => ({
  quoteNumber: "GN26IMP", title: "Báo giá nhập thử", toCompany: "Công ty ABC",
  toContact: "A", toPhone: "0900000000", toAddress: "1 Đường X",
  vatPercent: 8, discount: 0, showTotals: false, city: "TP. Hồ Chí Minh",
  quoteDate: new Date("2026-06-13"), fromContact: "B", fromTitle: "Sale",
  fromPhone: "0911111111", fromAddress: "2 Đường Y", greeting: "Xin gửi báo giá:",
  sheets: [{
    order: 1, name: "Trang 1", groupSubtotal: false, template: { code: "marico_decor" },
    items: Array.from({ length: soDong }, (_, i) => ({
      kind: "item", name: `Hạng mục ${i}`, detail: "", unit: "cái", quantity: 1, unitPrice: 1000 + i, days: null, notes: "",
    })),
  }],
});

describe("đọc file Excel phải chạy trong worker thread", () => {
  it("file HỢP LỆ → worker trả kết quả đã phân tích, y như gọi trực tiếp", async () => {
    const buf = await buildQuoteBuffer(baoGia(5));
    const m = await chayWorker(buf);
    expect(m.ok, m.error).toBe(true);
    expect(m.result.sheets.length).toBeGreaterThan(0);
    expect(m.result.sheets[0].items.length).toBe(5);
    expect(m.result.sheets[0].items[0].name).toBe("Hạng mục 0");
  });

  it("LUỒNG CHÍNH KHÔNG BỊ CHIẾM trong lúc worker đọc file", async () => {
    const buf = await buildQuoteBuffer(baoGia(4000));   // đủ nặng để thấy khác biệt

    // Đo độ TRỄ của event loop: đặt hẹn 10ms liên tục trong lúc worker chạy. Nếu việc đọc file
    // diễn ra trên luồng chính thì các hẹn này bị dồn hết lại và độ trễ tối đa vọt lên.
    let treMax = 0;
    let chay = true;
    const nhip = () => {
      const t = Date.now();
      setTimeout(() => {
        if (!chay) return;
        treMax = Math.max(treMax, Date.now() - t - 10);
        nhip();
      }, 10);
    };
    nhip();

    const m = await chayWorker(buf);
    chay = false;

    expect(m.ok, m.error).toBe(true);
    // Ngưỡng rộng cho máy CI chậm — điều cần chứng minh là event loop VẪN QUAY, không phải nó
    // nhanh. Đọc cùng file này trên luồng chính làm độ trễ vọt lên hàng trăm ms tới hàng giây.
    expect(treMax, `độ trễ event loop tối đa ${treMax}ms — luồng chính bị chiếm?`).toBeLessThan(250);
  });

  // ⚠️ KHÔNG có bài "chạm trần heap thì worker chết". Đã thử và ĐO ĐƯỢC rằng
  // `resourceLimits.maxOldGenerationSizeMb` KHÔNG chặn thứ tốn kém ở đây: với trần 32MB, một
  // worker vẫn cấp phát thoải mái `Buffer.alloc(300MB)` và ba triệu object. Viết một bài test
  // khẳng định điều không đúng còn tệ hơn không có bài nào — nó tạo cảm giác an toàn giả.
  //
  // Thứ worker thread THẬT SỰ mang lại và đo được là bài ngay trên: event loop vẫn quay. Hàng rào
  // bộ nhớ ở đường này là trần tải lên 10MB + timeout. Việc còn lại (đọc theo luồng bằng exceljs
  // WorkbookReader) ghi ở docs/REMAINING_RISKS.md.
  it("worker chạy với trần heap NHỎ vẫn không kéo tiến trình cha xuống", async () => {
    const buf = await buildQuoteBuffer(baoGia(3000));
    const m = await chayWorker(buf, { heapMb: 32 });
    // Không khẳng định m.ok true hay false — V8 có thể cho qua (đã đo) hoặc chặn. Điều DUY NHẤT
    // bài này chốt: dù đằng nào thì cũng có phản hồi CÓ CẤU TRÚC, và tiến trình cha còn sống để
    // chạy tiếp dòng này.
    expect(m).toBeTypeOf("object");
    expect(m.ok === true || typeof m.error === "string").toBe(true);
  });

  it("file KHÔNG PHẢI xlsx → lỗi có thông điệp, không làm sập worker runner", async () => {
    const m = await chayWorker(Buffer.from("đây không phải file excel"));
    expect(m.ok).toBe(false);
    expect(String(m.error).length).toBeGreaterThan(0);
  });
});

describe.runIf(dbAvailable)("POST /api/import-excel — đường HTTP thật", () => {
  let app, admin, adminU, companyId, templateId;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    adminU = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: adminU.username, password: PWD })).status).toBe(200);
    const co = await prisma.company.create({ data: { code: `${TAG}CO`, name: "Cty thử", address: "1 Thử", quotePrefix: "IW" } });
    companyId = co.id;
    templateId = (await prisma.quoteTemplate.create({ data: { companyId: co.id, name: "Mẫu thử", code: `${TAG}k`, filePath: "templates/Marico_Decor.xlsx" } })).id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("nhập file hợp lệ vẫn chạy end-to-end qua worker", async () => {
    const buf = await buildQuoteBuffer(baoGia(3));
    const r = await admin
      .post("/api/quotes/import-excel")
      .attach("file", buf, { filename: "baogia.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body.sheets[0].items.length).toBe(3);
    expect(companyId && templateId).toBeTruthy();
  });

  it("file rác → 422 kèm thông điệp tiếng Việt, KHÔNG phải 500", async () => {
    const r = await admin
      .post("/api/quotes/import-excel")
      .attach("file", Buffer.from("PK rác rác rác"), { filename: "hong.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    expect([415, 422]).toContain(r.status);
    expect(String(r.body.error)).toMatch(/[Kk]hông|[Ff]ile/);
  });
});
