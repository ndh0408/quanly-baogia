#!/usr/bin/env node
// ============================================================================
// check-architecture.mjs — RANH GIỚI TẦNG PHẢI GIỮ ĐƯỢC QUA NĂM THÁNG.
//
//   npm run check:arch
//
// ── VÌ SAO LÀ CỔNG CHỨ KHÔNG PHẢI MỘT CẤU TRÚC THƯ MỤC ─────────────────────
// §2 đòi "modular monolith rõ ràng". Cách dễ nhất là đổi tên thư mục cho giống sơ đồ trong tài liệu
// — và nó KHÔNG giữ được gì: một `import { prisma }` viết vào route ngày mai vẫn biên dịch, vẫn
// chạy, vẫn qua mọi test. Thư mục là cách SẮP XẾP; thứ giữ ranh giới là một phép kiểm chạy được.
//
// docs/adr/0001-modular-monolith.md khai ranh giới là `routes/ → services/ → Prisma`. File này biến
// câu đó thành thứ đỏ được.
//
// ── BỐN LUẬT ───────────────────────────────────────────────────────────────
//   [K1] route KHÔNG chạm thẳng Prisma       — truy vấn thuộc về service (có danh sách nợ, xem dưới)
//   [K2] service KHÔNG cầm `Response`/`NextFunction` — service trả DỮ LIỆU, route mới nói HTTP
//   [K3] service KHÔNG import route          — chiều phụ thuộc chỉ đi một hướng
//   [K4] không có vòng import giữa các service — vòng là dấu hiệu ranh giới đã nhoè
//
// ── NỢ ĐƯỢC KHAI, KHÔNG PHẢI NỢ ĐƯỢC THA ───────────────────────────────────
// Bảy file route đang chạm Prisma. Chúng được liệt kê TỪNG CÁI kèm lý do — không phải để tha, mà
// để: (a) file MỚI không được thêm vào danh sách mà không ai bàn; (b) khoản nợ này nhìn thấy được
// thay vì nằm im. Ép refactor cả bảy ngay trong đợt này là sửa mã đang chạy đúng để chiều một sơ
// đồ, đúng thứ §0 và §50 cấm — và §54 xếp "kiến trúc sạch" ở hạng 8, dưới cả hiệu năng.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const GOC = path.resolve(import.meta.dirname, "../..");
const ROUTES = path.join(GOC, "src/routes");
const SERVICES = path.join(GOC, "src/services");

let loi = 0;
const buoc = (s) => console.log(`\n\x1b[1m▶ ${s}\x1b[0m`);
const ok = (s) => console.log(`  \x1b[32m✓ ${s}\x1b[0m`);
const xau = (s) => {
  console.log(`  \x1b[31m✗ ${s}\x1b[0m`);
  loi = 1;
};

/**
 * Route ĐANG chạm Prisma, kèm lý do. Thêm mục mới vào đây là một QUYẾT ĐỊNH — nếu bạn đang định
 * làm vậy chỉ để cổng xanh lại thì câu trả lời gần như chắc chắn là "chuyển truy vấn xuống service".
 */
const NO_KY_THUAT = new Map([
  ["export.routes.ts", "hai lần đọc Quote CHỈ để kiểm quyền + kích thước trước khi sinh file; chuyển xuống service thì service phải trả về một hình dạng chỉ route này dùng"],
  ["files.routes.ts", "9 truy vấn quanh UploadObject — đây thực chất là service viết thẳng trong route; là mục ĐÁNG tách nhất trong danh sách"],
  ["import.routes.ts", "một lần đọc Quote để kiểm quyền trước khi nhận file"],
  ["jobs.routes.ts", "một lần đọc Quote để kiểm quyền trước khi xếp việc"],
  ["permissions.routes.ts", "một lần đọc User theo role để đếm — dữ liệu quản trị, không đi qua đường nghiệp vụ nào"],
  ["stream.routes.ts", "SSE: đọc Quote + User để dựng danh sách người đang mở; sống theo vòng đời kết nối chứ không theo request"],
  ["webhooks.routes.ts", "chỉ import KIỂU `Webhook` từ @prisma/client, không chạy truy vấn nào"],
]);

const tep = (thuMuc) => readdirSync(thuMuc).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
const doc = (thuMuc, f) => readFileSync(path.join(thuMuc, f), "utf8");

// Bỏ chú thích trước khi tìm `import` — một tên file nhắc trong chú thích không phải phụ thuộc.
const boChuThich = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── [K1] ────────────────────────────────────────────────────────────────────
buoc("[K1] Route không chạm thẳng Prisma");
{
  const viPham = [];
  for (const f of tep(ROUTES)) {
    const noi = boChuThich(doc(ROUTES, f));
    const chamDb = /from\s+["']\.\.\/db\.js["']/.test(noi) || /from\s+["']@prisma\/client["']/.test(noi);
    if (!chamDb) continue;
    if (NO_KY_THUAT.has(f)) continue;
    viPham.push(f);
  }
  if (viPham.length) {
    xau(`route MỚI chạm thẳng Prisma: ${viPham.join(", ")}`);
    console.log("      → chuyển truy vấn xuống src/services/, hoặc khai vào NO_KY_THUAT kèm lý do THẬT.");
  } else {
    ok(`không route mới nào chạm Prisma (${NO_KY_THUAT.size} file cũ đã khai nợ)`);
  }
  // Chiều ngược: mục nợ đã được trả thì phải GỠ khỏi danh sách, nếu không nó che một file
  // trùng tên xuất hiện sau này.
  const daTra = [...NO_KY_THUAT.keys()].filter((f) => {
    const p = path.join(ROUTES, f);
    let noi;
    try {
      noi = boChuThich(readFileSync(p, "utf8"));
    } catch {
      return true; // file không còn → mục nợ chết
    }
    return !/from\s+["']\.\.\/db\.js["']/.test(noi) && !/from\s+["']@prisma\/client["']/.test(noi);
  });
  if (daTra.length) xau(`mục nợ đã được trả nhưng còn trong danh sách — gỡ đi: ${daTra.join(", ")}`);
}

// ── [K2] ────────────────────────────────────────────────────────────────────
buoc("[K2] Service không cầm Response/NextFunction");
{
  const viPham = [];
  for (const f of tep(SERVICES)) {
    const noi = boChuThich(doc(SERVICES, f));
    // `Request` thì ĐƯỢC: service ở repo này đọc `req.session` / `req.query` — quyết định có chủ ý,
    // ghi ở ADR 0001. Nhưng cầm `Response`/`NextFunction` nghĩa là nó đang tự trả lời HTTP, tức
    // ranh giới đã đổ.
    if (/\b(Response|NextFunction)\b/.test(noi)) viPham.push(f);
  }
  if (viPham.length) xau(`service tự trả lời HTTP: ${viPham.join(", ")}`);
  else ok(`${tep(SERVICES).length} service đều trả DỮ LIỆU, không trả HTTP`);
}

// ── [K3] ────────────────────────────────────────────────────────────────────
buoc("[K3] Service không import route");
{
  const viPham = [];
  for (const f of tep(SERVICES)) {
    if (/from\s+["']\.\.\/routes\//.test(boChuThich(doc(SERVICES, f)))) viPham.push(f);
  }
  if (viPham.length) xau(`phụ thuộc ngược chiều: ${viPham.join(", ")} import từ src/routes/`);
  else ok("chiều phụ thuộc chỉ đi một hướng: routes → services");
}

// ── [K4] ────────────────────────────────────────────────────────────────────
buoc("[K4] Không có vòng import giữa các service");
{
  const canh = new Map();
  for (const f of tep(SERVICES)) {
    const noi = boChuThich(doc(SERVICES, f));
    const den = new Set();
    for (const m of noi.matchAll(/from\s+["']\.\/([\w.-]+)\.js["']/g)) den.add(`${m[1]}.ts`);
    canh.set(f, [...den].filter((x) => x !== f));
  }
  const mau = new Map(); // 0 chưa thăm · 1 đang trong ngăn xếp · 2 xong
  const vong = [];
  const di = (n, duong) => {
    if (mau.get(n) === 1) {
      vong.push([...duong.slice(duong.indexOf(n)), n].join(" → "));
      return;
    }
    if (mau.get(n) === 2) return;
    mau.set(n, 1);
    for (const k of canh.get(n) || []) di(k, [...duong, n]);
    mau.set(n, 2);
  };
  for (const n of canh.keys()) di(n, []);
  if (vong.length) {
    xau(`vòng phụ thuộc giữa service: ${vong.length}`);
    [...new Set(vong)].slice(0, 5).forEach((v) => console.log(`      · ${v}`));
  } else {
    ok(`${canh.size} service, không vòng nào`);
  }
}

console.log(loi ? "\n\x1b[31m❌ RANH GIỚI TẦNG ĐỎ\x1b[0m" : "\n\x1b[32m✅ RANH GIỚI TẦNG XANH\x1b[0m");
process.exit(loi);
