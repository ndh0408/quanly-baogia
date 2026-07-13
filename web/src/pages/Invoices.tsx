import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me, type ProjectQuote } from "../lib/api";
import { toast } from "../lib/ui";

// Trang HÓA ĐƠN (kế toán) — thay bảng Excel theo dõi hóa đơn. CÙNG NGUỒN dữ liệu với Quản lý dự án
// (QuoteSheet): kế toán NHẬP ở đây → trang Dự án THAM CHIẾU (read-only). Mỗi sheet đã chốt = 1 dòng.
// - Tình trạng HĐ: TỰ ĐỘNG "Done" khi có Số HĐơn + Ngày HĐơn (không nhập tay).
// - Kế toán nhập: Hạng mục, PO/HĐ, CTy (GN/SM/CLF), Số HĐơn, Ngày HĐơn, Hình thức TT, Ngày đóng ĐH,
//   Link HĐ, Ngày thanh toán (quyền invoice:pay riêng), Chứng từ gửi/trả, Năm, Note.
// - Tự động: Khách hàng, Mã KH, Mã sản xuất, Số tiền (thành tiền VAT), Acc (người tạo — suy từ MSX),
//   Công nợ (số ngày từ Ngày HĐơn khi chưa thanh toán — ĐỎ nếu quá ngưỡng, ngưỡng chỉnh được ở toolbar),
//   Ký chứng từ (tham chiếu từ trang Quản lý dự án — hiện AI ký + ngày ký).
// - Ô ngày CHƯA điền tô HỒNG để kế toán thấy còn thiếu.

const fmtMoney = (v?: number) => Number(v || 0).toLocaleString("vi-VN");
const fmtDate = (v?: string | null) => { if (!v) return ""; const d = new Date(v); if (isNaN(d.getTime())) return ""; const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; };
const toInputDate = (v?: string | null) => { if (!v) return ""; const d = new Date(v); if (isNaN(d.getTime())) return ""; const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const shortTitle = (t: string) => { const s = String(t || ""); return s.replace(/^\s*bảng\s+báo\s+giá\s*[-–—:|·]*\s*/i, "").trim() || s; };
const codeLabel = (q: ProjectQuote) => { const c = q.projectCode || q.quoteNumber || ""; return q.projectVersion && q.projectVersion > 1 ? `${c}_v${q.projectVersion}` : c; };
const dash = <span className="muted">—</span>;

const HEADERS = ["Khách hàng", "Mã KH", "Mã sản xuất", "Hạng mục", "Tình trạng HĐ", "PO/HĐ", "CTy", "Số HĐơn", "Ngày HĐơn", "Số tiền", "Công nợ", "Hình thức TT", "Ngày đóng ĐH", "Acc", "Link HĐ", "Ngày thanh toán", "Chứng từ gửi đi", "Chứng từ trả về", "Ký chứng từ", "Năm", "Note"];
const COMPANIES = ["GN", "SM", "CLF"];
const PAY_METHODS = ["CK", "TM"];

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

export function InvoicesPage({ me }: { me: Me }) {
  const canEdit = me.permissions.includes("invoice:edit");
  const canPay = me.permissions.includes("invoice:pay");
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [year, setYear] = useState("");
  const [cty, setCty] = useState("");
  // Ngưỡng báo công nợ (ngày) — kế toán tự đặt, nhớ theo máy.
  const [debtLimit, setDebtLimit] = useState(() => { const n = Number(localStorage.getItem("inv_debt_days")); return n > 0 ? n : 30; });
  const setLimit = (v: string) => { const n = Math.max(1, Math.min(999, Number(v) || 0)) || 30; setDebtLimit(n); localStorage.setItem("inv_debt_days", String(n)); };

  const { data, isPending, error } = useQuery({ queryKey: ["quoteProjects"], queryFn: api.quoteProjects });
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { if (data) setRows(buildRows(data.data || [])); }, [data]);
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";
  const load = () => { qc.invalidateQueries({ queryKey: ["quoteProjects"] }); };

  const years = useMemo(() => [...new Set(rows.map((r) => r.invoiceYear || (r.invoiceDate ? new Date(r.invoiceDate).getFullYear() : null)).filter(Boolean))].sort() as number[], [rows]);
  const norm = (s: unknown) => (s == null ? "" : String(s)).toLowerCase();
  const shown = rows.filter((r) => {
    if (year && String(r.invoiceYear || (r.invoiceDate ? new Date(r.invoiceDate).getFullYear() : "")) !== year) return false;
    if (cty && (r.invoiceCompany || defaultCty(r.q)) !== cty) return false;
    if (q && ![r.q.customerName, r.q.customerCode, r.q.title, r.code, r.invoiceDesc, r.invoiceNo, r.poNumber, r.q.createdBy?.displayName].map(norm).join(" ").includes(norm(q))) return false;
    return true;
  });

  const sumAmount = shown.reduce((s, r) => s + r.amount, 0);
  const collected = shown.reduce((s, r) => s + (r.paidAt ? r.amount : 0), 0);
  const overdue = shown.filter((r) => { const d = debtDays(r); return d != null && d > debtLimit; });
  const overdueAmount = overdue.reduce((s, r) => s + r.amount, 0);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const saveField = async (row: Row, field: string, val: string | null) => {
    if (!row.sheetId) return;
    try {
      await api.updateSheetInvoice(row.sheetId, field, val);
      toast("Đã lưu", "success");
      // Đồng bộ cache cho trang Quản lý dự án / Dashboard (tham chiếu cùng nguồn) thấy ngay giá trị mới.
      qc.invalidateQueries({ queryKey: ["quoteProjects"] });
    } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); load(); }
  };

  const editable = (r: Row, field?: string) => (field === "paidAt" ? canPay : canEdit) && !!r.sheetId;
  const textCell = (r: Row, field: keyof Row, ph: string, w = 110) =>
    editable(r, field as string) ? (
      <td><input value={(r[field] as string) || ""} placeholder={ph} style={{ width: w }}
        onChange={(e) => patch(r.key, { [field]: e.target.value } as Partial<Row>)} onBlur={(e) => saveField(r, field as string, e.target.value.trim() || null)} /></td>
    ) : <td>{(r[field] as string) || dash}</td>;
  // Ô ngày CHƯA điền → nền HỒNG (nhắc kế toán còn thiếu), điền xong tự hết.
  const pinkIfEmpty = (v: unknown) => (v ? undefined : { background: "#ffe0ee" });
  const dateCell = (r: Row, field: keyof Row) =>
    editable(r, field as string) ? (
      <td style={pinkIfEmpty(r[field])}><input type="date" value={toInputDate(r[field] as string)} style={{ width: 140, background: "transparent" }}
        onChange={(e) => { patch(r.key, { [field]: e.target.value || null } as Partial<Row>); saveField(r, field as string, e.target.value || null); }} /></td>
    ) : <td style={pinkIfEmpty(r[field])}>{(r[field] as string) ? fmtDate(r[field] as string) : dash}</td>;
  const selectCell = (r: Row, field: keyof Row, options: string[], defVal = "") =>
    editable(r, field as string) ? (
      <td><select value={(r[field] as string) || defVal} style={{ width: 74 }}
        onChange={(e) => { patch(r.key, { [field]: e.target.value || null } as Partial<Row>); saveField(r, field as string, e.target.value || null); }}>
        {!defVal && <option value="">—</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select></td>
    ) : <td>{(r[field] as string) || defVal || dash}</td>;

  const stat = (label: string, val: string, color?: string) => (
    <div className="card-section" style={{ flex: 1, minWidth: 160, padding: "12px 16px" }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 3, color }}>{val}</div>
    </div>
  );

  return (
    <div>
      <h1>Hóa đơn</h1>
      <p className="muted">Theo dõi hóa đơn theo <b>dự án đã chốt</b> (mỗi sheet 1 dòng). Nhập ở đây — trang Quản lý dự án <b>tham chiếu</b> tự động. Tình trạng HĐ tự <b>Done</b> khi có Số HĐơn + Ngày HĐơn. Bấm dòng để mở báo giá.</p>

      <div className="toolbar" style={{ margin: "4px 0 6px" }}>
        <input className="grow" type="search" placeholder="Tìm: khách, mã sản xuất, số HĐ, PO, hạng mục…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm hóa đơn" />
        <select value={cty} onChange={(e) => setCty(e.target.value)} aria-label="Lọc theo công ty"><option value="">CTy: Tất cả</option>{COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Lọc theo năm"><option value="">Năm: Tất cả</option>{years.map((y) => <option key={y} value={String(y)}>{y}</option>)}</select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }} title="Chưa thanh toán quá số ngày này (tính từ Ngày HĐơn) → cột Công nợ báo ĐỎ để đi đòi">
          <span className="muted" style={{ fontSize: 13 }}>Báo nợ quá</span>
          <input inputMode="numeric" value={debtLimit} onChange={(e) => setLimit(e.target.value)} style={{ width: 52, textAlign: "center" }} aria-label="Ngưỡng báo công nợ (ngày)" />
          <span className="muted" style={{ fontSize: 13 }}>ngày</span>
        </label>
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setQ(""); setYear(""); setCty(""); }}>Xóa lọc</button>
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}

      {isPending ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "8px 0 16px" }}>
            {stat("Tổng số tiền (VAT)", fmtMoney(sumAmount))}
            {stat("Đã thu", fmtMoney(collected), "#0a7d28")}
            {stat("Chưa thu", fmtMoney(sumAmount - collected), sumAmount - collected > 0 ? "#c0392b" : undefined)}
            {stat(`Nợ quá ${debtLimit} ngày`, overdue.length ? `${overdue.length} HĐ · ${fmtMoney(overdueAmount)}` : "0", overdue.length ? "#c0392b" : "#0a7d28")}
            {stat("Số hóa đơn", String(shown.length))}
          </div>

          {shown.length === 0 ? (
            <div className="empty">{rows.length ? "Không có hóa đơn khớp bộ lọc." : 'Chưa có dự án nào ở trạng thái "Đã chốt".'}</div>
          ) : (
            <div className="tbl-scroll">
              <table className="list-table inv-table">
                <thead><tr>{HEADERS.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>
                  {shown.map((r) => {
                    const done = !!(r.invoiceNo && r.invoiceDate);   // TỰ ĐỘNG Done khi có Số HĐ + Ngày HĐ
                    const nDays = debtDays(r);                        // null = đã thanh toán / chưa có Ngày HĐơn
                    const over = nDays != null && nDays > debtLimit;  // quá ngưỡng → ĐỎ (đi đòi nợ)
                    return (
                      <tr key={r.key} className="qrow" title="Bấm để mở báo giá" style={{ cursor: "pointer" }}
                          onClick={(e) => { if ((e.target as HTMLElement).closest("button,a,input,select")) return; location.hash = "#/quotes/" + r.q.id; }}>
                        <td title={r.q.title}><strong>{r.q.customerName || r.q.customerCode || shortTitle(r.q.title)}</strong></td>
                        <td>{r.q.customerCode || dash}</td>
                        <td><strong>{r.code}</strong></td>
                        {textCell(r, "invoiceDesc", "Hạng mục…", 210)}
                        <td>{done ? <span className="status approved">Done</span> : <span className="status pending">Chưa đủ</span>}</td>
                        {textCell(r, "poNumber", "PO/HĐ", 90)}
                        {selectCell(r, "invoiceCompany", COMPANIES, defaultCty(r.q))}
                        {textCell(r, "invoiceNo", "Số HĐ", 90)}
                        {dateCell(r, "invoiceDate")}
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtMoney(r.amount)}</td>
                        <td style={over ? { background: "#ffd6d6", color: "#b91c1c", fontWeight: 700, whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}
                            title={over ? `Quá ${debtLimit} ngày chưa thanh toán (từ Ngày HĐơn ${fmtDate(r.invoiceDate)}) — cần đi đòi` : undefined}>
                          {r.paidAt ? <span style={{ color: "#0a7d28" }}>✓ Đã TT</span> : nDays == null ? dash : <>{over ? "⚠ " : ""}{nDays} ngày</>}
                        </td>
                        {selectCell(r, "paymentMethod", PAY_METHODS)}
                        {dateCell(r, "orderClosedAt")}
                        <td>{r.q.createdBy?.displayName || dash}</td>
                        {editable(r)
                          ? <td><input value={r.invoiceLink || ""} placeholder="Link HĐ" style={{ width: 120 }} onChange={(e) => patch(r.key, { invoiceLink: e.target.value })} onBlur={(e) => saveField(r, "invoiceLink", e.target.value.trim() || null)} /></td>
                          : <td>{r.invoiceLink ? <a href={r.invoiceLink} target="_blank" rel="noopener">Xem HĐ</a> : dash}</td>}
                        {dateCell(r, "paidAt")}
                        {dateCell(r, "docSentAt")}
                        {dateCell(r, "docReturnedAt")}
                        <td style={{ whiteSpace: "nowrap" }}>
                          {r.signedAt
                            ? <span className="status approved" style={{ whiteSpace: "nowrap" }}>✓ {r.signedByName || "Đã ký"} · {fmtDate(r.signedAt)}</span>
                            : <span className="muted">Chưa ký</span>}
                        </td>
                        {editable(r)
                          ? <td><input inputMode="numeric" value={r.invoiceYear ?? ""} placeholder="Năm" style={{ width: 64 }} onChange={(e) => patch(r.key, { invoiceYear: e.target.value ? Number(e.target.value) : null })} onBlur={(e) => saveField(r, "invoiceYear", e.target.value.trim() || null)} /></td>
                          : <td>{r.invoiceYear ?? dash}</td>}
                        {textCell(r, "invoiceNote", "Note…", 130)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
