#!/usr/bin/env node
// QA nghiệp vụ + ma trận vai trò + hiệu năng, chạy trên DEV ĐANG CHẠY THẬT.
//
// Khác với bộ test tích hợp (dựng app trong tiến trình, DB test riêng), tệp này bắn HTTP vào bản
// ĐANG PHỤC VỤ — qua Cloudflare, qua reverse proxy, với dữ liệu DEV thật, mã hoá PII đang BẬT và
// kho object đang hoạt động. Nó bắt được lớp sai mà test tích hợp không thấy: cấu hình môi trường,
// biến thiếu, proxy, và hiệu năng thật.
//
//   node scripts/dev/rc-qa.mjs

const BASE = process.env.BASE || "https://dev.gianguyen.cloud";
// KHÔNG có mật khẩu mặc định trong mã nguồn — xem chú thích ở prisma/seed-demo.js.
const PASS = process.env.QA_PASS;
if (!PASS) {
  console.error("✗ Cần QA_PASS (mật khẩu tài khoản demo trên DEV). Không hard-code trong repo.");
  process.exit(1);
}

// Tài khoản seed sẵn trên DEV. Mỗi vai trò một góc nhìn khác nhau về cùng dữ liệu.
const ACTORS = {
  admin: "admin",
  manager: "demo_acc_a",   // tài khoản `manager` có thật nhưng không thuộc bộ seed demo (mật khẩu khác)
  accounthn: "accounthn",
  hr: "demo_hr",
  accountant: "demo_acct",
};

const jars = {};
const results = [];
const rec = (group, name, ok, detail = "") => { results.push({ group, name, ok, detail }); };

async function login(role) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ACTORS[role], password: PASS }),
  });
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  jars[role] = cookie;
  return r.status;
}

const call = (role, path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", cookie: jars[role] || "", ...(init.headers || {}) } });

/** Đo p50/p95 bằng cách gọi lặp — không dùng công cụ tải nặng, chỉ đủ để lộ N+1 rõ rệt. */
async function measure(role, path, n = 6) {
  const ms = [];
  for (let i = 0; i < n; i++) {
    const t = Date.now();
    const r = await call(role, path);
    ms.push(Date.now() - t);
    // Nghỉ giữa các nhịp: limiter API là 120 req/phút. Đo mà tự đụng trần thì con số đo được là
    // thời gian bị chặn, không phải thời gian xử lý — và tệ hơn, dễ bị đọc thành "app chậm".
    await new Promise((r2) => setTimeout(r2, 700));
    if (!r.ok && r.status !== 403) return { path, error: r.status };
  }
  ms.sort((a, b) => a - b);
  return { path, p50: ms[Math.floor(n * 0.5)], p95: ms[Math.floor(n * 0.95)], max: ms[n - 1] };
}

console.log(`▶ QA bản phát hành trên ${BASE}\n`);

// ── Đăng nhập mọi vai trò ────────────────────────────────────────────────────
for (const role of Object.keys(ACTORS)) {
  const s = await login(role);
  rec("đăng-nhập", role, s === 200, `HTTP ${s}`);
}

// ── §30 MA TRẬN VAI TRÒ: mỗi ô là một quyết định phân quyền đã tuyên bố ─────
// Mong đợi: 200 = được, 403 = chặn đúng. Bảng này phải khớp docs/product/ROLES_PERMISSIONS.md.
const MATRIX = [
  // [đường dẫn,          admin, manager, accounthn, hr,  accountant]
  ["/api/quotes", 200, 200, 200, 403, 403],
  ["/api/quotes/next-number", 200, 200, 403, 403, 403],
  // accounthn CÓ quote:read:own nên vào được trang dự án — nhưng phạm vi là "do mình tạo", mà họ
  // không tạo báo giá nào, nên nhận 200 với danh sách RỖNG. accountant có invoice:page → xem hết
  // (đúng nghiệp vụ: kế toán nhập hoá đơn cho mọi dự án). Kỳ vọng ban đầu 403/403 là tôi ghi sai
  // mô hình, không phải mã sai.
  ["/api/quotes/projects", 200, 200, 200, 403, 200],
  ["/api/customers", 200, 200, 403, 403, 403],
  ["/api/personnel", 200, 200, 403, 200, 200],
  ["/api/employees", 200, 200, 403, 403, 403],
  ["/api/analytics/overview", 200, 200, 403, 403, 403],
  ["/api/users", 200, 403, 403, 403, 403],
  ["/api/audit", 200, 200, 403, 403, 403],
  ["/api/admin/stats", 200, 403, 403, 403, 403],
  ["/api/venues", 200, 200, 403, 403, 403],
  ["/api/settings/notif.channels", 200, 200, 200, 200, 200],
];
const ORDER = ["admin", "manager", "accounthn", "hr", "accountant"];
console.log("── §30 Ma trận vai trò (thực tế vs tuyên bố)");
for (const [path, ...want] of MATRIX) {
  const got = [];
  for (let i = 0; i < ORDER.length; i++) {
    const r = await call(ORDER[i], path);
    got.push(r.status);
  }
  const ok = got.every((g, i) => g === want[i] || (want[i] === 200 && g === 404));
  rec("ma-trận-vai-trò", path, ok, ok ? "" : `mong ${want.join("/")} · thực ${got.join("/")}`);
  console.log(`   ${ok ? "✓" : "✖"} ${path.padEnd(34)} ${got.join(" ")}${ok ? "" : `   (mong ${want.join(" ")})`}`);
}

// ── §33 NHẤT QUÁN QUYỀN: một nguồn sự thật ─────────────────────────────────
console.log("\n── §33 Nhất quán quyền giữa /auth/me và /permissions/me");
for (const role of ORDER) {
  const a = await (await call(role, "/api/auth/me")).json();
  const b = await (await call(role, "/api/permissions/me")).json();
  const same = JSON.stringify([...(a.permissions || [])].sort()) === JSON.stringify([...(b.permissions || [])].sort());
  rec("nhất-quán-quyền", role, same, same ? "" : `lệch ${(a.permissions || []).length} vs ${(b.permissions || []).length}`);
  console.log(`   ${same ? "✓" : "✖"} ${role.padEnd(12)} ${(a.permissions || []).length} quyền`);
}

// ── §31 DÒ TÀI KHOẢN qua đăng nhập ─────────────────────────────────────────
console.log("\n── §31 Dò tài khoản");
const bodies = [];
for (const u of ["admin", "chac-chan-khong-ton-tai-9x8y7z"]) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: "MatKhauChacChanSai999" }),
  });
  bodies.push({ status: r.status, body: await r.text() });
}
const indistinguishable = bodies[0].status === bodies[1].status && bodies[0].body === bodies[1].body;
rec("dò-tài-khoản", "có-thật vs không-tồn-tại", indistinguishable, indistinguishable ? "" : JSON.stringify(bodies));
console.log(`   ${indistinguishable ? "✓" : "✖"} phản hồi không phân biệt được (HTTP ${bodies[0].status})`);

// ── §29 LUỒNG NGHIỆP VỤ: đọc được dữ liệu thật, PII giải mã đúng ───────────
console.log("\n── §29 Luồng nghiệp vụ + PII giải mã qua API");
const pl = await (await call("admin", "/api/personnel?size=5")).json();
const withPii = (pl.data || []).filter((r) => r.idCard || r.bankAccount || r.salary != null);
rec("nghiệp-vụ", "nhân-sự-đọc-được-PII", withPii.length > 0, `${withPii.length}/${(pl.data || []).length} hàng có PII`);
const leaked = (pl.data || []).some((r) => Object.keys(r).some((k) => k.endsWith("Enc") || k.endsWith("Idx") || k === "piiVersion"));
rec("nghiệp-vụ", "không-lộ-cột-kỹ-thuật", !leaked);
const cipherLeak = (pl.data || []).some((r) => String(r.idCard || "").startsWith("pii:v1:"));
rec("nghiệp-vụ", "không-trả-bản-mã-thô", !cipherLeak);
console.log(`   ${withPii.length > 0 ? "✓" : "✖"} PII giải mã: ${withPii.length}/${(pl.data || []).length} hàng`);
console.log(`   ${!leaked ? "✓" : "✖"} không lộ cột *Enc/*Idx/piiVersion`);

for (const [name, path] of [
  ["báo giá", "/api/quotes?size=5"], ["khách hàng", "/api/customers?size=5"],
  ["danh bạ", "/api/employees?size=5"], ["dự án", "/api/quotes/projects"],
  ["hoá đơn", "/api/analytics/overview"], ["danh mục rạp", "/api/venues"],
  ["nhật ký", "/api/audit?size=5"], ["thông báo", "/api/notifications"],
]) {
  const r = await call("admin", path);
  rec("nghiệp-vụ", name, r.ok, `HTTP ${r.status}`);
  console.log(`   ${r.ok ? "✓" : "✖"} ${name.padEnd(14)} HTTP ${r.status}`);
}

// ── §44 HIỆU NĂNG ───────────────────────────────────────────────────────────
console.log("\n── §44 Hiệu năng (ms, qua Cloudflare + proxy)");
const PERF = ["/api/quotes?size=20", "/api/search?q=a&types=quote,customer", "/api/analytics/overview",
  "/api/quotes/projects", "/api/personnel?size=50", "/api/customers?size=20"];
const slow = [];
for (const p of PERF) {
  const m = await measure("admin", p);
  if (m.error) { console.log(`   ✖ ${p} → HTTP ${m.error}`); continue; }
  const bad = m.p95 > 2000;
  if (bad) slow.push(p);
  console.log(`   ${bad ? "⚠" : "✓"} ${p.padEnd(44)} p50=${String(m.p50).padStart(4)} p95=${String(m.p95).padStart(4)} max=${m.max}`);
  rec("hiệu-năng", p, !bad, `p95=${m.p95}ms`);
}

// ── Tổng kết ────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n── KẾT QUẢ: ${results.length - failed.length}/${results.length} đạt`);
for (const f of failed) console.log(`   ✖ [${f.group}] ${f.name}: ${f.detail}`);
process.exit(failed.length ? 1 : 0);
