import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me, type ProjectQuote } from "../lib/api";
import { toast } from "../lib/ui";
import { fmtMoney, fmtDate, toInputDate, shortTitle, codeLabel, dash, Stat } from "../lib/format";
import { smartTextMatch } from "../lib/filterText";

// Trang HÓA ĐƠN (kế toán) — thay bảng Excel theo dõi hóa đơn. CÙNG NGUỒN dữ liệu với Quản lý dự án
// (QuoteSheet): kế toán NHẬP ở đây → trang Dự án THAM CHIẾU (read-only). Mỗi sheet đã chốt = 1 dòng.
// - Tình trạng HĐ: TỰ ĐỘNG "Hoàn tất" khi có Số HĐơn + Ngày HĐơn (không nhập tay).
// - Kế toán nhập: Hạng mục, PO/HĐ, CTy (GN/SM/CLF), Số HĐơn, Ngày HĐơn, Hình thức TT, Ngày đóng ĐH,
//   Link HĐ, Ngày thanh toán (quyền invoice:pay riêng), Chứng từ gửi/trả, Năm, Note.
// - Tự động: Khách hàng, Mã KH, Mã sản xuất, Số tiền (thành tiền VAT), Acc (người tạo — suy từ MSX),
//   Công nợ (số ngày từ Ngày HĐơn khi chưa thanh toán — ĐỎ nếu quá HẠN CÔNG NỢ RIÊNG của khách
//   (đặt ở trang Mã khách hàng); khách chưa đặt thì dùng ngưỡng mặc định chỉnh được ở toolbar),
//   Ký chứng từ (tham chiếu từ trang Quản lý dự án — hiện AI ký + ngày ký).
// - Mọi ô nhập tay CHƯA điền tô HỒNG; có dữ liệu thì tự trở lại nền trắng.

const HEADERS = ["Khách hàng", "Mã KH", "Mã sản xuất", "Hạng mục", "Tình trạng HĐ", "PO/HĐ", "CTy", "Số HĐơn", "Ngày HĐơn", "Số tiền", "Công nợ", "Hình thức TT", "Ngày đóng ĐH", "Acc", "Link HĐ", "Ngày thanh toán", "Chứng từ gửi đi", "Chứng từ trả về", "Ký chứng từ", "Năm", "Note"];
const COMPANIES = ["GN", "SM", "CLF"];
const PAY_METHODS = ["CK", "TM"];
const DEBT_DEFAULT = 30;   // hạn công nợ (ngày) cho khách CHƯA đặt hạn riêng ở trang Mã khách hàng

// Cột sort được (kế toán cần sắp theo ngày/tiền/nợ để đòi nợ) + cột SỐ (căn phải, tabular-nums qua .num).
type SortKey = "invoiceDate" | "amount" | "debt";
const SORT_COLS: Record<string, SortKey> = { "Ngày HĐơn": "invoiceDate", "Số tiền": "amount", "Công nợ": "debt" };
const NUM_COLS = new Set(["Số tiền", "Công nợ"]);

// Nhãn cột cho aria-label từng ô nhập trong bảng (screen reader): vd "Số HĐơn — GN2607_2".
const FIELD_LABEL: Record<string, string> = {
  invoiceDesc: "Hạng mục", poNumber: "PO/HĐ", invoiceCompany: "CTy", invoiceNo: "Số HĐơn",
  invoiceDate: "Ngày HĐơn", paymentMethod: "Hình thức TT", orderClosedAt: "Ngày đóng ĐH",
  invoiceLink: "Link HĐ", paidAt: "Ngày thanh toán", docSentAt: "Chứng từ gửi đi",
  docReturnedAt: "Chứng từ trả về", invoiceYear: "Năm", invoiceNote: "Note",
};

// Field kế toán lưu qua saveField + field kiểu NGÀY (chuẩn hoá về yyyy-mm-dd như input khi so sánh).
const SAVE_FIELDS = ["invoiceDesc", "poNumber", "invoiceCompany", "invoiceNo", "invoiceDate", "paymentMethod", "orderClosedAt", "invoiceLink", "paidAt", "docSentAt", "docReturnedAt", "invoiceYear", "invoiceNote"] as const;
const DATE_FIELDS = new Set(["invoiceDate", "orderClosedAt", "paidAt", "docSentAt", "docReturnedAt"]);
type StatusFilter = "" | "complete" | "incomplete";
type CollectionFilter = "" | "paid" | "unpaid" | "dueSoon" | "overdue";
type MissingFilter = "" | "any" | "invoiceDesc" | "poNumber" | "invoiceNo" | "invoiceDate" | "paymentMethod" | "orderClosedAt" | "invoiceLink" | "paidAt" | "docSentAt" | "docReturnedAt" | "signedAt" | "invoiceYear" | "invoiceNote";

type Row = {
  key: string; q: ProjectQuote; code: string; sheetId: number | null; amount: number;
  invoiceDesc: string | null; poNumber: string | null; invoiceCompany: string | null;
  invoiceNo: string | null; invoiceDate: string | null; paymentMethod: string | null;
  orderClosedAt: string | null; invoiceLink: string | null; paidAt: string | null;
  docSentAt: string | null; docReturnedAt: string | null; invoiceYear: number | null; invoiceNote: string | null;
  signedAt: string | null; signedByName: string | null;   // Ký chứng từ — hành động ở trang Quản lý dự án
};

function buildRows(quotes: ProjectQuote[]): Row[] {
  const out: Row[] = [];
  for (const q of quotes) {
    if (q.status !== "converted") continue;   // hóa đơn chỉ theo dự án ĐÃ CHỐT
    const base = codeLabel(q);
    const sheets = q.sheets && q.sheets.length ? q.sheets : [];
    const multi = sheets.length > 1;
    sheets.forEach((sh, i) => {
      const baoGia = Number(sh.subtotal) || 0;
      const vat = Math.round((baoGia * (Number(q.vatPercent) || 0)) / 100);
      out.push({
        key: `${q.id}-${i}`, q, code: base + (multi ? `_${i + 1}` : ""), sheetId: sh.id || null,
        amount: baoGia + vat,
        invoiceDesc: sh.invoiceDesc || null, poNumber: sh.poNumber || null,
        invoiceCompany: sh.invoiceCompany || null, invoiceNo: sh.invoiceNo || null,
        invoiceDate: sh.invoiceDate || null, paymentMethod: sh.paymentMethod || null,
        orderClosedAt: sh.orderClosedAt || null, invoiceLink: sh.invoiceLink || null,
        paidAt: sh.paidAt || null, docSentAt: sh.docSentAt || null, docReturnedAt: sh.docReturnedAt || null,
        invoiceYear: sh.invoiceYear ?? null, invoiceNote: sh.invoiceNote || null,
        signedAt: sh.signedAt || null, signedByName: sh.signedByName || null,
      });
    });
  }
  return out;
}

// Giá trị "đã lưu trên server" chuẩn hoá để so sánh trước khi gọi API (ngày → yyyy-mm-dd giống input).
const savedVal = (r: Row, f: string): string | null => {
  const v = r[f as keyof Row];
  if (v == null || v === "") return null;
  return DATE_FIELDS.has(f) ? (toInputDate(String(v)) || null) : String(v);
};

// Mặc định CTy theo công ty của báo giá (Gia Nguyễn → GN, Colorfull → CLF) khi kế toán chưa chọn.
const defaultCty = (q: ProjectQuote) => {
  const s = (q.company?.shortName || q.company?.name || "").toLowerCase();
  if (s.includes("color") || s.includes("clf")) return "CLF";
  return "GN";
};

// Công nợ = số ngày từ Ngày HĐơn đến hôm nay khi CHƯA thanh toán (đã thanh toán/chưa xuất HĐ → không nợ).
const debtDays = (r: Row): number | null => {
  if (!r.invoiceDate || r.paidAt) return null;
  const d = new Date(r.invoiceDate); if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
};

const hasValue = (v: unknown) => v != null && String(v).trim() !== "";
const rowLimit = (r: Row) => r.q.customerDebtDays ?? DEBT_DEFAULT;
const isOverdue = (r: Row) => { const days = debtDays(r); return days != null && days > rowLimit(r); };
const isDueSoon = (r: Row) => {
  const days = debtDays(r);
  const limit = rowLimit(r);
  return days != null && days <= limit && days >= Math.max(0, limit - 7);
};
const missingFields = (r: Row): MissingFilter[] => [
  "invoiceDesc", "poNumber", "invoiceNo", "invoiceDate", "paymentMethod", "orderClosedAt",
  "invoiceLink", "paidAt", "docSentAt", "docReturnedAt", "signedAt", "invoiceYear", "invoiceNote",
].filter((field) => !hasValue(r[field as keyof Row])) as MissingFilter[];

export function InvoicesPage({ me }: { me: Me }) {
  const canEdit = me.permissions.includes("invoice:edit");
  const canPay = me.permissions.includes("invoice:pay");
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");   // lọc theo THÁNG của Ngày HĐơn
  const [cty, setCty] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [collection, setCollection] = useState<CollectionFilter>("");
  const [missing, setMissing] = useState<MissingFilter>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Hạn công nợ đặt RIÊNG TỪNG CÔNG TY ở trang Mã khách hàng (nút Sửa) — khách chưa đặt
  // thì dùng mặc định cố định 30 ngày. (2026-07-16: bỏ ô chỉnh "mặc định" trên toolbar theo
  // yêu cầu — thừa khi đã có hạn riêng từng khách.)

  const { data, isPending, error } = useQuery({ queryKey: ["quoteProjects"], queryFn: api.quoteProjects });
  const [rows, setRows] = useState<Row[]>([]);
  // Snapshot giá trị ĐÃ LƯU từng ô (key:field) — để saveField bỏ qua khi giá trị không đổi.
  const savedRef = useRef<Record<string, string | null>>({});
  useEffect(() => {
    if (!data) return;
    const built = buildRows(data.data || []);
    const snap: Record<string, string | null> = {};
    for (const r of built) for (const f of SAVE_FIELDS) snap[`${r.key}:${f}`] = savedVal(r, f);
    savedRef.current = snap;
    // Đang gõ dở trong bảng (input/select focus trong .inv-table) → BỎ QUA, không ghi đè ô đang nhập
    // (refetch sau khi lưu ô khác sẽ reset controlled input về giá trị server → mất chữ đang gõ).
    const ae = document.activeElement;
    if (ae instanceof HTMLElement && (ae.tagName === "INPUT" || ae.tagName === "SELECT") && ae.closest(".inv-table")) return;
    setRows(built);
  }, [data]);
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";
  const load = () => { qc.invalidateQueries({ queryKey: ["quoteProjects"] }); };

  const years = useMemo(() => [...new Set(rows.map((r) => r.invoiceYear || (r.invoiceDate ? new Date(r.invoiceDate).getFullYear() : null)).filter(Boolean))].sort() as number[], [rows]);
  // Lọc NGỮ CẢNH trước (tìm kiếm/pháp nhân/thời gian). Số lượng trên nút lọc nhanh tính từ tập này,
  // nên vẫn đúng khi người dùng đang xem riêng một công ty hoặc một khoảng ngày.
  const contextRows = rows.filter((r) => {
    const inputDate = toInputDate(r.invoiceDate);
    const done = !!(r.invoiceNo && r.invoiceDate);
    if (year && String(r.invoiceYear || (r.invoiceDate ? new Date(r.invoiceDate).getFullYear() : "")) !== year) return false;
    if (month && String(r.invoiceDate ? new Date(r.invoiceDate).getMonth() + 1 : "") !== month) return false;
    if (dateFrom && (!inputDate || inputDate < dateFrom)) return false;
    if (dateTo && (!inputDate || inputDate > dateTo)) return false;
    if (cty && (r.invoiceCompany || defaultCty(r.q)) !== cty) return false;
    if (!smartTextMatch(q, [
      r.q.customerName, r.q.customerCode, r.q.title, r.code, r.invoiceDesc, r.invoiceNo, r.poNumber,
      r.invoiceCompany || defaultCty(r.q), r.paymentMethod, r.invoiceNote, r.q.createdBy?.displayName,
      r.signedByName, r.amount, fmtMoney(r.amount), r.invoiceDate, fmtDate(r.invoiceDate),
      done ? "hoàn tất" : "chưa đủ", r.paidAt ? "đã thu đã thanh toán" : "chưa thu chưa thanh toán",
      isOverdue(r) ? "quá hạn nợ quá hạn" : "", isDueSoon(r) ? "sắp đến hạn sap den han" : "",
    ])) return false;
    return true;
  });
  // Sau đó mới áp điều kiện NGHIỆP VỤ; các nhóm độc lập để có thể kết hợp, vd CTy=GN + Chưa thu + Chưa ký.
  const shown = contextRows.filter((r) => {
    const done = !!(r.invoiceNo && r.invoiceDate);
    if (status === "complete" && !done) return false;
    if (status === "incomplete" && done) return false;
    if (collection === "paid" && !r.paidAt) return false;
    if (collection === "unpaid" && r.paidAt) return false;
    if (collection === "dueSoon" && !isDueSoon(r)) return false;
    if (collection === "overdue" && !isOverdue(r)) return false;
    if (missing === "any" && missingFields(r).length === 0) return false;
    if (missing && missing !== "any" && !missingFields(r).includes(missing)) return false;
    return true;
  });
  const quickCounts = {
    incomplete: contextRows.filter((r) => !(r.invoiceNo && r.invoiceDate)).length,
    unpaid: contextRows.filter((r) => !r.paidAt).length,
    dueSoon: contextRows.filter(isDueSoon).length,
    overdue: contextRows.filter(isOverdue).length,
    missing: contextRows.filter((r) => missingFields(r).length > 0).length,
    unsigned: contextRows.filter((r) => !r.signedAt).length,
    paid: contextRows.filter((r) => !!r.paidAt).length,
  };
  const activeFilterCount = [q.trim(), cty, year, month, status, collection, missing, dateFrom, dateTo].filter(Boolean).length;
  const clearFilters = () => {
    setQ(""); setCty(""); setYear(""); setMonth(""); setStatus(""); setCollection(""); setMissing(""); setDateFrom(""); setDateTo("");
  };

  // Sort client 3 cột chính (Ngày HĐơn / Số tiền / Công nợ) — pattern th.sortable + aria-sort như trang Mã khách hàng.
  const [sortKey, setSortKey] = useState<SortKey | "">("");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const toggleSort = (k: SortKey) => { if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(1); } };
  const sortVal = (r: Row, k: SortKey): number | null => {
    if (k === "amount") return r.amount;
    if (k === "invoiceDate") { if (!r.invoiceDate) return null; const t = new Date(r.invoiceDate).getTime(); return isNaN(t) ? null : t; }
    return debtDays(r);
  };
  const sorted = sortKey
    ? [...shown].sort((a, b) => {
        const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;         // ô trống luôn xuống cuối
        if (vb == null) return -1;
        return (va - vb) * sortDir;
      })
    : shown;

  const sumAmount = shown.reduce((s, r) => s + r.amount, 0);
  const collected = shown.reduce((s, r) => s + (r.paidAt ? r.amount : 0), 0);
  // Hạn công nợ áp cho TỪNG DÒNG: ưu tiên hạn RIÊNG của khách (trang Mã khách hàng), chưa đặt → 30 ngày.
  const overdue = shown.filter(isOverdue);
  const overdueAmount = overdue.reduce((s, r) => s + r.amount, 0);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const saveField = async (row: Row, field: string, val: string | null) => {
    if (!row.sheetId) return;
    const k = `${row.key}:${field}`;
    if ((val ?? null) === (savedRef.current[k] ?? null)) return;   // giá trị KHÔNG đổi → khỏi gọi API/toast/refetch
    try {
      await api.updateSheetInvoice(row.sheetId, field, val);
      savedRef.current[k] = val ?? null;
      toast("Đã lưu", "success");
      // Đồng bộ cache cho trang Quản lý dự án / Dashboard (tham chiếu cùng nguồn) thấy ngay giá trị mới.
      qc.invalidateQueries({ queryKey: ["quoteProjects"] });
    } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); load(); }
  };

  const fieldLabel = (f: string, r: Row) => `${FIELD_LABEL[f] || f} — ${r.code}`;
  const editable = (r: Row, field?: string) => (field === "paidAt" ? canPay : canEdit) && !!r.sheetId;
  // Một quy tắc duy nhất cho toàn bảng: null, chuỗi rỗng hoặc chỉ có khoảng trắng đều là CHƯA ĐIỀN.
  const missCls = (v: unknown) => (hasValue(v) ? undefined : "cell-miss");
  const textCell = (r: Row, field: keyof Row, w = 110) =>
    editable(r, field as string) ? (
      <td className={missCls(r[field])}><input value={(r[field] as string) || ""} style={{ width: w }} aria-label={fieldLabel(field as string, r)}
        onChange={(e) => patch(r.key, { [field]: e.target.value } as Partial<Row>)} onBlur={(e) => saveField(r, field as string, e.target.value.trim() || null)} /></td>
    ) : <td className={missCls(r[field])}>{(r[field] as string) || dash}</td>;
  const dateCell = (r: Row, field: keyof Row) =>
    editable(r, field as string) ? (
      <td className={missCls(r[field])}><input className={!hasValue(r[field]) ? "inv-date-empty" : undefined} type="date" value={toInputDate(r[field] as string)} style={{ width: 140 }} aria-label={fieldLabel(field as string, r)}
        onChange={(e) => { patch(r.key, { [field]: e.target.value || null } as Partial<Row>); saveField(r, field as string, e.target.value || null); }} /></td>
    ) : <td className={missCls(r[field])}>{(r[field] as string) ? fmtDate(r[field] as string) : dash}</td>;
  const selectCell = (r: Row, field: keyof Row, options: string[], defVal = "") =>
    editable(r, field as string) ? (
      <td className={missCls((r[field] as string) || defVal)}><select value={(r[field] as string) || defVal} style={{ width: 74 }} aria-label={fieldLabel(field as string, r)}
        onChange={(e) => { patch(r.key, { [field]: e.target.value || null } as Partial<Row>); saveField(r, field as string, e.target.value || null); }}>
        {!defVal && <option value="">—</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select></td>
    ) : <td>{(r[field] as string) || defVal || dash}</td>;

  return (
    <div>
      <h1>Hóa đơn</h1>
      <p className="muted">Theo dõi hóa đơn theo <b>dự án đã chốt</b> (mỗi sheet 1 dòng). Nhập ở đây — trang Quản lý dự án <b>tham chiếu</b> tự động. Tình trạng HĐ tự <b>Hoàn tất</b> khi có Số HĐơn + Ngày HĐơn. Bấm dòng để mở báo giá.</p>

      <div className="inv-filters">
        <div className="toolbar inv-filter-row inv-filter-main">
          <input className="grow" type="search" placeholder="Tìm không dấu: khách, MSX, số HĐ, PO, tiền, ngày, ghi chú…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm hóa đơn" />
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Lọc tình trạng hóa đơn">
            <option value="">Tình trạng: Tất cả</option><option value="complete">Hoàn tất</option><option value="incomplete">Chưa đủ</option>
          </select>
          <select value={collection} onChange={(e) => setCollection(e.target.value as CollectionFilter)} aria-label="Lọc thu tiền">
            <option value="">Thu tiền: Tất cả</option><option value="paid">Đã thu</option><option value="unpaid">Chưa thu</option><option value="dueSoon">Sắp đến hạn (7 ngày)</option><option value="overdue">Nợ quá hạn</option>
          </select>
          <select value={missing} onChange={(e) => setMissing(e.target.value as MissingFilter)} aria-label="Lọc thông tin còn thiếu">
            <option value="">Thiếu dữ liệu: Tất cả</option><option value="any">Có ô còn thiếu</option>
            <option value="invoiceDesc">Thiếu Hạng mục</option><option value="poNumber">Thiếu PO/HĐ</option>
            <option value="invoiceNo">Thiếu Số HĐ</option><option value="invoiceDate">Thiếu Ngày HĐ</option>
            <option value="paymentMethod">Thiếu Hình thức TT</option><option value="orderClosedAt">Thiếu Ngày đóng ĐH</option>
            <option value="invoiceLink">Thiếu Link HĐ</option><option value="paidAt">Thiếu Ngày thanh toán</option>
            <option value="docSentAt">Thiếu CT gửi đi</option><option value="docReturnedAt">Thiếu CT trả về</option>
            <option value="signedAt">Chưa ký chứng từ</option><option value="invoiceYear">Thiếu Năm</option><option value="invoiceNote">Thiếu Note</option>
          </select>
        </div>
        <div className="toolbar inv-filter-row inv-filter-extra">
          <select value={cty} onChange={(e) => setCty(e.target.value)} aria-label="Lọc theo công ty"><option value="">CTy: Tất cả</option>{COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Lọc theo năm"><option value="">Năm: Tất cả</option>{years.map((y) => <option key={y} value={String(y)}>{y}</option>)}</select>
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Lọc theo tháng (Ngày HĐơn)" title="Theo tháng của Ngày HĐơn">
            <option value="">Tháng: Tất cả</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>Tháng {i + 1}</option>)}
          </select>
          <label className="inv-date-filter"><span>Từ ngày HĐ</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} /></label>
          <label className="inv-date-filter"><span>Đến ngày HĐ</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} /></label>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" type="button" disabled={!activeFilterCount} onClick={clearFilters}>Xóa tất cả{activeFilterCount ? <span className="inv-filter-count">{activeFilterCount}</span> : null}</button>
        </div>
      </div>
      <div className="inv-quick-filters" aria-label="Bộ lọc nhanh hóa đơn">
        <span className="inv-quick-label">Lọc nhanh:</span>
        <button type="button" className={!status && !collection && !missing ? "active" : ""} onClick={() => { setStatus(""); setCollection(""); setMissing(""); }}>Tất cả <b>{contextRows.length}</b></button>
        <button type="button" className={status === "incomplete" ? "active" : ""} onClick={() => setStatus((v) => v === "incomplete" ? "" : "incomplete")}>Chưa đủ HĐ <b>{quickCounts.incomplete}</b></button>
        <button type="button" className={collection === "unpaid" ? "active" : ""} onClick={() => setCollection((v) => v === "unpaid" ? "" : "unpaid")}>Chưa thu <b>{quickCounts.unpaid}</b></button>
        <button type="button" className={`warning${collection === "dueSoon" ? " active" : ""}`} onClick={() => setCollection((v) => v === "dueSoon" ? "" : "dueSoon")}>Sắp đến hạn <b>{quickCounts.dueSoon}</b></button>
        <button type="button" className={`danger${collection === "overdue" ? " active" : ""}`} onClick={() => setCollection((v) => v === "overdue" ? "" : "overdue")}>⚠ Nợ quá hạn <b>{quickCounts.overdue}</b></button>
        <button type="button" className={missing === "any" ? "active" : ""} onClick={() => setMissing((v) => v === "any" ? "" : "any")}>Thiếu dữ liệu <b>{quickCounts.missing}</b></button>
        <button type="button" className={missing === "signedAt" ? "active" : ""} onClick={() => setMissing((v) => v === "signedAt" ? "" : "signedAt")}>Chưa ký <b>{quickCounts.unsigned}</b></button>
        <button type="button" className={collection === "paid" ? "active" : ""} onClick={() => setCollection((v) => v === "paid" ? "" : "paid")}>Đã thu <b>{quickCounts.paid}</b></button>
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}

      {isPending ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : err && !data ? null : (   /* lỗi tải mà CHƯA có dữ liệu → chỉ hiện banner lỗi, không hiện stat 0 gây hiểu nhầm */
        <>
          <div className="stat-row">
            <Stat label="Tổng số tiền (VAT)" value={fmtMoney(sumAmount)} />
            <Stat label="Đã thu" value={fmtMoney(collected)} tone="ok" active={collection === "paid"} onClick={() => setCollection((v) => v === "paid" ? "" : "paid")} title="Bấm để lọc hóa đơn đã thu" />
            <Stat label="Chưa thu" value={fmtMoney(sumAmount - collected)} tone={sumAmount - collected > 0 ? "danger" : undefined} active={collection === "unpaid"} onClick={() => setCollection((v) => v === "unpaid" ? "" : "unpaid")} title="Bấm để lọc hóa đơn chưa thu" />
            <Stat label="Nợ quá hạn" value={overdue.length ? `${overdue.length} HĐ · ${fmtMoney(overdueAmount)}` : "0"} tone={overdue.length ? "danger" : "ok"} active={collection === "overdue"} onClick={() => setCollection((v) => v === "overdue" ? "" : "overdue")} title="Bấm để lọc nợ quá hạn" />
            <Stat label="Số hóa đơn" value={String(shown.length)} />
          </div>

          {shown.length === 0 ? (
            <div className="empty">{rows.length ? <>Không có hóa đơn khớp bộ lọc.{activeFilterCount > 0 && <div style={{ marginTop: 10 }}><button className="btn btn-sm" onClick={clearFilters}>Xóa tất cả bộ lọc</button></div>}</> : 'Chưa có dự án nào ở trạng thái "Đã chốt".'}</div>
          ) : (
            <>
              <div className="tbl-scroll">
                <table className="list-table inv-table">
                  <thead><tr>{HEADERS.map((h) => {
                    const sk = SORT_COLS[h];
                    const cls = [NUM_COLS.has(h) ? "num" : "", sk ? "sortable" : ""].filter(Boolean).join(" ") || undefined;
                    if (!sk) return <th key={h} scope="col" className={cls}>{h}</th>;
                    const active = sortKey === sk;
                    return (
                      <th key={h} scope="col" className={cls} tabIndex={0} title="Bấm để sắp xếp"
                          aria-sort={active ? (sortDir === 1 ? "ascending" : "descending") : "none"}
                          onClick={() => toggleSort(sk)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(sk); } }}>
                        {h}{active ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}</tr></thead>
                  <tbody>
                    {sorted.map((r) => {
                      const done = !!(r.invoiceNo && r.invoiceDate);   // TỰ ĐỘNG Hoàn tất khi có Số HĐ + Ngày HĐ
                      const nDays = debtDays(r);                        // null = đã thanh toán / chưa có Ngày HĐơn
                      const limit = rowLimit(r);                        // hạn riêng của khách ?? mặc định toolbar
                      const over = nDays != null && nDays > limit;      // quá hạn → ĐỎ (đi đòi nợ)
                      return (
                        <tr key={r.key} className="qrow" title="Bấm để mở báo giá" tabIndex={0}
                            onClick={(e) => { if ((e.target as HTMLElement).closest("button,a,input,select")) return; location.hash = "#/quotes/" + r.q.id; }}
                            onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) location.hash = "#/quotes/" + r.q.id; }}>
                          <td title={r.q.title}><strong>{r.q.customerName || r.q.customerCode || shortTitle(r.q.title)}</strong></td>
                          <td>{r.q.customerCode || dash}</td>
                          <td><strong>{r.code}</strong></td>
                          {textCell(r, "invoiceDesc", 210)}
                          <td>{done ? <span className="status approved">Hoàn tất</span> : <span className="status pending">Chưa đủ</span>}</td>
                          {textCell(r, "poNumber", 90)}
                          {selectCell(r, "invoiceCompany", COMPANIES, defaultCty(r.q))}
                          {textCell(r, "invoiceNo", 90)}
                          {dateCell(r, "invoiceDate")}
                          <td className="num"><strong>{fmtMoney(r.amount)}</strong></td>
                          <td className={"num nowrap" + (over ? " cell-over" : "")}
                              title={nDays == null ? undefined : `Hạn công nợ ${limit} ngày (${r.q.customerDebtDays != null ? "riêng khách này — đặt ở Mã khách hàng" : "mặc định"})${over ? ` — QUÁ HẠN, từ Ngày HĐơn ${fmtDate(r.invoiceDate)}, cần báo thanh toán` : ""}`}>
                            {r.paidAt ? <span className="txt-ok">✓ Đã TT</span> : nDays == null ? dash : <>{over ? "⚠ " : ""}{nDays}/{limit} ngày</>}
                          </td>
                          {selectCell(r, "paymentMethod", PAY_METHODS)}
                          {dateCell(r, "orderClosedAt")}
                          <td>{r.q.createdBy?.displayName || dash}</td>
                          {editable(r)
                            ? <td className={["nowrap", missCls(r.invoiceLink)].filter(Boolean).join(" ")}>
                                <input value={r.invoiceLink || ""} style={{ width: 120 }} aria-label={fieldLabel("invoiceLink", r)} onChange={(e) => patch(r.key, { invoiceLink: e.target.value })} onBlur={(e) => saveField(r, "invoiceLink", e.target.value.trim() || null)} />
                                {r.invoiceLink && /^https?:\/\//i.test(r.invoiceLink) && <a href={r.invoiceLink} target="_blank" rel="noopener" title="Mở link HĐ" style={{ marginLeft: 4 }} onClick={(e) => e.stopPropagation()}>↗</a>}
                              </td>
                            : <td className={missCls(r.invoiceLink)}>{r.invoiceLink ? <a href={r.invoiceLink} target="_blank" rel="noopener">Xem HĐ</a> : dash}</td>}
                          {dateCell(r, "paidAt")}
                          {dateCell(r, "docSentAt")}
                          {dateCell(r, "docReturnedAt")}
                          <td className="nowrap">
                            {r.signedAt
                              ? <span className="status approved nowrap">✓ {r.signedByName || "Đã ký"} · {fmtDate(r.signedAt)}</span>
                              : <span className="muted">Chưa ký</span>}
                          </td>
                          {editable(r)
                            ? <td className={missCls(r.invoiceYear)}><input inputMode="numeric" value={r.invoiceYear ?? ""} style={{ width: 64 }} aria-label={fieldLabel("invoiceYear", r)}
                                onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, ""); patch(r.key, { invoiceYear: v ? Number(v) : null }); }}
                                onBlur={(e) => { const v = e.target.value.replace(/[^\d]/g, ""); saveField(r, "invoiceYear", v || null); }} /></td>
                            : <td className={missCls(r.invoiceYear)}>{r.invoiceYear ?? dash}</td>}
                          {textCell(r, "invoiceNote", 130)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="list-foot"><span className="muted">Hiển thị {sorted.length} / {rows.length} hóa đơn{activeFilterCount ? ` · ${activeFilterCount} bộ lọc đang dùng` : ""}</span></div>
            </>
          )}
        </>
      )}
    </div>
  );
}
