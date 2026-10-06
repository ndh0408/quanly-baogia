import { useMemo, useRef, useState } from "react";
import { BangNoi } from "./BangNoi";
import { normalizeFilterText } from "../lib/filterText";

// Ô CHỌN NHIỀU (Người tạo, Công ty… của bộ lọc Danh sách báo giá): một nút "Nhãn ▾ (2)" mở bảng nổi có hộp tìm
// (khi nhiều lựa chọn), danh sách tích chọn kèm SỐ ĐẾM, "Bỏ chọn". Giá trị đã chọn mà không còn trong danh sách đếm
// (vd người tạo không còn báo giá nào khớp các bộ lọc khác) VẪN hiện — không thì tích rồi không gỡ được nữa.

export type TuyChon = { value: string; nhan: string; dem?: number };

export function ChonNhieu({ nhan, tuyChon, chon, onChange, tenCu = {}, ngung = 7, trong = "Chưa có lựa chọn nào" }: {
  nhan: string;
  tuyChon: TuyChon[];
  chon: string[];
  onChange: (v: string[]) => void;
  /** Tên đã biết của các giá trị không có trong `tuyChon` (đã thấy ở lượt đếm trước). */
  tenCu?: Record<string, string>;
  /** Từ chừng này lựa chọn trở lên mới hiện hộp tìm. */
  ngung?: number;
  trong?: string;
}) {
  const [mo, setMo] = useState(false);
  const [tim, setTim] = useState("");
  const nut = useRef<HTMLButtonElement>(null);
  const dong = (traTieuDiem: boolean) => { setMo(false); setTim(""); if (traTieuDiem) nut.current?.focus(); };

  const dsDayDu = useMemo(() => {
    const co = new Set(tuyChon.map((t) => t.value));
    const thieu = chon.filter((v) => !co.has(v)).map((v) => ({ value: v, nhan: tenCu[v] ?? `#${v}`, dem: 0 }));
    return [...thieu, ...tuyChon];
  }, [tuyChon, chon, tenCu]);
  const tk = normalizeFilterText(tim);
  const hien = tk ? dsDayDu.filter((t) => normalizeFilterText(t.nhan).includes(tk)) : dsDayDu;
  const bat = (v: string) => onChange(chon.includes(v) ? chon.filter((x) => x !== v) : [...chon, v]);

  return (
    <>
      <button ref={nut} type="button" className={`cn-nut${chon.length ? " co-chon" : ""}`} aria-haspopup="dialog" aria-expanded={mo}
        onClick={() => (mo ? dong(false) : setMo(true))}>
        {nhan}{chon.length > 0 && <b className="cn-sl" aria-label={`${chon.length} đã chọn`}>{chon.length}</b>}<span className="cn-mui" aria-hidden="true">▾</span>
      </button>
      {mo && (
        <BangNoi neo={nut} onDong={dong} nhan={nhan} rong={280}>
          {dsDayDu.length >= ngung && (
            <input name="tim" type="search" className="cn-tim" autoFocus placeholder={`Tìm ${nhan.toLowerCase()}…`} aria-label={`Tìm ${nhan.toLowerCase()}`} value={tim} onChange={(e) => setTim(e.target.value)} />
          )}
          {dsDayDu.length === 0 ? <p className="muted cn-trong">{trong}</p> : hien.length === 0 ? <p className="muted cn-trong">Không có “{tim}”.</p> : (
            <ul className="cn-ds" role="group" aria-label={nhan}>
              {hien.map((t) => (
                <li key={t.value}>
                  <label className="cn-dong">
                    <input name="chon" type="checkbox" checked={chon.includes(t.value)} onChange={() => bat(t.value)} />
                    <span className="cn-ten">{t.nhan}</span>
                    {t.dem !== undefined && <span className="cn-dem" aria-label={`${t.dem} báo giá`}>{t.dem}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="cn-chan">
            <button type="button" className="btn btn-sm btn-ghost" disabled={chon.length === 0} onClick={() => onChange([])}>Bỏ chọn</button>
            <button type="button" className="btn btn-sm" onClick={() => dong(true)}>Xong</button>
          </div>
        </BangNoi>
      )}
    </>
  );
}
