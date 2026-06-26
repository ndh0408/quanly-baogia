import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Me } from "./api";
import type { ItemK } from "./gridShared";
import * as M from "./quoteMath";
import { ExtraPayDialog } from "./ExtraTables";

// Màn hình CHỈ XEM BẢNG NỘI BỘ (quyền quote:internal:view) — tài khoản "chi phí": thấy các bảng nội bộ của
// 1 báo giá + đánh dấu THANH TOÁN từng hàng (+ ảnh). KHÔNG lộ giá/khách/báo giá chính (server đã lược).

const catLabel = (c: string) => ({ hcm: "Chi Phí HCM", hanoi: "Báo Giá Hà Nội", khach: "Phí Khách Hàng" } as Record<string, string>)[c] || c;
const isRow = (it: any) => it && !["section", "subsection", "info"].includes(it.kind);
const rowTotal = (it: any) => {
  const qty = M.trunc2(it.quantity || 0), price = Number(it.unitPrice) || 0, days = it.days != null ? Number(it.days) : null;
  return Math.round(days && days > 0 ? qty * days * price : qty * price);
};

type PayTarget = { sheetId: number; item: Record<string, unknown> } | null;

export function InternalQuoteView({ quoteId, me }: { quoteId: number; me: Me }) {
  const { data, isPending, error, refetch } = useQuery({ queryKey: ["quote-internal", quoteId], queryFn: () => api.getQuote(quoteId) });
  const canPay = me.permissions.includes("quote:internal:pay");
  const [pay, setPay] = useState<PayTarget>(null);

  if (isPending) return <div className="skeleton-wrap">{Array.from({ length: 4 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>;
  if (error || !data) return <div className="err">⚠ Không tải được. <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>;
  const q = data as Record<string, any>;
  // internalSheets = bản server đã lược (tài khoản chi phí thật). Khi XEM THỬ (admin), data đầy đủ → lấy từ sheets.extraTables.
  const sheets: any[] = q.internalSheets || (q.sheets || []).map((s: any) => ({ sheetId: s.id, sheetName: s.name || null, order: s.order, tables: Array.isArray(s.extraTables) ? s.extraTables : [] }));
  const tables = sheets.flatMap((s) => (s.tables || []).map((t: any) => ({ s, t })));

  return (
    <div>
      <h1>Bảng nội bộ — {q.projectCode || q.quoteNumber} {q.title ? `· ${q.title}` : ""}</h1>
      <p className="muted" style={{ margin: "-8px 0 16px" }}>Chỉ xem bảng nội bộ + đánh dấu thanh toán từng hàng. Không thấy báo giá/giá/khách hàng.</p>
      {tables.length === 0 ? (
        <div className="empty">Báo giá này chưa có bảng nội bộ.</div>
      ) : tables.map(({ s, t }, ti) => {
        const rows = (t.items || []).filter(isRow);
        return (
          <div key={`${s.sheetId}-${ti}`} className="list-wrap" style={{ marginBottom: 18 }}>
            <h3 style={{ margin: "4px 0 8px" }}><span className={`extra-cat-badge cat-${t.category}`}>{catLabel(t.category)}</span>{t.name ? ` — ${t.name}` : ""} {s.sheetName ? <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({s.sheetName})</span> : null}</h3>
            <table className="list-table">
              <thead><tr><th>Hạng mục</th><th style={{ width: 80, textAlign: "right" }}>SL</th><th style={{ width: 120, textAlign: "right" }}>Đơn giá</th><th style={{ width: 130, textAlign: "right" }}>Thành tiền</th><th style={{ width: 150 }}>Thanh toán</th></tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 14 }}>(không có hàng)</td></tr>
                  : rows.map((it: any, ri: number) => (
                    <tr key={it.rid || ri}>
                      <td>{it.name || "—"}</td>
                      <td style={{ textAlign: "right" }}>{it.quantity ?? ""}</td>
                      <td style={{ textAlign: "right" }}>{M.fmtMoney(Number(it.unitPrice) || 0)}</td>
                      <td style={{ textAlign: "right" }}>{M.fmtMoney(rowTotal(it))}</td>
                      <td className="col-pay">
                        {canPay
                          ? <button type="button" className={`btn btn-xs ${it.paid ? "btn-success" : ""}`} onClick={() => setPay({ sheetId: s.sheetId, item: it })}>{it.paid ? "✓ Đã TT" : "Thanh toán"}</button>
                          : (it.paid ? <span className="ap-date">✓ Đã TT</span> : <span className="muted">—</span>)}
                        {it.hasPaidProof ? <span title="Có ảnh chứng từ"> 📎</span> : null}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {pay && (
        <ExtraPayDialog quoteId={quoteId} sheetId={pay.sheetId} item={pay.item as unknown as ItemK}
          onClose={() => setPay(null)}
          onSaved={(paid, hasProof) => { pay.item.paid = paid; pay.item.paidAt = paid ? new Date().toISOString() : null; pay.item.hasPaidProof = hasProof; setPay(null); refetch(); }} />
      )}
    </div>
  );
}
