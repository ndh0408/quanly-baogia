#!/usr/bin/env node
// ============================================================================
// check-alerts.mjs — QUY TẮC CẢNH BÁO PHẢI ĐÚNG CÚ PHÁP, ĐÚNG LOGIC, VÀ TRỎ VÀO METRIC CÓ THẬT.
//
//   npm run check:alerts
//
// ── BA LỚP, MỖI LỚP BẮT MỘT KIỂU SAI KHÁC NHAU ─────────────────────────────
//   [A1] `promtool check rules`  → PromQL phân tích được (bắt lỗi gõ, ngoặc thiếu).
//   [A2] `promtool test rules`   → quy tắc kêu ĐÚNG LÚC và IM ĐÚNG LÚC, trên chuỗi số liệu giả.
//                                  Đây là lớp duy nhất bắt được lỗi LOGIC — thiếu một vế `and`,
//                                  so sai chiều, `for:` quá dài. `check rules` mù hoàn toàn với
//                                  những lỗi đó.
//   [A3] tên metric có thật      → promtool KHÔNG biết ứng dụng này phát ra metric nào. Một cảnh
//                                  báo trỏ vào metric đã đổi tên/bị gỡ thì vẫn "hợp lệ" với
//                                  promtool và im lặng vĩnh viễn ở production.
//
// [A3] không phải giả định: src/observability.ts đã từng GỠ một metric (`quote_operations_total`)
// vì nó được khai mà không chỗ nào tăng. Lần sau gỡ một metric ĐANG được cảnh báo dùng thì lớp này
// là thứ duy nhất lên tiếng.
//
// promtool KHÔNG có sẵn trên mọi máy. Thiếu nó thì [A1]/[A2] bỏ qua kèm cảnh báo vàng, còn [A3]
// VẪN CHẠY — nó chỉ cần đọc file.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const GOC = path.resolve(import.meta.dirname, "../..");
const THUMUC = path.join(GOC, "infra/prometheus");
const RULES = path.join(THUMUC, "alerts.yaml");
const TESTS = path.join(THUMUC, "alerts.test.yaml");

let loi = 0;
const buoc = (s) => console.log(`\n\x1b[1m▶ ${s}\x1b[0m`);
const ok = (s) => console.log(`  \x1b[32m✓ ${s}\x1b[0m`);
const xau = (s) => { console.log(`  \x1b[31m✗ ${s}\x1b[0m`); loi = 1; };

const coPromtool = (() => {
  try { execFileSync("sh", ["-c", "command -v promtool"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

if (coPromtool) {
  buoc("[A1] Cú pháp + PromQL (promtool check rules)");
  try {
    const ra = execFileSync("promtool", ["check", "rules", RULES], { encoding: "utf8", cwd: THUMUC });
    ok(ra.trim().split("\n").pop().trim());
  } catch (e) { xau("promtool check rules"); console.log(`${e.stdout || ""}${e.stderr || ""}`.slice(0, 2000)); }

  buoc("[A2] Logic (promtool test rules — chuỗi số liệu giả)");
  try {
    execFileSync("promtool", ["test", "rules", "alerts.test.yaml"], { encoding: "utf8", cwd: THUMUC });
    ok("mọi bài kiểm quy tắc đạt (kêu đúng lúc VÀ im đúng lúc)");
  } catch (e) { xau("promtool test rules"); console.log(`${e.stdout || ""}${e.stderr || ""}`.slice(0, 3000)); }
} else {
  console.log("\x1b[33m— promtool chưa cài: bỏ qua [A1]/[A2].");
  console.log("  Cài: tải prometheus từ https://github.com/prometheus/prometheus/releases rồi copy `promtool` vào PATH.");
  console.log("  [A3] bên dưới VẪN chạy.\x1b[0m");
}

// ── [A3] ────────────────────────────────────────────────────────────────────
buoc("[A3] Mọi metric được cảnh báo dùng phải CÓ THẬT");
const obs = readFileSync(path.join(GOC, "src/observability.ts"), "utf8");

// Tên metric do ứng dụng khai: `name: "..."` trong new Counter/Gauge/Histogram.
const tuUngDung = new Set([...obs.matchAll(/^\s*name:\s*"([a-z_][a-z0-9_]*)"/gim)].map((m) => m[1]));
// Histogram của prom-client đẻ thêm ba chuỗi hậu tố; cảnh báo dùng `_bucket` để tính quantile.
for (const t of [...tuUngDung]) for (const h of ["_bucket", "_sum", "_count"]) tuUngDung.add(t + h);

// Metric KHÔNG do ứng dụng khai nhưng chắc chắn tồn tại:
//   · `up` do chính Prometheus sinh cho mỗi target;
//   · `process_*` / `nodejs_*` do `collectDefaultMetrics()` của prom-client sinh (dòng gọi ở
//     src/observability.ts — nếu ai đó gỡ dòng đó thì cả nhóm này biến mất, nên kiểm luôn).
const coDefault = /collectDefaultMetrics\(/.test(obs);
const laBuiltin = (t) => t === "up" || ((/^(process_|nodejs_)/.test(t)) && coDefault);
if (!coDefault) xau("src/observability.ts không còn gọi collectDefaultMetrics() — mọi cảnh báo dùng process_*/nodejs_* sẽ im lặng");

const rules = readFileSync(RULES, "utf8");
// Chỉ soi dòng biểu thức, KHÔNG soi chú thích/annotations — nếu không thì một tên metric nhắc
// trong phần mô tả cũng bị coi là "đang dùng", và luật tự bãi bỏ chính nó.
const bieuThuc = [];
{
  const dong = rules.split("\n");
  for (let i = 0; i < dong.length; i++) {
    const m = dong[i].match(/^(\s*)expr:\s*(.*)$/);
    if (!m) continue;
    const [, thut, dau] = m;
    if (dau.trim() === "|" || dau.trim() === ">-" || dau.trim() === ">") {
      // Biểu thức nhiều dòng: gom mọi dòng thụt sâu hơn.
      for (let j = i + 1; j < dong.length; j++) {
        if (dong[j].trim() === "") continue;
        const sau = dong[j].match(/^(\s*)/)[1];
        if (sau.length <= thut.length) break;
        bieuThuc.push(dong[j]);
      }
    } else {
      bieuThuc.push(dau);
    }
  }
}
if (bieuThuc.length === 0) xau("không đọc được biểu thức nào từ alerts.yaml — bộ tách hỏng?");

// Tên metric = định danh KHÔNG đứng ngay trước "(" (loại tên hàm PromQL) và không phải từ khoá.
const TU_KHOA = new Set([
  // Toán tử tập hợp / so khớp vector.
  "and", "or", "unless", "by", "without", "on", "ignoring", "group_left", "group_right",
  "offset", "bool",
  // TOÁN TỬ GOM. Chúng KHÔNG luôn đứng ngay trước "(" — `sum by (queue) (...)` có "by" xen giữa,
  // nên bộ lọc "theo sau là dấu (" ở dưới không loại được chúng. Bỏ sót nhóm này thì `sum` bị coi
  // là tên metric và cổng đỏ oan (đã gặp đúng vậy khi viết file này).
  "sum", "min", "max", "avg", "group", "stddev", "stdvar", "count", "count_values",
  "bottomk", "topk", "quantile", "limitk", "limit_ratio",
  // Tên NHÃN hay dùng trong bộ lọc — không phải tên metric.
  // `route` và `method` là NHÃN của http_requests_total / http_request_duration_seconds
  // (src/observability.ts `labelNames`), không phải tên metric. `label_values(x, route)` của
  // Grafana đưa chúng ra ngoài dấu ngoặc nhọn nên bộ lọc `{...}` bên dưới không nuốt được.
  "le", "instance", "job", "mode", "state", "queue", "reason", "status", "route", "method",
]);
const dung = new Set();
for (const d of bieuThuc) {
  // Bỏ nội dung trong ngoặc nhọn (bộ lọc nhãn) trước khi tìm tên metric.
  const sach = d.replace(/\{[^}]*\}/g, "").replace(/"[^"]*"/g, "");
  for (const m of sach.matchAll(/\b([a-zA-Z_:][a-zA-Z0-9_:]*)\b(\s*\()?/g)) {
    if (m[2]) continue;                       // theo sau là "(" → tên hàm
    if (TU_KHOA.has(m[1])) continue;
    if (/^\d/.test(m[1])) continue;
    dung.add(m[1]);
  }
}

const thieu = [...dung].filter((t) => !tuUngDung.has(t) && !laBuiltin(t)).sort();
console.log(`      ${dung.size} tên metric được dùng trong ${bieuThuc.length} dòng biểu thức`);
if (thieu.length) {
  xau(`metric KHÔNG tồn tại trong src/observability.ts và không phải built-in: ${thieu.join(", ")}`);
  console.log("      → cảnh báo dùng chúng sẽ KHÔNG BAO GIỜ kêu. Đổi tên metric mà quên sửa cảnh báo?");
} else {
  ok("mọi metric được cảnh báo dùng đều có thật (ứng dụng khai, hoặc built-in của Prometheus/prom-client)");
}

// Bảo hiểm hai chiều: bộ tách trên mà hỏng thì `dung` rỗng và [A3] sẽ xanh một cách vô nghĩa.
if (dung.size < 8) xau(`chỉ tách được ${dung.size} tên metric — bộ tách nhiều khả năng đã hỏng, [A3] đang xanh giả`);

// ── [A4] ────────────────────────────────────────────────────────────────────
// Bảng điều khiển Grafana hỏng theo ĐÚNG cách cảnh báo hỏng — và tệ hơn một bậc: một quy tắc cảnh
// báo im lặng thì ít ra không ai bị lừa, còn một panel trỏ vào metric đã chết vẽ ra đường thẳng
// bằng 0 và người trực đọc thành "hệ thống đang yên". Dùng lại y hệt bộ máy của [A3].
buoc("[A4] Mọi metric trong bảng điều khiển Grafana phải CÓ THẬT");
const THUMUC_BANG = path.join(GOC, "infra/observability/grafana/dashboards");
if (!existsSync(THUMUC_BANG)) {
  console.log("      (chưa có bảng điều khiển nào — bỏ qua)");
} else {
  const tepBang = readdirSync(THUMUC_BANG).filter((f) => f.endsWith(".json"));
  if (!tepBang.length) console.log("      (chưa có bảng điều khiển nào — bỏ qua)");
  let soPanel = 0;
  const dungBang = new Set();
  const loiJson = [];
  for (const f of tepBang) {
    let bang;
    try {
      bang = JSON.parse(readFileSync(path.join(THUMUC_BANG, f), "utf8"));
    } catch (e) {
      loiJson.push(`${f}: ${String(e.message).slice(0, 120)}`);
      continue;
    }
    for (const pn of bang.panels || []) {
      soPanel++;
      for (const t of pn.targets || []) {
        // CHỈ soi truy vấn Prometheus. Panel Loki dùng LogQL — cú pháp khác, tên nhãn khác, và
        // `{container="quanly-app"}` mà đem đi dò tên metric thì sẽ đỏ oan.
        const nguon = (t.datasource?.type || pn.datasource?.type || "").toLowerCase();
        if (nguon && nguon !== "prometheus") continue;
        if (typeof t.expr === "string") dungBang.add(t.expr);
      }
    }
    // Biến truy vấn (`templating`) cũng chạy PromQL thật.
    for (const bien of bang.templating?.list || []) {
      if ((bien.datasource?.type || "").toLowerCase() === "prometheus" && typeof bien.query === "string") {
        dungBang.add(bien.query);
      }
    }
  }
  for (const x of loiJson) xau(`bảng điều khiển KHÔNG phải JSON hợp lệ — ${x}`);

  const tenBang = new Set();
  for (const d of dungBang) {
    const sach = d.replace(/\{[^}]*\}/g, "").replace(/"[^"]*"/g, "");
    // Tên metric của Prometheus CHO PHÉP chữ hoa (`[a-zA-Z_:][a-zA-Z0-9_:]*`). Bản đầu của bộ
    // tách chỉ nhận chữ thường, nên một tên có chữ hoa KHÔNG khớp gì cả và cổng tưởng là không có
    // metric nào — xanh giả. Phát hiện lúc kiểm ngược [A4]: đổi tên metric thành
    // `..._KHONG_TON_TAI` mà cổng vẫn xanh.
    for (const m of sach.matchAll(/\b([a-zA-Z_:][a-zA-Z0-9_:]*)\b(\s*\()?/g)) {
      if (m[2]) continue;
      if (TU_KHOA.has(m[1])) continue;
      if (/^\d/.test(m[1])) continue;
      tenBang.add(m[1]);
    }
  }
  const thieuBang = [...tenBang].filter((t) => !tuUngDung.has(t) && !laBuiltin(t)).sort();
  console.log(`      ${tepBang.length} tệp · ${soPanel} panel · ${tenBang.size} tên metric`);
  if (thieuBang.length) {
    xau(`metric KHÔNG tồn tại, bảng điều khiển sẽ vẽ đường 0: ${thieuBang.join(", ")}`);
  } else if (tepBang.length) {
    ok("mọi metric trong bảng điều khiển đều có thật");
  }
}

console.log(loi ? "\n\x1b[31m❌ CỔNG CẢNH BÁO ĐỎ\x1b[0m" : "\n\x1b[32m✅ CỔNG CẢNH BÁO XANH\x1b[0m");
process.exit(loi);
