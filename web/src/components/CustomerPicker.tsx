import { useEffect, useState } from "react";
import { api, type Customer } from "../lib/api";
import { useEscClose } from "../lib/ui";
import { errMsg } from "../lib/format";

// HỘP CHỌN KHÁCH HÀNG (danh mục "Mã khách hàng") — dùng chung cho wizard "Tạo báo giá mới" và màn soạn báo giá (đổi khách
// hàng ngay trong báo giá, chủ repo 2026-09-30: "trong báo giá cho chọn đổi khách hàng luôn nhé"). Bê nguyên từ wizard: cùng
// DOM (.modal[aria-label="Chọn khách hàng"] · tr.qrow) để test cũ của wizard còn chạy, cùng hoãn 250ms khi gõ tìm.
//
// Khác bản cũ:
//   · lỗi tải (403 không có quyền xem danh mục, mạng…) được NÓI RA — trước đây nuốt lỗi rồi báo "Không có khách hàng khớp",
//     người dùng tưởng danh mục trống;
//   · bỏ kết quả của lượt tìm CŨ trả về muộn (gõ nhanh → lượt chậm hơn về sau không được đè kết quả mới);
//   · `chonId`: khách đang gắn với báo giá được đánh dấu, để người đổi biết mình đang đứng ở đâu.
export function CustomerPicker({ onClose, onPick, chonId }: { onClose: () => void; onPick: (c: Customer) => void; chonId?: number | null }) {
  const [q, setQ] = useState("");
  useEscClose(onClose); // ESC đóng — trước đây modal này là ngõ cụt hoàn toàn cho bàn phím
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [tong, setTong] = useState(0);
  const [loi, setLoi] = useState("");
  useEffect(() => {
    let huy = false;
    const t = setTimeout(() => {
      api.listCustomers(q, 1, 30)
        .then((r) => { if (huy) return; setRows(r.data); setTong(r.meta?.total ?? r.data.length); setLoi(""); })
        .catch((ex) => { if (huy) return; setRows([]); setTong(0); setLoi(errMsg(ex, "Không tải được danh sách khách hàng")); });
    }, 250);
    return () => { huy = true; clearTimeout(t); };
  }, [q]);
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Chọn khách hàng">
        <div className="modal-head"><h3>Chọn khách hàng</h3><button className="icon-btn" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <input type="search" autoFocus placeholder="Tìm mã / tên khách hàng…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
          {!rows ? <div className="skeleton-wrap">{Array.from({ length: 5 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
            : loi ? <div className="err" role="alert">⚠ {loi}</div>
            : rows.length === 0 ? <p className="muted">Không có khách hàng khớp.</p> : (
              <>
                <div className="list-wrap">
                  <table className="list-table"><tbody>{rows.map((c) => {
                    const dangChon = chonId != null && c.id === chonId;
                    return (
                      // Bàn phím: cùng mẫu hàng bảng của Projects.tsx (tabIndex + Enter) — trước đây
                      // hàng này chỉ nghe onClick nên người dùng chỉ bàn phím không mở được, kẹt luôn
                      // wizard vì bước 3 bắt buộc chọn khách hàng.
                      <tr key={c.id} className="qrow" style={{ cursor: "pointer" }} tabIndex={0} aria-current={dangChon || undefined}
                        onClick={() => onPick(c)}
                        onKeyDown={(e) => { if (e.key === "Enter") onPick(c); }}>
                        <td><strong>{c.code}</strong>{dangChon && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>✓ đang chọn</span>}</td><td>{c.name}</td><td className="muted">{c.phone || ""}</td>
                      </tr>);
                  })}</tbody></table>
                </div>
                {tong > rows.length && <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Hiện {rows.length}/{tong} khách đầu tiên — gõ thêm mã hoặc tên để thu hẹp.</p>}
              </>
            )}
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>Đóng</button></div>
      </div>
    </div>
  );
}
