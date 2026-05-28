import { PrismaClient } from "@prisma/client";
import { logger } from "./logger.js";
import { isProd } from "./config.js";

export const prisma = new PrismaClient({
  log: isProd
    ? [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }]
    : [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }],
});

prisma.$on("warn", (e) => logger.warn({ source: "prisma" }, e.message));
prisma.$on("error", (e) => logger.error({ source: "prisma" }, e.message));

// Global soft-delete middleware: turns `delete` into `update { deletedAt: now }`
// and adds an automatic `where: { deletedAt: null }` filter on common queries.
//
// Applies to: User, Company, QuoteTemplate, Quote (any model with a deletedAt field).
const SOFT_DELETE_MODELS = new Set(["User", "Company", "QuoteTemplate", "Quote"]);

prisma.$use(async (params, next) => {
  if (!SOFT_DELETE_MODELS.has(params.model)) return next(params);

  // Intercept hard deletes → soft delete
  if (params.action === "delete") {
    params.action = "update";
    params.args.data = { ...(params.args.data || {}), deletedAt: new Date() };
  } else if (params.action === "deleteMany") {
    params.action = "updateMany";
    params.args = params.args || {};
    params.args.data = { ...(params.args.data || {}), deletedAt: new Date() };
  }

  // Auto-filter deletedAt = null for find*, unless caller explicitly opts in.
  // Caller can pass `includeDeleted: true` outside `where` to bypass.
  if (
    (params.action === "findUnique" || params.action === "findFirst" || params.action === "findMany" ||
     params.action === "count" || params.action === "aggregate") &&
    params.args?.includeDeleted !== true
  ) {
    params.args = params.args || {};
    // findUnique requires a unique where; convert to findFirst to attach deletedAt filter.
    if (params.action === "findUnique") {
      params.action = "findFirst";
    }
    const where = params.args.where || {};
    if (where.deletedAt === undefined) {
      params.args.where = { ...where, deletedAt: null };
    }
  }

  if (params.args && params.args.includeDeleted !== undefined) {
    delete params.args.includeDeleted;
  }

  return next(params);
});

process.on("beforeExit", async () => {
  await prisma.$disconnect();
});
