import type { TxClient } from "./db.js";

/**
 * Lược ẢNH chứng từ thanh toán (`paidProof`, base64 tới ~900.000 ký tự/ảnh) khỏi bản chụp
 * phiên bản, giữ lại cờ `hasPaidProof` — CÙNG hình dạng `stripExtraProofs` (src/quoteUtils.ts)
 * đã dùng khi gửi client, để giao diện đọc phiên bản cũ không phải xử lý hai kiểu dữ liệu.
 *
 * VÌ SAO: phiên bản chỉ để ĐỐI CHIẾU cấu trúc/giá; ảnh không bao giờ được diff, mà mỗi lần lưu
 * có ảnh hưởng giá lại đẻ một hàng QuoteVersion mang trọn bộ ảnh — nhân với RETAIN_VERSION_KEEP
 * (mặc định 100) là phình DB và phình bản sao lưu. Ảnh gốc vẫn sống ở bản HIỆN TẠI của báo giá
 * và tải được qua GET /:id/extra/:sheetId/:rid/proof.
 *
 * ⚠️ TRÙNG LẶP CÓ CHỦ Ý: `stripExtraProofs` trong src/quoteUtils.ts làm y hệt việc này cho đường
 * GỬI CLIENT nhưng KHÔNG được export (và quoteUtils kéo theo db/permissions/money, không đáng
 * import vào đây). Ràng buộc "hai bản không được trôi khỏi nhau" nay do TEST giữ, không do kỷ
 * luật con người: tests/vdb-version-snapshot-proof.test.js so kết quả của hai đường trên cùng
 * một dữ liệu vào. Thêm trường ảnh thứ hai mà chỉ sửa một bên là test ĐỎ.
 *
 * KHÁC BIỆT DUY NHẤT so với bản kia (cố ý): bảng KHÔNG có khoá `items` thì giữ nguyên, không bị
 * thêm `items: []`. Payload phiên bản là dữ liệu đem đi DIFF — bịa thêm khoá làm diffVersions báo
 * `sheets` đã đổi cho một thay đổi không hề có.
 */
function stripProofsForSnapshot(extraTables: unknown): unknown {
  if (!Array.isArray(extraTables)) return extraTables ?? null;
  return extraTables.map((t: any) => {
    if (!t || typeof t !== "object") return t;
    // `extraTables` là cột Json TỰ DO: đường ghi lại ở src/hnWorkflow.ts và lúc nhân bản báo giá
    // KHÔNG đi qua sanitizeExtraTables, nên dữ liệu lịch sử có thể có `items` là object/chuỗi.
    // `.map` trên thứ đó ném TypeError NGAY TRONG transaction lưu báo giá ⇒ 500 và mất trắng lần
    // sửa. Không phải mảng thì để nguyên, không đụng tới.
    if (!Array.isArray(t.items)) return t;
    return {
      ...t,
      items: t.items.map((it: any) => {
        if (!it || typeof it !== "object") return it;
        const { paidProof, ...rest } = it;
        return { ...rest, hasPaidProof: !!paidProof };
      }),
    };
  });
}

/**
 * Snapshot the current state of a quote (including sheets+items) into QuoteVersion.
 * Called after every mutating operation that changes price/structure.
 */
export async function snapshotQuoteVersion(tx: TxClient, quoteId: number, actorId: number | null | undefined, reason: string | null) {
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
      showImages: s.showImages,
      // KHÔNG chép ẢNH base64 vào snapshot phiên bản (item.images ở dòng item, paidProof trong
      // extraTables): ảnh nặng, mỗi lần lưu tạo snapshot → phình DB. Phiên bản chỉ lưu cấu trúc/giá
      // để đối chiếu; ảnh sống ở bản HIỆN TẠI của báo giá.
      extraTables: stripProofsForSnapshot(s.extraTables),
      items: s.items.map((it) => ({
        order: it.order,
        kind: it.kind,
        productId: it.productId,
        name: it.name,
        detail: it.detail,
        unit: it.unit,
        quantity: it.quantity.toString(),
        quantityExact: it.quantityExact,
        unitPrice: it.unitPrice.toString(),
        days: it.days?.toString() ?? null,
        notes: it.notes,
        internalNote: it.internalNote,
        formulas: it.formulas,
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
export function diffVersions(a: any, b: any) {
  const out: { key: string; before: unknown; after: unknown }[] = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) {
      out.push({ key: k, before: a?.[k] ?? null, after: b?.[k] ?? null });
    }
  }
  return out;
}
