import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me, type ProjectQuote } from "../lib/api";
import { toast } from "../lib/ui";
import { fmtMoney, fmtDate, shortTitle, codeLabel, statusLabel, dash, Stat } from "../lib/format";

// Port "Quản lý dự án" (renderProjects) — bê ĐẦY ĐỦ: báo giá ĐÃ CHỐT, mỗi sheet 1 dòng, bảng 23
// cột theo dõi hóa đơn (Trạng thái: Hóa đơn→Thanh toán→Hoàn tất) + sửa-tại-ô (admin: Số HĐ/Ngày TT/PO/
// chứng từ/link/Số HĐ HN — ĐÈN ĐỎ việc cần làm) + Ký chứng từ + lọc (tìm/Account/Mã KH) + summary
// (tổng/đã-chưa thanh toán) + bấm dòng → mở báo giá (editor). CẢI TIẾN: sửa 1 ô CHỈ cập nhật dòng
// đó (không re-render cả trang như SPA → không mất focus/cuộn).
const INV: Record<string, { l: string; c: string }> = { invoice: { l: "Hóa đơn", c: "pending" }, payment: { l: "Thanh toán", c: "sent" }, done: { l: "Hoàn tất", c: "approved" } };
const HEADERS = ["Trạng thái", "Phim", "Hạng Mục", "Báo Giá", "Chi Phí HCM", "Báo Giá Hà Nội", "Phí Khách Hàng", "Mã Sản Xuất", "Ngày Thi Công", "Số PO/HĐ", "Cty Xuất Hóa Đơn", "Số Hóa Đơn", "Ngày Xuất Hóa Đơn", "Thành Tiền VAT", "Thanh Toán", "Chứng từ gửi đi", "Chứng từ trả về", "Link Hóa Đơn", "Số HĐ HN", "Team client", "Account", "Ký Chứng từ", "Check"];
// Cột tiền → căn phải + tabular-nums (.list-table .num) đồng bộ th lẫn td.
const NUM_COLS = new Set(["Báo Giá", "Chi Phí HCM", "Báo Giá Hà Nội", "Phí Khách Hàng", "Thành Tiền VAT"]);
type Row = {
  key: string; q: ProjectQuote; code: string; hangMuc: string; baoGia: number; thanhTienVAT: number;
  hcm: number; hanoi: number; khach: number; cty: string | null; sheetId: number | null;
  signedAt: string | null; signedByName: string | null; invoiceNo: string | null; paidAt: string | null;
  invStatus: string; poNumber: string | null; hnInvoiceNo: string | null; invoiceLink: string | null;
  docSentAt: string | null; docReturnedAt: string | null; hnStatus: string | null;
  invoiceDate: string | null; invoiceCompany: string | null;   // tham chiếu từ trang Hóa đơn
};

function buildRows(quotes: ProjectQuote[]): Row[] {
  const out: Row[] = [];
  for (const q of quotes) {
    const base = codeLabel(q);
    const sheets = q.sheets && q.sheets.length ? q.sheets : [{ name: null, subtotal: q.subtotal }];
    const multi = sheets.length > 1;
    sheets.forEach((sh, i) => {
      const baoGia = Number(sh.subtotal) || 0;
      const vat = Math.round((baoGia * (Number(q.vatPercent) || 0)) / 100);
      out.push({
        key: `${q.id}-${i}`, q, code: base + (multi ? `_${i + 1}` : ""), hangMuc: sh.name || (multi ? `Sheet ${i + 1}` : ""),
        baoGia, thanhTienVAT: baoGia + vat, hcm: Number(sh.hcm) || 0, hanoi: Number(sh.hanoi) || 0, khach: Number(sh.khach) || 0,
        cty: sh.cty || null, sheetId: sh.id || null, signedAt: sh.signedAt || null, signedByName: sh.signedByName || null,
        invoiceNo: sh.invoiceNo || null, paidAt: sh.paidAt || null, invStatus: sh.invStatus || "invoice", poNumber: sh.poNumber || null,
        hnInvoiceNo: sh.hnInvoiceNo || null, invoiceLink: sh.invoiceLink || null, docSentAt: sh.docSentAt || null,
        docReturnedAt: sh.docReturnedAt || null, hnStatus: q.hnStatus || null,
        invoiceDate: sh.invoiceDate || null, invoiceCompany: sh.invoiceCompany || null,
      });
    });
  }
  return out;
}

export function ProjectsPage({ me }: { me: Me }) {
  const isAdmin = me.permissions.includes("user:manage");
  // Ký chứng từ theo QUYỀN: sign:all (mọi dự án) hoặc sign:own (chỉ dự án mình tạo — server chặn owner).
  const canSignNow = me.permissions.includes("quote:sign:all") || me.permissions.includes("quote:sign:own");
  // (2026-07-06: hết sửa hóa đơn ở trang này — dữ liệu THAM CHIẾU từ trang Hóa đơn; chỉ còn nút Ký.)
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("");
  const [customer, setCustomer] = useState("");

  // Tải qua TanStack Query. CHỈ đổi cơ chế lấy dữ liệu; sửa-tại-ô vẫn cập nhật cục bộ (rows state)
  // để không re-render cả trang / mất focus. Đồng bộ rows từ cache khi data đổi.
  const { data, isPending, error } = useQuery({
    queryKey: ["quoteProjects"],
    queryFn: () => api.quoteProjects(),
  });
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { if (data) setRows(buildRows(data.data || [])); }, [data]);
  const loading = isPending;
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";
  const load = () => { qc.invalidateQueries({ queryKey: ["quoteProjects"] }); };

  const accounts = useMemo(() => [...new Set(rows.map((r) => r.q.createdBy?.displayName).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "vi")), [rows]);
  const customers = useMemo(() => [...new Set(rows.map((r) => r.q.customerCode).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "vi")), [rows]);
  const norm = (s: unknown) => (s == null ? "" : String(s)).toLowerCase();
  const shown = rows.filter((r) => {
    if (account && (r.q.createdBy?.displayName || "") !== account) return false;
    if (customer && (r.q.customerCode || "") !== customer) return false;
    if (q && ![r.q.title, r.code, r.hangMuc, r.q.customerCode, r.q.createdBy?.displayName].map(norm).join(" ").includes(norm(q))) return false;
    return true;
  });

  const sumBaoGia = shown.reduce((s, r) => s + r.baoGia, 0);
  const sumVAT = shown.reduce((s, r) => s + r.thanhTienVAT, 0);
  const paid = shown.reduce((s, r) => s + (r.paidAt ? r.thanhTienVAT : 0), 0);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => r.key === key ? { ...r, ...p } : r));
  const sign = async (row: Row, signed: boolean) => {
    if (!row.sheetId) return;
    try { await api.signSheet(row.sheetId, signed); toast(signed ? "Đã ký chứng từ" : "Đã bỏ ký", "success"); patch(row.key, signed ? { signedAt: new Date().toISOString(), signedByName: me.displayName } : { signedAt: null, signedByName: null }); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); load(); }
  };
  const clear = () => { setQ(""); setAccount(""); setCustomer(""); };

  // 2026-07-06: trang Dự án CHỈ THAM CHIẾU dữ liệu hóa đơn (nhập ở trang HÓA ĐƠN) — mọi ô hóa
  // đơn read-only, giữ nguyên ĐÈN ĐỎ "việc cần làm" (.cell-need, theme-aware). Nút Ký vẫn ở đây.
  const needCls = (need: boolean) => (need ? "cell-need" : undefined);
  const textCell = (r: Row, field: keyof Row, need = false) =>
    <td className={needCls(need)}>{(r[field] as string) || dash}</td>;
  const dateCell = (r: Row, field: keyof Row, need = false) =>
    <td className={needCls(need)}>{(r[field] as string) ? fmtDate(r[field] as string) : dash}</td>;

  return (
    <div>
      <h1>Quản lý dự án</h1>
      <p className="muted">Dự án = báo giá <b>đã chốt</b>. {!isAdmin && <b>Bạn chỉ xem được dự án do mình tạo. </b>}Báo giá nhiều sheet được tách mỗi sheet 1 dòng (Mã Sản Xuất thêm <b>_1, _2…</b>; Hạng Mục = tên sheet). Dữ liệu hóa đơn (Số HĐ, PO, ngày, chứng từ…) là <b>tham chiếu từ trang Hóa đơn</b> — kế toán nhập bên đó. Bấm vào dòng để mở báo giá.</p>

      <div className="toolbar" style={{ margin: "4px 0 6px" }}>
        <input className="grow" type="search" placeholder="Tìm: phim, mã sản xuất, khách hàng, account…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm kiếm dự án" />
        <select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Lọc theo Account"><option value="">Account: Tất cả</option>{accounts.map((a) => <option key={a as string} value={a as string}>{a as string}</option>)}</select>
        <select value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Lọc theo Mã khách hàng"><option value="">Mã KH: Tất cả</option>{customers.map((c) => <option key={c as string} value={c as string}>{c as string}</option>)}</select>
        <button className="btn btn-sm btn-ghost" type="button" onClick={clear} disabled={!q && !account && !customer}>Xóa lọc</button>
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : (
        <>
          <div className="stat-row">
            <Stat label="Tổng báo giá (trước VAT)" value={fmtMoney(sumBaoGia)} />
            <Stat label="Tổng thành tiền VAT" value={fmtMoney(sumVAT)} />
            <Stat label="Đã thanh toán" value={fmtMoney(paid)} tone="ok" />
            <Stat label="Chưa thanh toán" value={fmtMoney(sumVAT - paid)} tone={sumVAT - paid > 0 ? "danger" : undefined} />
          </div>

          {shown.length === 0 ? (
            <div className="empty">{rows.length ? "Không có dự án khớp tìm kiếm/bộ lọc." : 'Chưa có báo giá nào ở trạng thái "Đã chốt".'}</div>
          ) : (
            <div className="tbl-scroll">
              <table className="list-table proj-table">
                <thead><tr>{HEADERS.map((h) => <th key={h} scope="col" className={NUM_COLS.has(h) ? "num" : undefined}>{h}</th>)}</tr></thead>
                <tbody>
                  {shown.map((r) => {
                    const poFilled = !!r.poNumber;
                    const inv = INV[r.invStatus] || INV.invoice;
                    const cty = r.invoiceCompany || r.cty || r.q.company?.shortName || r.q.company?.name || "";
                    const hnNeed = r.hnStatus === "approved" && r.hanoi > 0 && !r.hnInvoiceNo;
                    const open = (e: { target: EventTarget | null }) => { if ((e.target as HTMLElement).closest("button,a,input")) return; location.hash = "#/quotes/" + r.q.id; };
                    return (
                      <tr key={r.key} className="qrow" title="Bấm để mở báo giá" tabIndex={0}
                          onClick={open}
                          onKeyDown={(e) => { if (e.key === "Enter") open(e); }}>
                        <td>{r.q.status === "converted" ? <span className={`status ${inv.c}`}>{inv.l}</span> : <span className={`status ${r.q.status}`}>{statusLabel(r.q.status)}</span>}</td>
                        <td title={r.q.title}><strong>{shortTitle(r.q.title)}</strong></td>
                        <td title={r.hangMuc || undefined}>{r.hangMuc || dash}</td>
                        <td className="num">{fmtMoney(r.baoGia)}</td>
                        <td className="num">{r.hcm ? fmtMoney(r.hcm) : dash}</td>
                        <td className="num">{r.hanoi ? fmtMoney(r.hanoi) : dash}</td>
                        <td className="num">{r.khach ? fmtMoney(r.khach) : dash}</td>
                        <td><strong>{r.code}</strong></td>
                        <td>{r.q.executionDate ? fmtDate(r.q.executionDate) : dash}</td>
                        {textCell(r, "poNumber")}
                        <td>{cty || dash}</td>
                        {textCell(r, "invoiceNo")}
                        {dateCell(r, "invoiceDate")}
                        <td className="num">{fmtMoney(r.thanhTienVAT)}</td>
                        {dateCell(r, "paidAt")}
                        {dateCell(r, "docSentAt", poFilled && !r.docSentAt)}
                        {dateCell(r, "docReturnedAt", poFilled && !r.docReturnedAt)}
                        <td className={needCls(poFilled && !r.invoiceLink)}>{r.invoiceLink ? <a href={r.invoiceLink} target="_blank" rel="noopener">Xem HĐ</a> : dash}</td>
                        {textCell(r, "hnInvoiceNo", hnNeed)}
                        <td>{r.q.customerCode || dash}</td>
                        <td>{r.q.createdBy?.displayName || dash}</td>
                        <td className={needCls(poFilled && !r.signedAt)}>
                          {r.signedAt
                            ? <><span className="status approved nowrap">✓ {r.signedByName || "Đã Ký"} · {fmtDate(r.signedAt)}</span>{canSignNow && r.sheetId && <button className="ky-undo" title="Bỏ ký" aria-label="Bỏ ký" style={{ marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); sign(r, false); }}>✕</button>}</>
                            : (canSignNow && r.sheetId ? <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); sign(r, true); }}>Ký</button> : dash)}
                        </td>
                        <td>{dash}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {shown.length > 0 && (
            <div className="list-foot"><span className="muted">Hiển thị {shown.length} / {rows.length} dòng</span></div>
          )}
        </>
      )}
    </div>
  );
}
