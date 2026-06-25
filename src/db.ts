import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { logger } from "./logger.js";

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
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const base = new PrismaClient({
  adapter,
  log: [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }],
});
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

process.on("beforeExit", async () => {
  await base.$disconnect();
});
