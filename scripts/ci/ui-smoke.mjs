#!/usr/bin/env node
// ============================================================================
// ui-smoke.mjs — MỞ TRÌNH DUYỆT THẬT, ĐĂNG NHẬP THẬT, GÕ VÀO LƯỚI THẬT.
//
//   node scripts/ci/ui-smoke.mjs            # chạy
//   node scripts/ci/ui-smoke.mjs --hien     # mở cửa sổ trình duyệt (gỡ lỗi trên máy có màn hình)
//
// ── VÌ SAO CẦN ─────────────────────────────────────────────────────────────
// 293 bài vitest của web/ (22 tệp — `cd web && npx vitest run`) chạy ở environment `node` theo
// MẶC ĐỊNH: repo
// KHÔNG cài jsdom, `web/vite.config.ts` không khai khối `test` nên vitest lấy mặc định `node`. Tức
// chúng kiểm HÀM và ĐỌC MÃ NGUỒN — không có `document`, không mount nổi một component nào, và dĩ
// nhiên không bài nào nạp BUNDLE ĐÃ BUILD qua máy chủ Express thật. Khoảng trống đó nuốt đúng một
// lớp lỗi:
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
// ── LUỒNG NGƯỜI DÙNG ĐƯỢC PHỦ ──────────────────────────────────────────────
// đăng nhập → danh sách → mở trình soạn → sửa ô → LƯU → tải lại + kiểm số đã lưu → MẤT TAB GIỮA
// CHỪNG: khôi phục bản nháp cục bộ → TẠO báo giá mới (wizard 3 bước) → lưu bản mới → XUẤT Excel →
// ĐĂNG XUẤT → ĐĂNG NHẬP tài khoản hạn chế → KIỂM QUYỀN → console sạch.
// Tổng 18 bước: `grep -cE '^\s*(await )?buoc\("' scripts/ci/ui-smoke.mjs`.
//
// ── DỮ LIỆU ────────────────────────────────────────────────────────────────
// Tự tạo 2 user + công ty + mẫu + khách hàng + báo giá mang tiền tố `uismoke-<pid>`, và XOÁ CỨNG ở
// finally. Không đụng dữ liệu sẵn có, không phụ thuộc seed.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
// `pathToFileURL`: ESM chỉ nhận file:// URL. Đường dẫn tuyệt đối Windows (D:\…) làm `import()`
// ném ERR_UNSUPPORTED_ESM_URL_SCHEME ("Received protocol 'd:'") ngay ở bước dựng dữ liệu.
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";

// `location` và `document` xuất hiện trong các hàm truyền cho `page.evaluate` /
// `page.waitForFunction` — chúng được TUẦN TỰ HOÁ rồi chạy TRONG TRÌNH DUYỆT, không chạy ở Node.
// eslint đọc file này bằng cấu hình Node nên báo `no-undef`; khai báo ở đây thay vì rắc
// eslint-disable ở từng chỗ.
/* global location, document, window */

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

  const { prisma } = await import(pathToFileURL(path.join(GOC, "dist/db.js")).href);
  // Ô tìm kiếm của danh sách lọc theo cột `searchText`, mà cột đó KHÔNG tự sinh: quoteService
  // dựng nó bằng `normalizeSearch(quoteNumber, projectCode, title, toCompany, toContact)`. Fixture
  // này ghi thẳng qua Prisma nên phải gọi đúng hàm đó — nếu tự bịa một chuỗi thì báo giá tồn tại
  // nhưng tìm không ra, và bài test đỏ vì lý do sai.
  const { normalizeSearch } = await import(pathToFileURL(path.join(GOC, "dist/searchText.js")).href);
  // `src/excel.ts` gọi `getConfig(sheet.template.code)` và getConfig NÉM với mã lạ — xem [U1].
  const { TEMPLATE_CONFIGS, getConfig } = await import(pathToFileURL(path.join(GOC, "dist/templateConfigs.js")).href);
  const cong = await congRanh();
  const goc = `http://127.0.0.1:${cong}`;
  const matKhau = `Ui-Smoke-${process.pid}-${Math.floor(Date.now() % 1e6)}!`;

  let may = null, trinhDuyet = null;
  // ── VÌ SAO DỌN THEO ID, KHÔNG CHỈ THEO TIỀN TỐ TÊN ─────────────────────────
  // Báo giá do bước WIZARD tạo ra mang số do MÁY CHỦ sinh (theo `quotePrefix` của công ty), KHÔNG
  // mang tiền tố `uismoke-`. Lọc `quoteNumber startsWith TAG` như bản đầu bỏ sót đúng bản ghi đó và
  // để lại rác sau MỖI lượt chạy. Dọn theo `companyId` thì bắt cả hai.
  // Mẫu báo giá là ngoại lệ ngược lại: mã của nó BẮT BUỘC là một khoá có thật trong TEMPLATE_CONFIGS
  // (lý do ở [U1]) nên không gắn tiền tố được — chỉ xoá khi CHÍNH lượt này tạo ra nó.
  const id = { user: [], company: null, template: null, khach: null };
  const donDep = async () => {
    try { if (trinhDuyet) await trinhDuyet.close(); } catch {}
    try { if (may && !may.killed) { may.kill("SIGTERM"); await nghi(400); may.kill("SIGKILL"); } } catch {}
    // Xoá CỨNG: db.ts có lớp soft-delete, xoá mềm thì lần chạy sau vấp `quoteNumber` trùng.
    const xoa = async (ten, dk) => { try { await prisma[ten].deleteMany({ where: dk, hardDelete: true, includeDeleted: true }); } catch {} };
    // Thứ tự BẮT BUỘC: báo giá trỏ tới công ty + mẫu + khách + người tạo bằng khoá ngoại NOT NULL.
    if (id.company) await xoa("quote", { companyId: id.company });
    await xoa("quote", { quoteNumber: { startsWith: TAG } });
    if (id.template) await xoa("quoteTemplate", { id: id.template });
    if (id.company) await xoa("company", { id: id.company });
    if (id.khach) await xoa("customer", { id: id.khach });
    if (id.user.length) await xoa("user", { id: { in: id.user } });
    await xoa("user", { username: { startsWith: TAG } });
    try { await prisma.$disconnect(); } catch {}
  };

  try {
    buoc("[U1] Dựng dữ liệu thử");
    const u = await prisma.user.create({ data: {
      username: `${TAG}-admin`, displayName: "Smoke Admin", role: "admin",
      passwordHash: await bcrypt.hash(matKhau, 10),
    } });
    id.user.push(u.id);
    // Tài khoản THỨ HAI, chỉ để [U15] kiểm quyền có nghĩa: `account_hn` KHÔNG có `quote:create` lẫn
    // `user:manage` (src/permissions.ts → ACCOUNT_HN). Kiểm quyền bằng chính tài khoản admin — vốn
    // có MỌI quyền — là kiểm rỗng: nó xanh kể cả khi mọi cổng quyền đã bị gỡ.
    const uHn = await prisma.user.create({ data: {
      username: `${TAG}-hn`, displayName: "Smoke HN", role: "account_hn",
      passwordHash: await bcrypt.hash(matKhau, 10),
    } });
    id.user.push(uHn.id);
    const co = await prisma.company.create({ data: {
      code: `${TAG}CO`, name: "Cty Smoke", address: "1 Đường Thử", quotePrefix: `S${String(process.pid).slice(-4)}`,
    } });
    id.company = co.id;
    // ── MÃ MẪU PHẢI LÀ MỘT KHOÁ CÓ THẬT TRONG TEMPLATE_CONFIGS ────────────────
    // `src/excel.ts:getConfig(tplCode)` NÉM `Không có config cho template code: …` với mã lạ. Bản
    // đầu của fixture này đặt mã `uismoke-<pid>k`, chạy được MỌI bước trừ xuất file — đúng bước
    // [U13] vừa thêm mới lộ ra. Mã mẫu là tập ĐÓNG (không có API tạo mẫu, chỉ seed đặt) nên không
    // gắn tiền tố `uismoke-` được: lấy khoá đầu tiên chưa nằm trong CSDL, và nói thẳng nếu hết.
    const maCoThe = Object.keys(TEMPLATE_CONFIGS);
    const daDung = new Set((await prisma.quoteTemplate.findMany({ select: { code: true }, includeDeleted: true })).map((t) => t.code));
    const maTpl = maCoThe.find((m) => !daDung.has(m));
    if (!maTpl) { xau(`CSDL đã dùng hết ${maCoThe.length} mã mẫu (${maCoThe.join(", ")}) — smoke cần 1 mã còn trống`); return 1; }
    const tpl = await prisma.quoteTemplate.create({ data: {
      companyId: co.id, name: "Mẫu Smoke", code: maTpl, filePath: getConfig(maTpl).filePath,
    } });
    id.template = tpl.id;
    // Khách hàng cho wizard [U11]: bước 3 CHẶN nếu chưa chọn mã khách ("Chọn khách hàng").
    const kh = await prisma.customer.create({ data: {
      code: `${TAG}KH`, name: "Khách Smoke Wizard",
      searchText: normalizeSearch("Khách Smoke Wizard", `${TAG}KH`, null, null, null, null),
    } });
    id.khach = kh.id;
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
    ok(`2 user + công ty + mẫu \`${maTpl}\` + khách + báo giá #${bg.id} (${TAG})`);

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
    // ── 4. MÃ LỖI MÀ BÀI TEST CỐ Ý GỌI RA ───────────────────────────────────
    // [U15] kiểm quyền bằng cách gọi THẲNG API bằng tài khoản không có quyền và đòi đúng 403 — đó
    // là chốt chặn thật (giao diện ẩn nút chỉ là lớp phủ). Nếu không khai trước thì chính bài kiểm
    // quyền ĐẠT sẽ làm [U16] đỏ. Khai theo CẶP `<mã> <đường dẫn>` chứ không tha cả mã 403: tha
    // rộng là mở cửa cho một 403 THẬT ở chỗ khác lọt qua.
    const coY = new Set();
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
      let duongDan = r.url();
      try { duongDan = new URL(r.url()).pathname; } catch { /* URL lạ — giữ nguyên chuỗi */ }
      if (coY.has(`${r.status()} ${duongDan}`)) return;
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

    buoc("[U9] Bấm Lưu — số vừa gõ phải đi tới CSDL");
    // Gõ vào lưới mới chỉ đổi state trong trình duyệt. Thiếu bước này thì [U10] "tải lại" chỉ chứng
    // minh bundle nạp lại được, KHÔNG chứng minh dữ liệu đi tới đâu — và cả hai vẫn xanh khi đường
    // LƯU đã đứt hẳn.
    await trang.click(".actions > .btn-primary");
    await trang.waitForSelector("#toast-host .toast-msg:has-text('Đã lưu')", { timeout: 30_000 });
    // Đọc THẲNG từ CSDL, không đọc lại màn hình: màn hình là thứ vừa được gõ vào, nó đồng ý với
    // chính nó dù máy chủ có ghi hay không. `save()` gửi CẢ báo giá và máy chủ xoá-tạo-lại sheet,
    // nên phải tìm theo quan hệ chứ không theo id dòng cũ.
    const dongDb = await prisma.quoteItem.findFirst({
      where: { sheet: { quoteId: bg.id }, order: 1 }, select: { name: true, unitPrice: true, quantity: true },
    });
    doi(Number(dongDb?.unitPrice) === 250_000, `CSDL: đơn giá dòng 1 = ${dongDb?.unitPrice} (mong 250000)`);
    doi(dongDb?.name === "Hạng mục smoke A", `CSDL: tên dòng 1 = "${dongDb?.name}" (các ô KHÔNG gõ vào vẫn nguyên)`);

    buoc("[U10] Tải lại trang — bundle nạp lại được, phiên còn, SỐ ĐÃ LƯU còn");
    // ChunkLoadError sau khi build mới chỉ hiện ra ở lượt tải lại. Shell.tsx có sẵn một lớp tự
    // reload cho chuyện này — bài này là chỗ duy nhất chạm tới nó.
    await trang.reload({ waitUntil: "domcontentloaded" });
    await trang.waitForSelector('tr[data-row="0"]', { timeout: 30_000 });
    doi(!(await trang.isVisible("#login-form")), "tải lại KHÔNG bị đá về màn đăng nhập");
    const sauTai = await soCuaO('tr[data-row="0"] .col-amount');
    doi(sauTai === 750_000, `sau khi tải lại Thành Tiền = ${sauTai.toLocaleString("vi-VN")} (mong 750.000 — đọc lại từ máy chủ)`);

    // Gõ vào một ô đúng nếp Excel (bấm CHỌN → gõ là ĐÈ). Xem lý do dài ở [U8].
    const goVaoO = async (sel, gt) => { await trang.locator(sel).click(); await trang.keyboard.type(gt); await trang.keyboard.press("Enter"); };

    buoc("[U10b] Mất tab giữa chừng — bản nháp cục bộ cứu được phần chưa lưu");
    // Ba lớp chống mất dữ liệu sẵn có (beforeunload · guardLeave · lớp phủ đăng nhập lại) đều chỉ
    // sống trong bộ nhớ tab. Bài này dựng đúng chỗ chúng không với tới: gõ, KHÔNG lưu, rồi nạp lại
    // trang — tương đương tab sập / máy mất điện. Không có web/src/lib/localDraft.ts thì phần vừa
    // gõ biến mất và ô quay về 750.000.
    await goVaoO('tr[data-row="0"] [data-f="unitPrice"]', "400000");
    const truocNhap = await soCuaO('tr[data-row="0"] .col-amount');
    doi(truocNhap === 1_200_000, `gõ 400.000 → Thành Tiền = ${truocNhap.toLocaleString("vi-VN")} (chưa lưu)`);
    // Chờ ĐÚNG cái mốc chương trình tạo ra, không ngủ một con số đoán: ghi bản nháp gộp 1,2 giây.
    const khoaNhap = `quanly:draft:quote:${bg.id}`;
    await trang.waitForFunction((k) => !!window.localStorage.getItem(k), khoaNhap, { timeout: 15_000 }).catch(() => {});
    doi(await trang.evaluate((k) => !!window.localStorage.getItem(k), khoaNhap), "bản nháp đã nằm trong localStorage");

    await trang.reload({ waitUntil: "domcontentloaded" });
    await trang.waitForSelector('.modal[aria-label="Có thay đổi chưa lưu từ lần trước"]', { timeout: 30_000 });
    ok("nạp lại → hiện hộp hỏi khôi phục");
    await trang.click('.modal[aria-label="Có thay đổi chưa lưu từ lần trước"] [data-yes]');
    await trang.waitForSelector('tr[data-row="0"]', { timeout: 30_000 });
    const sauKhoiPhuc = await soCuaO('tr[data-row="0"] .col-amount');
    doi(sauKhoiPhuc === 1_200_000, `sau khôi phục Thành Tiền = ${sauKhoiPhuc.toLocaleString("vi-VN")} (mong 1.200.000 — số CHƯA LƯU sống sót)`);

    // Lưu để trạng thái sạch cho các bước sau, và chốt luôn: lưu xong bản nháp bị dọn (giữ lại sẽ
    // khiến lần mở sau hỏi khôi phục một thứ CŨ HƠN bản trên máy chủ).
    await trang.click(".actions > .btn-primary");
    await trang.waitForSelector("#toast-host .toast-msg:has-text('Đã lưu')", { timeout: 30_000 });
    doi(!(await trang.evaluate((k) => !!window.localStorage.getItem(k), khoaNhap)), "lưu xong → bản nháp cục bộ đã bị dọn");
    const dbSauKhoiPhuc = await prisma.quoteItem.findFirst({ where: { sheet: { quoteId: bg.id }, order: 1 }, select: { unitPrice: true } });
    doi(Number(dbSauKhoiPhuc?.unitPrice) === 400_000, `CSDL: đơn giá dòng 1 = ${dbSauKhoiPhuc?.unitPrice} (mong 400000)`);

    buoc("[U11] Tạo báo giá mới — wizard 3 bước");
    await trang.evaluate(() => { location.hash = "#/new"; });
    await trang.waitForSelector("h1:has-text('Tạo báo giá mới')", { timeout: 20_000 });
    // Bước 1 — công ty. KHÔNG dựa vào lựa chọn mặc định: wizard chọn sẵn `companies[0]`, mà công ty
    // của smoke gần như không bao giờ là cái đầu tiên.
    await trang.click('.pick-card:has-text("Cty Smoke")');
    await trang.click(".wizard-foot .btn-primary");
    // Bước 2 — mẫu (mỗi mẫu = 1 sheet)
    await trang.click('.pick-card:has-text("Mẫu Smoke")');
    await trang.click(".wizard-foot .btn-primary");
    // Bước 3 — thông tin. Ba trường BẮT BUỘC (`next()` chặn nếu thiếu): tiêu đề, mã khách, tên khách.
    const tieuDeMoi = `Báo giá wizard ${TAG}`;
    await trang.fill('input[placeholder="VD: Décor Premiere Phim Thỏ Ơi"]', tieuDeMoi);
    await trang.click('button:has-text("Chọn khách hàng")');
    await trang.waitForSelector('.modal[aria-label="Chọn khách hàng"]', { timeout: 20_000 });
    await trang.fill('.modal[aria-label="Chọn khách hàng"] input[type="search"]', `${TAG}KH`);
    await trang.click(`.modal[aria-label="Chọn khách hàng"] tr:has-text("${TAG}KH")`, { timeout: 20_000 });
    await trang.fill('.form-grid label:has-text("Khách hàng (To)") input', "Khách Smoke Wizard");
    await trang.click(".wizard-foot .btn-primary");
    // Wizard KHÔNG gọi API tạo: nó dựng bản nháp trong bộ nhớ rồi mở trình soạn ở #/rnew. Bấm Lưu
    // mới POST — nên "tạo báo giá" chỉ trọn vẹn khi có cả bước [U12].
    await trang.waitForFunction(() => location.hash === "#/rnew", undefined, { timeout: 20_000 });
    await trang.waitForSelector('tr[data-row="0"]', { timeout: 30_000 });
    ok("wizard đi hết 3 bước → trình soạn bản nháp #/rnew");

    buoc("[U12] Lưu báo giá MỚI — POST tạo bản ghi thật");
    await goVaoO('tr[data-row="0"] [data-f="name"]', "Hạng mục wizard");
    await goVaoO('tr[data-row="0"] [data-f="quantity"]', "4");
    await goVaoO('tr[data-row="0"] [data-f="unitPrice"]', "125000");
    await trang.click(".actions > .btn-primary");
    // `save()` cho bản mới đổi hash sang #/quotes/:id — đó là mốc "máy chủ đã cấp id" duy nhất.
    await trang.waitForFunction(() => /^#\/quotes\/\d+$/.test(location.hash), undefined, { timeout: 30_000 });
    const idMoi = Number((await trang.evaluate(() => location.hash)).split("/").pop());
    const bgMoi = await prisma.quote.findFirst({
      where: { id: idMoi }, select: { title: true, quoteNumber: true, companyId: true, customerId: true, createdById: true },
    });
    doi(bgMoi?.title === tieuDeMoi, `CSDL có báo giá mới #${idMoi} tiêu đề "${bgMoi?.title}"`);
    doi(!!bgMoi?.quoteNumber && bgMoi.quoteNumber.startsWith(`S${String(process.pid).slice(-4)}`),
        `số báo giá do MÁY CHỦ sinh theo quotePrefix: ${bgMoi?.quoteNumber}`);
    doi(bgMoi?.companyId === co.id && bgMoi?.customerId === kh.id && bgMoi?.createdById === u.id,
        "công ty + khách hàng + người tạo được ghi đúng theo lựa chọn trong wizard");
    const dongMoi = await prisma.quoteItem.findFirst({ where: { sheet: { quoteId: idMoi } }, select: { name: true, quantity: true, unitPrice: true } });
    doi(dongMoi?.name === "Hạng mục wizard" && Number(dongMoi?.quantity) === 4 && Number(dongMoi?.unitPrice) === 125_000,
        `hạng mục đầu tiên: "${dongMoi?.name}" × ${dongMoi?.quantity} × ${dongMoi?.unitPrice}`);

    buoc("[U13] Xuất Excel từ menu ⋯ — file thật, không phải trang HTML");
    await trang.evaluate((qid) => { location.hash = `#/quotes/${qid}`; }, bg.id);
    await trang.waitForSelector('tr[data-row="0"]', { timeout: 30_000 });
    await trang.click(".actions .kebab-btn");
    const [taiXuong, phanHoiXuat] = await Promise.all([
      trang.waitForEvent("download", { timeout: 90_000 }),
      trang.waitForResponse((r) => r.url().includes(`/api/export/${bg.id}.xlsx`), { timeout: 90_000 }),
      trang.click('.kebab-menu [role="menuitem"]:has-text("Tải Excel gửi khách")'),
    ]);
    doi(phanHoiXuat.status() === 200, `GET /api/export/${bg.id}.xlsx → ${phanHoiXuat.status()}`);
    const kieuXuat = phanHoiXuat.headers()["content-type"] || "";
    doi(kieuXuat.includes("spreadsheetml.sheet"), `Content-Type = ${kieuXuat.slice(0, 70)}`);
    // Chốt ĐẮT nhất của bước này: 200 KHÔNG bảo đảm đó là file. SPA fallback, proxy, hay trang đăng
    // nhập SSO đều trả 200 kèm HTML — web/src/lib/exportQuote.ts chặn đúng chuyện đó ở phía client.
    // .xlsx là gói ZIP nên hai byte đầu PHẢI là "PK".
    const thanXuat = await phanHoiXuat.body();
    doi(thanXuat.length > 4 && thanXuat[0] === 0x50 && thanXuat[1] === 0x4b,
        `thân trả về là gói OOXML thật (${thanXuat.length} byte, mở đầu ${thanXuat.slice(0, 2).toString("latin1")})`);
    doi(!!taiXuong, `trình duyệt bắt đầu tải: ${taiXuong.suggestedFilename()}`);

    buoc("[U14] Đăng xuất");
    await trang.evaluate(() => { location.hash = "#/list"; });
    await trang.waitForSelector("h1:has-text('Danh sách báo giá')", { timeout: 20_000 });
    await trang.click("button.logout");
    await trang.waitForSelector("#login-form", { timeout: 30_000 });
    // Màn đăng nhập hiện lại CHƯA phải là đăng xuất: `location.reload()` sau một `api.logout()` hỏng
    // cũng cho ra đúng màn hình đó. Hỏi thẳng máy chủ xem cookie phiên còn sống không.
    const maSauThoat = await trang.evaluate(async () => (await fetch("/api/auth/me", { credentials: "include" })).status);
    doi(maSauThoat === 401, `sau đăng xuất /api/auth/me trả ${maSauThoat} (mong 401 — phiên đã bị huỷ ở MÁY CHỦ)`);

    buoc("[U15] Kiểm quyền — account_hn không vào được chỗ của admin");
    await trang.fill('#login-form input[name="username"]', `${TAG}-hn`);
    await trang.fill('#login-form input[name="password"]', matKhau);
    await trang.click("#login-form .btn-login");
    await trang.waitForSelector("#login-form", { state: "detached", timeout: 30_000 });
    const menu = (await trang.locator("nav a span").allTextContents()).map((x) => x.trim());
    doi(!menu.includes("Tạo báo giá"), `menu KHÔNG có "Tạo báo giá" (đang thấy: ${menu.join(" · ")})`);
    doi(!menu.includes("Quản lý nhân viên"), 'menu KHÔNG có "Quản lý nhân viên"');
    // Ẩn nút KHÔNG phải là chặn. Gõ thẳng hash là đường đi thật của người muốn lách — trong đó
    // `#/rnew` là alias KHÔNG nằm trong mảng NAV, nên nó đi qua cổng `editorDenied` riêng.
    for (const h of ["#/new", "#/rnew", "#/users"]) {
      await trang.evaluate(() => { location.hash = "#/list"; });
      await trang.waitForSelector(".access-denied", { state: "detached", timeout: 20_000 });
      await trang.evaluate((x) => { location.hash = x; }, h);
      await trang.waitForSelector(".access-denied h2", { timeout: 20_000 }).catch(() => {});
      const chu = await trang.textContent(".access-denied h2").catch(() => null);
      doi(chu === "Không có quyền truy cập", `gõ thẳng ${h} → "${chu ?? "KHÔNG bị chặn"}"`);
    }
    // CHỐT CHẶN THẬT nằm ở máy chủ; hai chốt trên chỉ là lớp phủ giao diện. Gọi thẳng API.
    coY.add("403 /api/users");
    coY.add("403 /api/quotes");
    const maUsers = await trang.evaluate(async () => (await fetch("/api/users", { credentials: "include" })).status);
    doi(maUsers === 403, `GET /api/users bằng account_hn → ${maUsers} (mong 403)`);
    const maTao = await trang.evaluate(async () => {
      // POST cần mã CSRF — lấy đúng đường mà SPA dùng, để 403 nhận về là do QUYỀN chứ không do CSRF.
      const t = await (await fetch("/api/csrf-token", { credentials: "include" })).json().catch(() => ({}));
      const r = await fetch("/api/quotes", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", ...(t?.token ? { "x-csrf-token": t.token } : {}) },
        body: JSON.stringify({ title: "khong duoc phep" }),
      });
      return r.status;
    });
    doi(maTao === 403, `POST /api/quotes bằng account_hn → ${maTao} (mong 403 — không tạo được báo giá)`);

    } catch (e) {
      xau(`kịch bản dừng giữa chừng: ${String(e).split("\n")[0]}`);
      neKichBan = e;
    }

    buoc("[U16] Console sạch + không request nào hỏng");
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
