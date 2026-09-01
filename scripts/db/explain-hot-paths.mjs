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
// Tự dựng `EXPLAIN_SO_DONG` (mặc định 5000) khách hàng + báo giá mang tiền tố `xp-<pid>`, chạy
// ANALYZE để bộ hoạch định có thống kê thật, rồi XOÁ CỨNG ở finally. Không đụng dữ liệu sẵn có.
// Không có dữ liệu thì mọi kế hoạch đều là Seq Scan trên bảng rỗng và bài đo nói dối theo chiều
// ngược lại: "không có index nào cần thiết".
// PHẢI đặt TRƯỚC khi nạp dist/db.js: `$on("query")` chỉ chạy khi client được DỰNG với mức log đó,
// và db.ts đọc biến này đúng một lần lúc nạp module.
process.env.PRISMA_LOG_QUERIES = "1";
const { prisma, ngheTruyVan } = await import("../../dist/db.js");

const CHI_TIET = process.argv.includes("--chi-tiet");
const SO_DONG = Number(process.env.EXPLAIN_SO_DONG || 5000);
const NGUONG_SEQ_SCAN = Number(process.env.EXPLAIN_NGUONG_SEQ || 1000);
const TAG = `xp-${process.pid}`;

let loi = 0;
const ok = (s) => console.log(`  \x1b[32m✓ ${s}\x1b[0m`);
const xau = (s) => {
  console.log(`  \x1b[31m✗ ${s}\x1b[0m`);
  loi = 1;
};
const buoc = (s) => console.log(`\n\x1b[1m▶ ${s}\x1b[0m`);

/**
 * Câu SQL Prisma vừa chạy (kèm tham số). Sự kiện bắn SAU khi chạy xong.
 *
 * DÙNG CHÍNH client của ứng dụng (`dist/db.js`), không dựng client riêng: các hàm service import
 * `prisma` từ đó, nên một client riêng sẽ không nghe được gì — bản đầu của file này mắc đúng lỗi
 * ấy và báo "không bắt được câu SELECT nào" cho cả 5 đường.
 */
let batDuoc = [];
const daNghe = ngheTruyVan((e) => {
  // Bỏ những câu KHÔNG phải truy vấn nghiệp vụ: BEGIN/COMMIT và câu dò phiên bản lúc kết nối.
  if (/^\s*(BEGIN|COMMIT|ROLLBACK|SELECT 1|SET |DEALLOCATE)/i.test(e.query)) return;
  batDuoc.push({ sql: e.query, params: e.params, ms: e.duration });
});
if (!daNghe) {
  console.error("❌ Không bật được log truy vấn của Prisma (PRISMA_LOG_QUERIES). Không đo được gì.");
  process.exit(1);
}

/**
 * Duyệt cây kế hoạch, trả về mọi nút Seq Scan kèm SỐ DÒNG THẬT SỰ ĐỌC.
 *
 * "Actual Rows" là số dòng ĐI RA khỏi nút, tức SAU bộ lọc. Một Seq Scan quét trọn 10.000 dòng rồi
 * trả về 1 vẫn hiện "Actual Rows: 1" — dùng con số đó làm ngưỡng là bỏ lọt đúng những lần quét
 * đắt nhất. Số đọc thật = ra + bị lọc bỏ.
 */
function timSeqScan(node, ra = []) {
  if (!node || typeof node !== "object") return ra;
  if (node["Node Type"] === "Seq Scan") {
    const raDong = node["Actual Rows"] ?? node["Plan Rows"] ?? 0;
    const boLoc = node["Rows Removed by Filter"] ?? 0;
    const vong = node["Actual Loops"] ?? 1;
    ra.push({
      bang: node["Relation Name"],
      dong: (raDong + boLoc) * (vong || 1),
      loc: node["Filter"] || null,
    });
  }
  for (const con of node["Plans"] || []) timSeqScan(con, ra);
  return ra;
}

/**
 * Những lần quét tuần tự ĐÃ SOÁT và CHẤP NHẬN. Khoá: `<tên đường>|<bảng>`.
 *
 * Có danh sách này vì một cổng hay báo động giả sẽ bị người ta tắt — lúc đó còn tệ hơn không có
 * cổng nào. Mỗi mục phải kèm LÝ DO ĐO ĐƯỢC, và mục mới chỉ được thêm sau khi đã thật sự xem kế
 * hoạch, không phải để cho qua chuyện.
 */
const CHAP_NHAN = [
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
const daChapNhan = (bang, sql) =>
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
    const ungVien = { thoiGian, seq, sql: q.sql, ke };
    if (teHon(ungVien, xauNhat)) xauNhat = ungVien;
  }
  if (!xauNhat) {
    xau(`${ten}: không EXPLAIN được câu nào`);
    return;
  }
  const nhan = `${ten} — ${xauNhat.thoiGian.toFixed(1)} ms`;
  if (xauNhat.seq.length) {
    xau(`${nhan} · QUÉT TUẦN TỰ bảng lớn: ${xauNhat.seq.map((s) => `${s.bang} (${s.dong} dòng)`).join(", ")}`);
    console.log(`      SQL: ${xauNhat.sql.slice(0, 220)}`);
  } else {
    ok(nhan);
  }
  if (CHI_TIET) console.log(JSON.stringify(xauNhat.ke, null, 1).slice(0, 4000));
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
  const khach = [];
  for (let lo = 0; lo < SO_DONG; lo += 500) {
    const n = Math.min(500, SO_DONG - lo);
    await prisma.customer.createMany({
      data: Array.from({ length: n }, (_, i) => {
        const ten = `Khách thử ${lo + i}`;
        const ma = `${TAG}K${lo + i}`;
        khach.push(ma);
        return { code: ma, name: ten, phone: `090${String(lo + i).padStart(7, "0")}`, searchText: normalizeSearch(ten, ma) };
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
          createdById: u.id, status: "draft",
          searchText: normalizeSearch(so, null, td, `Khách ${lo + i}`, null),
        };
      }),
    });
  }
  // ANALYZE: không có thống kê tươi thì bộ hoạch định đoán bừa và mọi kế hoạch dưới đây vô nghĩa.
  await prisma.$executeRawUnsafe('ANALYZE "Quote", "Customer", "QuoteSheet", "QuoteItem", "AuditEvent"');
  ok(`${SO_DONG} khách + ${SO_DONG} báo giá, đã ANALYZE`);

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
  const chung = { sort: "createdAt", order: "desc" };
  await giaiThich("danh sách báo giá (trang 1)", async () => {
    await quoteService.listQuotes({ ...req, query: { ...chung, page: 1, size: 20 } });
  });
  await giaiThich("danh sách báo giá (TÌM không dấu)", async () => {
    await quoteService.listQuotes({ ...req, query: { ...chung, q: "bao gia thu 4321", page: 1, size: 20 } });
  });
  await giaiThich("danh sách báo giá (trang SÂU — offset lớn)", async () => {
    await quoteService.listQuotes({ ...req, query: { ...chung, page: 100, size: 20 } });
  });
  await giaiThich("danh sách khách hàng (trang 1)", async () => {
    await customerService.listCustomers({ ...req, query: { ...chung, page: 1, size: 20 } });
  });
  await giaiThich("danh sách khách hàng (TÌM không dấu)", async () => {
    await customerService.listCustomers({ ...req, query: { ...chung, q: "khach thu 4321", page: 1, size: 20 } });
  });

  buoc("Kết luận");
  console.log(
    loi
      ? "  Có truy vấn quét tuần tự bảng lớn — xem SQL in kèm rồi thêm index hoặc đổi điều kiện lọc."
      : `  Không truy vấn nào quét tuần tự bảng từ ${NGUONG_SEQ_SCAN} dòng trở lên.`,
  );
}

async function donDep() {
  try {
    await prisma.quote.deleteMany({ where: { quoteNumber: { startsWith: TAG } }, hardDelete: true, includeDeleted: true });
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

main().then(
  async () => {
    await donDep();
    console.log(loi ? "\n\x1b[31m❌ EXPLAIN ĐỎ\x1b[0m" : "\n\x1b[32m✅ EXPLAIN XANH\x1b[0m");
    process.exit(loi);
  },
  async (e) => {
    console.error("\n❌", e);
    await donDep();
    process.exit(1);
  },
);
