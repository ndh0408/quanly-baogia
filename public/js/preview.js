// preview.js — live, xlsx-faithful quote preview (step 5 of the SPA modularization).
// Approximates the src/excel.js export layout (GN / CLF forms + summary sheet) so the
// editor shows what the downloaded file will look like. Only refreshPreview() is public;
// the per-form renderers are internal. Depends on util.js (pure render/total helpers)
// and state.js (templates/companies lookup) — never on api/render, so no import cycle.

import {
  escapeHtml, nl2br, safeLogoSrc, vnDateText, baoGiaTitleJS,
  pvRows, pvMoney, pvRowspan, quoteTotals, sheetSubtotalGrouped,
} from "./util.js?v=20260623e";
import { state } from "./core/state.js?v=20260623e";

let _pvTimer = null;
// Debounced entry point the editor calls on every edit; a no-op while the preview
// panel is hidden so typing stays cheap.
export function refreshPreview(q) {
  const box = document.getElementById("xlsx-preview");
  if (!box || box.hidden) return;
  clearTimeout(_pvTimer);
  _pvTimer = setTimeout(() => renderPreview(q), 80);
}
function renderPreview(q) {
  const box = document.getElementById("xlsx-preview");
  if (!box || box.hidden) return;
  const parts = (q.sheets || []).map(s => {
    const tpl = state.templates.find(t => t.id === s.templateId);
    // Route by layout shape (same flags the editor grid uses): a "Chi Tiết" column
    // means the CLF form; otherwise it's a GN form (with or without a Số ngày column).
    return (tpl && tpl.layout && tpl.layout.hasDetail) ? previewCLF(q, s, tpl) : previewGN(q, s, tpl);
  });
  if (q.showTotals !== false) parts.push(previewSummary(q));   // mirror the export summary sheet
  box.innerHTML = parts.join('<div class="xlsx-page-gap"></div>');
}
function pvCompanyBanner(q) {
  const co = state.companies.find(c => c.id === q.companyId) || {};
  return [
    co.name ? `<b>${escapeHtml(co.name)}</b>` : "",
    escapeHtml(co.address || ""),
    co.phone ? "ĐT: " + escapeHtml(co.phone) : "",
    co.email ? "Email: " + escapeHtml(co.email) : "",
  ].filter(Boolean).join("<br>");
}
function previewCLF(q, s) {
  const items = s.items || [];
  const { rows, eff } = pvRows(items, false, !!s.groupSubtotal);
  const vatPct = Number(q.vatPercent) || 0;
  const infoLines = items.filter(it => it.kind === "info").map(it => (it.name || "").trim()).filter(Boolean);
  const body = rows.map((row, i) => {
    if (row.kind === "info") return "";   // CLF folds info into the banner
    if (row.kind === "section") {
      const it = row.it;
      const amtCell = row.groupSubtotal ? pvMoney(row.groupSum * row.gmult) : "";
      return `<tr class="xlsx-section"><td class="xlsx-stt">${escapeHtml(row.letter)}</td><td style="font-weight:700">${nl2br(it.name)}</td><td></td><td class="xlsx-center">${escapeHtml(it.unit || "")}</td><td class="xlsx-center">${pvMoney(it.quantity)}</td><td class="xlsx-num">${pvMoney(row.groupSum)}</td><td class="xlsx-num">${amtCell}</td><td class="xlsx-center xlsx-italic">${nl2br(it.notes)}</td></tr>`;
    }
    const it = row.it, amt = row.amt;
    const neg = amt < 0 ? " xlsx-neg" : "";
    let head = "";
    if (row.kind === "head") {
      const span = pvRowspan(eff, i);
      head = `<td class="xlsx-stt" rowspan="${span}">${row.stt}</td><td rowspan="${span}" style="font-weight:700">${nl2br(it.name)}</td>`;
    }
    return `<tr>${head}<td class="xlsx-italic">${nl2br(it.detail)}</td><td class="xlsx-center">${escapeHtml(it.unit || "")}</td><td class="xlsx-center">${pvMoney(it.quantity)}</td><td class="xlsx-num${neg}">${pvMoney(it.unitPrice)}</td><td class="xlsx-num${neg}">${pvMoney(amt)}</td><td class="xlsx-center xlsx-italic">${nl2br(it.notes)}</td></tr>`;
  }).join("");
  const subtotal = sheetSubtotalGrouped(items, false, !!s.groupSubtotal);
  // The quote-level discount sits on the grand total; a single-sheet export shows it on
  // the sheet itself (excel.js onlySheet), multi-sheet shows it on the summary sheet.
  const tt = quoteTotals(subtotal, vatPct, (q.sheets || []).length === 1 ? q.discount : 0);
  const kg = [`Kính gửi: ${escapeHtml(q.toCompany || "…..")}`];
  if (q.toContact) kg.push(escapeHtml(q.toContact));
  if (q.toEmail) kg.push("Email: " + escapeHtml(q.toEmail));
  const logoCell = safeLogoSrc(q.customerLogo) ? `<img class="cust-logo" src="${safeLogoSrc(q.customerLogo)}" alt="Logo ${escapeHtml(q.toCompany || "khách hàng")}">` : `<span class="logo-ph">logo cty khách hàng</span>`;
  return `<table class="xlsx-page xlsx-clf">
    <colgroup><col style="width:50px"><col style="width:132px"><col style="width:240px"><col style="width:55px"><col style="width:78px"><col style="width:96px"><col style="width:108px"><col style="width:100px"></colgroup>
    <tr><td colspan="3"></td><td colspan="5" class="xlsx-center" style="white-space:pre-wrap">${pvCompanyBanner(q)}</td></tr>
    <tr><td colspan="8" class="xlsx-band xlsx-title">${escapeHtml(baoGiaTitleJS(q.title))}</td></tr>
    <tr><td colspan="3" class="xlsx-center">${logoCell}</td><td colspan="5" class="xlsx-center" style="white-space:pre-wrap">${kg.join("<br>")}</td></tr>
    <tr class="xlsx-band xlsx-center"><td>STT</td><td>Hạng Mục</td><td>Chi Tiết</td><td>ĐVT</td><td>SỐ LƯỢNG</td><td>ĐƠN GIÁ</td><td>THÀNH TIỀN</td><td>Ghi Chú</td></tr>
    ${infoLines.length ? `<tr><td colspan="8" class="xlsx-band" style="font-weight:600">* Thông tin chương trình: ${infoLines.map(escapeHtml).join("; ")}</td></tr>` : ""}
    ${body}
    <tr class="xlsx-band"><td colspan="6" class="xlsx-center">Tổng Cộng</td><td class="xlsx-num">${pvMoney(tt.subtotal)}</td><td></td></tr>
    <tr class="xlsx-band"><td colspan="6" class="xlsx-center">VAT(${vatPct}%)</td><td class="xlsx-num">${pvMoney(tt.vat)}</td><td></td></tr>
    ${tt.discount > 0 ? `<tr class="xlsx-band"><td colspan="6" class="xlsx-center">Giảm Giá</td><td class="xlsx-num">-${pvMoney(tt.discount)}</td><td></td></tr>` : ""}
    <tr class="xlsx-band"><td colspan="6" class="xlsx-center">Thành Tiền</td><td class="xlsx-num">${pvMoney(tt.total)}</td><td></td></tr>
    <tr><td colspan="4" style="white-space:pre-wrap">* Ghi chú: \n- Tất cả các hạng mục trên là cho thuê, Colofull thu hồi sau khi tháo dỡ</td><td colspan="4" class="xlsx-center">${escapeHtml(vnDateText(q.quoteDate, q.city))}</td></tr>
    <tr><td colspan="4">XÁC NHẬN ĐỒNG Ý ĐẶT HÀNG</td><td colspan="4" class="xlsx-center" style="font-weight:700">Công Ty TNHH Colorfull</td></tr>
  </table>`;
}
function previewGN(q, s, tpl) {
  const usesDays = !!(tpl && tpl.layout && tpl.layout.hasDays);
  const NC = usesDays ? 8 : 7;          // total columns
  const wide = NC;                      // colspan for full-width chrome rows
  const lblSpan = NC - 2;               // totals label spans up to the price column
  const items = s.items || [];
  const { rows, eff } = pvRows(items, usesDays, !!s.groupSubtotal);
  const vatPct = Number(q.vatPercent) || 0;
  const daysHead = usesDays ? `<td>SỐ NGÀY</td>` : "";
  const body = rows.map((row, i) => {
    if (row.kind === "info") return `<tr><td></td><td class="xlsx-italic" colspan="${NC - 1}">${nl2br(row.it.name)}</td></tr>`;
    if (row.kind === "section") {
      const it = row.it;
      const daysCell = usesDays ? `<td></td>` : "";
      const amtCell = row.groupSubtotal ? pvMoney(row.groupSum * row.gmult) : "";
      return `<tr class="xlsx-section"><td class="xlsx-stt">${escapeHtml(row.letter)}</td><td style="font-weight:700">${nl2br(it.name)}</td><td class="xlsx-center">${escapeHtml(it.unit || "")}</td><td class="xlsx-center">${pvMoney(it.quantity)}</td>${daysCell}<td class="xlsx-num">${pvMoney(row.groupSum)}</td><td class="xlsx-num">${amtCell}</td><td class="xlsx-center xlsx-italic">${nl2br(it.notes)}</td></tr>`;
    }
    const it = row.it, amt = row.amt;
    const neg = amt < 0 ? " xlsx-neg" : "";
    let head = "";
    if (row.kind === "head") {
      const span = pvRowspan(eff, i);
      head = `<td class="xlsx-stt" rowspan="${span}">${row.stt}</td><td class="xlsx-italic" rowspan="${span}">${nl2br(it.name)}</td>`;
    }
    const daysCell = usesDays ? `<td class="xlsx-center">${pvMoney(it.days)}</td>` : "";
    return `<tr>${head}<td class="xlsx-center">${escapeHtml(it.unit || "")}</td><td class="xlsx-center">${pvMoney(it.quantity)}</td>${daysCell}<td class="xlsx-num${neg}">${pvMoney(it.unitPrice)}</td><td class="xlsx-num${neg}">${pvMoney(amt)}</td><td class="xlsx-center xlsx-italic">${nl2br(it.notes)}</td></tr>`;
  }).join("");
  const subtotal = sheetSubtotalGrouped(items, usesDays, !!s.groupSubtotal);
  const tt = quoteTotals(subtotal, vatPct, (q.sheets || []).length === 1 ? q.discount : 0);   // discount only on a single-sheet export (excel.js)
  const fromName = state.companies.find(c => c.id === q.companyId)?.name || "";
  return `<table class="xlsx-page xlsx-gn">
    <tr><td colspan="2">To: <b class="xlsx-green">${escapeHtml(q.toCompany || "")}</b></td><td colspan="${wide - 2}">From: ${escapeHtml(fromName)}</td></tr>
    <tr><td colspan="2">${escapeHtml(q.toContact || "")}</td><td colspan="${wide - 2}">${escapeHtml(q.fromContact || "")}${q.fromTitle ? " _ " + escapeHtml(q.fromTitle) : ""}</td></tr>
    <tr><td colspan="2"></td><td colspan="${wide - 2}">Tel: ${escapeHtml(q.fromPhone || "")}</td></tr>
    <tr><td colspan="2"></td><td colspan="${wide - 2}">Add: ${escapeHtml(q.fromAddress || "")}</td></tr>
    <tr><td colspan="${wide}" class="xlsx-center">${escapeHtml(vnDateText(q.quoteDate, q.city))}</td></tr>
    <tr><td colspan="${wide}" class="xlsx-band xlsx-title">${escapeHtml(baoGiaTitleJS(q.title))}</td></tr>
    <tr><td colspan="${wide}" class="xlsx-italic">${nl2br(q.greeting)}</td></tr>
    <tr class="xlsx-band xlsx-center"><td>STT</td><td>Hạng Mục</td><td>ĐVT</td><td>SỐ LƯỢNG</td>${daysHead}<td>ĐƠN GIÁ</td><td>THÀNH TIỀN</td><td>Ghi Chú</td></tr>
    ${body}
    <tr class="xlsx-band-grey"><td colspan="${lblSpan}" class="xlsx-center">Tổng cộng</td><td class="xlsx-num">${pvMoney(tt.subtotal)}</td><td></td></tr>
    <tr class="xlsx-band-grey"><td colspan="${lblSpan}" class="xlsx-center">VAT ${vatPct}%</td><td class="xlsx-num">${pvMoney(tt.vat)}</td><td></td></tr>
    ${tt.discount > 0 ? `<tr class="xlsx-band-grey"><td colspan="${lblSpan}" class="xlsx-center">Giảm giá</td><td class="xlsx-num">-${pvMoney(tt.discount)}</td><td></td></tr>` : ""}
    <tr class="xlsx-band-grey"><td colspan="${lblSpan}" class="xlsx-center">Thành tiền</td><td class="xlsx-num">${pvMoney(tt.total)}</td><td></td></tr>
    ${q.notes ? `<tr><td colspan="${wide}" class="xlsx-italic" style="white-space:pre-wrap">Ghi chú: ${nl2br(q.notes)}</td></tr>` : ""}
  </table>`;
}
function previewSummary(q) {
  const vatPct = Number(q.vatPercent) || 0;
  let subtotalAll = 0;
  const rows = (q.sheets || []).map((s, i) => {
    const tpl = state.templates.find(t => t.id === s.templateId);
    const usesDays = !!(tpl && tpl.layout && tpl.layout.hasDays);
    const sub = sheetSubtotalGrouped(s.items, usesDays, !!s.groupSubtotal);
    subtotalAll += sub;
    return { idx: i + 1, name: s.name || (tpl && tpl.name) || ("Sheet " + (i + 1)), sub };
  });
  const tt = quoteTotals(subtotalAll, vatPct, q.discount);   // grand total carries the discount (mirror excel.js summary sheet)
  return `<table class="xlsx-page xlsx-summary">
    <colgroup><col style="width:50px"><col style="width:330px"><col style="width:160px"></colgroup>
    <tr><td colspan="3" class="xlsx-title">TỔNG BÁO GIÁ ${escapeHtml(q.quoteNumber || "")}</td></tr>
    <tr><td colspan="3" class="xlsx-center xlsx-italic">${escapeHtml(q.title || "")}</td></tr>
    <thead><tr><th>STT</th><th>Hạng mục</th><th>Thành tiền (VNĐ)</th></tr></thead>
    ${rows.map(r => `<tr><td class="xlsx-center">${r.idx}</td><td>${escapeHtml(r.name)}</td><td class="xlsx-num">${pvMoney(r.sub)}</td></tr>`).join("")}
    <tr class="xlsx-band"><td colspan="2" class="xlsx-center">Tổng cộng</td><td class="xlsx-num">${pvMoney(tt.subtotal)}</td></tr>
    <tr class="xlsx-band"><td colspan="2" class="xlsx-center">VAT (${vatPct}%)</td><td class="xlsx-num">${pvMoney(tt.vat)}</td></tr>
    ${tt.discount > 0 ? `<tr class="xlsx-band"><td colspan="2" class="xlsx-center">Giảm giá</td><td class="xlsx-num">-${pvMoney(tt.discount)}</td></tr>` : ""}
    <tr class="xlsx-band"><td colspan="2" class="xlsx-center">Thành tiền</td><td class="total-val">${pvMoney(tt.total)}</td></tr>
  </table>`;
}
