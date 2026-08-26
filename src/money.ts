import { Prisma } from "@prisma/client";

const { Decimal } = Prisma;

/**
 * Convert any numeric-ish value (Decimal, number, string) to Prisma.Decimal.
 * Returns Decimal(0) for null/undefined/empty so arithmetic stays safe.
 */
export function D(v: Prisma.Decimal.Value | null | undefined) {
  if (v == null || v === "") return new Decimal(0);
  if (v instanceof Decimal) return v;
  return new Decimal(v);
}

/** LÀM TRÒN Số Lượng về 1 chữ số thập phân (7,378→7,4; 6,42→6,4). Cho code dùng number (quoteUtils/excel). */
export function qtyRound(x: unknown) {
  const n = Number(x) || 0;
  const t = Math.round(Math.abs(n) * 10 + 1e-6) / 10;   // +1e-6 khử nhiễu float; làm tròn 1 số, khớp ROUND_HALF_UP
  return n < 0 ? -t : t;
}

/**
 * Recompute snapshot totals for a Quote (with sheets/items eager-loaded).
 * Returns { subtotal, vat, total, sheetTotals } all as Decimal — caller stores them.
 *
 * Per-item amount:
 *   - days null/0  → quantity × unitPrice
 *   - days > 0     → quantity × days × unitPrice
 *
 * Rounding policy: half-up to 0 dp for VAT and total (VND has no fractional units).
 */
// Structural shape of what the body actually reads. The full Prisma `Quote & {sheets:[...]}`
// row satisfies this, and so does the slim `{ vatPercent, discount, sheets }` built by callers
// (computed totals before a write). Widening the param to this structural type is a pure
// type relaxation — no runtime change.
type QuoteTotalsInput = {
  vatPercent: Prisma.Decimal.Value | null | undefined;
  discount?: Prisma.Decimal.Value | null | undefined;
  sheets?: ({
    id?: number;
    groupSubtotal?: boolean | null;
    items?: {
      kind?: string | null;
      quantity?: Prisma.Decimal.Value | null | undefined;
      quantityExact?: boolean | null;
      unitPrice?: Prisma.Decimal.Value | null | undefined;
      days?: Prisma.Decimal.Value | null | undefined;
    }[] | null;
  })[] | null;
};

export function computeQuoteTotals(quote: QuoteTotalsInput) {
  const vatPct = D(quote.vatPercent);
  const sheetTotals = (quote.sheets || []).map((sh) => {
    let mult = 1;
    const subtotal = (sh.items || []).reduce((acc, it) => {
      if (it.kind === "section" || it.kind === "subsection") {   // nhóm/nhóm con: header — đặt mult, không tự cộng. Item con vẫn vào tổng cộng.
        // Hệ số nhóm lấy SL ĐÃ làm tròn đúng như lưới hiển thị (cùng phép làm tròn với qty dòng
        // thường ngay dưới) — trước đây nhân số thô nên tổng lệch con số người dùng nhìn thấy.
        const gq = Number(D(it.quantity).toDecimalPlaces(it.quantityExact ? 4 : 1, Decimal.ROUND_HALF_UP));
        mult = sh.groupSubtotal ? Math.max(1, gq || 1) : 1;
        return acc;
      }
      if (it.kind === "info") return acc;   // dòng thông tin: không tính tiền (khớp với Excel + client)
      // Báo giá cũ mặc định 1 số lẻ. Dòng import Excel ngoài có quantityExact giữ tối đa 4 số
      // khi file chứng minh Thành Tiền đang tính theo số gốc.
      const qty = D(it.quantity).toDecimalPlaces(it.quantityExact ? 4 : 1, Decimal.ROUND_HALF_UP);
      const price = D(it.unitPrice);
      const days = it.days != null ? D(it.days) : null;
      // Thành Tiền 1 dòng làm tròn số nguyên (khớp hiển thị + Excel) RỒI mới nhân hệ số nhóm
      // → dòng cộng lại đúng bằng tổng, không lệch sub-đồng.
      const base = (days && days.gt(0) ? qty.times(days).times(price) : qty.times(price)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      return acc.plus(base.times(mult));
    }, new Decimal(0));
    return { sheetId: sh.id ?? 0, subtotal };
  });
  // Round subtotal to 0 dp too (VND has no fractional unit) so the stored
  // subtotal column matches what we recompute on read — no sub-đồng drift.
  const subtotal = sheetTotals
    .reduce((s, x) => s.plus(x.subtotal), new Decimal(0))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const vat = subtotal.times(vatPct).dividedBy(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const gross = subtotal.plus(vat);
  // Optional negotiated discount (giảm giá), in VNĐ, subtracted from the grand total.
  // Clamped to the gross so the total never goes negative.
  const discInput = D(quote.discount).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const discount = discInput.greaterThan(gross) ? gross : (discInput.lessThan(0) ? new Decimal(0) : discInput);
  const total = gross.minus(discount).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { subtotal, vat, discount, total, sheetTotals };
}

/**
 * Chặn tổng tiền ÂM TRƯỚC KHI ghi xuống CSDL.
 *
 * ── SỰ CỐ ĐÃ TÁI HIỆN ĐƯỢC ──────────────────────────────────────────────────
 * Lưới báo giá CHO PHÉP gõ số âm — `parseVN` trong shared/quote-math.ts xử lý "-5.000" đàng hoàng,
 * và người dùng vẫn dùng dòng âm để ghi khoản giảm trừ. Nhưng CSDL có ràng buộc
 * `Quote_money_check` (subtotal/vat/total/discount đều phải ≥ 0). Một báo giá có tổng ròng âm sẽ
 * làm INSERT/UPDATE vi phạm ràng buộc, Prisma ném lỗi, và errorHandler trả về đúng một cục
 * "Lỗi server" 500 — TOÀN BỘ lần Lưu bị mất, người dùng không biết vì sao và không biết sửa ở đâu.
 * Đã tái hiện: một dòng đơn giá -5.000.000 → 500, không hàng nào được ghi.
 *
 * Ràng buộc CSDL là ĐÚNG (báo giá xuất cho khách không thể có tổng âm). Cái sai là để người dùng
 * đâm vào nó bằng một lỗi 500 vô nghĩa. Ở đây chuyển thành 400 nói rõ TRANG nào đang âm.
 *
 * CỐ Ý không đặt trong `computeQuoteTotals`: hàm đó còn được gọi trên ĐƯỜNG ĐỌC (quoteUtils,
 * projectRef) để tính lại tổng khi hiển thị. Ném lỗi ở đó sẽ khiến một bản ghi cũ có dữ liệu xấu
 * không mở ra xem được nữa — biến một lỗi lúc ghi thành một lỗi lúc đọc, tệ hơn hẳn.
 */
export function assertTotalsStorable(
  t: { subtotal: Prisma.Decimal; vat: Prisma.Decimal; total: Prisma.Decimal; sheetTotals: { subtotal: Prisma.Decimal }[] },
  sheets?: ({ name?: string | null } | null)[] | null
) {
  if (t.subtotal.gte(0) && t.vat.gte(0) && t.total.gte(0)) return;

  const badSheets = t.sheetTotals
    .map((s, i) => ({ i, neg: s.subtotal.lessThan(0), name: sheets?.[i]?.name || `Trang ${i + 1}` }))
    .filter((s) => s.neg)
    .map((s) => s.name);

  const detail = badSheets.length
    ? `Các trang đang âm: ${badSheets.join(", ")}.`
    : "Tổng các trang cộng lại đang âm.";

  throw Object.assign(
    new Error(
      `Không lưu được: tổng tiền báo giá đang ÂM (${t.total.toFixed(0)} đ). ${detail} ` +
        `Kiểm tra các dòng có Đơn Giá hoặc Số Lượng âm — tổng của cả báo giá phải từ 0 trở lên.`
    ),
    { status: 400, code: "quote_negative_total" }
  );
}

/** Serialize Decimal fields as JS numbers for JSON response. Loses precision on huge numbers but UI-safe. */
export function totalsToJson(t: {
  subtotal: Prisma.Decimal;
  vat: Prisma.Decimal;
  discount?: Prisma.Decimal | null;
  total: Prisma.Decimal;
  sheetTotals: { sheetId: number; subtotal: Prisma.Decimal }[];
}) {
  return {
    subtotal: t.subtotal.toNumber(),
    vat: t.vat.toNumber(),
    discount: (t.discount ?? new Decimal(0)).toNumber(),
    total: t.total.toNumber(),
    sheetTotals: t.sheetTotals.map((s) => ({ sheetId: s.sheetId, subtotal: s.subtotal.toNumber() })),
  };
}
