// Pure, dependency-free helpers extracted from app.js (no state, no DOM, no api).
// Step 1 of the SPA modularization — the leaf-most layer that everything imports.
// Mirrors src/money.js / src/templateConfigs.js where noted; keep those in sync.

export function fmtMoney(n) {
  if (n == null || isNaN(n)) return "0";
  return Number(n).toLocaleString("vi-VN");
}
// Round to whole VND (half-up) — VND has no fractional unit. Mirrors src/money.js so the
// on-screen totals equal the DB-stored totals AND the exported Excel (no sub-đồng drift).
export function roundVnd(n) { return Math.round(Number(n) || 0); }
// Authoritative client-side total, byte-identical to computeQuoteTotals (src/money.js):
// round subtotal, VAT from the rounded subtotal, clamp the discount to [0, gross].
export function quoteTotals(subtotalRaw, vatPct, discountRaw) {
  const subtotal = roundVnd(subtotalRaw);
  const vat = roundVnd(subtotal * (Number(vatPct) || 0) / 100);
  const gross = subtotal + vat;
  let discount = roundVnd(discountRaw);
  if (discount < 0) discount = 0;
  if (discount > gross) discount = gross;
  return { subtotal, vat, discount, total: gross - discount };
}
export function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}
export function vnDateText(d, city) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${city || "TP. Hồ Chí Minh"}, ngày ${String(dt.getDate()).padStart(2, "0")} tháng ${String(dt.getMonth() + 1).padStart(2, "0")} năm ${dt.getFullYear()}`;
}
export function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
// Only ever put a logo in an <img src> when it's a pure base64 image data-URL —
// anything else (markup smuggled into the value) renders nothing instead.
export function safeLogoSrc(s) {
  return typeof s === "string" && /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(s) ? s : "";
}

// ---- Live-preview helpers (mirror drawItems + src/excel.js so the preview matches the file) ----
export function pvRowspan(rk, i) { let s = 1, j = i + 1; while (j < rk.length && rk[j] === "sub") { s++; j++; } return s; }
export function pvAmount(it, usesDays) {
  const qy = Number(it.quantity) || 0, d = Number(it.days) || 1, p = Number(it.unitPrice) || 0;
  return usesDays ? qy * d * p : qy * p;
}
export function pvMoney(n) { return (!n || isNaN(Number(n))) ? "" : Number(n).toLocaleString("vi-VN"); }
export function nl2br(s) { return escapeHtml(s || "").replace(/\n/g, "<br>"); }
// 0→"A", 1→"B", …, 25→"Z", 26→"AA". Auto letter for section (nhóm) rows.
export function groupLetter(n) {
  let s = "", x = n + 1;
  while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); }
  return s;
}
// Per-row preview descriptors mirroring src/excel.js EXACTLY (sections, subtotals, ×SL).
export function pvRows(items, usesDays, groupSubtotal) {
  items = items || [];
  const eff = items.map(() => "head");
  for (let i = 0; i < items.length; i++) {
    const k = items[i] && items[i].kind;
    if (k === "info") eff[i] = "info";
    else if (k === "section" || k === "subsection") eff[i] = "section";
    else if (k === "sub" && i > 0 && (eff[i - 1] === "head" || eff[i - 1] === "sub")) eff[i] = "sub";
    else eff[i] = "head";
  }
  const sectionSum = {};
  let cur = -1;
  for (let i = 0; i < items.length; i++) {
    if (eff[i] === "section") { cur = i; sectionSum[i] = 0; }
    else if ((eff[i] === "head" || eff[i] === "sub") && cur >= 0) sectionSum[cur] += pvAmount(items[i], usesDays);
  }
  let itemNo = 0, sectionIdx = -1, mult = 1;
  const rows = items.map((it, i) => {
    const kind = eff[i];
    if (kind === "section") {
      sectionIdx++; itemNo = 0;
      const gmult = groupSubtotal ? Math.max(1, Number(it.quantity) || 1) : 1;
      mult = gmult;
      return { kind, it, letter: (it.label && String(it.label).trim()) || groupLetter(sectionIdx), groupSum: sectionSum[i] || 0, gmult, groupSubtotal };
    }
    if (kind === "info") return { kind, it };
    return { kind, it, stt: kind === "head" ? ++itemNo : null, amt: pvAmount(it, usesDays), mult };
  });
  return { rows, eff };
}
// Sheet subtotal honoring section (nhóm) multipliers: a section's Số Lượng multiplies the
// amounts of the items under it (until the next section). Section rows contribute 0 themselves.
// Shared by the editor totals AND the live preview; mirrors src/money.js grouped logic.
export function sheetSubtotalGrouped(items, usesDays, groupSubtotal) {
  let mult = 1, sum = 0;
  for (const it of (items || [])) {
    if (it.kind === "section" || it.kind === "subsection") { mult = groupSubtotal ? Math.max(1, Number(it.quantity) || 1) : 1; continue; }
    if (it.kind === "info") continue;   // dòng thông tin: không tính tiền (khớp Excel + money.js)
    const qty = Number(it.quantity) || 0, days = Number(it.days) || 1, price = Number(it.unitPrice) || 0;
    sum += (usesDays ? qty * days * price : qty * price) * mult;
  }
  return sum;
}
// Mirror of src/templateConfigs.js baoGiaTitle (app.js is no-build; keep this copy in sync).
export function baoGiaTitleJS(t) {
  t = (t || "").trim();
  if (!t) return "BẢNG BÁO GIÁ";
  const ascii = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toUpperCase();
  return /^BANG\s*BAO\s*GIA/.test(ascii) ? t : "BẢNG BÁO GIÁ - " + t;
}

// Vòng đời hiện tại CHỈ dùng: draft / converted / lost.
// pending/approved/rejected/sent là LEGACY (luồng duyệt nội bộ bỏ 2026-06-22) — giữ nhãn
// để hiển thị đúng cho dữ liệu cũ (enum Prisma không migration), KHÔNG sinh mới nữa.
export const STATUS_LABEL = {
  draft: "Nháp", pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Bị từ chối",
  sent: "Đã gửi", converted: "Đã chốt", lost: "Không chốt",
};
export const statusLabel = (s) => STATUS_LABEL[s] || s || "—";
export const ROLE_LABEL = { admin: "Quản trị", manager: "Account", account_hn: "Account HN" };
export const ROLE_LABEL_FULL = { admin: "Quản trị (Giám đốc)", manager: "Account", account_hn: "Account Hà Nội" };
export const CUSTOMER_STATUS_LABEL = { lead: "Tiềm năng", prospect: "Đang trao đổi", active: "Đang giao dịch", inactive: "Ngừng" };
export const customerStatusLabel = (s) => CUSTOMER_STATUS_LABEL[s] || s || "—";
export const RESOURCE_LABEL = { quote: "Báo giá", customer: "Khách hàng", product: "Sản phẩm", user: "Nhân viên", webhook: "Webhook", token: "Phiên đăng nhập" };

// Friendly Vietnamese descriptions for audit action codes.
// quote.submit/approve/reject là LEGACY (luồng duyệt bỏ 2026-06-22) — chỉ còn map nhật ký cũ.
export const ACTION_LABEL = {
  "quote.create": "Tạo báo giá", "quote.update": "Sửa báo giá", "quote.submit": "Trình duyệt báo giá",
  "quote.approve": "Duyệt báo giá", "quote.reject": "Từ chối báo giá", "quote.send": "Gửi báo giá cho khách",
  "quote.convert": "Chốt báo giá (thắng)", "quote.lost": "Đánh dấu không chốt", "quote.delete": "Xóa báo giá",
  "quote.duplicate": "Nhân bản báo giá", "quote.reopened": "Mở lại để sửa",
  "customer.create": "Thêm khách hàng", "customer.update": "Sửa khách hàng", "customer.delete": "Xóa khách hàng",
  "customer.note.add": "Thêm ghi chú khách hàng",
  "product.create": "Thêm sản phẩm", "product.update": "Sửa sản phẩm", "product.delete": "Xóa sản phẩm",
  "user.create": "Thêm nhân viên", "user.update": "Cập nhật nhân viên",
  "login.token": "Đăng nhập (ứng dụng)", "password.change.success": "Đổi mật khẩu",
  "password.change.failed": "Đổi mật khẩu thất bại", "mfa.enable": "Bật bảo mật 2 lớp",
  "mfa.disable": "Tắt bảo mật 2 lớp", "token.revoke-all": "Đăng xuất mọi thiết bị",
  "webhook.create": "Thêm tích hợp", "webhook.update": "Sửa tích hợp", "webhook.delete": "Xóa tích hợp",
};
export const actionLabel = (a) => ACTION_LABEL[a] || a || "—";
export const resourceLabel = (r) => RESOURCE_LABEL[r] || r || "";
