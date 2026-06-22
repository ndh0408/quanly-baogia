import { PrismaClient } from "@prisma/client";
import { logger } from "./logger.js";
import { isProd } from "./config.js";

export const prisma = new PrismaClient({
  // warn+error events in all environments (the two branches were identical).
  log: [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }],
});

prisma.$on("warn", (e) => logger.warn({ source: "prisma" }, e.message));
prisma.$on("error", (e) => logger.error({ source: "prisma" }, e.message));

// Global soft-delete middleware: turns `delete` into `update { deletedAt: now }`
// and adds an automatic `where: { deletedAt: null }` filter on common queries.
//
// Applies to every model that has a deletedAt field.
const SOFT_DELETE_MODELS = new Set(["User", "Company", "QuoteTemplate", "Quote", "Customer", "Product", "PersonnelRecord"]);

prisma.$use(async (params, next) => {
  if (!SOFT_DELETE_MODELS.has(params.model)) return next(params);

  // Intercept hard deletes → soft delete.
  // Caller can pass `hardDelete: true` (top-level, next to `where`) to really delete —
  // used by the admin purge endpoint to remove soft-deleted rows for good.
  if (params.action === "delete" || params.action === "deleteMany") {
    if (params.args?.hardDelete === true) {
      delete params.args.hardDelete;
      return next(params);
    }
    if (params.action === "delete") {
      params.action = "update";
      params.args.data = { ...(params.args.data || {}), deletedAt: new Date() };
    } else {
      params.action = "updateMany";
      params.args = params.args || {};
      params.args.data = { ...(params.args.data || {}), deletedAt: new Date() };
    }
  }

  // Auto-filter deletedAt = null for find*, unless caller explicitly opts in.
  // Caller can pass `includeDeleted: true` outside `where` to bypass.
  if (
    (params.action === "findUnique" || params.action === "findFirst" || params.action === "findMany" ||
     params.action === "findUniqueOrThrow" || params.action === "findFirstOrThrow" ||
     params.action === "count" || params.action === "aggregate" || params.action === "groupBy") &&
    params.args?.includeDeleted !== true
  ) {
    params.args = params.args || {};
    // findUnique requires a unique where; convert to findFirst to attach deletedAt filter.
    if (params.action === "findUnique") {
      params.action = "findFirst";
    } else if (params.action === "findUniqueOrThrow") {
      params.action = "findFirstOrThrow";
    }
    const where = params.args.where || {};
    if (where.deletedAt === undefined) {
      params.args.where = { ...where, deletedAt: null };
    }
  }

  if (params.args && params.args.includeDeleted !== undefined) {
    delete params.args.includeDeleted;
  }
  // Strip our control flag unconditionally so a stray hardDelete on a non-delete
  // action is never forwarded to Prisma (which rejects unknown top-level args).
  if (params.args && params.args.hardDelete !== undefined) {
    delete params.args.hardDelete;
  }

  return next(params);
});

// Realtime change feed: after any write to a user-facing model, broadcast a hint
// so every connected client refreshes its lists live (no manual page reload).
// Registered AFTER soft-delete so a `delete` already appears here as `update`.
const RT_ENTITY = { Quote: "quote", Customer: "customer", User: "user" };
const RT_WRITES = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);

prisma.$use(async (params, next) => {
  const result = await next(params);
  const entity = RT_ENTITY[params.model];
  if (entity && RT_WRITES.has(params.action)) {
    // Lazy import avoids a static db <-> sse import cycle.
    import("./sse.js")
      .then(({ emitChange }) => emitChange(entity, params.action, result?.id))
      .catch(() => {});
  }
  return result;
});

process.on("beforeExit", async () => {
  await prisma.$disconnect();
});
