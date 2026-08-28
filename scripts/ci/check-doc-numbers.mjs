#!/usr/bin/env node
// ============================================================================
// check-doc-numbers.mjs — ĐO SỐ TỪ MÃ NGUỒN RỒI ĐỐI CHIẾU VỚI TÀI LIỆU.
//
//   node scripts/ci/check-doc-numbers.mjs           # in bảng số đo + mọi chỗ tài liệu khai
//   node scripts/ci/check-doc-numbers.mjs --check   # lệch → in đích danh tệp:dòng rồi exit 1
//
// ── VÌ SAO CÓ FILE NÀY ─────────────────────────────────────────────────────
// Số liệu trong tài liệu trôi khỏi mã nguồn liên tục, và cho tới nay KHÔNG cổng nào bắt được.
// `check-line-refs` chỉ kiểm tham chiếu `file:dòng` có trỏ vào chỗ có thật — nó không nhìn con số.
// `repo-stats --check` có đối chiếu con số, nhưng đúng 4 số và đúng một tệp (README.md).
//
// Bằng chứng thật, đã xảy ra nhiều lần trong repo này:
//   · docs/REMAINING_RISKS.md từng ghi "14 rule cảnh báo" khi thật là 17, "10 bài promtool" khi
//     thật là 28, "5 nhóm" khi thật là 6, "17 bước ui-smoke" khi thật là 18 — và TỰ MÂU THUẪN
//     với chính nó ở dòng khác;
//   · AGENTS.md ghi "17 bước" khi thật là 18;
//   · scripts/ci/ui-smoke.mjs tự khai "187 bài vitest của web" khi thật là 251 — đã sửa, nhưng
//     bản sao của chính câu đó ở scripts/verify-local.sh VẪN ghi 187. Đây là ca sống, và cổng này
//     KHÔNG bắt được nó: số BÀI test không đo tĩnh được (xem mục "KHÔNG PHỦ CÁI GÌ" bên dưới);
//   · infra/observability/{README.md,prometheus.yml,docker-compose.observability.yml} từng nói BA
//     con số khác nhau cho cùng một thứ.
// Không con số nào SAI vào lúc được viết. Chúng chỉ trôi, vì không có gì buộc chúng đúng.
//
// ── NGUYÊN TẮC ─────────────────────────────────────────────────────────────
// Mỗi con số có ĐÚNG MỘT hàm đo, đo từ MÃ NGUỒN (xem `PHEP_DO` bên dưới), và mỗi hàm đo kèm
// `lenh` — dòng lệnh shell tương đương để người đọc tự kiểm lại mà không cần tin file này.
//
// ── ⚠️ QUY ƯỚC KHAI SỐ LỊCH SỬ — ĐỌC TRƯỚC KHI VIẾT TÀI LIỆU ───────────────
// Repo này CỐ Ý giữ nhiều con số của quá khứ ("trước đợt vá là 14 metric"). Đó là bản ghi, không
// phải lỗi, và cổng này KHÔNG được làm chúng đỏ. Ba cách khai một con số lịch sử, dùng cách nào
// cũng được:
//
//   1. MỐC BẰNG LỜI — đặt một trong các cụm sau TRƯỚC con số, trong cùng ĐOẠN VĂN:
//        "trước đợt" · "trước đó" · "trước đây" · "từng ghi" · "từng là" · "bản đầu" · "bản cũ"
//        "bản trước" · "ảnh chụp" · "số của mốc" · "lúc Phase" · "đã đo lúc" · "không phải số hiện tại"
//      Một mốc như vậy làm mờ MỌI con số ĐỨNG SAU NÓ trong cùng đoạn văn (xem `danhDauLichSu`).
//      Đây là lối viết repo đang dùng sẵn, ví dụ infra/observability/README.md:
//        "Trước đợt 2026-08-27 hai con số này là 14 metric và 14 quy tắc. Đợt đó thêm 7 metric…"
//
//   2. NHÃN TƯỜNG MINH — đặt `<!-- so-lich-su -->` trên chính dòng đó hoặc dòng ngay trước.
//      Dùng khi câu không có mốc bằng lời mà vẫn là số của quá khứ.
//
//   3. DẠNG TỈ LỆ `N/M` — "8/8 ADR", "137/137 endpoint". Đây là lời khai "đã xử lý N trong M của
//      LÚC ĐÓ", không phải lời khai tổng hiện tại, nên cổng bỏ qua cả cụm.
//
// ⚠️ ĐIỂM MÙ ĐÃ ĐO ĐƯỢC CỦA CƠ CHẾ (1) — đọc trước khi tin cổng này:
// Các cụm mốc ở trên là TỪ NGỮ THÔNG THƯỜNG của tiếng Việt, không phải cú pháp dành riêng. Một câu
// dùng "trước đó" vì lý do KHÔNG liên quan tới số liệu vẫn làm mờ mọi con số đứng sau nó trong cùng
// đoạn. Hai ca thật đã dựng và xác nhận LỌT (cổng exit 0 dù số sai):
//     "Trước đó chúng tôi dùng Grafana Cloud, nay tự dựng."
//     "Hiện tại alerts.yaml có 14 quy tắc cảnh báo"        ← sai, thật là 17, KHÔNG bị bắt
// Cách né: đặt con số HIỆN TẠI **trước** mốc, hoặc tách nó sang đoạn riêng (dòng trống ở giữa).
// Đây là đánh đổi có chủ ý: siết chặt hơn (ví dụ đòi mốc phải kèm ngày) sẽ bắt nhầm văn xuôi đang
// viết đúng, mà một cổng hay bắt nhầm là một cổng sẽ bị tắt — lúc đó nó không còn bảo vệ gì nữa.
//

// ĐOẠN VĂN = dãy dòng liền nhau không có dòng trống. Dòng bảng (`|`), tiêu đề (`#`) và mục danh
// sách (`- `, `* `, `1. `) MỖI CÁI TỰ LÀ MỘT ĐOẠN — nếu không, một mốc ở ô bảng này sẽ làm mờ cả
// những hàng bên dưới, và cổng thành đồ trang trí.
//
// ── CỔNG NÀY KHÔNG PHỦ CÁI GÌ (nói ra để không ai tưởng nó phủ) ────────────
//   · SỐ BÀI TEST (1 410 bài backend, 251 bài web). Đếm tĩnh KHÔNG ra đúng: `it.each([...])` nở ra
//     nhiều bài lúc chạy — đếm lời gọi trong web/src ra 210, chạy thật ra 251. Muốn đúng thì phải
//     CHẠY cả bộ test, mà một cổng tài liệu không được phép tốn mấy phút. Chỉ phủ SỐ TỆP test.
//   · SỐ BƯỚC của `scripts/verify-local.sh`. Repo đang đọc nó theo HAI cách đều đúng: 13 (mẫu số
//     của nhãn `[0/13]`…`[13/13]`) và 14 (số nhãn). Xem docs/REMAINING_RISKS.md, mục "Cột Bước".
//     Ép một cách đọc là tự đẻ báo động giả.
//   · Số commit, số dòng mã, dung lượng bundle — trôi mỗi commit, xem chú thích ở repo-stats.mjs.
//   · Số model Prisma và số file test tổng của README — repo-stats.mjs đã canh, không làm lần hai.
//   · Mọi con số KHÔNG có hàm đo trong `PHEP_DO`. Cổng CỐ Ý hẹp: bắt đúng tập số đo được. Một cổng
//     hay báo động giả sẽ bị người ta tắt đi — lúc đó còn tệ hơn không có cổng nào.
//
// ── VÌ SAO CÓ `NO_TRE` ─────────────────────────────────────────────────────
// Xem ngay trên khai báo `NO_TRE`. Tóm tắt: chỗ trôi THẬT mà lượt vá này không được phép sửa
// (tệp thuộc phần việc khác). Nó được in ra ẦM Ĩ mỗi lượt chạy, và khi ai đó sửa tài liệu thì
// mục nợ thành LẠC HẬU và cổng ĐỎ — buộc phải xoá nó đi. Nợ không tự sống mãi được.
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GOC = path.resolve(import.meta.dirname, "../..");
const doc = (p) => readFileSync(path.join(GOC, p), "utf8");
const demMau = (text, re) => (text.match(re) || []).length;

const lsFiles = (...co) =>
  execFileSync("git", ["ls-files", ...co], { cwd: GOC, encoding: "utf8", maxBuffer: 64 << 20 })
    .split("\n")
    .filter(Boolean);

// ── HAI DANH SÁCH TỆP, CÓ CHỦ Ý ─────────────────────────────────────────────
// ĐẾM đi theo CHỈ MỤC GIT (`git ls-files` trần); QUÉT thì lấy cả tệp mới chưa `git add`
// (trừ tệp bị .gitignore loại). Hai vế cố tình lệch nhau vì hai rủi ro ngược chiều:
//
//   · ĐẾM mà tính cả tệp chưa add → một bản nháp `tests/thu-nghiem.test.js` nằm trên máy một
//     người làm cổng ĐỎ ở đó mà XANH ở mọi nơi khác, dù CÙNG MỘT COMMIT. Một cổng nói khác nhau
//     về cùng một commit là một cổng không tin được.
//     ⚠️ HỆ QUẢ PHẢI BIẾT: con số đếm được đổi ngay lúc `git add`, chứ không phải lúc tệp xuất
//     hiện trên đĩa. Nên thêm một tệp test rồi `git add` là cổng này ĐỎ NGAY — trước khi commit,
//     đúng lúc còn sửa được tài liệu trong cùng một commit. (`scripts/ci/repo-stats.mjs` đếm theo
//     ĐĨA nên nó đỏ sớm hơn một nhịp; hai cổng cùng đòi một việc, chỉ khác thời điểm.)
//
//   · QUÉT mà bỏ tệp chưa add → một tài liệu MỚI toanh ghi sai số sẽ lọt, vì người ta chạy
//     `npm run verify` TRƯỚC khi `git add`. Nó chỉ bị bắt ở lượt verify SAU, tức sau khi đã commit.
const TEP_GIT = lsFiles();
const TEP_QUET = lsFiles("--cached", "--others", "--exclude-standard");

/** Đếm tệp khớp `re` trong danh sách tệp ĐÃ THEO DÕI (xem khối ngay trên). */
const demTepGit = (re) => TEP_GIT.filter((f) => re.test(f)).length;

// ── ĐƠN VỊ DÙNG CHUNG ────────────────────────────────────────────────────────
// "bước" là đơn vị của BA đại lượng khác nhau trong repo này (bước ui-smoke, bước verify-local,
// bước wizard), "tệp/file test" là đơn vị của HAI (backend, web). Nên đại lượng nào có đơn vị
// dùng chung thì BẮT BUỘC phải có `neo` — một cụm từ định danh nằm gần con số. Không có neo thì
// bỏ qua, KHÔNG đoán. Bỏ sót còn sửa được; báo động giả thì cổng bị tắt.

/**
 * Mỗi mục: một con số, một hàm đo, một dòng lệnh để người đọc tự kiểm.
 *
 *   nhan    — tên tiếng Việt, in ra khi lệch
 *   do()    — ĐO TỪ MÃ NGUỒN. Đây là nguồn sự thật duy nhất.
 *   lenh    — lệnh shell tương đương; in kèm mỗi lỗi để sửa lại không cần đọc file này
 *   donVi   — regex đơn vị đứng NGAY SAU con số trong câu văn
 *   neo     — (tuỳ chọn) regex phải xuất hiện ở đoạn chứa con số, hoặc đoạn liền trước/liền sau
 *   phanNeo — (tuỳ chọn) regex mà nếu có ở CÙNG đoạn thì con số thuộc về đại lượng KHÁC → bỏ qua
 *   loaiTru — (tuỳ chọn) regex trên cửa sổ văn bản quanh con số; khớp thì bỏ qua
 */
export const PHEP_DO = {
  "quy-tac-canh-bao": {
    nhan: "quy tắc cảnh báo Prometheus",
    do: () => demMau(doc("infra/prometheus/alerts.yaml"), /^ *- alert:/gm),
    lenh: "grep -cE '^ *- alert:' infra/prometheus/alerts.yaml",
    donVi: [/^quy tắc/iu, /^rules?\b/iu],
  },
  "nhom-quy-tac": {
    nhan: "nhóm quy tắc trong alerts.yaml",
    do: () => demMau(doc("infra/prometheus/alerts.yaml"), /^ {2}- name:/gm),
    lenh: "grep -c '^  - name:' infra/prometheus/alerts.yaml",
    donVi: [/^nhóm/iu],
    neo: [/alerts\.yaml/iu, /quy tắc/iu, /\brule/iu],
  },
  "bai-promtool": {
    nhan: "bài `promtool test rules`",
    do: () => demMau(doc("infra/prometheus/alerts.test.yaml"), /alert_rule_test:/g),
    lenh: "grep -c 'alert_rule_test:' infra/prometheus/alerts.test.yaml",
    donVi: [/^bài/iu],
    neo: [/promtool/iu, /kiểm logic/iu],
  },
  "buoc-ui-smoke": {
    nhan: "bước của scripts/ci/ui-smoke.mjs",
    do: () => demMau(doc("scripts/ci/ui-smoke.mjs"), /^\s*(?:await )?buoc\("/gm),
    lenh: `grep -cE '^\\s*(await )?buoc\\("' scripts/ci/ui-smoke.mjs`,
    donVi: [/^bước/iu],
    neo: [/ui-smoke/iu, /smoke:ui/iu, /Chromium/iu, /Playwright/iu, /luồng người dùng/iu, /smoke giao diện/iu],
    // `npm run verify` cũng đếm "bước", và câu "smoke giao diện Chromium 18 bước" hay nằm CÙNG DÒNG
    // với "npm run verify nay 13 bước" (docs/REMAINING_RISKS.md, bảng Phase). Phân neo tách hai.
    phanNeo: [/npm run verify/iu, /verify-local/iu],
    // "wizard 3 bước" là bước của MÀN HÌNH, không phải bước của smoke.
    loaiTru: [/wizard\W*$/iu],
  },
  metric: {
    nhan: "metric ứng dụng trong src/observability.ts",
    do: () => demMau(doc("src/observability.ts"), /name: "[a-z_]+"/g),
    lenh: `grep -coE 'name: "[a-z_]+"' src/observability.ts`,
    donVi: [/^metrics?\b/iu],
  },
  endpoint: {
    nhan: "endpoint HTTP",
    // Dùng LẠI bộ sinh danh sách endpoint thay vì cài lại logic lần hai — cùng lý do repo-stats.mjs
    // dùng lại nó. `inventory()` là hàm thuần, không in bảng, không process.exit.
    do: async () => (await import(path.join(GOC, "scripts/ci/endpoint-inventory.mjs"))).inventory().rows.length,
    lenh: "node scripts/ci/endpoint-inventory.mjs   # dòng TỔNG cuối bảng",
    donVi: [/^endpoints?\b/iu, /^HTTP endpoints?\b/iu],
    loaiTru: [
      // Tiêu đề mục của ma trận phân quyền khai TỪNG NHÓM: "## `/api/auth` — 12 endpoint".
      // Đây là số con, không phải tổng; `endpoint-inventory --check` đã canh từng dòng ma trận.
      /\/[\w/*.-]+\\?`?\s*[—–-]\s*$/u,
      /\bthêm\s*$/iu,
      // Tiêu đề mục con của ma trận phân quyền: "## Ngoài router — 9 endpoint".
      /^#{2,}\s/u,
      /endpoint\s+(?:hạ tầng|GHI)/u,
    ],
  },
  adr: {
    nhan: "ADR trong docs/adr/",
    do: () => demTepGit(/^docs\/adr\/\d{4}-.*\.md$/),
    lenh: "git ls-files 'docs/adr/[0-9][0-9][0-9][0-9]-*.md' | wc -l",
    donVi: [/^ADR\b/u],
  },
  "tep-test-backend": {
    nhan: "tệp test backend (tests/*.test.js)",
    do: () => demTepGit(/^tests\/.*\.test\.js$/),
    lenh: "git ls-files 'tests/*.test.js' | wc -l",
    donVi: [/^tệp/iu, /^files? test/iu],
    neo: [/vitest/iu, /\btests\//u, /\(backend\)/iu],
    // "21 tệp" của web cũng đứng cạnh chữ `vitest` — phân neo đẩy nó sang đại lượng dưới.
    phanNeo: [/web\//iu, /file test web/iu, /test web/iu, /cd web/iu],
  },
  "tep-test-web": {
    nhan: "tệp test web (web/src/**/*.test.ts[x])",
    do: () => demTepGit(/^web\/src\/.*\.test\.tsx?$/),
    lenh: "git ls-files 'web/src/**/*.test.ts' 'web/src/**/*.test.tsx' | wc -l",
    donVi: [/^tệp/iu, /^files? test/iu],
    // Neo CỐ Ý chặt: chữ "web" trần xuất hiện khắp nơi ("web 163 xanh", "build backend + web").
    neo: [/web\/(?:src)?/iu, /file test web/iu, /test web/iu, /cd web/iu, /trong `web/iu],
  },
};

// ── MỐC LỊCH SỬ ─────────────────────────────────────────────────────────────
// Xem "QUY ƯỚC KHAI SỐ LỊCH SỬ" ở đầu file. Danh sách này LÀ quy ước đó, dạng mã.
const MOC_LICH_SU =
  /<!--\s*so-lich-su\s*-->|trước đợt|trước đó|trước đây|từng ghi|từng là|bản đầu|bản cũ|bản trước|ảnh chụp|số của mốc|lúc Phase|đã đo lúc|không phải số hiện tại|số của lúc/iu;

/** Dòng mở một ĐOẠN VĂN mới: bảng, tiêu đề, mục danh sách, dòng trống, rào mã. */
const laDauDoan = (d) => /^\s*(\||#{1,6}\s|[-*+]\s|\d+\.\s|```|\/\/ ─|# ─)/.test(d) || d.trim() === "";

/**
 * Đánh dấu những dòng mà mọi con số trên đó là SỐ LỊCH SỬ.
 *
 * Quy tắc: một mốc làm mờ phần CÒN LẠI của đoạn văn, tính TỪ chính dòng chứa mốc trở đi.
 * Mốc chỉ về phía trước là đúng với cách người ta viết ("Trước đợt X, hai con số này là …"), và
 * nó giữ được những dòng ĐỨNG TRƯỚC mốc trong cùng đoạn — chỗ thường chứa số HIỆN TẠI.
 * Ví dụ thật (docs/REMAINING_RISKS.md, mục "Quy tắc cảnh báo Prometheus"):
 *     616  `alerts.yaml` — 17 quy tắc, 6 nhóm, …        ← SỐ HIỆN TẠI, phải kiểm
 *     617  … Trước đó repo không có quy tắc nào         ← mốc
 *     618  (…): 14 metric (số của mốc đó — nay là 21)   ← số lịch sử, phải bỏ qua
 *
 * @param {string[]} dong
 * @returns {boolean[]} cùng độ dài với `dong`
 */
export function danhDauLichSu(dong) {
  const ra = new Array(dong.length).fill(false);
  let trongDoanLichSu = false;
  for (let i = 0; i < dong.length; i++) {
    if (laDauDoan(dong[i])) trongDoanLichSu = false;
    // Nhãn tường minh đặt ở dòng NGAY TRƯỚC cũng có tác dụng (kiểu chú thích của markdown).
    const nhanODongTruoc = i > 0 && /<!--\s*so-lich-su\s*-->/iu.test(dong[i - 1]);
    if (MOC_LICH_SU.test(dong[i]) || nhanODongTruoc) trongDoanLichSu = true;
    ra[i] = trongDoanLichSu;
  }
  return ra;
}

// ── TÁCH ĐOẠN TRONG MỘT DÒNG ────────────────────────────────────────────────
// Một dòng bảng markdown chứa nhiều lời khai độc lập. Neo phải được tìm GẦN con số, không phải
// "ở đâu đó trên dòng" — nếu không thì dòng
//   "| `npm run verify` nay 13 bước, … smoke giao diện Chromium 18 bước, … |"
// sẽ gán CẢ 13 lẫn 18 cho ui-smoke và cổng báo động giả ngay lượt đầu.
const NGAT = /[,;|]|\s[—–]\s|\s·\s|:\s/gu;

/** @returns {{text:string,tu:number}[]} các đoạn con của một dòng, kèm vị trí bắt đầu. */
export function tachDoan(dong) {
  const ra = [];
  let tu = 0;
  for (const m of dong.matchAll(NGAT)) {
    ra.push({ text: dong.slice(tu, m.index), tu });
    tu = m.index + m[0].length;
  }
  ra.push({ text: dong.slice(tu), tu });
  return ra;
}

// Con số + đơn vị. Bắt được cả "**18 bước**", "toàn bộ 21 metric", "17 rule".
//
// Ba chốt chống bắt nhầm, mỗi cái ứng một ca THẬT đã gặp lúc dựng cổng:
//   · `(?<![\d/,.])` — chặn vế sau của dạng tỉ lệ ("8/8 ADR", "137/137 endpoint"), xem quy ước
//     ở đầu file, và chặn cả "1 410" bị cắt thành "410";
//   · `[ \t]+` BẮT BUỘC — không có nó thì "S3_ENDPOINT" hoá "3 endpoint", "app:3000/metrics" hoá
//     "3000 metric", "hq3-bullmq-metrics.test.js" hoá "3 metric";
//   · đơn vị chỉ lấy TỐI ĐA HAI TỪ ngay sau số, và mọi mẫu `donVi` neo `^` — không có nó thì
//     "16 MB vào bất kỳ endpoint nào" hoá "16 endpoint".
const RE_SO = /(?<![\d/,.])(\d+)\*{0,2}[ \t]+\*{0,2}(\p{L}+(?:[ \t]+\p{L}+)?)/gu;

/**
 * Quét một văn bản, trả về mọi lời khai con số ĐỐI CHIẾU ĐƯỢC.
 *
 * Tách khỏi phần đọc đĩa để tests/xg-doc-numbers.test.js kiểm được LOGIC trên dữ liệu dựng sẵn,
 * thay vì chỉ chạy cổng rồi tin mã thoát.
 *
 * @param {string} noiDung  toàn văn tệp
 * @param {Record<string,number>} soThuc  id đại lượng → số đo được
 * @param {Record<string,object>} [phepDo] cho phép test bơm bộ đại lượng riêng
 * @returns {{id:string,dong:number,soTaiLieu:number,soThuc:number,khop:boolean,trich:string}[]}
 */
export function quet(noiDung, soThuc, phepDo = PHEP_DO) {
  const dong = noiDung.split("\n");
  const lichSu = danhDauLichSu(dong);
  const ra = [];

  for (let i = 0; i < dong.length; i++) {
    if (lichSu[i]) continue;
    const doanTrongDong = tachDoan(dong[i]);

    for (const [id, dl] of Object.entries(phepDo)) {
      if (!(id in soThuc)) continue;
      for (let k = 0; k < doanTrongDong.length; k++) {
        const { text, tu } = doanTrongDong[k];
        for (const m of text.matchAll(RE_SO)) {
          const sau = m[2];
          if (!dl.donVi.some((re) => re.test(sau))) continue;

          // Cửa sổ trước con số: đủ để thấy "wizard", "`/api/auth` —", "thêm".
          const truoc = dong[i].slice(Math.max(0, tu + m.index - 40), tu + m.index);
          if (dl.loaiTru?.some((re) => re.test(truoc) || re.test(text))) continue;

          // Neo tìm ở đoạn chứa con số và HAI đoạn kề. Kề trước vì bảng markdown hay đặt tên
          // ở ô đầu ("| `npm run smoke:ui` | 18 bước |"); kề sau vì tiếng Việt hay đặt bổ ngữ
          // sau ("18 bước, đi hết một luồng người dùng thật").
          if (dl.neo) {
            const quanh = [doanTrongDong[k - 1], doanTrongDong[k], doanTrongDong[k + 1]]
              .filter(Boolean)
              .map((d) => d.text)
              .join(" ┆ ");
            if (!dl.neo.some((re) => re.test(quanh))) continue;
            if (dl.phanNeo?.some((re) => re.test(quanh))) continue;
          }

          const soTaiLieu = Number(m[1]);
          ra.push({
            id,
            dong: i + 1,
            soTaiLieu,
            soThuc: soThuc[id],
            khop: soTaiLieu === soThuc[id],
            trich: dong[i].trim().slice(0, 110),
          });
        }
      }
    }
  }
  return ra;
}

// ── PHẠM VI QUÉT ────────────────────────────────────────────────────────────
export const NGOAI_PHAM_VI = [
  // Nhật ký commit — sinh từ `git log`, là LỊCH SỬ theo định nghĩa.
  (f) => f === "CHANGELOG.md",
  // Ảnh chụp kiểm toán của một thời điểm; sửa cho khớp HEAD là làm sai bản ghi.
  (f) => f.startsWith("docs/archive/"),
  // Chính file này chứa mẫu ví dụ và con số minh hoạ — đừng tự bắt mình (như check-line-refs).
  (f) => f === "scripts/ci/check-doc-numbers.mjs",
  // Bài kiểm của cổng chứa dữ liệu dựng sẵn CỐ Ý sai.
  (f) => f.startsWith("tests/"),
];

export function danhSachTep() {
  return TEP_QUET
    .filter((f) => /\.md$/.test(f) || /^scripts\/.*\.(mjs|sh)$/.test(f))
    .filter((f) => !NGOAI_PHAM_VI.some((bo) => bo(f)))
    .filter((f) => existsSync(path.join(GOC, f)));
}

export async function doTatCa() {
  const ra = {};
  for (const [id, dl] of Object.entries(PHEP_DO)) ra[id] = await dl.do();
  return ra;
}

// ── NỢ TRỄ ──────────────────────────────────────────────────────────────────
// Chỗ trôi THẬT, đã xác nhận bằng tay, mà lượt vá dựng cổng này KHÔNG được phép sửa: tệp đang do
// phần việc khác giữ. Để cổng đỏ ngay thì `npm run verify` đỏ theo và cổng mới không vào được cây;
// để im lặng thì nợ sống mãi. Nên: in ẦM Ĩ mỗi lượt, và khi tài liệu ĐƯỢC SỬA thì mục nợ thành
// LẠC HẬU và cổng ĐỎ — buộc người sửa xoá luôn mục nợ. Nợ không tự sống mãi được.
//
// Cách xoá một mục: sửa con số trong tài liệu cho đúng, rồi xoá dòng tương ứng ở đây.
const NO_TRE = [];

// ── ĐỐI CHIẾU TOÀN CÂY ──────────────────────────────────────────────────────

/** Quét mọi tệp trong phạm vi rồi đối chiếu với số đo. Tách khỏi phần in để test gọi được. */
export async function doiChieuTatCa() {
  const soThuc = await doTatCa();
  const tep = danhSachTep();
  const tatCa = [];
  for (const f of tep) for (const k of quet(doc(f), soThuc)) tatCa.push({ tep: f, ...k });

  const lech = tatCa.filter((k) => !k.khop);
  // Nợ trễ khớp theo (tệp, đại lượng, số tài liệu) — KHÔNG theo số dòng, vì số dòng trôi.
  const laNo = (k) => NO_TRE.some((n) => n.tep === k.tep && n.id === k.id && n.soTaiLieu === k.soTaiLieu);
  const lechThat = lech.filter((k) => !laNo(k));
  const noLacHau = NO_TRE.filter((n) => !lech.some((k) => k.tep === n.tep && k.id === n.id && k.soTaiLieu === n.soTaiLieu));
  return { soThuc, tep, tatCa, lech, lechThat, noLacHau, noConSong: NO_TRE.filter((n) => !noLacHau.includes(n)) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const CHECK = process.argv.includes("--check");
  const { soThuc, tep, tatCa, lechThat, noLacHau, noConSong } = await doiChieuTatCa();

  if (!CHECK) {
    const rong = Math.max(...Object.values(PHEP_DO).map((d) => d.nhan.length));
    console.log("SỐ ĐO TỪ MÃ NGUỒN\n");
    for (const [id, dl] of Object.entries(PHEP_DO)) {
      console.log(`  ${dl.nhan.padEnd(rong)}  ${String(soThuc[id]).padStart(4)}   ${dl.lenh}`);
    }
    console.log(`\nTÀI LIỆU KHAI (${tatCa.length} chỗ trong ${tep.length} tệp được quét)\n`);
    for (const k of tatCa) {
      console.log(`  ${k.khop ? "✓" : "✖"} ${k.tep}:${k.dong}  [${k.id}] ghi ${k.soTaiLieu}, đo ${k.soThuc}`);
    }
  }

  if (noConSong.length) {
    console.error(`\n\x1b[33m⚠ ${noConSong.length} SỐ TRÔI ĐÃ BIẾT, ĐANG CHỜ NGƯỜI GIỮ TỆP SỬA (nợ trễ):\x1b[0m`);
    for (const n of noConSong) {
      console.error(`   · ${n.tep} — ${n.ghiChu}`);
      console.error(`     đúng phải là ${soThuc[n.id]}   (${PHEP_DO[n.id].lenh})`);
    }
    console.error("   Sửa xong thì XOÁ mục tương ứng trong NO_TRE của scripts/ci/check-doc-numbers.mjs.");
  }

  if (noLacHau.length) {
    console.error(`\n\x1b[31m✖ ${noLacHau.length} mục NO_TRE đã LẠC HẬU — tài liệu sửa rồi mà nợ còn đó:\x1b[0m`);
    for (const n of noLacHau) console.error(`   · ${n.tep} [${n.id}] không còn ghi ${n.soTaiLieu}`);
    console.error("   Xoá mục đó khỏi NO_TRE trong scripts/ci/check-doc-numbers.mjs.");
  }

  if (lechThat.length) {
    console.error(`\n\x1b[31m✖ ${lechThat.length} CON SỐ TRONG TÀI LIỆU LỆCH KHỎI MÃ NGUỒN:\x1b[0m\n`);
    for (const k of lechThat) {
      const dl = PHEP_DO[k.id];
      console.error(`  ${k.tep}:${k.dong}`);
      console.error(`      ${k.trich}`);
      console.error(`      tài liệu ghi → ${k.soTaiLieu} ${dl.nhan}`);
      console.error(`      đo được      → ${k.soThuc}`);
      console.error(`      đo lại       → ${dl.lenh}\n`);
    }
    console.error("Nếu con số ĐÚNG vì nó là số của QUÁ KHỨ, đừng sửa nó — hãy khai là số lịch sử:");
    console.error('  · đặt một mốc bằng lời trước nó trong cùng đoạn ("Trước đợt …", "bản đầu …"), hoặc');
    console.error("  · đặt nhãn <!-- so-lich-su --> trên dòng đó / dòng ngay trước.");
    console.error("Quy ước đầy đủ: chú thích đầu scripts/ci/check-doc-numbers.mjs.");
  }

  if (lechThat.length || noLacHau.length) process.exit(CHECK ? 1 : 0);

  if (CHECK) {
    console.log(
      `✓ ${tatCa.length} con số trong ${tep.length} tệp khớp mã nguồn ` +
        `(${Object.entries(soThuc).map(([id, v]) => `${id}=${v}`).join(" · ")})`
    );
  }
}

// Chỉ chạy CLI khi được gọi TRỰC TIẾP. Import từ bài test thì chỉ lấy hàm — nếu không,
// `import` sẽ kéo theo cả việc quét, in bảng và `process.exit`, và bài test chết trước khi chạy.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
