import { prisma } from "./db.js";

/**
 * Approval workflow — intentionally ONE step: the Director (admin) approves or
 * rejects a submitted quote. No tiers/levels, no amount matrix. (The
 * ApprovalMatrix model + an amount-band engine were scaffolded but never wired;
 * the dead lookup was removed to avoid accidental re-activation.)
 */

/**
 * Initialize the approval for a quote.
 *
 * Workflow is intentionally simple: ONE step, the Director (admin) approves or
 * rejects. No tiers/levels, no amount matrix.
 */
export async function startApprovalChain(quoteId, versionNo, db = prisma) {
  await db.approval.deleteMany({ where: { quoteId, versionNo } });
  await db.approval.create({
    data: { quoteId, versionNo, level: 1, decision: "pending" },
  });
}

/** Only the Director (admin) may approve. */
export async function canApproveLevel(_quoteId, _versionNo, _level, userRole) {
  return userRole === "admin";
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
export async function isChainComplete(quoteId, versionNo, db = prisma) {
  const remaining = await db.approval.count({
    where: { quoteId, versionNo, decision: { not: "approved" } },
  });
  return remaining === 0;
}
