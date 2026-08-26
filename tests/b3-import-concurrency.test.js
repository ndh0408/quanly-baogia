// B3 — NHẬP EXCEL không có trần SỐ WORKER CHẠY CÙNG LÚC.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `POST /api/quotes/import-excel` đẻ MỘT worker thread cho MỖI request
// (src/routes/import.routes.ts: `new Worker(IMPORT_WORKER_URL, …)`), không đếm, không chặn.
// Rate limiter `createLimiter("import-excel", { max: 12 })` đếm theo KHOÁ (người dùng/IP) trong
// 60s — nó KHÔNG nói gì về số việc chạy ĐỒNG THỜI: 8 người mỗi người 1 file 10MB là 8 worker
// cùng lúc, mỗi worker được cấp `maxOldGenerationSizeMb: 512`.
//
// Và chính mã nguồn đã ĐO và ghi lại rằng trần heap đó KHÔNG phải hàng rào
// (import.routes.ts: "maxOldGenerationSizeMb KHÔNG chặn được thứ tốn kém nhất ở đây… ĐỪNG coi
// đây là hàng rào"). Nên thứ duy nhất còn giới hạn RAM của cả tiến trình là… không có gì.
// Vượt RAM ở mức container = kernel SIGKILL cả tiến trình: mọi request đang bay đứt, lần Lưu
// báo giá đang gửi dở mất — đúng thứ mà việc chuyển sang worker thread định tránh.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Một cái phễu (semaphore) có trần: N việc chạy cùng lúc, hàng chờ có trần, chờ quá lâu thì
// 429 kèm Retry-After. Từ chối SỚM và NÓI RÕ tốt hơn là nhận hết rồi chết cả tiến trình.
//
// Env đặt TRƯỚC khi nạp module vì trần được đọc lúc nạp — nạp động để chắc chắn thứ tự.
process.env.IMPORT_MAX_CONCURRENT = "1";
process.env.IMPORT_MAX_QUEUED = "1";
process.env.IMPORT_WAIT_MS = "50";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { agentWithCsrf } from "./helpers/agent.js";
import { buildQuoteBuffer } from "../src/excel.js";
import { prisma } from "../src/db.js";

const { _tranNhap } = await import("../src/routes/import.routes.js");

const dbAvailable = await prisma.$queryRawUnsafe('SELECT 1 FROM "Quote" LIMIT 1').then(() => true).catch(() => false);
if (!dbAvailable && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 nhưng không kết nối được Postgres");

const TAG = `b3cc${Date.now()}`;
const PWD = "Test1234!a";

const baoGia = (soDong) => ({
  quoteNumber: "GN26B3C", title: `${TAG} nhập thử`, toCompany: "Công ty ABC",
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

describe("phễu: trần số worker nhập chạy cùng lúc", () => {
  it("quá trần thì request phải XẾP HÀNG, và suất được chuyển tay chứ không cấp thêm", async () => {
    expect(_tranNhap.MAX_CONCURRENT).toBe(1);
    await _tranNhap.xin();
    expect(_tranNhap.soDangChay()).toBe(1);

    let daNhan = false;
    const cho = _tranNhap.xin().then(() => { daNhan = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(daNhan, "vượt trần mà vẫn được cấp suất ngay").toBe(false);
    expect(_tranNhap.soDangCho()).toBe(1);

    _tranNhap.tra();
    await cho;
    expect(daNhan).toBe(true);
    expect(_tranNhap.soDangChay(), "suất phải được CHUYỂN TAY, không cộng thêm").toBe(1);
    expect(_tranNhap.soDangCho()).toBe(0);

    _tranNhap.tra();
    expect(_tranNhap.soDangChay()).toBe(0);
  });

  it("hàng chờ đầy → từ chối NGAY với 429, không xếp thêm", async () => {
    await _tranNhap.xin();                    // chiếm suất duy nhất
    const cho = _tranNhap.xin();              // lấp đầy hàng chờ (trần 1)
    await new Promise((r) => setTimeout(r, 5));
    expect(_tranNhap.soDangCho()).toBe(1);

    await expect(_tranNhap.xin()).rejects.toMatchObject({ status: 429 });

    // Người đang chờ hết hạn chờ (IMPORT_WAIT_MS=50) → cũng 429, KHÔNG treo mãi.
    await expect(cho).rejects.toMatchObject({ status: 429 });
    expect(_tranNhap.soDangCho()).toBe(0);
    _tranNhap.tra();
    expect(_tranNhap.soDangChay()).toBe(0);
  });
});

describe.runIf(dbAvailable)("POST /api/quotes/import-excel — phễu trên đường HTTP thật", () => {
  let app, admin;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    app = createApp();
    const u = await prisma.user.create({ data: { username: `${TAG}-admin`, displayName: `${TAG} admin`, role: "admin", passwordHash: await bcrypt.hash(PWD, 4) } });
    admin = agentWithCsrf(app);
    expect((await admin.post("/api/auth/login").send({ username: u.username, password: PWD })).status).toBe(200);
  });

  afterAll(async () => {
    await prisma.loginAttempt.deleteMany({ where: { username: { startsWith: TAG } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true }).catch(() => {});
  });

  it("3 lần nhập cùng lúc với trần 1 → ít nhất 1 lần bị 429 kèm Retry-After", async () => {
    // File đủ nặng để lần nhập đầu còn đang chạy khi hai lần sau tới (đo: ~vài trăm ms).
    const buf = await buildQuoteBuffer(baoGia(1500));
    const gui = () => admin
      .post("/api/quotes/import-excel")
      .attach("file", buf, { filename: "baogia.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

    const rs = await Promise.all([gui(), gui(), gui()]);
    const ma = rs.map((r) => r.status);
    const bity = rs.filter((r) => r.status === 429);
    expect(bity.length, `mã trả về: ${ma.join(", ")} — không có lần nào bị chặn`).toBeGreaterThan(0);
    expect(bity[0].headers["retry-after"], "429 phải kèm Retry-After").toBeTruthy();
    expect(String(bity[0].body.error)).toMatch(/bận|thử lại/i);
    // Lần nào qua được phễu thì vẫn phải trả kết quả đúng.
    const ok = rs.find((r) => r.status === 200);
    expect(ok, `không lần nào thành công: ${ma.join(", ")}`).toBeTruthy();
    expect(ok.body.sheets[0].items.length).toBe(1500);
  }, 60_000);

  it("phễu KHÔNG rò suất: xong đợt trên thì bộ đếm về 0", async () => {
    // Nếu `tra()` không nằm trong finally, mọi lỗi/timeout sẽ ăn mòn dần số suất cho tới khi
    // không ai nhập được nữa — kiểu hỏng chỉ lộ ra sau nhiều ngày chạy.
    await new Promise((r) => setTimeout(r, 100));
    expect(_tranNhap.soDangChay()).toBe(0);
    expect(_tranNhap.soDangCho()).toBe(0);
  });
});
