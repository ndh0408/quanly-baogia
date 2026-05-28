import { prisma } from "./db.js";
import { D } from "./money.js";

/**
 * Approval matrix engine.
 *
 * Matrix rows define amount bands and the per-level requirements:
 *   { name, minAmount, maxAmount, levels: [{level, roles, any}] }
 *
 * `levels[i].roles` = array of role codes that can sign at this level
 * `levels[i].any`   = number of roles needed to mark the level as approved (default 1)
 *
 * When a quote is submitted, we look up the band by `total` and create one
 * `Approval` row per level with decision=pending. Each level must be approved
 * before the next can act. Final approval flips Quote.status to "approved".
 */

export async function findMatrixForAmount(total) {
  const amount = D(total);
  const rows = await prisma.approvalMatrix.findMany({
    where: { active: true, minAmount: { lte: amount } },
    orderBy: { minAmount: "desc" },
  });
  // First row whose maxAmount is either null (open-ended) or >= amount
  for (const row of rows) {
    if (row.maxAmount == null || D(row.maxAmount).gte(amount)) return row;
  }
  return null;
}

/** Initialize the approval chain for a quote based on its current total. */
export async function startApprovalChain(quoteId, versionNo) {
  const quote = await prisma.quote.findFirst({ where: { id: quoteId } });
  if (!quote) throw new Error("Quote not found");
  const matrix = await findMatrixForAmount(quote.total);

  // Reset any prior approvals for this version
  await prisma.approval.deleteMany({ where: { quoteId, versionNo } });

  const levels = matrix?.levels ?? defaultLevels();
  if (!Array.isArray(levels) || levels.length === 0) {
    // No matrix → single manager approval default
    await prisma.approval.create({
      data: { quoteId, versionNo, level: 1, decision: "pending" },
    });
    return;
  }
  for (const lvl of levels) {
    await prisma.approval.create({
      data: { quoteId, versionNo, level: Number(lvl.level), decision: "pending" },
    });
  }
}

function defaultLevels() {
  return [{ level: 1, roles: ["manager", "admin"], any: 1 }];
}

/** True if the given user can act on this level (based on matrix roles config). */
export async function canApproveLevel(quoteId, versionNo, level, userRole) {
  const quote = await prisma.quote.findFirst({ where: { id: quoteId } });
  if (!quote) return false;
  const matrix = await findMatrixForAmount(quote.total);
  const levels = matrix?.levels ?? defaultLevels();
  const lvl = levels.find((l) => Number(l.level) === Number(level));
  if (!lvl) return userRole === "admin"; // fallback
  const roles = Array.isArray(lvl.roles) ? lvl.roles : ["manager", "admin"];
  return roles.includes(userRole);
}

/** Find the next pending level for this version. Returns Approval row or null. */
export async function nextPendingLevel(quoteId, versionNo) {
  return prisma.approval.findFirst({
    where: { quoteId, versionNo, decision: "pending" },
    orderBy: { level: "asc" },
  });
}

/** Has any other earlier level not been approved yet? */
export async function hasEarlierPending(quoteId, versionNo, level) {
  const earlier = await prisma.approval.findFirst({
    where: { quoteId, versionNo, level: { lt: level }, decision: { not: "approved" } },
  });
  return !!earlier;
}

/** All levels for this version approved? */
export async function isChainComplete(quoteId, versionNo) {
  const remaining = await prisma.approval.count({
    where: { quoteId, versionNo, decision: { not: "approved" } },
  });
  return remaining === 0;
}
