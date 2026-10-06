import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me, type InputInvoiceRow } from "../lib/api";
import { fmtMoney, fmtDate, toInputDate, statusLabel, dash, Stat } from "../lib/format";
import { smartTextMatch } from "../lib/filterText";
import { CHUNG_TU } from "../lib/gridShared";
import { useTrangAnToan } from "../lib/phienBan";

// Trang HÓA ĐƠN ĐẦU VÀO (kế toán) — chủ repo 2026-09-30: "trang của những cái nào đã duyệt ở phần nội bộ".
// Mỗi HÀNG bảng nội bộ của báo giá (Chi phí HCM · Phí khách hàng · Báo giá Hà Nội) mà người có quyền duyệt đã
// DUYỆT là một khoản chi — và là một hoá đơn đầu vào kế toán phải đòi/đối chiếu. Hàng chưa duyệt không cộng vào
// tổng báo giá nên không xuất hiện ở đây. Đối xứng với trang Hóa đơn ĐẦU RA (Invoices.tsx: hoá đơn xuất cho khách).
//
// CHỈ XEM: duyệt / bỏ duyệt / đổi chứng từ là việc ở màn soạn báo giá (người có quote:internal:approve và người
// soạn). Trang này đọc cùng dữ liệu đó nên không có nguồn thứ hai để lệch. Luật chọn hàng + tính tiền nằm ở máy
// chủ (src/inputInvoices.ts) — trang này không tự cộng lại tiền.

const LOAI_BANG: Record<string, string> = { hcm: "Chi phí HCM", hanoi: "Báo giá Hà Nội", khach: "Phí khách hàng" };
const NHAN_CHUNG_TU: Record<string, string> = Object.fromEntries(CHUNG_TU);
const TRANG_THAI_BAO_GIA: Record<string, string> = { converted: "Đã chốt", draft: "Nháp", lost: "Không chốt" };
const CO_TRANG = 100;   // số dòng mỗi trang (phân trang phía trình duyệt — máy chủ trả hết một lượt, như trang Hóa đơn đầu ra)

export type BoLoc = { q: string; loai: string; chungTu: string; thanhToan: string; trangThai: string; tu: string; den: string };
export const BO_LOC_RONG: BoLoc = { q: "", loai: "", chungTu: "", thanhToan: "", trangThai: "", tu: "", den: "" };

/** Lọc phía trình duyệt. Thuần (xuất ra để test): mỗi nhóm độc lập nên kết hợp tự do, vd HCM + VAT + Chưa thanh toán. */
export function locHang(rows: InputInvoiceRow[], b: BoLoc): InputInvoiceRow[] {
  return rows.filter((r) => {
    if (b.loai && r.category !== b.loai) return false;
    if (b.chungTu === "none" ? r.chungTu != null : b.chungTu && r.chungTu !== b.chungTu) return false;
    if (b.thanhToan === "paid" && !r.paid) return false;
    if (b.thanhToan === "unpaid" && r.paid) return false;
    if (b.trangThai === "other" ? r.status in TRANG_THAI_BAO_GIA : b.trangThai && r.status !== b.trangThai) return false;
    // Khoảng NGÀY DUYỆT: hàng không có ngày duyệt (dữ liệu cũ) không thể nằm trong một khoảng ngày đã chọn.
    if (b.tu || b.den) {
      const ngay = toInputDate(r.approvedAt);
      if (!ngay || (b.tu && ngay < b.tu) || (b.den && ngay > b.den)) return false;
    }
    return smartTextMatch(b.q, [
      r.quoteCode, r.title, r.customerName, r.customerCode, r.sheetCode, r.sheetName, r.tableName, LOAI_BANG[r.category],
      r.name, r.detail, r.ns, r.chungTu ? NHAN_CHUNG_TU[r.chungTu] : "", r.approvedByName, r.createdByName, r.companyName,
      r.amount, fmtMoney(r.amount), fmtDate(r.approvedAt), TRANG_THAI_BAO_GIA[r.status] ?? statusLabel(r.status),
      r.paid ? "đã thanh toán" : "chưa thanh toán",
    ]);
  });
}

type SortKey = "approvedAt" | "amount";
const SORT_COLS: Record<string, SortKey> = { "Ngày duyệt": "approvedAt", "Thành tiền": "amount" };
const HEADERS = ["Mã dự án", "Khách hàng", "Loại bảng", "Hạng mục", "NS", "SL", "Đơn giá", "Thành tiền", "Chứng từ", "Lưu kho", "Ngày duyệt", "Người duyệt", "Thanh toán"];
const NUM_COLS = new Set(["SL", "Đơn giá", "Thành tiền"]);
const KHONG_HANG: InputInvoiceRow[] = [];
const fmtSL = (n: number) => Number(n).toLocaleString("vi-VN", { maximumFractionDigits: 4 });

export function InvoicesInPage({ me }: { me: Me }) {
  useTrangAnToan();   // chỉ xem/lọc — tải lại không mất gì (dải "Có bản mới", lib/phienBan.ts)
  const qc = useQueryClient();
  // Mở được báo giá chỉ khi có quyền đọc báo giá: kế toán thường KHÔNG có (server 403) — đừng mời họ bấm vào ngõ cụt.
  const moDuoc = me.permissions.includes("quote:read:own") || me.permissions.includes("quote:read:all");
  const { data, isPending, error } = useQuery({ queryKey: ["inputInvoices"], queryFn: api.inputInvoices });
  const [b, setB] = useState<BoLoc>(BO_LOC_RONG);
  const dat = (p: Partial<BoLoc>) => setB((x) => ({ ...x, ...p }));
  const rows = data?.data ?? KHONG_HANG;   // mảng cố định: `?? []` đẻ mảng MỚI mỗi lượt vẽ → useMemo bên dưới tính lại mỗi lần
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";

  const shown = useMemo(() => locHang(rows, b), [rows, b]);
  const soBoLoc = Object.values(b).filter(Boolean).length;

  const [sortKey, setSortKey] = useState<SortKey | "">("");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const toggleSort = (k: SortKey) => { if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(1); } };
  const sorted = useMemo(() => {
    if (!sortKey) return shown;
    const val = (r: InputInvoiceRow) => (sortKey === "amount" ? r.amount : r.approvedAt ? Date.parse(r.approvedAt) : null);
    return [...shown].sort((x, y) => {
      const a = val(x), c = val(y);
      if (a == null && c == null) return 0;
      if (a == null) return 1;        // ô trống luôn xuống cuối
      if (c == null) return -1;
      return (a - c) * sortDir;
    });
  }, [shown, sortKey, sortDir]);

  // Phân trang: đổi bộ lọc / sắp xếp thì về trang 1 — giữ số trang cũ là nhìn vào một trang trống.
  const [trang, setTrang] = useState(1);
  const soTrang = Math.max(1, Math.ceil(sorted.length / CO_TRANG));
  useEffect(() => { setTrang(1); }, [b, sortKey, sortDir]);
  const trangNay = Math.min(trang, soTrang);
  const hien = sorted.slice((trangNay - 1) * CO_TRANG, trangNay * CO_TRANG);

  const tong = shown.reduce((s, r) => s + r.amount, 0);
  const daTT = shown.reduce((s, r) => s + (r.paid ? r.amount : 0), 0);
  const coVat = shown.reduce((s, r) => s + (r.chungTu === "VAT" ? r.amount : 0), 0);
  const moQuote = (id: number) => { location.hash = "#/quotes/" + id; };

  return (
    <div>
      <h1>Hóa đơn đầu vào</h1>
      <p className="muted">Các <b>hàng đã duyệt</b> ở bảng nội bộ của báo giá (Chi phí HCM · Phí khách hàng · Báo giá Hà Nội) — mỗi hàng là một khoản chi cần <b>hóa đơn đầu vào</b>. Hàng chưa duyệt không nằm ở đây. Trang chỉ <b>xem</b>: duyệt / bỏ duyệt và đổi chứng từ làm ở màn soạn báo giá.{moDuoc && " Bấm dòng để mở báo giá."}</p>

      <div className="inv-filters">
        <div className="toolbar inv-filter-row inv-filter-main">
          <input className="grow" type="search" placeholder="Tìm không dấu: dự án, khách, hạng mục, NS, số tiền, người duyệt…" value={b.q} onChange={(e) => dat({ q: e.target.value })} aria-label="Tìm hóa đơn đầu vào" />
          <select value={b.loai} onChange={(e) => dat({ loai: e.target.value })} aria-label="Lọc theo loại bảng">
            <option value="">Loại bảng: Tất cả</option>
            {Object.entries(LOAI_BANG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={b.chungTu} onChange={(e) => dat({ chungTu: e.target.value })} aria-label="Lọc theo chứng từ">
            <option value="">Chứng từ: Tất cả</option>
            {CHUNG_TU.map(([ma, nhan]) => <option key={ma} value={ma}>{nhan}</option>)}
            <option value="none">Chưa chọn chứng từ</option>
          </select>
          <select value={b.thanhToan} onChange={(e) => dat({ thanhToan: e.target.value })} aria-label="Lọc theo thanh toán">
            <option value="">Thanh toán: Tất cả</option><option value="paid">Đã thanh toán</option><option value="unpaid">Chưa thanh toán</option>
          </select>
        </div>
        <div className="toolbar inv-filter-row inv-filter-extra">
          <select value={b.trangThai} onChange={(e) => dat({ trangThai: e.target.value })} aria-label="Lọc theo trạng thái báo giá">
            <option value="">Báo giá: Tất cả</option><option value="converted">Đã chốt</option><option value="draft">Nháp</option><option value="lost">Không chốt</option><option value="other">Khác</option>
          </select>
          <label className="inv-date-filter"><span>Duyệt từ ngày</span><input type="date" value={b.tu} max={b.den || undefined} onChange={(e) => dat({ tu: e.target.value })} /></label>
          <label className="inv-date-filter"><span>Đến ngày</span><input type="date" value={b.den} min={b.tu || undefined} onChange={(e) => dat({ den: e.target.value })} /></label>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" type="button" disabled={!soBoLoc} onClick={() => setB(BO_LOC_RONG)}>Xóa tất cả{soBoLoc ? <span className="inv-filter-count">{soBoLoc}</span> : null}</button>
        </div>
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => qc.invalidateQueries({ queryKey: ["inputInvoices"] })}>Thử lại</button></div>}
      {data?.meta.truncated && <div className="inv-in-warn" role="status">⚠ Chỉ hiện các khoản của báo giá mới nhất (đã chạm trần số báo giá một lượt) — còn khoản của báo giá cũ hơn chưa hiển thị.</div>}

      {isPending ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : err && !data ? null : (   /* lỗi tải mà CHƯA có dữ liệu → chỉ hiện banner lỗi, không hiện stat 0 gây hiểu nhầm */
        <>
          <div className="stat-row">
            <Stat label="Tổng tiền đã duyệt" value={fmtMoney(tong)} />
            <Stat label="Đã thanh toán" value={fmtMoney(daTT)} tone="ok" active={b.thanhToan === "paid"} onClick={() => dat({ thanhToan: b.thanhToan === "paid" ? "" : "paid" })} title="Bấm để lọc khoản đã thanh toán" />
            <Stat label="Chưa thanh toán" value={fmtMoney(tong - daTT)} active={b.thanhToan === "unpaid"} onClick={() => dat({ thanhToan: b.thanhToan === "unpaid" ? "" : "unpaid" })} title="Bấm để lọc khoản chưa thanh toán" />
            <Stat label="Có chứng từ VAT" value={fmtMoney(coVat)} active={b.chungTu === "VAT"} onClick={() => dat({ chungTu: b.chungTu === "VAT" ? "" : "VAT" })} title="Bấm để lọc khoản có chứng từ VAT" />
            <Stat label="Số khoản" value={String(shown.length)} />
          </div>

          {shown.length === 0 ? (
            <div className="empty">{rows.length ? <>Không có khoản nào khớp bộ lọc.{soBoLoc > 0 && <div style={{ marginTop: 10 }}><button className="btn btn-sm" onClick={() => setB(BO_LOC_RONG)}>Xóa tất cả bộ lọc</button></div>}</> : "Chưa có hàng nào được duyệt ở bảng nội bộ."}</div>
          ) : (
            <>
              <div className="list-wrap">
                <table className="list-table inv-in-table">
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
                    {hien.map((r) => (
                      <tr key={r.key} className={moDuoc ? "qrow" : undefined} title={moDuoc ? "Bấm để mở báo giá" : undefined}
                          onClick={moDuoc ? (e) => { if ((e.target as HTMLElement).closest("button,a,input,select")) return; moQuote(r.quoteId); } : undefined}>
                        <td title={r.title}><strong>{r.sheetCode || r.quoteCode}</strong><div className="inv-in-sub">{r.sheetName || dash}</div></td>
                        <td>{r.customerName || r.customerCode || dash}{r.customerName && r.customerCode ? <div className="inv-in-sub">{r.customerCode}</div> : null}</td>
                        <td><span className={`extra-cat-badge cat-${r.category}`}>{LOAI_BANG[r.category] ?? r.category}</span></td>
                        <td title={r.detail ?? undefined}>
                          <div>{r.name || dash}</div>
                          {(r.tableName || r.detail) && <div className="inv-in-sub">{[r.tableName, r.detail].filter(Boolean).join(" · ")}</div>}
                        </td>
                        <td className="inv-in-ns">{r.ns || dash}</td>
                        <td className="num nowrap">{fmtSL(r.quantity)}{r.days != null && r.days > 0 ? <div className="inv-in-sub">× {fmtSL(r.days)} ngày</div> : null}</td>
                        <td className="num nowrap">{fmtMoney(r.unitPrice)}</td>
                        <td className="num nowrap"><strong>{fmtMoney(r.amount)}</strong></td>
                        <td>{r.chungTu ? <span className={`status ${r.chungTu === "VAT" ? "approved" : "pending"}`}>{NHAN_CHUNG_TU[r.chungTu]}</span> : dash}</td>
                        <td>{r.luuKho ? <span role="img" aria-label="Có lưu kho" title="Có lưu kho">✓</span> : dash}</td>
                        <td className="nowrap">{fmtDate(r.approvedAt) || dash}</td>
                        <td className="nowrap">{r.approvedByName || dash}</td>
                        <td className="nowrap">{r.paid ? <span className="txt-ok">✓ Đã TT{r.paidAt ? ` · ${fmtDate(r.paidAt)}` : ""}</span> : <span className="muted">Chưa</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="list-foot">
                <span className="muted">Hiển thị {(trangNay - 1) * CO_TRANG + 1}–{(trangNay - 1) * CO_TRANG + hien.length} / {shown.length} khoản{shown.length !== rows.length ? ` (lọc từ ${rows.length})` : ""}</span>
                {soTrang > 1 && (
                  <div className="pager">
                    <button className="btn btn-sm" disabled={trangNay <= 1} onClick={() => setTrang(trangNay - 1)}>← Trước</button>
                    <span className="muted">Trang {trangNay}/{soTrang}</span>
                    <button className="btn btn-sm" disabled={trangNay >= soTrang} onClick={() => setTrang(trangNay + 1)}>Sau →</button>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
