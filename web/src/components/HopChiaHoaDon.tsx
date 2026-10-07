import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type ProjectQuote } from "../lib/api";
import { toast, useEscClose } from "../lib/ui";
import { fmtMoney, soMa, trangKhachTuChoi } from "../lib/format";
import { daChia, laMacDinh, luaChonCua, nhomHoaDon } from "../lib/hoaDonChia";

// HỘP "CHIA HÓA ĐƠN" — trang Hóa đơn đầu ra (chủ repo 2026-10-06: "cho chức năng chọn sheet nào là hóa đơn 1, sheet nào
// hóa đơn 2, và có thể bỏ cái nào chưa muốn xuất để xuất sau hay là không làm"). Kế toán (invoice:edit) gán từng sheet
// vào Hóa đơn 1, 2… (gom nhiều sheet vào một hóa đơn), Để sau, hoặc Không xuất; xem trước mã _01/_02 + tiền từng hóa đơn.
// Máy chủ (PUT /quotes/:id/invoice-split) giữ luật: hóa đơn đã xuất (có số HĐ / đã thu) đứng yên — ô của sheet đó khoá
// sẵn ở đây cho khỏi bấm rồi mới nhận 409.

// Khoá ô = sheet thuộc hóa đơn ĐÃ CÓ SỐ HĐ (muốn đổi: "Làm lại HĐ" trước). Sheet đã thu (không còn số HĐ) vẫn chọn được —
// máy chủ chặn gom đã thu với chưa thu / để Để sau, Không xuất, kèm lời giải thích.
const daXuat = (sh: { invoiceNo?: string | null }) => !!String(sh.invoiceNo ?? "").trim();

export function HopChiaHoaDon({ q, onClose, onSaved }: { q: ProjectQuote; onClose: () => void; onSaved: () => void }) {
  const sheets = useMemo(() => q.sheets || [], [q]);
  const chiaSan = daChia(sheets);
  // Lựa chọn ban đầu: đã chia → đúng phép chia đang lưu; chưa chia → mỗi sheet một hóa đơn theo số mã cũ (_01, _02…),
  // sheet khách không duyệt → Không xuất (trang Hóa đơn vẫn ẩn nó như trước).
  const [chon, setChon] = useState<Record<number, string>>(() => {
    const o: Record<number, string> = {};
    sheets.forEach((sh, i) => {
      if (sh.id == null) return;
      o[sh.id] = !chiaSan && trangKhachTuChoi(q, sh) ? "skip" : luaChonCua(sh, i, chiaSan);
    });
    return o;
  });
  const [dangLuu, setDangLuu] = useState(false);
  const hopRef = useRef<HTMLDivElement>(null);
  useEscClose(onClose, !dangLuu);
  useEffect(() => { hopRef.current?.querySelector<HTMLElement>("select:not([disabled])")?.focus(); }, []);

  // Số hóa đơn chọn được: 1…max(số sheet, số đang dùng) — đủ để mỗi sheet một hóa đơn và giữ số cũ của hóa đơn đã xuất.
  const toiDa = Math.max(sheets.length, ...sheets.map((sh, i) => soMa(sh, i)), ...Object.values(chon).map((v) => Number(v) || 0));
  const xemTruoc = nhomHoaDon(q, chon);

  const luu = async (boChia: boolean) => {
    if (dangLuu) return;
    const macDinh = boChia || laMacDinh(sheets, chon);
    const ds = sheets.filter((sh) => sh.id != null).map((sh) => {
      const v = chon[sh.id!] ?? "later";
      if (macDinh) return { sheetId: sh.id!, group: null, hold: null };
      return { sheetId: sh.id!, group: v === "later" || v === "skip" ? null : Number(v), hold: v === "later" || v === "skip" ? v : null } as const;
    });
    setDangLuu(true);
    try {
      await api.chiaHoaDon(q.id, ds);
      toast(macDinh ? "Đã để mỗi sheet một hóa đơn" : "Đã chia hóa đơn", "success");
      onSaved();
      onClose();
    } catch (ex) {
      toast(ex instanceof ApiError ? ex.message : "Lỗi", "error");
      setDangLuu(false);
    }
  };

  const tenSheet = (i: number) => sheets[i]?.name || `Sheet ${i + 1}`;
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !dangLuu) onClose(); }}>
      <div ref={hopRef} className="modal modal-sm inv-chia-hop" role="dialog" aria-modal="true" aria-label={`Chia hóa đơn — ${q.customerName || q.title}`}>
        <div className="modal-head">
          <h3>Chia hóa đơn</h3>
          <button type="button" className="x" onClick={onClose} aria-label="Đóng" disabled={dangLuu}>✕</button>
        </div>
        <div className="modal-body">
          <p className="muted">Chọn sheet nào thuộc <b>Hóa đơn 1</b>, <b>Hóa đơn 2</b>… (nhiều sheet cùng số = gom một hóa đơn), <b>Để sau</b> (xuất lượt sau) hoặc <b>Không xuất</b>. Hóa đơn đã có số HĐ thì giữ nguyên — muốn đổi, bấm <b>Làm lại HĐ</b> trước. Sheet đã thu tiền không gom chung với sheet chưa thu.</p>
          <table className="list-table inv-chia-bang">
            <thead><tr><th scope="col">Sheet</th><th scope="col" className="num">Thành tiền</th><th scope="col">Thuộc</th></tr></thead>
            <tbody>
              {sheets.map((sh, i) => sh.id == null ? null : (
                <tr key={sh.id}>
                  <td>{tenSheet(i)}{trangKhachTuChoi(q, sh) && <span className="muted"> (khách không duyệt)</span>}{daXuat(sh) && <span className="status approved" title={`Số HĐ ${sh.invoiceNo || "—"}`}> đã xuất</span>}{sh.paidAt && <span className="status approved"> đã thu</span>}</td>
                  <td className="num">{fmtMoney(Number(sh.subtotal) || 0)}</td>
                  <td>
                    <select name={`chiaHoaDon-${sh.id}`} autoComplete="off" aria-label={`Hóa đơn của sheet ${tenSheet(i)}`}
                            value={chon[sh.id] ?? "later"} disabled={dangLuu || daXuat(sh)}
                            onChange={(e) => { const v = e.target.value; setChon((c) => ({ ...c, [sh.id!]: v })); }}>
                      {Array.from({ length: toiDa }, (_, k) => <option key={k + 1} value={String(k + 1)}>Hóa đơn {k + 1}</option>)}
                      <option value="later">Để sau</option>
                      <option value="skip">Không xuất</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="inv-chia-xem" aria-live="polite">
            <b>Xem trước</b>
            <ul>
              {xemTruoc.hoaDon.map((hd) => (
                <li key={hd.so}><strong>{hd.code}</strong> — {hd.sheets.map((x) => tenSheet(x.i)).join(", ")} · <strong>{fmtMoney(hd.amount)}</strong> (gồm VAT)</li>
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
