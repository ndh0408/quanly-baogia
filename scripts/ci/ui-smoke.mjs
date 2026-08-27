#!/usr/bin/env node
// ============================================================================
// ui-smoke.mjs — MỞ TRÌNH DUYỆT THẬT, ĐĂNG NHẬP THẬT, GÕ VÀO LƯỚI THẬT.
//
//   node scripts/ci/ui-smoke.mjs            # chạy
//   node scripts/ci/ui-smoke.mjs --hien     # mở cửa sổ trình duyệt (gỡ lỗi trên máy có màn hình)
//
// ── VÌ SAO CẦN ─────────────────────────────────────────────────────────────
// 187 bài vitest của web/ chạy trên jsdom với component ĐƯỢC MOUNT LẺ. Không bài nào nạp
// BUNDLE ĐÃ BUILD qua máy chủ Express thật. Khoảng trống đó nuốt đúng một lớp lỗi:
//   · asset trỏ sai đường (public/app2/assets/… 404) → màn hình trắng, mọi unit test vẫn xanh;
//   · ChunkLoadError sau khi build mới xoá chunk-hash cũ (web/src/components/Shell.tsx tự reload
//     một lần vì chuyện này ĐÃ xảy ra);
//   · CSP của helmet chặn chính bundle của mình;
//   · lỗi React chưa bắt lúc mount cả cây (chỉ lộ khi có đủ provider + router + dữ liệu thật).
// Không cái nào bắt được bằng cách đọc mã nguồn.
//
// ── CHỐT ĐẮT GIÁ NHẤT LÀ HAI CÁI CUỐI ──────────────────────────────────────
// KHÔNG lỗi console và KHÔNG request hỏng, trong SUỐT lượt chạy. Một smoke chỉ kiểm "có thấy chữ
// X không" sẽ xanh trong khi console đỏ rực — mà console đỏ chính là chỗ bốn lỗi trên hiện ra.
//
// ── CHẠY Ở NODE_ENV=development, CÓ CHỦ Ý ──────────────────────────────────
// src/app.ts đặt cookie phiên `secure: isProd`. Ở production cookie CHỈ đi qua HTTPS, nên chạy
// smoke qua http://127.0.0.1 thì đăng nhập không bao giờ giữ được phiên. Vế "cấu hình production
// có khởi động nổi không" KHÔNG bỏ trống: nó nằm ở scripts/ci/docker-smoke.sh, chạy container
// NODE_ENV=production thật. Hai script chia nhau hai vế, không cái nào phủ được cả hai.
//
// ── DỮ LIỆU ────────────────────────────────────────────────────────────────
// Tự tạo user + công ty + mẫu + báo giá mang tiền tố `uismoke-<pid>`, và XOÁ CỨNG ở finally.
// Không đụng dữ liệu sẵn có, không phụ thuộc seed.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import bcrypt from "bcryptjs";

// `location` và `document` xuất hiện trong các hàm truyền cho `page.evaluate` /
// `page.waitForFunction` — chúng được TUẦN TỰ HOÁ rồi chạy TRONG TRÌNH DUYỆT, không chạy ở Node.
// eslint đọc file này bằng cấu hình Node nên báo `no-undef`; khai báo ở đây thay vì rắc
// eslint-disable ở từng chỗ.
/* global location, document */

const GOC = path.resolve(import.meta.dirname, "../..");
const HIEN = process.argv.includes("--hien");
const TAG = `uismoke-${process.pid}`;
const ANH_LOI = path.join(GOC, ".ui-smoke");

let loi = 0;
const buoc = (s) => console.log(`\n\x1b[1m▶ ${s}\x1b[0m`);
const ok = (s) => console.log(`  \x1b[32m✓ ${s}\x1b[0m`);
const xau = (s) => { console.log(`  \x1b[31m✗ ${s}\x1b[0m`); loi = 1; };
const doi = (dk, msg) => (dk ? ok(msg) : xau(msg));

/** Chromium: ưu tiên biến môi trường, rồi bản Playwright tự quản, rồi bản cài sẵn của máy. */
function timChromium() {
  if (process.env.SMOKE_CHROMIUM) return process.env.SMOKE_CHROMIUM;
  const kho = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (kho && existsSync(kho)) {
    // Máy này có sẵn chromium-<build> do ảnh nền cài, thường KHÔNG khớp build mà bản playwright
    // trong package-lock mong đợi → `chromium.launch()` trần sẽ báo "Executable doesn't exist".
    const thuMuc = readdirSync(kho).filter((d) => /^chromium-\d+$/.test(d)).sort();
    for (const d of thuMuc.reverse()) {
      const p = path.join(kho, d, "chrome-linux", "chrome");
      if (existsSync(p)) return p;
    }
  }
  return undefined;   // để Playwright tự tìm (máy dev đã chạy `npx playwright install`)
}

const congRanh = () => new Promise((res, rej) => {
  const s = createServer();
  s.once("error", rej);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});

const nghi = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  buoc("[U0] Artifact phải có sẵn");
  const thieu = ["dist/server.js", "public/app2/index.html"].filter((f) => !existsSync(path.join(GOC, f)));
  if (thieu.length) {
    xau(`thiếu ${thieu.join(", ")} — chạy \`npm run build\` và \`npm run web:build\` trước`);
    return 1;
  }
  ok("dist/server.js + public/app2/index.html");

  const { prisma } = await import(path.join(GOC, "dist/db.js"));
  // Ô tìm kiếm của danh sách lọc theo cột `searchText`, mà cột đó KHÔNG tự sinh: quoteService
  // dựng nó bằng `normalizeSearch(quoteNumber, projectCode, title, toCompany, toContact)`. Fixture
  // này ghi thẳng qua Prisma nên phải gọi đúng hàm đó — nếu tự bịa một chuỗi thì báo giá tồn tại
  // nhưng tìm không ra, và bài test đỏ vì lý do sai.
  const { normalizeSearch } = await import(path.join(GOC, "dist/searchText.js"));
  const cong = await congRanh();
  const goc = `http://127.0.0.1:${cong}`;
  const matKhau = `Ui-Smoke-${process.pid}-${Math.floor(Date.now() % 1e6)}!`;

  let may = null, trinhDuyet = null;
  const donDep = async () => {
    try { if (trinhDuyet) await trinhDuyet.close(); } catch {}
    try { if (may && !may.killed) { may.kill("SIGTERM"); await nghi(400); may.kill("SIGKILL"); } } catch {}
    // Xoá CỨNG: db.ts có lớp soft-delete, xoá mềm thì lần chạy sau vấp `quoteNumber` trùng.
    for (const [ten, dk] of [
      ["quote", { quoteNumber: { startsWith: TAG } }],
      ["quoteTemplate", { code: { startsWith: TAG } }],
      ["company", { code: { startsWith: TAG } }],
      ["user", { username: { startsWith: TAG } }],
    ]) {
      try { await prisma[ten].deleteMany({ where: dk, hardDelete: true, includeDeleted: true }); } catch {}
    }
    try { await prisma.$disconnect(); } catch {}
  };

  try {
    buoc("[U1] Dựng dữ liệu thử");
    const u = await prisma.user.create({ data: {
      username: `${TAG}-admin`, displayName: "Smoke Admin", role: "admin",
      passwordHash: await bcrypt.hash(matKhau, 10),
    } });
    const co = await prisma.company.create({ data: {
      code: `${TAG}CO`, name: "Cty Smoke", address: "1 Đường Thử", quotePrefix: `S${String(process.pid).slice(-4)}`,
    } });
    const tpl = await prisma.quoteTemplate.create({ data: {
      companyId: co.id, name: "Mẫu Smoke", code: `${TAG}k`, filePath: "templates/GN_KhongNgay.xlsx",
    } });
    const bg = await prisma.quote.create({ data: {
      quoteNumber: `${TAG}-001`, title: "Báo giá smoke giao diện", toCompany: "Khách Smoke",
      searchText: normalizeSearch(`${TAG}-001`, null, "Báo giá smoke giao diện", "Khách Smoke", null),
      companyId: co.id, fromContact: "Smoke", fromAddress: "1 Đường Thử", city: "TP. Hồ Chí Minh",
      quoteDate: new Date(), createdById: u.id, status: "draft",
      sheets: { create: [{ templateId: tpl.id, order: 1, name: "Trang 1", items: { create: [
        { order: 1, kind: "item", name: "Hạng mục smoke A", unit: "cái", quantity: 3, unitPrice: 100000 },
        { order: 2, kind: "item", name: "Hạng mục smoke B", unit: "bộ", quantity: 2, unitPrice: 50000 },
      ] } }] },
    } });
    ok(`user + công ty + mẫu + báo giá #${bg.id} (${TAG})`);

    buoc("[U2] Khởi động máy chủ từ dist/");
    may = spawn(process.execPath, ["dist/server.js"], {
      cwd: GOC, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "development", PORT: String(cong), LOG_LEVEL: "error",
             // PHẢI khớp origin mà trình duyệt thật sự dùng. `ALLOWED_ORIGINS` trong src/app.ts dựng
             // TỪ APP_BASE_URL, mà mặc định của config.ts là `http://localhost:<port>`. Trình duyệt
             // ở đây mở `http://127.0.0.1:<port>` — khác origin, nên lớp 1 của csrfGuard trả 403
             // "origin không hợp lệ" và mọi POST đều trượt, kể cả đăng nhập. (Đo được: đúng lỗi đó.)
             APP_BASE_URL: goc,
             SESSION_SECRET: process.env.SESSION_SECRET || "ui-smoke-session-secret-du-32-ky-tu-0123456789" },
    });
    const logMay = [];
    may.stdout.on("data", (d) => logMay.push(String(d)));
    may.stderr.on("data", (d) => logMay.push(String(d)));

    let len = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${goc}/livez`)).ok) { len = true; break; } } catch {}
      if (may.exitCode !== null) break;
      await nghi(500);
    }
    if (!len) { xau(`máy chủ không lên ở ${goc}`); console.log(logMay.join("").slice(-2000)); return 1; }
    ok(`máy chủ sống ở ${goc}`);

    buoc("[U3] Mở trình duyệt");
    const exe = timChromium();
    trinhDuyet = await chromium.launch({ headless: !HIEN, executablePath: exe, args: ["--no-sandbox"] });
    ok(`chromium ${trinhDuyet.version()}${exe ? ` (${exe})` : ""}`);
    const ctx = await trinhDuyet.newContext({ viewport: { width: 1440, height: 900 } });
    const trang = await ctx.newPage();

    // ── HAI SỔ GHI QUAN TRỌNG NHẤT CỦA CẢ FILE ─────────────────────────────
    const loiConsole = [];
    const requestHong = [];
    trang.on("console", (m) => {
      if (m.type() !== "error") return;
      // "Failed to load resource: …" là tiếng vọng của một response mà listener bên dưới ĐÃ soi,
      // chỉ khác là dòng console KHÔNG kèm URL nên không lọc chính xác được. Bỏ ở đây, giữ ở dưới:
      // như vậy mỗi request hỏng được đếm ĐÚNG MỘT LẦN và luôn kèm URL để biết hỏng ở đâu.
      if (m.text().startsWith("Failed to load resource")) return;
      loiConsole.push(m.text());
    });
    trang.on("pageerror", (e) => loiConsole.push(`pageerror: ${e.message}`));
    const ngoai = [];
    // ── BA NGOẠI LỆ, MỖI CÁI CÓ LÝ DO ĐO ĐƯỢC ───────────────────────────────
    // 1. `/api/stream/events` bị ERR_ABORTED: SSE là kết nối SỐNG MÃI. Tải lại trang hoặc đóng
    //    tab thì trình duyệt huỷ nó — đó là kết thúc bình thường, không phải hỏng. Chỉ tha ĐÚNG
    //    endpoint đó với ĐÚNG mã ERR_ABORTED; tha ERR_ABORTED nói chung sẽ nuốt cả abort thật.
    // 2. 401 ở `/api/auth/me` TRƯỚC khi đăng nhập: SPA hỏi để biết có phiên chưa; 401 là câu trả
    //    lời "chưa", không phải lỗi.
    // 3. Máy chủ NGOÀI (fonts.googleapis.com): repo này nạp phông Be Vietnam Pro từ CDN Google
    //    (web/index.html). Nó KHÔNG thuộc quyền của bộ test — mạng của máy chạy quyết định — và
    //    `display=swap` khiến trang vẫn đọc được bằng phông dự phòng. Nên KHÔNG làm đỏ, nhưng
    //    VẪN liệt kê: một phụ thuộc ngoài lúc tải trang là chuyện người vận hành cần biết, không
    //    phải chuyện được im lặng. (Ghi trong docs/REMAINING_RISKS.md.)
    const laCuaMinh = (url) => url.startsWith(goc);
    const ghiHong = (mo) => (laCuaMinh(mo) ? requestHong : ngoai).push(mo);
    trang.on("requestfailed", (r) => {
      const err = r.failure()?.errorText || "";
      if (r.url().includes("/api/stream/events") && err.includes("ERR_ABORTED")) return;
      ghiHong(`${r.method()} ${r.url()} — ${err}`);
    });
    trang.on("response", (r) => {
      if (r.status() < 400) return;
      if (r.status() === 401 && r.url().includes("/api/auth/me")) return;
      ghiHong(`${r.status()} ${r.request().method()} ${r.url()}`);
    });

    // KỊCH BẢN NẰM TRONG try RIÊNG: một `waitForSelector` hết hạn sẽ NÉM. Nếu để nó bay thẳng ra
    // ngoài thì người đọc chỉ nhận một vết stack của Playwright, KHÔNG có ảnh màn hình, KHÔNG có log
    // máy chủ, và [U10] (console/request — thường chứa đúng nguyên nhân) không bao giờ chạy.
    // Đo được ở lượt kiểm ngược "giấu public/app2/assets": đúng như vậy.
    let neKichBan = null;
    try {
    buoc("[U4] Màn đăng nhập");
    await trang.goto(`${goc}/`, { waitUntil: "domcontentloaded" });
    await trang.waitForSelector("#login-form", { timeout: 20_000 });
    doi(await trang.isVisible('#login-form input[name="username"]'), "form đăng nhập render (bundle nạp được)");

    buoc("[U5] Đăng nhập");
    await trang.fill('#login-form input[name="username"]', `${TAG}-admin`);
    await trang.fill('#login-form input[name="password"]', matKhau);
    await trang.click("#login-form .btn-login");
    await trang.waitForSelector("#login-form", { state: "detached", timeout: 30_000 });
    ok("đăng nhập xong, vỏ ứng dụng thay màn đăng nhập");

    buoc("[U6] Danh sách báo giá");
    await trang.evaluate(() => { location.hash = "#/list"; });
    await trang.waitForSelector("h1:has-text('Danh sách báo giá')", { timeout: 20_000 });
    await trang.fill('input[aria-label="Tìm báo giá"]', `${TAG}-001`);
    await trang.waitForSelector(`text=${TAG}-001`, { timeout: 20_000 });
    ok(`tìm thấy ${TAG}-001 trong danh sách`);

    buoc("[U7] Trình soạn — lưới Excel dựng được");
    await trang.evaluate((id) => { location.hash = `#/quotes/${id}`; }, bg.id);
    await trang.waitForSelector('tr[data-row="0"]', { timeout: 30_000 });
    const soDong = await trang.locator("tr[data-row]").count();
    doi(soDong >= 2, `lưới có ${soDong} dòng (dựng từ dữ liệu thật)`);
    const tenA = await trang.inputValue('tr[data-row="0"] [data-f="name"]');
    doi(tenA === "Hạng mục smoke A", `ô Hạng Mục dòng 0 = "${tenA}"`);

    buoc("[U8] Gõ vào ô đơn giá → Thành Tiền tính lại");
    // ĐÂY LÀ NGHIỆP VỤ LÕI: lưới kiểu Excel + công thức tiền. Một smoke chỉ "mở được trang" sẽ
    // xanh kể cả khi phép nhân sai. Chốt này bám vào con số người dùng nhìn thấy.
    const soCuaO = async (sel) => Number((await trang.textContent(sel) || "").replace(/[^\d]/g, ""));
    const truoc = await soCuaO('tr[data-row="0"] .col-amount');
    doi(truoc === 300_000, `Thành Tiền ban đầu = ${truoc.toLocaleString("vi-VN")} (3 × 100.000)`);

    // GÕ NHƯ TRONG EXCEL, KHÔNG `fill()`.
    // Lưới theo mô hình READY/EDIT của Excel: một cú bấm chỉ CHỌN ô — `lockCell` đặt `readOnly`
    // và class `cell-lock` để bấm nhầm chuột không rê con trỏ lung tung. `fill()` của Playwright
    // từ chối ô readonly ("element is not editable" — đo được). Người dùng thật gõ thẳng, và
    // `typeToReplace` xoá nội dung cũ rồi mở khoá ô. Đi đúng đường đó thì bài này kiểm luôn cả
    // cơ chế gõ-là-đè, chứ không chỉ kiểm phép nhân.
    const oGia = trang.locator('tr[data-row="0"] [data-f="unitPrice"]');
    await oGia.click();
    await trang.keyboard.type("250000");
    await trang.keyboard.press("Enter");
    await trang.waitForFunction(
      () => {
        const td = document.querySelector('tr[data-row="0"] .col-amount');
        return td && Number((td.textContent || "").replace(/[^\d]/g, "")) === 750_000;
      },
      undefined,
      { timeout: 15_000 },
    ).catch(() => {});
    const sau = await soCuaO('tr[data-row="0"] .col-amount');
    doi(sau === 750_000, `sau khi gõ 250.000 → Thành Tiền = ${sau.toLocaleString("vi-VN")} (mong 750.000)`);

    buoc("[U9] Tải lại trang — bundle vẫn nạp được, phiên còn nguyên");
    // ChunkLoadError sau khi build mới chỉ hiện ra ở lượt tải lại. Shell.tsx có sẵn một lớp tự
    // reload cho chuyện này — bài này là chỗ duy nhất chạm tới nó.
    await trang.reload({ waitUntil: "domcontentloaded" });
    await trang.waitForSelector("tr[data-row], h1", { timeout: 30_000 });
    doi(!(await trang.isVisible("#login-form")), "tải lại KHÔNG bị đá về màn đăng nhập");

    } catch (e) {
      xau(`kịch bản dừng giữa chừng: ${String(e).split("\n")[0]}`);
      neKichBan = e;
    }

    buoc("[U10] Console sạch + không request nào hỏng");
    doi(loiConsole.length === 0, `lỗi console: ${loiConsole.length}`);
    loiConsole.slice(0, 10).forEach((x) => console.log(`      · ${x.slice(0, 200)}`));
    doi(requestHong.length === 0, `request hỏng ở máy chủ CỦA MÌNH: ${requestHong.length}`);
    requestHong.slice(0, 10).forEach((x) => console.log(`      · ${x.slice(0, 200)}`));
    if (ngoai.length) {
      console.log(`  \x1b[33m— ${ngoai.length} request tới máy chủ NGOÀI không tới nơi (không làm đỏ):\x1b[0m`);
      [...new Set(ngoai)].slice(0, 5).forEach((x) => console.log(`      · ${x.slice(0, 160)}`));
    }

    if (loi) {
      mkdirSync(ANH_LOI, { recursive: true });
      const anh = path.join(ANH_LOI, `that-bai-${Date.now()}.png`);
      await trang.screenshot({ path: anh, fullPage: true });
      console.log(`\n  ảnh màn hình lúc hỏng: ${anh}`);
      const cuoi = logMay.join("").slice(-1500);
      if (cuoi.trim()) console.log(`\n  ── log máy chủ (1500 ký tự cuối) ──\n${cuoi}`);
      if (neKichBan) console.log(`\n  ── lỗi gốc ──\n${neKichBan.stack || neKichBan}`);
    }
  } finally {
    await donDep();
  }

  console.log(loi ? "\n\x1b[31m❌ SMOKE GIAO DIỆN ĐỎ\x1b[0m" : "\n\x1b[32m✅ SMOKE GIAO DIỆN XANH\x1b[0m");
  return loi;
}

main().then((m) => process.exit(m), (e) => { console.error(e); process.exit(1); });
