#!/usr/bin/env node
// Liệt kê MỌI endpoint HTTP từ mã nguồn — nguồn sự thật duy nhất về số lượng endpoint.
//
// Vì sao cần: README từng ghi "141 HTTP endpoints" trong khi docs/product/ROLES_PERMISSIONS.md ghi "133". Cả hai đều
// đếm tay nên cả hai đều có thể sai, và không ai biết cái nào. Con số đếm tay lệch âm thầm mỗi lần
// thêm route — mà một endpoint không nằm trong ma trận phân quyền là một endpoint chưa ai soát.
//
//   node scripts/ci/endpoint-inventory.mjs                 # bảng cho người đọc
//   node scripts/ci/endpoint-inventory.mjs --json          # JSON cho công cụ
//   node scripts/ci/endpoint-inventory.mjs --check         # đối chiếu TỪNG DÒNG với docs/product/ROLES_PERMISSIONS.md
//   node scripts/ci/endpoint-inventory.mjs --check-guards  # route KHÔNG có middleware gác nào → exit 1
//   node scripts/ci/endpoint-inventory.mjs --check-write-authz  # route GHI không khai quyền ở đâu cả → exit 1
//
// ── LỖ THẬT SỰ, VÀ CÁI GÌ BỊT NÓ ────────────────────────────────────────────
// Lỗ cần bịt là: "thêm một route mà không ai soát quyền, nhớ +1 vào tài liệu, CI vẫn xanh".
//
// `--check-guards` KHÔNG bịt được lỗ đó, và bản trước của khối chú thích này nói sai khi gọi nó là
// "phần bù". ĐÃ ĐO bằng chính hàm `inventory()` trong file này: 84/137 endpoint có `capRoute` RỖNG
// và chỉ dựa vào `capRouter`, vì 20/24 file route mở đầu bằng `router.use(requireAuth)` — mà
// `routerLevelGuards` coi một dòng như thế là phủ MỌI route trong file. Một route mới thêm vào bất
// kỳ file nào trong số đó KHÔNG BAO GIỜ lọt vào `routesWithoutGuards`. Phép kiểm ấy chỉ thật sự có
// hiệu lực ở 4 file không có `router.use(<guard>)` cấp router: src/app.ts, auth.routes.ts,
// jobs.routes.ts, stream.routes.ts (đã kiểm ngược: thêm một route hở vào auth.routes.ts thì exit 1).
// Nó vẫn đáng giữ — nhưng đúng tầm của nó là "chặn route hở ở 4 file đó", không hơn.
//
// `--check-write-authz` (thêm sau) đóng nốt phần còn lại của lỗ đó cho các endpoint GHI: xem khối
// "CỔNG PHÂN QUYỀN CHO ENDPOINT GHI" ở giữa file. Tóm tắt: `requireAuth` không được tính là gác
// quyền, và một dòng ma trận có cột QUYỀN bỏ trống (`—`) cũng không được tính là đã soát.
//
// Thứ THỰC SỰ bịt lỗ là `--check`, sau khi bản này nâng nó từ ĐẾM SỐ lên ĐỐI CHIẾU TỪNG DÒNG với
// bảng ma trận trong docs/product/ROLES_PERMISSIONS.md. `docMatrix()` bóc ra (METHOD, đường dẫn)
// của từng dòng bảng và so HAI CHIỀU với mã nguồn:
//   • endpoint có trong mã mà KHÔNG có dòng ma trận → đỏ. Đây chính là kịch bản trên: sửa con số
//     137→138 không tạo ra dòng bảng, nên không qua được. Muốn xanh thì phải viết một dòng ma
//     trận, tức phải điền cột QUYỀN / P.VI / T.NGUYÊN — tức phải SOÁT.
//   • dòng ma trận KHÔNG còn endpoint tương ứng → đỏ (dòng chết ở lại thì lần sau một route mới
//     trùng đường dẫn được tha im lặng).
//
// Giới hạn có chủ đích: đây là bộ phân tích theo mẫu, không phải trình biên dịch TS. Nó KHÔNG chạy
// mã (chạy mã lúc kiểm kê là tự chuốc lấy side effect). Đổi lại, mọi lối khai báo route bất thường
// sẽ hiện ra ở cảnh báo "router import mà chưa gắn" thay vì âm thầm biến mất.
//
// ── ĐIỀU NÀY *KHÔNG* KIỂM ĐƯỢC (đọc trước khi tin) ──────────────────────────
//   • Ma trận nói ĐÚNG hay không thì script không biết. Nó ép mỗi endpoint phải CÓ một dòng đã
//     điền cột QUYỀN; nó không kiểm được quyền ghi trong dòng đó có khớp với mã hay không, vì rất
//     nhiều route ở repo này kiểm quyền TRONG thân handler (`can`, `canOnQuote`, `loadAuthorized`)
//     chứ không bằng middleware. Ép so cột QUYỀN với middleware sẽ đỏ oan 46/78 route ghi.
//   • Có gác ≠ gác ĐÚNG. Script không biết `requirePermission(P.VENUE_READ)` là quyền hợp lý hay
//     quá rộng cho route đó — nó chỉ biết CÓ một middleware tên như vậy.
//   • Guard đặt trong một hàm bọc (`asyncHandler(guard(...))`) hoặc kiểm quyền viết tay TRONG thân
//     handler không được tính — nên "tập guard rỗng" là dấu hiệu để NGƯỜI xem lại, không phải bản án.
//   • `router.use(<middleware>)` được coi là phủ MỌI route trong cùng file, kể cả route khai báo
//     TRƯỚC dòng đó (thứ tự thật của Express thì không như vậy) — xem phần đo 84/137 ở trên.
//   • Sub-router gắn bằng `router.use("/x", sub)` bên trong một file route vẫn không được lần theo.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// scripts/ci/<file> → lùi HAI cấp về gốc repo.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const METHODS = ["get", "post", "put", "delete", "patch", "all"];

/** Bóc literal đường dẫn đầu tiên sau dấu `(` — chịu được khai báo xuống dòng và mảng đường dẫn. */
function firstPathArg(text, fromIndex) {
  let i = fromIndex;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "/" && text[i + 1] === "/") { const nl = text.indexOf("\n", i); i = nl < 0 ? text.length : nl + 1; continue; }
    if (ch === "/" && text[i + 1] === "*") { const e = text.indexOf("*/", i); i = e < 0 ? text.length : e + 2; continue; }
    break;
  }
  // Dạng mảng: app.get(["/app", "/app/*"], …)
  if (text[i] === "[") {
    const end = text.indexOf("]", i);
    if (end < 0) return null;
    const paths = [...text.slice(i + 1, end).matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1]);
    return paths.length ? paths : null;
  }
  const q = text[i];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  const end = text.indexOf(q, i + 1);
  if (end < 0) return null;
  return [text.slice(i + 1, end)];
}

// Tên các middleware được COI LÀ gác. Cố ý là danh sách đóng: thêm một middleware gác mới thì phải
// thêm vào đây, và việc phải sửa file này chính là lúc người ta nghĩ về nó.
const GUARDS = ["requireAuth", "requirePermission", "requireAnyPermission", "requireRole"];
const GUARD_RE = new RegExp(`\\b(${GUARDS.join("|")})\\b`, "g");

/**
 * Từ vị trí NGAY SAU dấu `(` của lời gọi, trả về đoạn văn bản của TOÀN BỘ danh sách đối số
 * (tới dấu `)` cân bằng). Bỏ qua chuỗi, chú thích và regex literal — nếu không, một `)` nằm trong
 * chuỗi hay trong regex sẽ cắt nhầm và guard phía sau biến mất khỏi kết quả (âm tính giả: CI xanh
 * trong khi route thật sự không được gác).
 */
export function argsSlice(text, fromIndex) {
  let depth = 1, i = fromIndex;
  // Ký tự có nghĩa gần nhất trước `/` quyết định đó là regex literal hay phép chia.
  let truoc = "(";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") { const nl = text.indexOf("\n", i); i = nl < 0 ? text.length : nl + 1; continue; }
    if (ch === "/" && text[i + 1] === "*") { const e = text.indexOf("*/", i); i = e < 0 ? text.length : e + 2; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch; i++;
      while (i < text.length && text[i] !== q) i += text[i] === "\\" ? 2 : 1;
      i++; truoc = q; continue;
    }
    if (ch === "/" && /[(,=:[!&|?{};+\n]/.test(truoc)) {
      i++; let lop = false;                       // `lop` = đang trong lớp ký tự [...] (ở đó `/` không kết thúc regex)
      while (i < text.length) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === "[") lop = true;
        else if (text[i] === "]") lop = false;
        else if (text[i] === "/" && !lop) break;
        i++;
      }
      i++; truoc = "/"; continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return text.slice(fromIndex, i);
    }
    if (!/\s/.test(ch)) truoc = ch;
    i++;
  }
  return text.slice(fromIndex); // không cân bằng (file cụt) — trả hết còn hơn nuốt im lặng
}

/** Tên guard xuất hiện trong một đoạn văn bản, không trùng lặp, giữ thứ tự. */
const guardsIn = (src) => [...new Set([...src.matchAll(GUARD_RE)].map((m) => m[1]))];

/**
 * Guard cấp ROUTER: `router.use(<middleware>)` KHÔNG kèm đường dẫn (có đường dẫn thì chỉ phủ một
 * nhánh con, không suy ra được ở mức phân tích tĩnh này nên bỏ qua cho an toàn).
 */
export function routerLevelGuards(text, objName) {
  const out = [];
  for (const m of text.matchAll(new RegExp(`\\b${objName}\\.use\\s*\\(`, "g"))) {
    const args = argsSlice(text, m.index + m[0].length);
    if (/^\s*["'`]/.test(args)) continue; // dạng use("/x", sub): không phải guard cho cả router
    out.push(...guardsIn(args));
  }
  return [...new Set(out)];
}

/** Mọi lời gọi `<obj>.<method>(` trong một file, kèm literal đường dẫn + guard cấp route. */
export function extractRoutes(text, objName) {
  const out = [];
  const capRouter = routerLevelGuards(text, objName);
  const re = new RegExp(`\\b${objName}\\.(${METHODS.join("|")})\\s*\\(`, "g");
  for (const m of text.matchAll(re)) {
    const dau = m.index + m[0].length;
    const paths = firstPathArg(text, dau);
    if (!paths) continue; // vd app.use(fn): middleware không đường dẫn — không phải endpoint
    const capRoute = guardsIn(argsSlice(text, dau));
    for (const p of paths) out.push({ method: m[1].toUpperCase(), path: p, capRoute, capRouter });
  }
  return out;
}

const joinPath = (prefix, sub) => (prefix.replace(/\/+$/, "") + (sub === "/" ? "" : sub)) || "/";

/**
 * Dựng danh sách endpoint từ mã nguồn. Tách thành HÀM (thay vì chạy ở thân module) để bài test
 * import được các bộ phân tích mà không kéo theo việc đọc file + in bảng + process.exit.
 */
export function inventory() {
const appSrc = readFileSync(join(ROOT, "src/app.ts"), "utf8");

// Bản đồ gắn router + bản đồ import.
const mounts = [...appSrc.matchAll(/app\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g)]
  .map((m) => ({ prefix: m[1], varName: m[2] }));
const imports = new Map(
  [...appSrc.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+["'`]\.\/routes\/([\w.-]+)\.js["'`]/g)]
    .map((m) => [m[1], `src/routes/${m[2]}.ts`])
);

const rows = [];

// Endpoint khai báo THẲNG trên app (/metrics, /livez, /readyz, /api/health, route phục vụ SPA).
// Dễ bị bỏ sót vì không nằm trong src/routes/.
for (const r of extractRoutes(appSrc, "app")) {
  rows.push({ ...r, source: "src/app.ts", mount: "" });
}

// Endpoint trong từng router. Nhiều router có thể gắn CÙNG prefix (importRoutes + quotesRoutes đều ở
// /api/quotes) và một router có thể gắn ở gốc /api (jobsRoutes) — lặp theo `mounts` xử lý đúng cả hai.
for (const { prefix, varName } of mounts) {
  const file = imports.get(varName);
  if (!file) continue; // app.use("/api/", bearerAuth): middleware, không phải router
  for (const r of extractRoutes(readFileSync(join(ROOT, file), "utf8"), "router")) {
    rows.push({ method: r.method, path: joinPath(prefix, r.path), source: file, mount: prefix, capRoute: r.capRoute, capRouter: r.capRouter });
  }
}

const mountedVars = new Set(mounts.map((m) => m.varName));
const unmounted = [...imports.keys()].filter((v) => !mountedVars.has(v));

rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
return { rows, unmounted };
}

/** Bỏ dấu `/` thừa ở cuối để `/api/settings/` và `/api/settings` là MỘT endpoint. */
export const chuanDuong = (s) => s.replace(/\/+$/, "") || "/";

/** Hai đoạn đầu của một đường dẫn — dùng làm gốc cho các đường viết tắt trong cùng một ô bảng. */
const goc2Doan = (p) => "/" + p.split("/").filter(Boolean).slice(0, 2).join("/");

/**
 * Bóc bảng ma trận phân quyền thành danh sách { method, path, quyen }.
 *
 * ── QUY ƯỚC CỦA BẢNG (đọc trước khi sửa regex) ───────────────────────────────
 *   · Tiêu đề mục `## \`/api/auth\` — 12 endpoint` khai TIỀN TỐ. Một mục có thể khai NHIỀU tiền tố
 *     (`## \`/api/admin\` (3) · \`/api/settings\` (4) · …`); khi đó đường dẫn trong dòng đã tự mang
 *     tên nhóm (`/settings/:key`) nên chỉ cần ghép `/api`.
 *   · Ô phương thức có thể gộp: `PUT/DELETE`, `POST/PUT/DELETE`.
 *   · Ô đường dẫn có thể gộp nhiều đường bằng dấu `·`, và đường THỨ HAI trở đi viết TẮT theo nhóm
 *     của đường đầu: `\`/mfa/setup\` · \`/enable\` · \`/disable\`` = ba endpoint dưới `/api/mfa`.
 *     Vì thế đường tiếp theo được ghép vào GỐC HAI ĐOẠN của đường đầu, trừ khi tự nó đã tuyệt đối.
 *   · `\`/webhooks/*\`` là ký tự đại diện: phủ mọi endpoint bắt đầu bằng `/api/webhooks/`.
 *   · Mục "Ngoài router" không khai tiền tố nào — đường dẫn ở đó đã tuyệt đối sẵn.
 *
 * Đã đối chiếu: bộ bóc này khớp 137/137 endpoint của mã nguồn theo CẢ HAI CHIỀU, không sót không thừa.
 */
export function docMatrix(md) {
  const out = [];
  let tienTo = [];
  for (const ln of md.split(/\r?\n/)) {
    const h = /^##\s+(.*)$/.exec(ln);
    if (h) {
      tienTo = [...h[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((x) => x.startsWith("/"));
      continue;
    }
    const r = /^\|\s*([A-Z][A-Z/]*)\s*\|\s*(.+?)\s*\|\s*([^|]*)\|\s*([^|]*)\|/.exec(ln);
    if (!r || r[1] === "M") continue;            // "M" = dòng tiêu đề cột
    const methods = r[1].split("/").filter(Boolean);
    const raws = [...r[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (!raws.length) continue;                   // dòng chú giải cột, không phải endpoint
    const quyen = (r[4] || "").trim();            // cột QUYỀN (mục "Ngoài router" cũng đặt QUYỀN ở cột 4)
    const daGiai = [];
    for (const raw of raws) {
      let duong;
      if (daGiai.length === 0) {
        duong = tienTo.length === 1 ? tienTo[0] + raw
          : (raw.startsWith("/api/") || tienTo.length === 0) ? raw
          : "/api" + raw;
      } else {
        const goc = goc2Doan(daGiai[0]);
        duong = (raw.startsWith("/api/") || raw.startsWith(goc)) ? raw : goc + "/" + raw.replace(/^\//, "");
      }
      daGiai.push(duong);
    }
    for (const m of methods) for (const d of daGiai) out.push({ method: m, path: chuanDuong(d), quyen });
  }
  return out;
}

/**
 * Một dòng ma trận có phủ endpoint này không (kể cả dòng ký tự đại diện `/x/*`).
 * `/webhooks/*` phủ CẢ `/api/webhooks` lẫn `/api/webhooks/:id` — dòng đó viết ra để gộp mọi
 * endpoint GHI của nhóm webhook, và `POST /api/webhooks` là một trong số đó.
 */
const dongPhu = (d, method, path) => {
  if (d.method !== method) return false;
  if (!d.path.endsWith("/*")) return d.path === path;
  const goc = d.path.slice(0, -2);
  return path === goc || path.startsWith(goc + "/");
};

/**
 * Đối chiếu HAI CHIỀU giữa mã nguồn và bảng ma trận. Hàm THUẦN — bài test dựng được dữ liệu giả.
 * Đây là phép kiểm thật sự bịt lỗ "thêm route không ai soát mà nhớ +1 con số"; xem đầu file.
 */
export function doiChieuMaTran(rows, doc) {
  const thieuDong = rows
    .filter((r) => !doc.some((d) => dongPhu(d, r.method, chuanDuong(r.path))))
    .map((r) => ({ method: r.method, path: chuanDuong(r.path), source: r.source }));
  const maSet = new Set(rows.map((r) => `${r.method} ${chuanDuong(r.path)}`));
  const dongChet = doc.filter((d) => !d.path.endsWith("/*") && !maSet.has(`${d.method} ${d.path}`));
  return { thieuDong, dongChet };
}

// ── CỔNG PHÂN QUYỀN CHO ENDPOINT GHI ────────────────────────────────────────
// `--check-guards` coi `requireAuth` là "có gác", nên một route GHI mới thêm vào bất kỳ file nào
// mở đầu bằng `router.use(requireAuth)` (20/24 file) luôn xanh dù không ai kiểm quyền. `--check`
// thì đòi có DÒNG ma trận nhưng không đọc cột QUYỀN — một dòng ghi `—` cũng qua.
//
// Cổng này đòi mỗi endpoint GHI (POST/PUT/PATCH/DELETE) có ÍT NHẤT một trong ba:
//   (a) middleware PHÂN QUYỀN ở cấp route/router — `requireAuth` KHÔNG tính (đó là xác thực);
//   (b) một dòng ma trận có cột QUYỀN ghi quyền THẬT — hợp lệ vì repo này kiểm quyền trong thân
//       handler (`can`, `canOnQuote`) hoặc trong service rất nhiều, không phải bằng middleware;
//   (c) tên trong MIEN_TRU_GHI, kèm lý do viết ngay tại chỗ.
// ĐÃ ĐO lúc thêm cổng: 78 endpoint GHI, 46 không có middleware phân quyền, và sau khi tính cột
// QUYỀN thì còn đúng 17 phải miễn trừ — toàn bộ là đường TỰ PHỤC VỤ trên chính tài khoản/phiên
// của người gọi. Cổng KHÔNG khẳng định quyền ấy ĐÚNG (xem phần giới hạn ở đầu file); nó khẳng
// định không ai thêm được route GHI mà bỏ trống chỗ "ai được gọi".
export const PHUONG_THUC_GHI = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// `requireAuth` CỐ Ý không nằm đây: nó trả lời "anh là ai", không trả lời "anh được làm gì".
const AUTHZ_MIDDLEWARE = ["requirePermission", "requireAnyPermission", "requireRole"];

/**
 * Ô QUYỀN có khai một quyền thật không. Quyền trong ma trận luôn nằm trong code-span và có dạng
 * `nhóm:hành-động` (`quote:update:all`, `settings:manage`) hoặc `role=admin`. Ô rỗng, ô `—`, và ô
 * `— *(giải thích)*` đều KHÔNG tính là đã khai.
 */
export const quyenDaKhai = (o) => /`[A-Za-z_]+(?:[:=][-A-Za-z_*:.]+)+`|`role=/.test(String(o || ""));

/**
 * Endpoint GHI không có bằng chứng phân quyền nào. Hàm THUẦN (nhận rows + ma trận đã bóc + tập
 * miễn trừ) để bài test dựng được ca giả mà không phải đọc file.
 */
export function mutationsWithoutAuthz(rows, doc, mienTru = new Set()) {
  return rows
    .filter((r) => PHUONG_THUC_GHI.has(r.method))
    .filter((r) => ![...(r.capRoute || []), ...(r.capRouter || [])].some((g) => AUTHZ_MIDDLEWARE.includes(g)))
    .filter((r) => !doc.some((d) => dongPhu(d, r.method, chuanDuong(r.path)) && quyenDaKhai(d.quyen)))
    .filter((r) => !mienTru.has(`${r.method} ${chuanDuong(r.path)}`))
    .map((r) => ({ method: r.method, path: chuanDuong(r.path), source: r.source }));
}

/**
 * Endpoint GHI CỐ Ý không đòi quyền, kèm lý do. Tất cả đều là đường TỰ PHỤC VỤ: chủ thể của thao
 * tác chính là người gọi, nên không có quyền nào để đòi — chốt phạm vi nằm ở chỗ khác (phiên,
 * token dùng một lần, hoặc `req.session.userId` trong handler).
 */
export const MIEN_TRU_GHI = new Map([
  // ── Cửa vào: chưa có phiên thì chưa có quyền để kiểm ──
  ["POST /api/auth/login", "đăng nhập bằng mật khẩu — cửa vào"],
  ["POST /api/auth/logout", "huỷ CHÍNH phiên của người gọi"],
  ["POST /api/auth/token", "đăng nhập cho client JWT"],
  ["POST /api/auth/token/refresh", "bí mật nằm TRONG refresh token"],
  ["POST /api/auth/token/revoke", "thu hồi một refresh token bằng chính token đó"],
  ["POST /api/auth/token/revoke-all", "thu hồi token của CHÍNH mình"],
  ["POST /api/auth/forgot-password", "vào bằng email, không bằng phiên"],
  ["POST /api/auth/accept-invite", "đặt mật khẩu bằng token mời dùng một lần"],
  // ── Tự phục vụ trên chính tài khoản mình ──
  ["POST /api/auth/change-password", "đổi mật khẩu của CHÍNH mình (đòi mật khẩu cũ)"],
  ["POST /api/auth/profile", "sửa hồ sơ của CHÍNH mình"],
  ["POST /api/mfa/setup", "bật MFA cho CHÍNH tài khoản mình"],
  ["POST /api/mfa/enable", "xác nhận MFA của CHÍNH mình"],
  ["POST /api/mfa/disable", "tắt MFA của CHÍNH mình (đòi mật khẩu)"],
  ["POST /api/gdpr/me/delete", "yêu cầu xoá dữ liệu của CHÍNH mình — quyền GDPR của chủ thể"],
  ["POST /api/notifications/:id/read", "đánh dấu đã đọc thông báo của CHÍNH mình"],
  ["POST /api/notifications/read-all", "đánh dấu đã đọc mọi thông báo của CHÍNH mình"],
  ["POST /api/stream/presence", "báo hiện diện của CHÍNH phiên đang mở"],
]);

/**
 * Route KHÔNG có middleware gác nào (cấp route lẫn cấp router) và KHÔNG nằm trong danh sách miễn trừ.
 * Hàm THUẦN: nhận danh sách đã dựng + tập miễn trừ, không đọc file, không thoát tiến trình — nhờ vậy
 * bài test dựng được một route "quên gác" rồi kiểm chính lớp phát hiện này.
 */
export function routesWithoutGuards(rows, mienTru = new Set()) {
  return rows
    .filter((r) => !(r.capRoute?.length || r.capRouter?.length))
    .filter((r) => !mienTru.has(`${r.method} ${r.path}`));
}

function main() {
const { rows, unmounted } = inventory();
const args = process.argv.slice(2);

if (args.includes("--json")) {
  console.log(JSON.stringify({ total: rows.length, unmounted, endpoints: rows }, null, 2));
  process.exit(0);
}

if (args.includes("--check")) {
  let bad = false;
  // Đối chiếu MỌI nơi công bố con số. Chỉ canh ma trận là chưa đủ: README từng ghi 141 trong khi ma
  // trận ghi 133 và mã nguồn có 138 — ba nguồn, ba con số, không ai biết cái nào đúng.
  const sources = [
    { file: "docs/product/ROLES_PERMISSIONS.md", re: /toàn bộ\s+(\d+)\s+endpoint/i },
    { file: "README.md", re: /(\d+)\s+HTTP endpoints/i },
  ];
  for (const { file, re } of sources) {
    const m = readFileSync(join(ROOT, file), "utf8").match(re);
    if (!m) {
      console.error(`✖ Không tìm thấy số endpoint công bố trong ${file}`);
      bad = true;
    } else if (Number(m[1]) !== rows.length) {
      console.error(`✖ LỆCH SỐ ENDPOINT: mã nguồn có ${rows.length}, ${file} ghi ${m[1]}.`);
      bad = true;
    }
  }
  if (bad) {
    console.error("  Thêm/xoá route thì PHẢI cập nhật ma trận — endpoint ngoài ma trận là endpoint chưa ai soát quyền.");
  }

  // ĐỐI CHIẾU TỪNG DÒNG — đây mới là phép kiểm bịt được lỗ "thêm route không ai soát mà nhớ +1 con
  // số" (xem khối đầu file). So số lượng thôi thì sửa 137→138 là qua; đòi một DÒNG ma trận thì
  // không, vì viết dòng đó buộc phải điền cột QUYỀN / P.VI / T.NGUYÊN.
  const doc = docMatrix(readFileSync(join(ROOT, "docs/product/ROLES_PERMISSIONS.md"), "utf8"));
  const { thieuDong, dongChet } = doiChieuMaTran(rows, doc);
  if (thieuDong.length) {
    console.error(`✖ ${thieuDong.length} endpoint CÓ TRONG MÃ nhưng KHÔNG có dòng nào trong ma trận phân quyền:`);
    for (const r of thieuDong) console.error(`    ${r.method.padEnd(7)} ${r.path.padEnd(52)} ${r.source}`);
    console.error("  Thêm một dòng vào docs/product/ROLES_PERMISSIONS.md, mục đúng tiền tố, điền đủ cột");
    console.error("  QUYỀN / P.VI / T.NGUYÊN / T.THÁI / N.CẢM. Nâng con số ở đầu tài liệu là CHƯA ĐỦ.");
    bad = true;
  }
  if (dongChet.length) {
    console.error(`✖ ${dongChet.length} dòng ma trận không còn endpoint tương ứng trong mã:`);
    for (const d of dongChet) console.error(`    ${d.method.padEnd(7)} ${d.path}`);
    console.error("  Xoá dòng chết: để lại thì lần sau một route MỚI trùng đường dẫn được tha im lặng.");
    bad = true;
  }

  if (unmounted.length) {
    console.error(`✖ Router được import nhưng không gắn vào app: ${unmounted.join(", ")}`);
    bad = true;
  }
  if (bad) process.exit(1);
  console.log(`✓ ${rows.length} endpoint — khớp README.md và KHỚP TỪNG DÒNG với ma trận trong docs/product/ROLES_PERMISSIONS.md`);
  process.exit(0);
}

if (args.includes("--check-guards")) {
  // MIỄN TRỪ TƯỜNG MINH. Mỗi dòng là một endpoint CỐ Ý không có middleware gác, kèm lý do. Danh sách
  // ngắn và phải sửa file này mới thêm được — đó là chốt chặn: người thêm endpoint công khai thứ 12
  // buộc phải viết ra lý do, thay vì im lặng để CI xanh.
  const MIEN_TRU = new Map([
    // ── Công khai theo THIẾT KẾ: chính chúng là cửa vào, không thể đòi phiên có sẵn ──
    ["POST /api/auth/login", "cửa đăng nhập (phiên cookie)"],
    ["POST /api/auth/logout", "huỷ phiên; gọi khi không có phiên cũng vô hại"],
    ["POST /api/auth/token", "cửa đăng nhập cho client JWT — cùng authCore với /login"],
    ["POST /api/auth/token/refresh", "đổi cặp token; bí mật nằm TRONG refresh token"],
    ["POST /api/auth/token/revoke", "thu hồi một refresh token bằng chính token đó"],
    ["POST /api/auth/forgot-password", "quên mật khẩu — vào bằng email, không bằng phiên"],
    ["GET /api/auth/invite/:token", "xem lời mời bằng token dùng một lần (tokenLimiter)"],
    ["POST /api/auth/accept-invite", "nhận lời mời: đặt mật khẩu bằng token dùng một lần"],
    // ── Hạ tầng + SPA ──
    ["GET /livez", "probe sống"],
    ["GET /readyz", "probe sẵn sàng"],
    ["GET /api/health", "probe cho load balancer"],
    ["GET /metrics", "Prometheus — chốt riêng bằng METRICS_TOKEN trong chính handler"],
    ["GET /api/csrf-token", "cấp mã CSRF cho phiên hiện tại"],
    ["GET /app2", "trả index.html của SPA"],
    ["GET /app2/*", "trả index.html của SPA"],
    ["GET *", "catch-all trả index.html của SPA"],
  ]);
  const thieu = routesWithoutGuards(rows, new Set(MIEN_TRU.keys()));
  if (thieu.length) {
    console.error(`✖ ${thieu.length} endpoint KHÔNG có middleware gác nào (route lẫn router):`);
    for (const r of thieu) console.error(`    ${r.method.padEnd(7)} ${r.path.padEnd(52)} ${r.source}`);
    console.error("  Gắn requireAuth/requirePermission/requireAnyPermission/requireRole, hoặc — nếu endpoint");
    console.error("  CỐ Ý công khai — thêm vào MIEN_TRU trong scripts/ci/endpoint-inventory.mjs kèm lý do.");
    process.exit(1);
  }
  // Miễn trừ thừa cũng là lỗi: nó nghĩa là endpoint đã đổi/biến mất mà miễn trừ ở lại, và lần sau
  // một route MỚI trùng tên sẽ được tha im lặng.
  const khoa = new Set(rows.map((r) => `${r.method} ${r.path}`));
  const thua = [...MIEN_TRU.keys()].filter((k) => !khoa.has(k));
  if (thua.length) {
    console.error(`✖ Miễn trừ trỏ vào endpoint không còn tồn tại: ${thua.join(", ")}`);
    process.exit(1);
  }
  console.log(`✓ ${rows.length} endpoint — mọi endpoint đều có middleware gác, trừ ${MIEN_TRU.size} miễn trừ tường minh`);
  console.log("  (LƯU Ý: đây là kiểm CÓ GÁC HAY KHÔNG, không phải gác ĐÚNG — xem phần giới hạn ở đầu file.)");
  process.exit(0);
}

if (args.includes("--check-write-authz")) {
  const doc = docMatrix(readFileSync(join(ROOT, "docs/product/ROLES_PERMISSIONS.md"), "utf8"));
  const thieu = mutationsWithoutAuthz(rows, doc, new Set(MIEN_TRU_GHI.keys()));
  if (thieu.length) {
    console.error(`✖ ${thieu.length} endpoint GHI không có bằng chứng phân quyền nào:`);
    for (const r of thieu) console.error(`    ${r.method.padEnd(7)} ${r.path.padEnd(52)} ${r.source}`);
    console.error("  requireAuth KHÔNG tính — nó chỉ trả lời 'anh là ai'. Làm MỘT trong ba:");
    console.error("   (a) gắn requirePermission/requireAnyPermission/requireRole cho route;");
    console.error("   (b) điền cột QUYỀN của dòng ma trận trong docs/product/ROLES_PERMISSIONS.md");
    console.error("       (hợp lệ khi quyền được kiểm trong handler/service — hãy ghi ĐÚNG quyền đang kiểm);");
    console.error("   (c) nếu endpoint CỐ Ý không đòi quyền (đường tự phục vụ), thêm vào MIEN_TRU_GHI");
    console.error("       trong scripts/ci/endpoint-inventory.mjs kèm lý do.");
    process.exit(1);
  }
  const khoa = new Set(rows.map((r) => `${r.method} ${chuanDuong(r.path)}`));
  const thua = [...MIEN_TRU_GHI.keys()].filter((k) => !khoa.has(k));
  if (thua.length) {
    console.error(`✖ Miễn trừ GHI trỏ vào endpoint không còn tồn tại: ${thua.join(", ")}`);
    process.exit(1);
  }
  const soGhi = rows.filter((r) => PHUONG_THUC_GHI.has(r.method)).length;
  console.log(`✓ ${soGhi} endpoint GHI — mỗi cái đều có middleware phân quyền HOẶC quyền ghi rõ trong ma trận, trừ ${MIEN_TRU_GHI.size} miễn trừ tự-phục-vụ`);
  console.log("  (LƯU Ý: cổng này kiểm CÓ KHAI QUYỀN hay không, không kiểm quyền đó có ĐÚNG không.)");
  process.exit(0);
}

const byMount = new Map();
for (const r of rows) {
  const k = r.mount || "(khai báo thẳng trên app)";
  byMount.set(k, (byMount.get(k) || 0) + 1);
}
for (const r of rows) {
  const g = [...new Set([...(r.capRoute || []), ...(r.capRouter || [])])].join("+") || "— KHÔNG GÁC —";
  console.log(`${r.method.padEnd(7)} ${r.path.padEnd(52)} ${g.padEnd(34)} ${r.source}`);
}
console.log("\n── theo prefix ──");
for (const [k, v] of [...byMount].sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(4)}  ${k}`);
console.log(`\nTỔNG: ${rows.length} endpoint`);
if (unmounted.length) console.log(`⚠️  router import mà chưa gắn: ${unmounted.join(", ")}`);
}

// Chỉ chạy CLI khi được gọi TRỰC TIẾP. Import từ bài test thì chỉ lấy các hàm phân tích.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
