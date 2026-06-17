/**
 * Snapshot the current state of a quote (including sheets+items) into QuoteVersion.
 * Called after every mutating operation that changes price/structure.
 */
export async function snapshotQuoteVersion(tx, quoteId, actorId, reason) {
  const q = await tx.quote.findFirst({
    where: { id: quoteId },
    include: {
      sheets: {
        orderBy: { order: "asc" },
        include: { items: { orderBy: { order: "asc" } }, template: { select: { code: true, name: true } } },
      },
    },
  });
  if (!q) return null;

  const versionNo = (q.currentVersion ?? 0);
  const payload = {
    reason: reason || null,
    quoteNumber: q.quoteNumber,
    title: q.title,
    toCompany: q.toCompany,
    toContact: q.toContact,
    toEmail: q.toEmail,
    toPhone: q.toPhone,
    toAddress: q.toAddress,
    customerId: q.customerId,
    companyId: q.companyId,
    fromContact: q.fromContact,
    fromPhone: q.fromPhone,
    fromTitle: q.fromTitle,
    fromAddress: q.fromAddress,
    city: q.city,
    quoteDate: q.quoteDate,
    executionDate: q.executionDate,
    greeting: q.greeting,
    vatPercent: q.vatPercent.toString(),
    notes: q.notes,
    status: q.status,
    showTotals: q.showTotals,
    subtotal: q.subtotal.toString(),
    vat: q.vat.toString(),
    // discount is price-affecting and triggers a version bump — it MUST be in the
    // snapshot or diffVersions can never show a discount change, and stored
    // subtotal+vat won't reconcile to total. (customerLogo is intentionally NOT
    // snapshotted: it's a large base64 blob and would bloat every version row.)
    discount: q.discount.toString(),
    total: q.total.toString(),
    sheets: q.sheets.map((s) => ({
      templateCode: s.template?.code,
      templateName: s.template?.name,
      name: s.name,
      order: s.order,
      groupSubtotal: s.groupSubtotal,
      extraTables: s.extraTables ?? null,
      items: s.items.map((it) => ({
        order: it.order,
        kind: it.kind,
        productId: it.productId,
        name: it.name,
        detail: it.detail,
        unit: it.unit,
        quantity: it.quantity.toString(),
        unitPrice: it.unitPrice.toString(),
        days: it.days?.toString() ?? null,
        notes: it.notes,
      })),
    })),
  };
  // Upsert: cosmetic edits don't bump currentVersion, so the same versionNo may be
  // snapshotted again — refresh that revision's snapshot instead of violating the
  // (quoteId, versionNo) unique constraint.
  return tx.quoteVersion.upsert({
    where: { quoteId_versionNo: { quoteId, versionNo } },
    create: {
      quoteId,
      versionNo,
      payload,
      total: q.total,
      createdById: actorId ?? null,
    },
    update: {
      payload,
      total: q.total,
      createdById: actorId ?? null,
    },
  });
}

/** Compute a shallow diff between two version payloads. Returns array of changed keys with old/new. */
export function diffVersions(a, b) {
  const out = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) {
      out.push({ key: k, before: a?.[k] ?? null, after: b?.[k] ?? null });
    }
  }
  return out;
}
