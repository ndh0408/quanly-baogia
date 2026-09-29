#!/usr/bin/env node
// ============================================================================
// explain-hot-paths.mjs — EXPLAIN ANALYZE cho các truy vấn NÓNG, và một cổng chặn.
//
//   node scripts/db/explain-hot-paths.mjs            # chạy, in bảng, đỏ nếu quét tuần tự bảng lớn
//   node scripts/db/explain-hot-paths.mjs --chi-tiet # in luôn kế hoạch đầy đủ của từng truy vấn
//   EXPLAIN_SO_DONG=20000 node scripts/db/explain-hot-paths.mjs
//
// ── VÌ SAO KHÔNG TỰ VIẾT SQL RỒI EXPLAIN NÓ ────────────────────────────────
// §17 đòi "EXPLAIN ANALYZE cho hot paths". Cách dễ là chép tay câu SQL mình NGHĨ là Prisma sinh ra
// rồi EXPLAIN câu đó — và nó vô giá trị: câu chép tay không trôi theo mã, nên vài tháng sau ta đang
// EXPLAIN một truy vấn KHÔNG CÒN AI CHẠY. File này lấy SQL THẬT: bật log sự kiện `query` của Prisma,
// gọi ĐÚNG hàm service mà route gọi, hứng lấy câu SQL kèm tham số, rồi EXPLAIN chính nó.
//
// ── CỔNG CHẶN, KHÔNG PHẢI BÁO CÁO ──────────────────────────────────────────
// Một báo cáo hiệu năng không ai đọc thì bằng không. Ở đây có ngưỡng: `Seq Scan` trên bảng có số
// dòng vượt `NGUONG_SEQ_SCAN` là ĐỎ. Bảng nhỏ quét tuần tự là chuyện BÌNH THƯỜNG và đúng đắn — nên
// ngưỡng đặt theo số dòng thật của bảng trong kế hoạch, không phải "thấy Seq Scan là đỏ".
//
// ── DỮ LIỆU ────────────────────────────────────────────────────────────────
// Tự dựng `EXPLAIN_SO_DONG` (mặc định 5000) khách hàng + báo giá mang tiền tố `xp-<pid>`, mỗi báo
// giá `TRANG_MOI_BAO_GIA` trang, chạy ANALYZE để bộ hoạch định có thống kê thật, rồi XOÁ CỨNG ở
// finally. Không đụng dữ liệu sẵn có.
// Không có dữ liệu thì mọi kế hoạch đều là Seq Scan trên bảng rỗng và bài đo nói dối theo chiều
// ngược lại: "không có index nào cần thiết".
//
// ── THỨ TỰ VẬT LÝ: CỔNG TỪNG ĐỎ/XANH THẤT THƯỜNG VÌ NÓ ─────────────────────
// Giá của một Index Scan đọc NHIỀU dòng do `correlation` của cột sắp xếp quyết định: thứ tự dòng
// nằm trên đĩa khớp thứ tự giá trị (≈ ±1) thì đi index gần như đọc tuần tự; lệch (≈ 0) thì mỗi dòng
// là một lần đọc trang ngẫu nhiên. Mà thứ tự vật lý của 5.000 dòng thử KHÔNG do script quyết định:
// lượt trước (hoặc bộ test) để lại dòng CHẾT; các lô đầu nối vào ĐUÔI bảng; autovacuum rơi vào giữa
// lúc đang chèn thì ghi chỗ trống ở ĐẦU bảng vào FSM và đặt con trỏ FSM về 0 → các lô sau chèn vào
// ĐẦU bảng. Đo được (2026-09-29, CSDL test): correlation(createdAt) của Quote rơi từ 0,98 xuống −0,46
// và trang 100 (bỏ qua 1.980 trong 5.015 dòng = 40% bảng) lật sang Seq Scan + Sort — chi phí 779 so
// với 851 của đường index. Bộ hoạch định CHỌN ĐÚNG: đọc 40% bảng theo thứ tự ngẫu nhiên đắt hơn quét
// hết. Cổng đỏ vì LỊCH SỬ của bảng, không vì thiếu index — rồi chạy lại thì xanh.
// Hai chỗ sửa, cùng một ý "phán quyết chỉ được phụ thuộc vào index, không vào may rủi":
//   1. `createdAt` của dữ liệu thử được HOÁN VỊ so với thứ tự chèn (thoiDiemTao) → correlation ≈ 0
//      MỌI lượt, dù FSM xếp các lô vào đâu. Tức là luôn đo ở thứ tự XẤU NHẤT — cũng là thứ tự thật
//      của một bảng production sống lâu: mỗi lần lưu báo giá ghi phiên bản dòng mới vào chỗ trống.
//   2. Trang SÂU bỏ qua ~10% số dòng dựng (trangSau), không phải 40%. Ở thứ tự xấu nhất, đường index
//      vẫn rẻ hơn quét tuần tự ~3 lần (đo: 190 so với 592); gỡ index thì mọi đường sắp theo createdAt
//      rơi về Seq Scan và cổng ĐỎ — kiểm ngược vẫn còn nguyên.

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHI_TIET = process.argv.includes("--chi-tiet");
const SO_DONG = Number(process.env.EXPLAIN_SO_DONG || 5000);
const NGUONG_SEQ_SCAN = Number(process.env.EXPLAIN_NGUONG_SEQ || 1000);
const TAG = `xp-${process.pid}`;

/** Cỡ trang của mọi đường đo — bằng mặc định `DEFAULT_PAGE_SIZE` mà `ListQuerySchema` dùng. */
export const CO_TRANG = 20;
/** Trang SÂU bỏ qua chừng này phần số dòng dựng. Vì sao không sâu hơn: xem khối THỨ TỰ VẬT LÝ. */
export const TI_LE_TRANG_SAU = 0.1;
/**
 * Số TRANG (QuoteSheet) dựng cho mỗi báo giá thử. Không được là 0: `quoteSheetsSchema` đòi mỗi báo
 * giá ≥ 1 trang, nên ở CSDL thật bảng QuoteSheet luôn lớn ít nhất bằng bảng Quote. Bản trước không
 * dựng trang nào — câu Prisma sinh cho `_count: { sheets }` (gộp TOÀN BẢNG QuoteSheet rồi mới JOIN)
 * quét một bảng rỗng và cổng báo XANH cho đúng Seq Scan mà mỗi lần tải danh sách phải trả.
 */
export const TRANG_MOI_BAO_GIA = 2;

/**
 * Số trang của đường "trang SÂU": bỏ qua ≈ `TI_LE_TRANG_SAU` số dòng dựng, không ít hơn trang 2.
 *
 * Đo trên bảng 5.015 báo giá ở correlation ≈ 0 (chi phí đường index so với Seq Scan + Sort):
 * bỏ qua 10% → 190/592, 20% → 366/617, 30% → 548/633, 40% → 734/644 (Seq Scan THẮNG). Điểm hoà
 * nằm quanh 30–35%, nên 10% chừa biên ~3 lần mà vẫn là trang sâu thật (trang 26 với 5.000 dòng).
 */
export function trangSau(soDong, coTrang = CO_TRANG) {
  return Math.max(2, Math.floor((soDong * TI_LE_TRANG_SAU) / coTrang) + 1);
}

const ucln = (a, b) => (b ? ucln(b, a % b) : a);

/** Bước của phép hoán vị `i ↦ i·b mod n`: gần n/φ (rải đều nhất) và nguyên tố cùng nhau với n. */
export function buocHoanVi(n) {
  let b = Math.max(1, Math.round(n * 0.6180339887));
  while (ucln(b, n) !== 1) b++;
  return b;
}

/**
 * `createdAt` của dòng thử thứ `i` (trong `n` dòng): mỗi dòng một phút riêng, lùi dần từ `goc`,
 * theo hoán vị `i·b mod n` — nên thứ tự thời gian KHÔNG tương quan với thứ tự chèn, kể cả trong
 * từng lô 500 dòng (FSM có thể xếp các LÔ vào bất cứ đâu, nhưng không xáo được bên trong một lô).
 * Tất định: cùng `n` thì cùng dãy, lượt nào đỏ thì chạy lại vẫn đỏ.
 */
export function thoiDiemTao(i, n, goc) {
  return new Date(goc - (((i * buocHoanVi(n)) % n) + 1) * 60_000);
}

/** Client Prisma CỦA ỨNG DỤNG — chỉ gán khi script được chạy thật (xem chayCong ở cuối tệp). */
let prisma;

let loi = 0;
const ok = (s) => console.log(`  \x1b[32m✓ ${s}\x1b[0m`);
// ĐỎ ra STDERR: verify-local.sh đổ stdout (log truy vấn của Prisma) vào /dev/null.
const xau = (s) => {
  console.error(`  \x1b[31m✗ ${s}\x1b[0m`);
  loi = 1;
};
const buoc = (s) => console.log(`\n\x1b[1m▶ ${s}\x1b[0m`);

/**
 * Câu SQL Prisma vừa chạy (kèm tham số). Sự kiện bắn SAU khi chạy xong.
 *
 * DÙNG CHÍNH client của ứng dụng (`dist/db.js`), không dựng client riêng: các hàm service import
 * `prisma` từ đó, nên một client riêng sẽ không nghe được gì — bản đầu của file này mắc đúng lỗi
 * ấy và báo "không bắt được câu SELECT nào" cho cả 5 đường. Nghe ở `chayCong`.
 */
let batDuoc = [];

/**
 * Duyệt cây kế hoạch, trả về mọi nút Seq Scan kèm SỐ DÒNG THẬT SỰ ĐỌC.
 *
 * "Actual Rows" là số dòng ĐI RA khỏi nút, tức SAU bộ lọc. Một Seq Scan quét trọn 10.000 dòng rồi
 * trả về 1 vẫn hiện "Actual Rows: 1" — dùng con số đó làm ngưỡng là bỏ lọt đúng những lần quét
 * đắt nhất. Số đọc thật = ra + bị lọc bỏ.
 */
export function timSeqScan(node, ra = []) {
  if (!node || typeof node !== "object") return ra;
  if (node["Node Type"] === "Seq Scan") {
    const raDong = node["Actual Rows"] ?? node["Plan Rows"] ?? 0;
    const boLoc = node["Rows Removed by Filter"] ?? 0;
    const vong = node["Actual Loops"] ?? 1;
    ra.push({
      bang: node["Relation Name"],
      dong: (raDong + boLoc) * (vong || 1),
      loc: node["Filter"] || null,
      uocLuong: node["Plan Rows"],
      thatRa: node["Actual Rows"],
      boLoc,
      vong,
      chiPhi: node["Total Cost"],
    });
  }
  for (const con of node["Plans"] || []) timSeqScan(con, ra);
  return ra;
}

/** Cây kế hoạch rút gọn, mỗi nút một dòng: loại nút · bảng/index · chi phí · ước lượng/thật. */
export function veKeHoach(node, sau = 0, ra = []) {
  if (!node || typeof node !== "object") return ra;
  const p = [`${"  ".repeat(sau)}${node["Node Type"]}`];
  if (node["Relation Name"]) p.push(`on "${node["Relation Name"]}"`);
  if (node["Index Name"]) p.push(`dùng ${node["Index Name"]}`);
  p.push(`· chi phí ${node["Total Cost"]}`);
  p.push(`· ước lượng ${node["Plan Rows"]} dòng`);
  if (node["Actual Rows"] !== undefined) p.push(`/ thật ${node["Actual Rows"]}×${node["Actual Loops"] ?? 1}`);
  if (node["Rows Removed by Filter"]) p.push(`(lọc bỏ ${node["Rows Removed by Filter"]})`);
  if (node["Sort Key"]) p.push(`· sắp ${node["Sort Key"].join(", ")}`);
  if (node["Filter"]) p.push(`· lọc ${node["Filter"]}`);
  if (node["Index Cond"]) p.push(`· điều kiện index ${node["Index Cond"]}`);
  ra.push(p.join(" "));
  for (const con of node["Plans"] || []) veKeHoach(con, sau + 1, ra);
  return ra;
}

const loiRa = (s) => console.error(`      ${s}`);

/**
 * KHI ĐỎ, NÓI RA ĐỦ ĐỂ KHÔNG PHẢI CHẠY LẠI. Cổng này từng đỏ trong lượt verify rồi xanh khi chạy
 * riêng — và bản trước chỉ in "✗ … Quote (5000 dòng)" ra stdout, mà verify-local.sh đổ stdout vào
 * /dev/null. Nên mọi thứ dưới đây ra STDERR: truy vấn nào, nút Seq Scan nào, bộ hoạch định ƯỚC
 * LƯỢNG bao nhiêu dòng so với THẬT bao nhiêu, thống kê của bảng lúc đó (kể cả `correlation` của cột
 * sắp xếp), và chi phí của kế hoạch dùng index mà bộ hoạch định đã gạt đi — đủ để biết đó là thiếu
 * index thật hay một lựa chọn sát nút. Chính khối này đã chỉ ra gốc rễ ở khối THỨ TỰ VẬT LÝ đầu tệp.
 */
async function inChanDoan(x) {
  loiRa(`SQL: ${x.sql}`);
  loiRa(`tham số: ${typeof x.params === "string" ? x.params : JSON.stringify(x.params)}`);
  for (const s of x.seq) {
    loiRa(
      `nút Seq Scan on "${s.bang}": ước lượng ${s.uocLuong} dòng · thật ${s.thatRa} ra + ${s.boLoc} bị lọc bỏ ` +
        `× ${s.vong} vòng = đọc ${s.dong} · chi phí ${s.chiPhi}${s.loc ? ` · lọc ${s.loc}` : ""}`,
    );
  }
  for (const bang of [...new Set(x.seq.map((s) => s.bang))]) {
    try {
      const [t] = await prisma.$queryRawUnsafe(
        `SELECT c.reltuples::bigint AS reltuples, c.relpages, s.n_live_tup, s.n_dead_tup, s.n_mod_since_analyze,
                s.last_analyze, s.last_autoanalyze, s.last_autovacuum
           FROM pg_class c LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
          WHERE c.oid = to_regclass($1)`,
        `"${bang}"`,
      );
      loiRa(`thống kê "${bang}": ${JSON.stringify(t, (_, v) => (typeof v === "bigint" ? Number(v) : v))}`);
      // Cột sắp xếp: `correlation` (thứ tự vật lý so với thứ tự giá trị) là thứ quyết định giá của
      // một Index Scan đọc nhiều dòng — thấp là bộ hoạch định thấy mỗi dòng một lần đọc ngẫu nhiên.
      const cot = [...(/ORDER BY (.+?)(?: LIMIT| OFFSET|$)/s.exec(x.sql)?.[1] ?? "").matchAll(/"(\w+)"\s*(?:ASC|DESC)?(?:,|$)/g)].map((m) => m[1]);
      if (cot.length) {
        const st = await prisma.$queryRawUnsafe(
          `SELECT attname, n_distinct, correlation FROM pg_stats WHERE schemaname = 'public' AND tablename = $1 AND attname = ANY($2::text[])`,
          bang, cot,
        );
        loiRa(`pg_stats cột sắp xếp của "${bang}": ${JSON.stringify(st)}`);
      }
    } catch (e) {
      loiRa(`(không đọc được thống kê "${bang}": ${String(e.message).slice(0, 120)})`);
    }
  }
  loiRa("kế hoạch đã chọn:");
  for (const d of veKeHoach(x.ke?.Plan ?? x.ke)) loiRa(`  ${d}`);
  // Kế hoạch mà bộ hoạch định GẠT ĐI: ép tắt seqscan trong một transaction riêng (SET LOCAL không
  // rò ra kết nối khác của pool) rồi so chi phí. Chênh ít = lựa chọn sát nút, dễ lật theo thống kê.
  try {
    const tham = typeof x.params === "string" ? JSON.parse(x.params) : x.params || [];
    const r = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) ${x.sql}`, ...tham);
    });
    const ke = r?.[0]?.["QUERY PLAN"]?.[0] ?? r?.[0]?.["QUERY PLAN"];
    loiRa(`kế hoạch bị gạt đi (enable_seqscan=off), chi phí ${ke?.Plan?.["Total Cost"]} so với ${(x.ke?.Plan ?? x.ke)?.["Total Cost"]} của kế hoạch đã chọn:`);
    for (const d of veKeHoach(ke?.Plan)) loiRa(`  ${d}`);
  } catch (e) {
    loiRa(`(không dựng được kế hoạch ép index: ${String(e.message).slice(0, 120)})`);
  }
}

/**
 * Những lần quét tuần tự ĐÃ SOÁT và CHẤP NHẬN. Khoá: `<tên đường>|<bảng>`.
 *
 * Có danh sách này vì một cổng hay báo động giả sẽ bị người ta tắt — lúc đó còn tệ hơn không có
 * cổng nào. Mỗi mục phải kèm LÝ DO ĐO ĐƯỢC, và mục mới chỉ được thêm sau khi đã thật sự xem kế
 * hoạch, không phải để cho qua chuyện.
 */
export const CHAP_NHAN = [
  {
    bang: "Customer",
    // PHẢI khớp ĐIỀU KIỆN LỌC, không phải chỉ chữ "searchText": Prisma SELECT mọi cột nên chuỗi
    // đó có mặt trong CẢ những câu không hề tìm kiếm. Bản đầu dùng /searchText/i và vô tình tha
    // luôn câu `findMany` của trang 1 — cổng kiểm ngược im lặng, đúng thứ tệ nhất một cổng có thể làm.
    sql: /"searchText"(::text)?\s*(NOT\s+)?I?LIKE/i,
    lyDo:
      "Tìm không dấu: GIN pg_trgm CÓ tồn tại. Ở cỡ bảng của bộ đo, bộ hoạch định tự thấy quét " +
      "tuần tự rẻ hơn đi index rồi lấy heap — lựa chọn ĐÚNG của nó, không phải thiếu index.",
  },
  {
    bang: "Quote",
    sql: /"searchText"(::text)?\s*(NOT\s+)?I?LIKE/i,
    lyDo: "Cùng lý do: Quote_searchText_trgm_idx tồn tại; ở cỡ này quét tuần tự rẻ hơn.",
  },
  {
    bang: null, // mọi bảng
    sql: /^\s*SELECT COUNT\(\*\)/i,
    lyDo:
      "ĐẾM TỔNG cho phân trang. Đếm mọi dòng còn sống thì BẮT BUỘC phải đọc hết chúng — không " +
      "index nào bỏ qua được việc đó, chỉ làm nó rẻ hơn (index-only scan). Đây là cái giá cố hữu " +
      "của phân trang kiểu OFFSET có hiển thị tổng số trang; muốn bỏ hẳn thì phải đổi sang phân " +
      "trang theo con trỏ (keyset) và không hiện tổng — một thay đổi HÀNH VI, không phải thêm " +
      "index. Ở quy mô hiện tại: 1–2 ms cho 5.000 dòng.",
  },
];

/** `true` nếu lần quét tuần tự này đã được soát và chấp nhận (xem CHAP_NHAN). */
export const daChapNhan = (bang, sql) =>
  CHAP_NHAN.some((c) => (c.bang === null || c.bang === bang) && c.sql.test(sql));

async function giaiThich(ten, chay) {
  batDuoc = [];
  await chay();
  const cau = batDuoc.filter((q) => /^\s*SELECT/i.test(q.sql));
  if (!cau.length) {
    xau(`${ten}: không bắt được câu SELECT nào — hàm service có thể đã đổi`);
    return;
  }
  // Chọn kế hoạch ĐÁNG BÁO ĐỘNG NHẤT, không phải kế hoạch CHẬM NHẤT: một đường thường chạy 2 câu
  // (count + findMany), và câu chậm hơn chưa chắc là câu quét tuần tự. Bản đầu của file này chọn
  // theo thời gian nên nó báo XANH cho danh sách báo giá trong khi câu findMany đang Seq Scan.
  let xauNhat = null;
  const teHon = (a, b) => {
    if (!b) return true;
    if (a.seq.length !== b.seq.length) return a.seq.length > b.seq.length;
    return a.thoiGian > b.thoiGian;
  };
  for (const q of cau) {
    let ke;
    try {
      const tham = typeof q.params === "string" ? JSON.parse(q.params) : q.params || [];
      const r = await prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}`, ...tham);
      ke = r?.[0]?.["QUERY PLAN"]?.[0] ?? r?.[0]?.["QUERY PLAN"];
    } catch (e) {
      // Câu có kiểu tham số Prisma tự ép (vd enum) đôi khi EXPLAIN không nhận — nói ra, đừng nuốt.
      console.log(`      \x1b[33m— không EXPLAIN được một câu của ${ten}: ${String(e.message).slice(0, 120)}\x1b[0m`);
      continue;
    }
    const goc = ke?.Plan ?? ke;
    const thoiGian = ke?.["Execution Time"] ?? 0;
    const seq = timSeqScan(goc)
      .filter((s) => s.dong >= NGUONG_SEQ_SCAN)
      .filter((s) => !daChapNhan(s.bang, q.sql));
    const ungVien = { thoiGian, seq, sql: q.sql, params: q.params, ke };
    if (teHon(ungVien, xauNhat)) xauNhat = ungVien;
  }
  if (!xauNhat) {
    xau(`${ten}: không EXPLAIN được câu nào`);
    return;
  }
  const nhan = `${ten} — ${xauNhat.thoiGian.toFixed(1)} ms`;
  if (xauNhat.seq.length) {
    xau(`${nhan} · QUÉT TUẦN TỰ bảng lớn: ${xauNhat.seq.map((s) => `${s.bang} (${s.dong} dòng)`).join(", ")}`);
    await inChanDoan(xauNhat);
  } else {
    ok(nhan);
  }
  if (CHI_TIET) {
    console.log(`      SQL: ${xauNhat.sql}`);
    for (const d of veKeHoach(xauNhat.ke?.Plan ?? xauNhat.ke)) console.log(`        ${d}`);
  }
}

async function main() {
  buoc(`Dựng ${SO_DONG} dòng dữ liệu thử (${TAG})`);
  const { normalizeSearch } = await import("../../dist/searchText.js");
  const u = await prisma.user.create({
    data: { username: `${TAG}-u`, displayName: "Explain", role: "admin", passwordHash: "x" },
  });
  const co = await prisma.company.create({
    data: { code: `${TAG}CO`, name: "Cty Explain", address: "1", quotePrefix: `X${String(process.pid).slice(-4)}` },
  });
  // `createdAt` hoán vị so với thứ tự chèn — xem khối THỨ TỰ VẬT LÝ đầu tệp và `thoiDiemTao`.
  const goc = Date.now();
  for (let lo = 0; lo < SO_DONG; lo += 500) {
    const n = Math.min(500, SO_DONG - lo);
    await prisma.customer.createMany({
      data: Array.from({ length: n }, (_, i) => {
        const ten = `Khách thử ${lo + i}`;
        const ma = `${TAG}K${lo + i}`;
        return {
          code: ma, name: ten, phone: `090${String(lo + i).padStart(7, "0")}`, searchText: normalizeSearch(ten, ma),
          createdAt: thoiDiemTao(lo + i, SO_DONG, goc),
        };
      }),
    });
  }
  for (let lo = 0; lo < SO_DONG; lo += 500) {
    const n = Math.min(500, SO_DONG - lo);
    await prisma.quote.createMany({
      data: Array.from({ length: n }, (_, i) => {
        const so = `${TAG}-${lo + i}`;
        const td = `Báo giá thử ${lo + i}`;
        return {
          quoteNumber: so, title: td, toCompany: `Khách ${lo + i}`, companyId: co.id,
          fromContact: "X", fromAddress: "1", city: "TP. Hồ Chí Minh", quoteDate: new Date(),
          createdById: u.id, status: "draft", createdAt: thoiDiemTao(lo + i, SO_DONG, goc),
          searchText: normalizeSearch(so, null, td, `Khách ${lo + i}`, null),
        };
      }),
    });
  }
  // Trang của từng báo giá — xem TRANG_MOI_BAO_GIA. SQL thô cho gọn: một câu thay cho 10.000 lần
  // tạo lồng; chỉ ba cột bắt buộc, còn lại để mặc định như một trang vừa tạo từ giao diện.
  const mau = await prisma.quoteTemplate.create({
    data: { companyId: co.id, name: "Mẫu Explain", code: `${TAG}-mau`, filePath: "templates/GN_KhongNgay.xlsx" },
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO "QuoteSheet" ("quoteId", "templateId", "order")
     SELECT q.id, $1, o FROM "Quote" q CROSS JOIN generate_series(1, $2) o WHERE q."companyId" = $3`,
    mau.id, TRANG_MOI_BAO_GIA, co.id,
  );
  // ANALYZE: không có thống kê tươi thì bộ hoạch định đoán bừa và mọi kế hoạch dưới đây vô nghĩa.
  await prisma.$executeRawUnsafe('ANALYZE "Quote", "Customer", "QuoteSheet", "QuoteItem", "AuditEvent"');
  // In ra để lượt nào cũng thấy tiền đề của bài đo: ≈ 0 là đang đo ở thứ tự vật lý xấu nhất. Không
  // chặn theo nó — CSDL có sẵn nhiều dữ liệu thật (dev) thì correlation do dữ liệu đó quyết định.
  const tuongQuan = await prisma.$queryRawUnsafe(
    `SELECT tablename, correlation FROM pg_stats
      WHERE schemaname = 'public' AND tablename IN ('Customer', 'Quote') AND attname = 'createdAt' ORDER BY tablename`,
  );
  ok(
    `${SO_DONG} khách + ${SO_DONG} báo giá × ${TRANG_MOI_BAO_GIA} trang, đã ANALYZE · correlation(createdAt): ` +
      (tuongQuan.map((r) => `${r.tablename} ${Number(r.correlation).toFixed(2)}`).join(", ") || "chưa có"),
  );

  // Phiên giả: các hàm service đọc quyền từ `req.session`. Dùng đúng hình dạng mà permissions.ts đợi.
  const { PERMISSIONS } = await import("../../dist/permissions.js");
  const req = {
    session: { userId: u.id, role: "admin", permissions: Object.values(PERMISSIONS) },
    query: {},
    params: {},
    body: {},
  };

  buoc("EXPLAIN ANALYZE các đường nóng");
  const quoteService = await import("../../dist/services/quoteService.js");
  const customerService = await import("../../dist/services/customerService.js");

  // Tên tham số lấy ĐÚNG như `ListQuerySchema` coerce ra (`size`, không phải `pageSize`; `sort` là
  // tên cột thật vì service ghép thẳng vào `orderBy`). Đoán sai tên là service lặng lẽ dùng mặc
  // định và ta EXPLAIN một truy vấn khác thứ mình định đo.
  const chung = { sort: "createdAt", order: "desc", size: CO_TRANG };
  const sau = trangSau(SO_DONG);
  await giaiThich("danh sách báo giá (trang 1)", async () => {
    await quoteService.listQuotes({ ...req, query: { ...chung, page: 1 } });
  });
  await giaiThich("danh sách báo giá (TÌM không dấu)", async () => {
    await quoteService.listQuotes({ ...req, query: { ...chung, q: "bao gia thu 4321", page: 1 } });
  });
  await giaiThich(`danh sách báo giá (trang SÂU ${sau} — bỏ qua ${(sau - 1) * CO_TRANG} dòng)`, async () => {
    await quoteService.listQuotes({ ...req, query: { ...chung, page: sau } });
  });
  await giaiThich("danh sách khách hàng (trang 1)", async () => {
    await customerService.listCustomers({ ...req, query: { ...chung, page: 1 } });
  });
  await giaiThich("danh sách khách hàng (TÌM không dấu)", async () => {
    await customerService.listCustomers({ ...req, query: { ...chung, q: "khach thu 4321", page: 1 } });
  });

  buoc("Kết luận");
  (loi ? console.error : console.log)(
    loi
      ? "  Có truy vấn quét tuần tự bảng lớn — xem SQL in kèm rồi thêm index hoặc đổi điều kiện lọc."
      : `  Không truy vấn nào quét tuần tự bảng từ ${NGUONG_SEQ_SCAN} dòng trở lên.`,
  );
}

async function donDep() {
  if (!prisma) return;
  try {
    await prisma.quote.deleteMany({ where: { quoteNumber: { startsWith: TAG } }, hardDelete: true, includeDeleted: true });
  } catch { /* bỏ qua */ }
  // Sau Quote (trang đi theo báo giá — onDelete: Cascade), trước Company (mẫu trỏ tới công ty).
  try {
    await prisma.quoteTemplate.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true, includeDeleted: true });
  } catch { /* bỏ qua */ }
  try {
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true, includeDeleted: true });
  } catch { /* bỏ qua */ }
  try {
    await prisma.company.deleteMany({ where: { code: { startsWith: TAG } }, hardDelete: true, includeDeleted: true });
  } catch { /* bỏ qua */ }
  try {
    await prisma.user.deleteMany({ where: { username: { startsWith: TAG } }, hardDelete: true, includeDeleted: true });
  } catch { /* bỏ qua */ }
  try {
    await prisma.$disconnect();
  } catch { /* bỏ qua */ }
}

async function chayCong() {
  // PHẢI đặt TRƯỚC khi nạp dist/db.js: `$on("query")` chỉ chạy khi client được DỰNG với mức log đó,
  // và db.ts đọc biến này đúng một lần lúc nạp module.
  process.env.PRISMA_LOG_QUERIES = "1";
  const db = await import("../../dist/db.js");
  prisma = db.prisma;
  const daNghe = db.ngheTruyVan((e) => {
    // Bỏ những câu KHÔNG phải truy vấn nghiệp vụ: BEGIN/COMMIT và câu dò phiên bản lúc kết nối.
    if (/^\s*(BEGIN|COMMIT|ROLLBACK|SELECT 1|SET |DEALLOCATE)/i.test(e.query)) return;
    batDuoc.push({ sql: e.query, params: e.params, ms: e.duration });
  });
  if (!daNghe) {
    console.error("❌ Không bật được log truy vấn của Prisma (PRISMA_LOG_QUERIES). Không đo được gì.");
    process.exit(1);
  }
  await main().then(
    async () => {
      await donDep();
      (loi ? console.error : console.log)(loi ? "\n\x1b[31m❌ EXPLAIN ĐỎ\x1b[0m" : "\n\x1b[32m✅ EXPLAIN XANH\x1b[0m");
      process.exit(loi);
    },
    async (e) => {
      console.error("\n❌", e);
      await donDep();
      process.exit(1);
    },
  );
}

/**
 * `true` khi tệp có `metaUrl` chính là tệp Node được gọi chạy (`argv1`), không phải được `import`.
 *
 * So ĐƯỜNG THẬT của hai vế, không so chuỗi. Node dựng `import.meta.url` của tệp chính từ đường đã
 * giải symlink/junction, còn `argv[1]` giữ nguyên chữ người gọi gõ. Bản trước so
 * `import.meta.url === pathToFileURL(path.resolve(argv[1]))` — gọi bằng đường tuyệt đối đi qua một
 * junction/symlink tới repo thì hai vế lệch, cổng KHÔNG chạy và tiến trình thoát 0 với 0 byte đầu
 * ra: một cổng im lặng trông y hệt cổng XANH (người soát đo được, 2026-09-29). `realpathSync.native`
 * còn chuẩn hoá luôn hoa/thường của ổ đĩa và thư mục trên Windows.
 */
export function laTepChinh(metaUrl, argv1) {
  if (!argv1) return false;
  const that = (p) => {
    try {
      return realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  return that(fileURLToPath(metaUrl)) === that(argv1);
}

// Chỉ CHẠY cổng khi được gọi thẳng. `import` từ test (tests/ops-cong-kiem.test.js) chỉ lấy các hàm
// thuần ở trên — không nạp dist/, không chạm CSDL. Thiếu chốt này thì một lần import sẽ dựng 5.000
// dòng vào CSDL test ngay giữa bộ test chạy song song.
if (laTepChinh(import.meta.url, process.argv[1])) await chayCong();
