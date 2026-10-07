import { useEffect, useRef, useState } from "react";
import { api, ApiError, type ProjectQuote, type ProjectSheet } from "../lib/api";
import { toast, useEscClose, confirmModal } from "../lib/ui";
import { fmtMoney, fmtDate, trangKhachTuChoi } from "../lib/format";
import { daChia, luaChonBanDau, nhomHoaDon, soHoaDonToiDa, thanhPhepChia, type GanSheet } from "../lib/hoaDonChia";

// HỘP "CHIA HÓA ĐƠN" — màn báo giá, SAU KHI khách chốt (chủ repo 2026-10-07: "không nó phải nằm ở chỗ duyệt cơ", "ở trong
// phần báo giá luôn á", "account chủ báo giá là người làm cái đó"). Lúc chốt thì chọn ngay trong hộp "✓ Khách chốt cả báo
// giá" (lib/ui modalChotBaoGia) — CÙNG luật xem trước (lib/hoaDonChia), không có bản thứ hai.
// Chủ báo giá / admin gán từng sheet vào Hóa đơn 1, 2… (gom nhiều sheet vào một hóa đơn), Để sau, hoặc Không xuất; xem
// trước mã _01/_02 + Trước VAT / Sau VAT từng hóa đơn. Hóa đơn ĐÃ XUẤT (có số HĐ) khoá ô chọn, kèm nút "Làm lại hóa đơn
// này" (POST /quotes/:id/invoice-redo: gỡ số / ngày / link HĐ khỏi mọi sheet của hóa đơn, GIỮ tiền đã thu, có nhật ký).
// Máy chủ (PUT /quotes/:id/invoice-split) vẫn là chốt chặn: hóa đơn đã xuất đứng yên, không gom sheet đã thu với chưa thu.

const daXuat = (sh: { invoiceNo?: string | null }) => !!String(sh.invoiceNo ?? "").trim();

export function HopChiaHoaDon({ q, onClose, onSaved, onDaLamLai }: {
  q: ProjectQuote;
  onClose: () => void;
  /** Phép chia máy chủ vừa lưu — người gọi vá vào bản đang mở (invoiceGroup / invoiceHold từng sheet). */
  onSaved: (sheets: GanSheet[]) => void;
  /** Hóa đơn vừa làm lại — các sheet này đã hết số / ngày / link HĐ (báo giá có thể hết khoá sửa). */
  onDaLamLai?: (sheetIds: number[]) => void;
}) {
  // Bản sao CỤC BỘ: làm lại hóa đơn xong thì ô của sheet đó mở ra ngay, không cần đóng hộp.
  const [ds, setDs] = useState<ProjectSheet[]>(() => q.sheets || []);
  const bg: ProjectQuote = { ...q, sheets: ds };
  const chiaSan = daChia(ds);
  const [chon, setChon] = useState<Record<number, string>>(() => luaChonBanDau(q));
  const [dangLuu, setDangLuu] = useState(false);
  const hopRef = useRef<HTMLDivElement>(null);
  useEscClose(onClose, !dangLuu);
  useEffect(() => { hopRef.current?.querySelector<HTMLElement>("select:not([disabled])")?.focus(); }, []);

  const toiDa = soHoaDonToiDa(ds, chon);
  const xemTruoc = nhomHoaDon(bg, chon);
  // Hóa đơn ĐANG LƯU (không theo lựa chọn chưa lưu) — nút "Làm lại" thuộc về hóa đơn đã xuất thật.
  const daLuu = nhomHoaDon(bg).hoaDon;
  const tenSheet = (i: number) => ds[i]?.name || `Sheet ${i + 1}`;

  const luu = async (boChia: boolean) => {
    if (dangLuu) return;
    const than = boChia
      ? ds.filter((sh) => sh.id != null).map((sh) => ({ sheetId: sh.id!, group: null, hold: null }))
      : thanhPhepChia(ds, chon);
    if (!than) { toast("Không có gì thay đổi — mỗi sheet vẫn một hóa đơn như cũ", "info"); onClose(); return; }
    setDangLuu(true);
    try {
      const kq = await api.chiaHoaDon(q.id, than);
      toast(than.every((x) => x.group == null && x.hold == null) ? "Đã để mỗi sheet một hóa đơn" : "Đã chia hóa đơn", "success");
      onSaved(kq.sheets as GanSheet[]);
      onClose();
    } catch (ex) {
      toast(ex instanceof ApiError ? ex.message : "Lỗi", "error");
      setDangLuu(false);
    }
  };

  const lamLai = async (hd: (typeof daLuu)[number]) => {
    const dau = hd.sheets[0].sh;
    if (dangLuu || dau.id == null) return;
    const daThu = hd.sheets.filter((x) => !!x.sh.paidAt);
    const ok = await confirmModal(
      `Làm lại hóa đơn ${hd.code}?`,
      `Gỡ số HĐ ${dau.invoiceNo}${dau.invoiceDate ? `, Ngày HĐ ${fmtDate(dau.invoiceDate)}` : ""}${dau.invoiceLink ? ", Link HĐ" : ""} khỏi ${hd.sheets.length > 1 ? `${hd.sheets.length} sheet (${hd.sheets.map((x) => tenSheet(x.i)).join(", ")})` : `sheet ${tenSheet(hd.sheets[0].i)}`}. Sau đó chọn lại sheet ở hộp này; kế toán nhập số HĐ mới.`
        + (daThu.length ? ` Đã thu ${fmtMoney(hd.amount)} ngày ${fmtDate(daThu[0].sh.paidAt)} — GIỮ NGUYÊN, không gỡ.` : ""),
      { danger: true, confirmText: "Gỡ số HĐ" },
    );
    if (!ok) return;
    setDangLuu(true);
    try {
      const kq = await api.lamLaiHoaDon(q.id, dau.id);
      setDs((cu) => cu.map((sh) => (sh.id != null && kq.sheetIds.includes(sh.id) ? { ...sh, invoiceNo: null, invoiceDate: null, invoiceLink: null } : sh)));
      onDaLamLai?.(kq.sheetIds);
      toast(`Đã gỡ số HĐ ${kq.invoiceNo.join(", ")} — chọn lại sheet rồi bấm Lưu`, "success");
    } catch (ex) {
      toast(ex instanceof ApiError ? ex.message : "Lỗi", "error");
    } finally {
      setDangLuu(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !dangLuu) onClose(); }}>
      <div ref={hopRef} className="modal modal-sm inv-chia-hop" role="dialog" aria-modal="true" aria-label={`Chia hóa đơn — ${q.quoteNumber || q.title}`}>
        <div className="modal-head">
          <h3>Chia hóa đơn</h3>
          <button type="button" className="x" onClick={onClose} aria-label="Đóng" disabled={dangLuu}>✕</button>
        </div>
        <div className="modal-body">
          <p className="muted">Chọn sheet nào thuộc <b>Hóa đơn 1</b>, <b>Hóa đơn 2</b>… (nhiều sheet cùng số = gom một hóa đơn), <b>Để sau</b> (xuất lượt sau) hoặc <b>Không xuất</b>. Trang Hóa đơn đầu ra của kế toán tách theo đúng mã này. Hóa đơn đã có số HĐ thì giữ nguyên — muốn đổi, bấm <b>Làm lại hóa đơn này</b> trước. Sheet đã thu tiền không gom chung với sheet chưa thu.</p>
          <table className="list-table inv-chia-bang">
            <thead><tr><th scope="col">Sheet</th><th scope="col" className="num">Thành tiền</th><th scope="col">Thuộc</th></tr></thead>
            <tbody>
              {ds.map((sh, i) => {
                if (sh.id == null) return null;
                const hd = daLuu.find((x) => x.sheets[0].sh.id === sh.id && daXuat(x.sheets[0].sh));
                return (
                  <tr key={sh.id}>
                    <td>{tenSheet(i)}{trangKhachTuChoi(bg, sh) && <span className="muted"> (khách không duyệt)</span>}{daXuat(sh) && <span className="status approved" title={`Số HĐ ${sh.invoiceNo || "—"}`}> đã xuất</span>}{sh.paidAt && <span className="status approved"> đã thu</span>}</td>
                    <td className="num">{fmtMoney(Number(sh.subtotal) || 0)}</td>
                    <td>
                      <select name={`chiaHoaDon-${sh.id}`} autoComplete="off" aria-label={`Hóa đơn của sheet ${tenSheet(i)}`}
                              value={chon[sh.id] ?? "later"} disabled={dangLuu || daXuat(sh)}
                              onChange={(e) => { const v = e.target.value; setChon((c) => ({ ...c, [sh.id!]: v })); }}>
                        {Array.from({ length: toiDa }, (_, k) => <option key={k + 1} value={String(k + 1)}>Hóa đơn {k + 1}</option>)}
                        <option value="later">Để sau</option>
                        <option value="skip">Không xuất</option>
                      </select>
                      {hd && (
                        <button type="button" className="btn btn-xs btn-ghost inv-chia-nut" disabled={dangLuu}
                                aria-label={`Làm lại hóa đơn này — ${hd.code}`} title={`Gỡ số HĐ ${hd.sheets[0].sh.invoiceNo} để chọn lại sheet`}
                                onClick={() => void lamLai(hd)}>Làm lại hóa đơn này</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="inv-chia-xem" aria-live="polite">
            <b>Xem trước</b>
            <ul>
              {xemTruoc.hoaDon.map((hd) => (
                <li key={hd.so}><strong>{hd.code}</strong> — {hd.sheets.map((x) => tenSheet(x.i)).join(", ")} · trước VAT {fmtMoney(hd.subtotal)} · sau VAT <strong>{fmtMoney(hd.amount)}</strong></li>
              ))}
              {xemTruoc.deSau.length > 0 && <li className="muted">Để sau: {xemTruoc.deSau.map((x) => tenSheet(x.i)).join(", ")}</li>}
              {xemTruoc.khongXuat.length > 0 && <li className="muted">Không xuất: {xemTruoc.khongXuat.map((x) => tenSheet(x.i)).join(", ")}</li>}
              {xemTruoc.hoaDon.length === 0 && <li className="muted">Chưa có hóa đơn nào — mọi sheet đang Để sau / Không xuất.</li>}
            </ul>
          </div>
        </div>
        <div className="modal-foot">
          {chiaSan && <button type="button" className="btn btn-sm btn-ghost" disabled={dangLuu} onClick={() => void luu(true)} title="Bỏ phép chia — mỗi sheet một hóa đơn như mặc định">Mỗi sheet một hóa đơn</button>}
          <span className="spacer" />
          <button type="button" className="btn btn-sm" disabled={dangLuu} onClick={onClose}>Hủy</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={dangLuu} onClick={() => void luu(false)}>{dangLuu ? "Đang lưu…" : "Lưu"}</button>
        </div>
      </div>
    </div>
  );
}
