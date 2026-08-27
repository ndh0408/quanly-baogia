#!/usr/bin/env node
// ============================================================================
// check-web-bundle.mjs — BUNDLE GIAO CHO NGƯỜI DÙNG PHẢI LÀ BẢN PRODUCTION.
//
//   node scripts/ci/check-web-bundle.mjs
//
// ── VÌ SAO CẦN MỘT CỔNG RIÊNG ──────────────────────────────────────────────
// Vite quyết dev-hay-prod theo `process.env.NODE_ENV ?? mode` — tức theo BIẾN MÔI TRƯỜNG CỦA MÁY
// ĐANG BUILD, không theo lệnh. `scripts/verify-local.sh` export `NODE_ENV=test` cho toàn bộ lượt
// chạy, nên trước đợt này chính lệnh `npm run verify` đẻ ra bundle DEV rồi đem đi smoke — smoke
// xanh trên một bản mà không người dùng nào chạy.
//
// Hậu quả đo được (không phải suy luận):
//   · 767.695 byte (dev) so với 463.630 byte (prod) — phình 65%;
//   · <StrictMode> chạy lại mọi useEffect, làm hỏng bàn giao bản nháp Wizard → QuoteEditor
//     (ui-smoke.mjs [U11] đỏ đúng vì lý do này).
// web/vite.config.ts đã chốt cứng NODE_ENV=production cho lệnh build. File này là cổng kiểm để
// chuyện đó không lặng lẽ trôi mất — cấu hình build là thứ không ai đọc lại sau khi viết.
//
// ── DẤU VẾT ĐƯỢC CHỌN ──────────────────────────────────────────────────────
// Chỉ dùng chuỗi CHẮC CHẮN chỉ có ở bản dev của React và KHÔNG có ở mã ứng dụng. Hai chuỗi, lấy từ
// HAI gói khác nhau (react-dom và react) để một lần React đổi lời nhắc không làm cả lưới mất tác
// dụng. ĐÃ ĐO trên chính repo này bằng cách gỡ chốt trong vite.config.ts rồi build lại:
//   bản dev   → cả hai chuỗi CÓ mặt, tổng .js 984.802 byte;
//   bản prod  → cả hai chuỗi KHÔNG, tổng .js 630.482 byte.
// Lưu ý `__REACT_DEVTOOLS_GLOBAL_HOOK__` CÓ MẶT ở cả bản production nên KHÔNG dùng làm dấu.
// Kiểm cả chiều ngược: tệp phải TỒN TẠI và không rỗng, để "không thấy dấu dev" không đến từ việc
// không có gì để đọc.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const GOC = path.resolve(import.meta.dirname, "../..");
const THU_MUC = path.join(GOC, "public/app2/assets");

let loi = 0;
const ok = (s) => console.log(`  \x1b[32m✓ ${s}\x1b[0m`);
const xau = (s) => { console.log(`  \x1b[31m✗ ${s}\x1b[0m`); loi = 1; };

const DAU_DEV = ["react-devtools", 'unique "key" prop'];

console.log("\x1b[1m▶ Bundle web phải là bản production\x1b[0m");

if (!existsSync(THU_MUC)) {
  xau(`không có ${path.relative(GOC, THU_MUC)} — chạy \`npm run web:build\` trước`);
  process.exit(1);
}

const js = readdirSync(THU_MUC).filter((f) => f.endsWith(".js"));
if (!js.length) { xau("không có tệp .js nào trong public/app2/assets"); process.exit(1); }

let tong = 0;
const dinhDau = [];
for (const f of js) {
  const p = path.join(THU_MUC, f);
  const kt = statSync(p).size;
  tong += kt;
  if (kt === 0) { xau(`${f} rỗng`); continue; }
  const noi = readFileSync(p, "utf8");
  for (const d of DAU_DEV) if (noi.includes(d)) dinhDau.push(`${f} chứa "${d}"`);
}
ok(`${js.length} tệp .js, tổng ${tong.toLocaleString("vi-VN")} byte`);

if (dinhDau.length) {
  xau("bundle là BẢN DEV của React — người dùng nhận bản chậm, phình, và <StrictMode> chạy đôi effect");
  dinhDau.slice(0, 5).forEach((x) => console.log(`      · ${x}`));
  console.log('      Nguyên nhân thường gặp: shell đang export NODE_ENV khác "production" lúc build.');
  console.log("      web/vite.config.ts đã chốt cứng — nếu vẫn đỏ thì chốt đó đã bị gỡ.");
} else {
  ok(`không tệp nào chứa dấu vết bản dev (${DAU_DEV.map((d) => `"${d}"`).join(", ")})`);
}

// ── TRẦN DUNG LƯỢNG: LƯỚI THỨ HAI, VÀ LÀ NGÂN SÁCH THẬT ──────────────────────
// Đặt GIỮA hai số đo ở trên (prod 630.482 · dev 984.802) nên nó bắt được bản dev kể cả khi cả hai
// chuỗi kia hết tác dụng, và bắt luôn trạng thái nửa vời: gỡ chốt `process.env.NODE_ENV` mà giữ
// `define` cho ra 777.205 byte — React vẫn là bản production (không chuỗi dev) nhưng bundle phồng
// thêm 23%, tức lưới chuỗi KHÔNG thấy gì.
// Đây đồng thời là ngân sách dung lượng: app phình thật thì cổng này đỏ, và đó là ĐÚNG việc của
// nó — nâng trần một cách CÓ CHỦ Ý kèm một dòng trong CHANGELOG, đừng nâng cho qua chuyện.
const TRAN = 850_000;
if (tong > TRAN) xau(`tổng ${tong.toLocaleString("vi-VN")} byte > trần ${TRAN.toLocaleString("vi-VN")} byte`);
else ok(`tổng dưới trần ${TRAN.toLocaleString("vi-VN")} byte`);

console.log(loi ? "\n\x1b[31m❌ BUNDLE WEB ĐỎ\x1b[0m" : "\n\x1b[32m✅ BUNDLE WEB XANH\x1b[0m");
process.exit(loi);
