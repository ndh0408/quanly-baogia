import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Me } from "../lib/api";
import { CHUNG_TU, COT_NOI_BO } from "../lib/gridShared";
import * as M from "../lib/quoteMath";
import { extraTableSum } from "../components/ExtraTables";
import { mauBangHn } from "../components/HnTables";
import { codeLabel, errMsg, dash } from "../lib/format";
import { useTrangAnToan } from "../lib/phienBan";
import { useDaChiBaoGia } from "../lib/daChiHang";
import type { DaChiHang } from "../lib/api";
import { OThanhToan } from "../components/OThanhToan";
import { XemChungTu, type LoaiChungTu } from "../components/XemChungTu";

// Màn hình CHỈ XEM BẢNG NỘI BỘ (quyền quote:internal:view) — tài khoản "chi phí": thấy các bảng nội bộ của
// 1 báo giá + trạng thái ĐÃ CHI từng hàng. KHÔNG lộ giá/khách/báo giá chính (server đã lược).
// CHỈ ĐỌC HOÀN TOÀN từ 2026-10-06: tích ĐÃ CHI + ảnh ủy nhiệm chi là việc của kế toán ở trang Hóa đơn đầu vào
// (invoice:input:pay); quote:internal:pay hết tác dụng. Cột "Thanh toán" chỉ còn chữ — đã chi chưa, ngày, ai tích —
// đọc từ GET /quotes/:id/khoan-chi (lib/daChiHang, cùng nguồn với màn soạn; chưa nạp được thì LỚP PHỦ trên hàng) —
// không mở được ảnh, không thấy Ngày HĐ / ghi chú kế toán.

const catLabel = (c: string) => ({ hcm: "Chi Phí HCM", hanoi: "Báo Giá Hà Nội", khach: "Phí Khách Hàng" } as Record<string, string>)[c] || c;
const isRow = (it: any) => it && !["section", "subsection", "info"].includes(it.kind);
// `coNgay` (đợt 4, L64): chỉ nhân Số Ngày khi mẫu của bảng CÓ cột đó — như màn soạn và tổng máy chủ
// (quoteUtils.extraTableSum + bangNoiBoCoNgay). Bảng mẫu không ngày mà CSDL còn days cũ từng hiện ở đây
// gấp days lần con số trên màn soạn.
const rowTotal = (it: any, coNgay: boolean) => {
  const qty = M.qtyForAmount(it), price = Number(it.unitPrice) || 0, days = coNgay && it.days != null ? Number(it.days) : null;
  return Math.round(days && days > 0 ? qty * days * price : qty * price);
};

// Ba cột NS · CHỨNG TỪ · LƯU KHO của bảng nội bộ (4e24308) — màn này là nơi tài khoản chi phí ĐỐI CHIẾU
// chi phí, mà chứng từ (VAT / HĐNS / TM) và lưu kho chính là thứ cần để đối chiếu. Máy chủ đã gửi đủ ba
// trường (presentQuoteForInternal chỉ lược ảnh chứng từ) nên chỉ việc vẽ. CHỈ ĐỌC: sửa là việc của người
// soạn trên lưới — quyền quote:internal:view không mở thêm đường ghi nào.
const nhanChungTu = (v: unknown) => CHUNG_TU.find(([ma]) => ma === v)?.[1] ?? null;
const SO_COT = 5 + COT_NOI_BO.length;

// `me` vẫn trong kiểu vì Shell truyền vào — màn chỉ đọc nên không còn quyền nào phải kiểm ở đây.
export function InternalQuoteView({ quoteId }: { quoteId: number; me: Me }) {
  useTrangAnToan();   // chỉ xem/lọc — tải lại lúc này không mất gì (dải "Có bản mới", lib/phienBan.ts)
  const { data, isPending, error, refetch } = useQuery({ queryKey: ["quote-internal", quoteId], queryFn: () => api.getQuote(quoteId) });
  // Danh sách mẫu — để biết bảng nào CÓ cột Số Ngày (luật chọn mẫu của HnTables / ExtraTables). Chưa có
  // thì chưa vẽ số: vẽ tạm kiểu "nhân days bất kể mẫu" là nháy một con số tiền sai.
  const mau = useQuery({ queryKey: ["meta-templates"], queryFn: () => api.metaTemplates(), staleTime: 5 * 60_000 });
  const daChi = useDaChiBaoGia(quoteId);
  // 📎 / 🧾 ở cột Thanh toán → hộp xem chứng từ HIỆN TẠI (chỉ xem; máy chủ kiểm quyền xem hàng + ghi nhật ký).
  const [xemCt, setXemCt] = useState<{ hn: boolean; rid: string; loai: LoaiChungTu; ten: string } | null>(null);
  const dongXemCt = useCallback(() => setXemCt(null), []);

  if (isPending || mau.isPending) return <div className="skeleton-wrap">{Array.from({ length: 4 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>;
  if (error || !data || mau.error) return <div className="err">⚠ {errMsg(error || mau.error, "Không tải được.")} <button className="btn btn-sm" onClick={() => { void refetch(); void mau.refetch(); }}>Thử lại</button></div>;
  const q = data as Record<string, any>;
  const coNgay = (t: any) => !!mauBangHn(t, mau.data || [], q.companyId)?.layout?.hasDays;
  // internalSheets = bản server đã lược (tài khoản chi phí thật). Khi XEM THỬ (admin), data đầy đủ → lấy từ sheets.extraTables.
  const sheets: any[] = q.internalSheets || (q.sheets || []).map((s: any) => ({ sheetId: s.id, sheetName: s.name || null, order: s.order, tables: Array.isArray(s.extraTables) ? s.extraTables : [] }));
  // Bảng HÀ NỘI ở CẤP BÁO GIÁ — không thuộc trang nào. Thiếu dòng này thì tài khoản chi phí mất sạch
  // hàng HN (cùng trạng thái đã chi của chúng) khỏi màn. Số đếm ở danh sách (presentQuoteRow nhánh
  // internalOnly) thì VẪN cộng cả hàng HN, nên bỏ sót ở đây là hai con số trên hai màn đá nhau.
  const bangHn: any[] = (Array.isArray(q.hnTables) ? q.hnTables : []).map((t: any) => ({ ...t, category: "hanoi" }));
  const daChiCua = (it: any, hn: boolean): DaChiHang | null => {
    if (daChi) { const rid = typeof it.rid === "string" ? it.rid.trim() : ""; return rid ? (hn ? daChi.hn : daChi.sheet).get(rid) ?? null : null; }
    return it.paid === true ? { rid: "", paidAt: it.paidAt ?? null, paidByName: null, coAnh: it.hasPaidProof === true, paid: true } : null;
  };
  const tables = [
    ...sheets.flatMap((s) => (s.tables || []).map((t: any) => ({ s, t }))),
    ...bangHn.map((t) => ({ s: { sheetId: null, sheetName: null, hn: true }, t })),
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <h1>Bảng nội bộ — {codeLabel(q)} {q.title ? `· ${q.title}` : ""}</h1>
        <button type="button" className="btn" onClick={() => { location.hash = "#/list"; }}>← Quay lại</button>
      </div>
      <p className="muted page-sub">Chỉ xem bảng nội bộ và trạng thái đã chi từng hàng — việc tích ĐÃ CHI + ảnh chứng từ nay ở trang Hóa đơn đầu vào của kế toán. Không thấy báo giá/giá/khách hàng.</p>
      {tables.length === 0 ? (
        <div className="empty">Báo giá này chưa có bảng nội bộ.</div>
      ) : tables.map(({ s, t }, ti) => {
        const rows = (t.items || []).filter(isRow);
        const ngay = coNgay(t);
        return (
          <div key={`${s.hn ? "hn" : s.sheetId}-${ti}`} className="list-wrap" style={{ marginBottom: 18 }}>
            <h3 style={{ margin: "4px 0 8px" }}><span className={`extra-cat-badge cat-${t.category}`}>{catLabel(t.category)}</span>{t.name ? ` — ${t.name}` : ""} {s.sheetName ? <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({s.sheetName})</span> : null}</h3>
            <table className="list-table">
              <thead><tr><th scope="col">Hạng mục</th><th scope="col" className="num" style={{ width: 80 }}>SL</th><th scope="col" className="num" style={{ width: 120 }}>Đơn giá</th><th scope="col" className="num" style={{ width: 130 }}>Thành tiền</th>{COT_NOI_BO.map((nhan) => <th scope="col" key={nhan}>{nhan}</th>)}<th scope="col" style={{ width: 150 }}>Thanh toán</th></tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={SO_COT} className="muted" style={{ textAlign: "center", padding: 14 }}>(không có hàng)</td></tr>
                  : rows.map((it: any, ri: number) => { const tt = daChiCua(it, !!s.hn); return (
                    <tr key={it.rid || ri}>
                      <td>{it.name || dash}</td>
                      <td className="num">{M.fmtNumCell(it.quantity, !!it.quantityExact)}</td>
                      <td className="num">{M.fmtMoney(Number(it.unitPrice) || 0)}</td>
                      <td className="num">{M.fmtMoney(rowTotal(it, ngay))}</td>
                      <td className="col-ns" style={{ whiteSpace: "pre-line", minWidth: 120 }}>{typeof it.ns === "string" && it.ns.trim() ? it.ns : dash}</td>
                      <td className="col-chung-tu">{nhanChungTu(it.chungTu) ?? dash}</td>
                      <td className="col-luu-kho">{it.luuKho ? <span role="img" aria-label="Có lưu kho" title="Có lưu kho">✓</span> : dash}</td>
                      <td className="col-pay">
                        <OThanhToan h={tt} chungTu={it.chungTu}
                          onBam={daChi && tt?.xemChungTu && typeof it.rid === "string" && it.rid.trim()
                            ? (e) => setXemCt({ hn: !!s.hn, rid: it.rid.trim(), loai: e.currentTarget.getAttribute("data-loai") === "vat" ? "vat" : "chi", ten: String(it.name ?? "") })
                            : undefined} />
                      </td>
                    </tr>
                  ); })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ textAlign: "right", fontWeight: 600 }}>Tổng</td>
                    <td className="num" style={{ fontWeight: 600 }}>{M.fmtMoney(extraTableSum(t, ngay))}</td>
                    <td colSpan={SO_COT - 4} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        );
      })}
      {xemCt && <XemChungTu quoteId={quoteId} side={xemCt.hn ? "hn" : "sheet"} rid={xemCt.rid} loai={xemCt.loai} tenHang={xemCt.ten}
                            hinhThuc={(xemCt.hn ? daChi?.hn : daChi?.sheet)?.get(xemCt.rid)?.paidMethod} onDong={dongXemCt} />}
    </div>
  );
}
