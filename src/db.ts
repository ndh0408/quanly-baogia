import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { logger } from "./logger.js";
import { config } from "./config.js";

// Soft-delete + realtime-feed nay dùng Client Extensions ($extends) thay cho $use (đã DEPRECATED,
// bị gỡ ở Prisma 6+). HÀNH VI GIỮ Y HỆT bản $use cũ:
//  • delete/deleteMany trên model soft-delete → update deletedAt (trừ `hardDelete: true`).
//  • find*/count/aggregate/groupBy → tự thêm where.deletedAt:null (trừ `includeDeleted: true`);
//    findUnique→findFirst để gắn được filter.
//  • sau mỗi WRITE vào Quote/Customer/User → bắn SSE để client tự refresh list.
// LƯU Ý: chuyển delete→update gọi `base.<model>.update()` (vì $extends không đổi được op qua query()).
// AN TOÀN vì codebase KHÔNG soft-delete BÊN TRONG $transaction (đã kiểm: chỉ dùng prisma.x.delete
// top-level). NẾU sau này cần soft-delete trong transaction → dùng `tx.<model>.update({ data: { deletedAt } })`.
// Chốt bằng tests/db-mem-trong-transaction.test.js (cấm `tx.<model-mềm>.delete`).
const SOFT_DELETE_MODELS = new Set(["User", "Company", "QuoteTemplate", "Quote", "Customer", "Product", "PersonnelRecord", "Employee"]);
const READS = new Set(["findUnique", "findFirst", "findMany", "findUniqueOrThrow", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const RT_ENTITY: Record<string, string> = { Quote: "quote", Customer: "customer", User: "user" };
const RT_WRITES = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

const lc = (m: string) => m.charAt(0).toLowerCase() + m.slice(1);

// Cột User chỉ mang trạng thái PHIÊN/BẢO MẬT — ghi vào chúng KHÔNG đổi gì mà màn hình nào hiển thị
// theo danh sách (RT-10). Trước đây mọi lượt đăng nhập, mọi lượt SAI mật khẩu (kể cả của người CHƯA
// đăng nhập) và mỗi mã TOTP đều emitChange('user','update') → broadcast tới MỌI phiên → mọi tab
// invalidateQueries() toàn bộ. Người ngoài điều khiển được tải đọc của cả công ty, và mọi phiên thấy
// nhịp đăng nhập của người khác.
const USER_COT_PHIEN = new Set(["lastLoginAt", "lastLoginIp", "failedAttempts", "lockedUntil", "mfaLastStep"]);
export function chiGhiCotPhienUser(model: string, action: string, a: any): boolean {
  if (model !== "User" || (action !== "update" && action !== "updateMany")) return false;
  const khoa = a?.data && typeof a.data === "object" ? Object.keys(a.data) : [];
  return khoa.length > 0 && khoa.every((k) => USER_COT_PHIEN.has(k));
}

// Prisma 7: kết nối qua driver adapter @prisma/adapter-pg (pg Pool) — engine TS, không còn engine Rust.
// max: nâng trần kết nối từ mặc định 10/process (dễ thành nút thắt concurrency khi đông user) lên cấu-hình-được
// qua DB_POOL_MAX (mặc định 20). CHỈ đổi capacity hạ tầng, KHÔNG đổi hành vi nghiệp vụ.
// connectionTimeoutMillis: node-pg mặc định chờ VÔ HẠN khi pool cạn. Trước đây một transaction hỏng
// bị Prisma cắt sau 5s nên kết nối quay lại pool nhanh; nay trần là DB_TX_TIMEOUT (mặc định 60s), tức
// DB_POOL_MAX lần Lưu báo giá lớn đồng thời là cạn pool — và mọi request khác (kể cả /readyz và đăng
// nhập) sẽ xếp hàng KHÔNG có trần thời gian thay vì thất bại nhanh. `maxWait` của Prisma KHÔNG chi
// phối hàng đợi này khi dùng driver adapter, nên trần phải đặt ở chính Pool. Lấy đúng DB_TX_MAX_WAIT
// để hai hàng đợi cùng một ngưỡng chờ.
// options: truyền thẳng xuống Postgres lúc BẮT TAY, nên ràng buộc MỌI câu lệnh đi qua pool này —
// kể cả câu do Prisma sinh ra mà mã ở đây không nhìn thấy. Xem khối chú thích ở config.ts về vì
// sao đặt tại pool chứ không `ALTER DATABASE` (migration phải được miễn).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: config.DB_POOL_MAX,
  connectionTimeoutMillis: config.DB_TX_MAX_WAIT,
  options: `-c statement_timeout=${config.DB_STATEMENT_TIMEOUT} -c idle_in_transaction_session_timeout=${config.DB_IDLE_TX_TIMEOUT}`,
});
const adapter = new PrismaPg(pool);

// ── POOL RIÊNG CHO PHÉP DÒ SẴN SÀNG (/readyz) ─────────────────────────────
// VẤN ĐỀ: `/readyz` dùng chung `pool` ở trên. Khi pool cạn — mà cạn là chuyện BÌNH THƯỜNG lúc
// nhiều người cùng lưu báo giá lớn — phép dò của nó cũng xếp hàng rồi hết giờ, và kubelet đọc
// thành "pod này chưa sẵn sàng" rồi RÚT pod khỏi Service.
//
// Đó là phản ứng ngược đúng lúc tệ nhất: pod vẫn đang phục vụ bình thường, chỉ là bận. Rút nó ra
// thì toàn bộ lưu lượng dồn sang replica còn lại, replica đó cạn pool theo, rồi cũng bị rút —
// MẤT DỊCH VỤ HOÀN TOÀN vì một cơn tải mà hệ thống lẽ ra chịu được. Càng đông người dùng càng dễ
// xảy ra, tức nó chờ đúng lúc đông nhất để nổ.
//
// Phép dò sẵn sàng phải trả lời "CSDL còn tới được không", KHÔNG phải "pool có rảnh không". Hai
// câu hỏi khác nhau, và chỉ câu đầu mới đáng để rút một pod ra khỏi tải. Nên nó cần đường đi
// riêng, không xếp hàng sau lưu lượng của người dùng.
//
// max = 1: chỉ cần một kết nối, và `/readyz` có bộ nhớ đệm 5s (READYZ_TTL_MS) cộng single-flight
// (src/app.ts) nên không bao giờ có hai phép dò cùng lúc.
//
// ── NGÂN SÁCH 2s PHẢI NHỎ HƠN `timeoutSeconds` CỦA PROBE ──────────────────
// kubelet mặc định `timeoutSeconds: 1` khi manifest không khai. Với mặc định đó, một phép dò chậm
// bị kubelet cắt ở 1 giây — tức ngân sách 2s ở đây không bao giờ dùng tới, và lý lẽ "thà trả lời
// chưa-sẵn-sàng nhanh" thành lời nói suông. Nên `infra/k8s/app.yaml` và chart Helm nay khai
// `timeoutSeconds: 3` TƯỜNG MINH; 2 < 3 nên ứng dụng luôn kịp trả lời trước khi kubelet bỏ cuộc.
// Đổi một trong hai số thì phải đổi số kia — tests/rz-readyz-pool-rieng.test.js khoá quan hệ đó.
//
// ── `query_timeout` LÀ TRẦN PHÍA CLIENT, KHÁC `statement_timeout` ─────────
// `statement_timeout` trong `options` là trần PHÍA MÁY CHỦ: Postgres tự huỷ câu lệnh. Nó KHÔNG
// cứu được ca socket chết im lặng — máy chủ không biết mình cần huỷ gì, còn client thì chờ mãi và
// giữ luôn kết nối DUY NHẤT của pool này. `query_timeout` là đồng hồ phía node-pg, phủ đúng ca đó.
const poolDoSanSang = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 2_000,
  query_timeout: 2_000,
  idleTimeoutMillis: 30_000,
  options: `-c statement_timeout=2000`,
});
poolDoSanSang.on("error", (e) => logger.warn({ source: "readyz-pool" }, e.message));

/**
 * `SELECT 1` qua đường RIÊNG cho /readyz. Ném lỗi nếu CSDL không tới được.
 *
 * KHÔNG dùng `prisma` ở đây — dùng nó là quay lại đúng lỗi khối chú thích trên mô tả.
 */
export async function kiemTraCsdlChoDoSanSang() {
  const c = await poolDoSanSang.connect();
  try {
    await c.query("SELECT 1");
  } finally {
    c.release();
  }
}
/**
 * Số kết nối đang dùng / trần `max_connections` — cho gauge `db_up` + `db_connections_*` của /metrics.
 *
 * Đi qua pool RIÊNG của /readyz (max 1), KHÔNG qua pool người dùng (audit 2026-09-22, OBS-02): pool
 * người dùng cạn thì phép đo xếp hàng và bị đọc thành "CSDL chết". Hai người dùng pool này đều
 * single-flight + nhớ đệm 5s nên không tranh nhau đáng kể.
 */
export async function doSoKetNoiCsdl(): Promise<{ dung: number; tran: number } | null> {
  const c = await poolDoSanSang.connect();
  try {
    const r = await c.query(
      "SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS dung, current_setting('max_connections')::int AS tran"
    );
    return (r.rows[0] as { dung: number; tran: number }) ?? null;
  } finally {
    c.release();
  }
}

// transactionOptions: KHÔNG để Prisma dùng mặc định (maxWait 2s / timeout 5s).
// Đường LƯU báo giá gói cả việc nặng vào MỘT transaction: xoá sạch sheet → tạo lại toàn bộ item →
// đọc lại báo giá qua QUOTE_INCLUDE → snapshot phiên bản (đọc thêm lần nữa + ghi khối jsonb). Trần
// payload cho phép 60 trang × 1000 dòng, nên báo giá lớn CHẠM 5s là rollback: người dùng mất trắng
// lần sửa. Nới trần là biện pháp GIẢM NHẸ (thu nhỏ transaction mới là cách chữa gốc) — đặt ở đây để
// mọi $transaction cùng hưởng, và P2028/P2024/P2034 nay được src/middleware.ts dịch thành thông điệp
// tiếng Việt nói được người dùng phải làm gì (trước đó rơi vào 500 "Lỗi server").
// Hai mốc lấy từ `config` chứ KHÔNG đọc thẳng process.env: đơn vị là MILI-GIÂY và rất dễ bị hiểu
// thành GIÂY — `DB_TX_TIMEOUT=5` (5ms) làm mọi lần Lưu chết P2028 mà tiến trình vẫn khởi động bình
// thường. Đi qua config.ts thì gõ sai là THOÁT NGAY kèm tên biến. Xem tests/qc-db-tx-config.test.js.
// PRISMA_LOG_QUERIES=1 → phát thêm sự kiện `query` (câu SQL THẬT + tham số + thời gian).
//
// MẶC ĐỊNH TẮT, và tắt ở đây là tắt hẳn: `$on("query")` chỉ hoạt động khi client được DỰNG với
// mức log đó, nên không thể bật lúc chạy. Vì sao vẫn cần một đường bật: §17 đòi EXPLAIN ANALYZE
// trên các đường NÓNG, mà cách duy nhất để EXPLAIN đúng câu Prisma thật sự chạy là hỏi chính
// Prisma — chép tay câu SQL mình NGHĨ nó sinh ra thì vài tháng sau ta EXPLAIN một truy vấn không
// còn ai chạy. `scripts/db/explain-hot-paths.mjs` bật biến này rồi lắng nghe.
//
// KHÔNG bật ở production: câu SQL kèm THAM SỐ, tức tên khách, số điện thoại, và mọi thứ người dùng
// gõ vào ô tìm kiếm sẽ nằm trong nhật ký.
const logQuery = process.env.PRISMA_LOG_QUERIES === "1";
const base = new PrismaClient({
  adapter,
  log: [
    ...(logQuery ? ([{ emit: "event", level: "query" }] as const) : []),
    { emit: "event", level: "warn" },
    { emit: "event", level: "error" },
  ],
  transactionOptions: {
    maxWait: config.DB_TX_MAX_WAIT,
    timeout: config.DB_TX_TIMEOUT,
  },
});
if (logQuery) {
  base.$on("query", (e) => logger.debug({ source: "prisma", ms: e.duration, params: e.params }, e.query));
}

/**
 * Nghe câu SQL Prisma thật sự chạy. Trả `false` nếu PRISMA_LOG_QUERIES chưa bật (không thể bật lúc
 * chạy — mức log là tham số DỰNG client).
 *
 * Tồn tại vì client được export bên dưới là bản `$extends`, mà bản đó KHÔNG có `$on`. Công cụ cần
 * nghe (scripts/db/explain-hot-paths.mjs) do đó không với tới `base` được nếu không có hàm này.
 */
export function ngheTruyVan(cb: (e: { query: string; params: string; duration: number }) => void): boolean {
  if (!logQuery) return false;
  base.$on("query", cb as never);
  return true;
}
base.$on("warn", (e) => logger.warn({ source: "prisma" }, e.message));
base.$on("error", (e) => logger.error({ source: "prisma" }, e.message));

export const prisma = base.$extends({
  name: "soft-delete+realtime",
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const soft = SOFT_DELETE_MODELS.has(model);
        const a: any = args || {};
        let action: string = operation;
        let result: any;

        if (soft && (operation === "delete" || operation === "deleteMany")) {
          // delete → soft-delete (update deletedAt), trừ khi hardDelete: true.
          const aa = { ...a };
          delete aa.hardDelete; delete aa.includeDeleted;
          if (a.hardDelete === true) {
            // Xoá thật: phép KHÔNG đổi nên chạy qua `query()` — giữ đúng ngữ cảnh transaction của
            // người gọi (bản cũ gọi `base`, tức chạy ngoài tx và không rollback theo tx — DB-04/DB-06).
            result = await query(aa); // xoá thật
          } else {
            action = operation === "delete" ? "update" : "updateMany";
            const data = { ...(aa.data || {}), deletedAt: new Date() };
            result = await (base as any)[lc(model)][action]({ where: aa.where, data });
          }
        } else if (soft && READS.has(operation) && a.includeDeleted !== true) {
          // đọc: tự thêm filter deletedAt:null (findUnique→findFirst để gắn được).
          const aa = { ...a };
          delete aa.includeDeleted;
          const where = aa.where || {};
          if (where.deletedAt === undefined) aa.where = { ...where, deletedAt: null };
          // findUnique GIỮ NGUYÊN là findUnique, chạy qua `query()` (DB-04, audit 2026-09-23). Bản cũ đổi
          // sang `base.findFirst` — tức chạy trên client GỐC, NGOÀI interactive transaction: trong
          // `prisma.$transaction(async tx => …)`, `tx.user.findUnique` không thấy hàng tx vừa tạo và không
          // chờ khoá của tx. Prisma ≥5 nhận trường thường (deletedAt) cạnh khoá unique trong where của
          // findUnique, nên không cần đổi phép nữa.
          result = await query(aa);
        } else {
          // op khác: strip cờ điều khiển còn sót (chỉ cho model soft-delete, như bản cũ) rồi chạy.
          let aa = a;
          if (soft && (a.includeDeleted !== undefined || a.hardDelete !== undefined)) {
            aa = { ...a }; delete aa.includeDeleted; delete aa.hardDelete;
          }
          result = await query(aa);
        }

        // Realtime: sau WRITE vào Quote/Customer/User → bắn SSE (soft-delete đã thành 'update').
        const entity = RT_ENTITY[model];
        if (entity && RT_WRITES.has(action) && !chiGhiCotPhienUser(model, action, a)) {
          import("./sse.js").then(({ emitChange }) => emitChange(entity, action, result?.id)).catch(() => {});
        }
        return result;
      },
    },
  },
});

// Transaction-client type for the EXTENDED prisma above. The $extends client's
// interactive-transaction callback receives a client whose type is a structural
// superset of Prisma.TransactionClient but is NOT assignable to it (Prisma v7
// DynamicClientExtensionThis). Helpers that run inside prisma.$transaction should
// accept THIS type so the inferred `tx` flows through without `as any`.
export type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * TRẠNG THÁI POOL — thứ THẬT SỰ chặn người dùng khi đông.
 *
 * VÌ SAO CẦN, dù đã có `db_connections_used`: gauge kia đếm `pg_stat_activity` của CẢ CSDL rồi
 * chia cho `max_connections` của MÁY CHỦ. Nhưng một tiến trình web cạn pool HOÀN TOÀN chỉ đóng
 * góp DB_POOL_MAX + SESSION_POOL_MAX + 1 (pool dò sẵn sàng) = 25 kết nối; với hai replica là
 * 50/100 = 50% — DƯỚI ngưỡng cảnh báo 80%. Tức cảnh báo kia IM LẶNG đúng lúc mọi request đang xếp
 * hàng rồi lỗi.
 *
 * Kết nối thứ 25 là pool RIÊNG của `/readyz` (max 1) và nó CỐ Ý không nằm trong `thongKePool`:
 * nó không phục vụ lưu lượng người dùng, gộp vào đây chỉ làm loãng đúng con số cần nhìn.
 *
 * `waitingCount` là con số trả lời được câu "nhiều người thì sao": nó > 0 nghĩa là ĐANG CÓ người
 * phải chờ mới có kết nối — triệu chứng xuất hiện TRƯỚC khi ai đó nhận lỗi.
 */
export function thongKePool() {
  return {
    tong: pool.totalCount,
    ranh: pool.idleCount,
    dangCho: pool.waitingCount,
    tran: config.DB_POOL_MAX,
  };
}

/**
 * Đóng pool dò sẵn sàng. PHẢI được gọi từ đường tắt êm của tiến trình (src/server.ts `shutdown`).
 *
 * ── VÌ SAO KHÔNG DỰA VÀO `beforeExit` ─────────────────────────────────────
 * `beforeExit` chỉ bắn khi vòng lặp sự kiện CẠN việc. Tiến trình máy chủ luôn có một socket đang
 * lắng nghe, nên nó KHÔNG BAO GIỜ bắn trên máy thật — và cũng không bắn khi tiến trình bị kết thúc
 * bằng tín hiệu, tức đúng đường mà `docker stop` / kubelet dùng. Đặt việc dọn ở đó là viết một câu
 * chưa từng chạy một lần nào.
 */
export async function dongPoolDoSanSang() {
  await poolDoSanSang.end().catch(() => {});
}

process.on("beforeExit", async () => {
  await base.$disconnect();
});
