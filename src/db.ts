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
// top-level). NẾU sau này cần soft-delete trong transaction → phải xử khác (dùng thư viện chuyên).
const SOFT_DELETE_MODELS = new Set(["User", "Company", "QuoteTemplate", "Quote", "Customer", "Product", "PersonnelRecord", "Employee"]);
const READS = new Set(["findUnique", "findFirst", "findMany", "findUniqueOrThrow", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const RT_ENTITY: Record<string, string> = { Quote: "quote", Customer: "customer", User: "user" };
const RT_WRITES = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

const lc = (m: string) => m.charAt(0).toLowerCase() + m.slice(1);

// Prisma 7: kết nối qua driver adapter @prisma/adapter-pg (pg Pool) — engine TS, không còn engine Rust.
// max: nâng trần kết nối từ mặc định 10/process (dễ thành nút thắt concurrency khi đông user) lên cấu-hình-được
// qua DB_POOL_MAX (mặc định 20). CHỈ đổi capacity hạ tầng, KHÔNG đổi hành vi nghiệp vụ.
// connectionTimeoutMillis: node-pg mặc định chờ VÔ HẠN khi pool cạn. Trước đây một transaction hỏng
// bị Prisma cắt sau 5s nên kết nối quay lại pool nhanh; nay trần là DB_TX_TIMEOUT (mặc định 60s), tức
// DB_POOL_MAX lần Lưu báo giá lớn đồng thời là cạn pool — và mọi request khác (kể cả /readyz và đăng
// nhập) sẽ xếp hàng KHÔNG có trần thời gian thay vì thất bại nhanh. `maxWait` của Prisma KHÔNG chi
// phối hàng đợi này khi dùng driver adapter, nên trần phải đặt ở chính Pool. Lấy đúng DB_TX_MAX_WAIT
// để hai hàng đợi cùng một ngưỡng chờ.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: config.DB_POOL_MAX,
  connectionTimeoutMillis: config.DB_TX_MAX_WAIT,
});
const adapter = new PrismaPg(pool);
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
            result = await (base as any)[lc(model)][operation](aa); // xoá thật
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
          if (operation === "findUnique") result = await (base as any)[lc(model)].findFirst(aa);
          else if (operation === "findUniqueOrThrow") result = await (base as any)[lc(model)].findFirstOrThrow(aa);
          else result = await query(aa);
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
        if (entity && RT_WRITES.has(action)) {
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

process.on("beforeExit", async () => {
  await base.$disconnect();
});
