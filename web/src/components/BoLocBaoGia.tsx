import { useEffect, useId, useRef, useState } from "react";
import { ChonNhieu } from "./ChonNhieu";
import type { QuoteFacets } from "../lib/api";
import { MAU_GHI_CHU, NHAN_MAU } from "../lib/ghiChuMau";
import { demBoLoc, hienTien, khoangNgay, mauNgayDangKhop, MAU_NGAY, parseTien, type BoLocDS, type KhoaMauNgay } from "../lib/locDanhSach";

// BỘ LỌC ĐẦY ĐỦ của Danh sách báo giá (chủ repo 2026-09-30: "bộ lọc … chưa đầy đủ và thông minh"). Hai hàng, cùng bố cục
// với trang Hóa đơn đầu ra:
//   · Trạng thái (chip, có số đếm) · Người tạo · Công ty (chọn nhiều) · "Của tôi";
//   · Ngày báo giá (mẫu nhanh + từ/đến) · Tổng tiền (gõ "100tr", "1,5 tỷ") · Ghi chú (có/chưa + theo MÀU như nhãn Zalo).
// Số đếm lấy từ `GET /api/quotes/facets`: mỗi nhóm đếm theo mọi bộ lọc KHÁC của nó. Chưa có số đếm (đang tải / lỗi) thì
// bộ lọc vẫn dùng bình thường, chỉ thiếu con số.

const TT_CHINH: [string, string][] = [["draft", "Nháp"], ["converted", "Đã chốt"], ["lost", "Không chốt"]];
/** Bốn trạng thái CŨ (không còn đường ghi nào đặt) — gộp thành một chip "Khác", chỉ hiện khi còn dữ liệu cũ. */
const TT_CU = ["pending", "approved", "rejected", "sent"];

export function BoLocBaoGia({ loc, dat, xoa, facets: duLieuDem, meId }: {
  loc: BoLocDS;
  dat: (p: Partial<BoLocDS>) => void;
  xoa: () => void;
  facets?: QuoteFacets;
  meId: number;
}) {
  // Số đếm chỉ dùng khi ĐÚNG hình dạng: phản hồi lạ (máy chủ bản cũ trong lúc triển khai, proxy trả trang lỗi…) không được
  // làm sập cả trang danh sách — bộ lọc vẫn dùng bình thường, chỉ thiếu con số.
  const facets = duLieuDem && Array.isArray(duLieuDem.status) && duLieuDem.note && Array.isArray(duLieuDem.creators) && Array.isArray(duLieuDem.companies) ? duLieuDem : undefined;
  const dem = demBoLoc(loc);
  const dTT = Object.fromEntries((facets?.status ?? []).map((x) => [x.value, x.count]));
  const soCu = TT_CU.reduce((a, k) => a + (dTT[k] ?? 0), 0);
  const coCu = loc.status.some((s) => TT_CU.includes(s));
  const batTT = (ds: string[]) => { const co = ds.every((d) => loc.status.includes(d)); dat({ status: co ? loc.status.filter((s) => !ds.includes(s)) : [...new Set([...loc.status, ...ds])] }); };

  // Tên đã thấy của người tạo / công ty — để giá trị ĐANG chọn mà lượt đếm sau không còn trả về vẫn hiện đúng tên.
  const tenNguoi = useRef<Record<string, string>>({}), tenCty = useRef<Record<string, string>>({});
  for (const c of facets?.creators ?? []) tenNguoi.current[String(c.id)] = c.name;
  for (const c of facets?.companies ?? []) tenCty.current[String(c.id)] = c.name;

  const laToi = loc.nguoi.length === 1 && loc.nguoi[0] === meId;
  // "Chưa ghi chú" và "theo màu" LOẠI TRỪ nhau — cả hai cùng bật luôn ra 0 dòng (dòng chưa có ghi chú thì không có màu).
  // Hai chiều đều phải gỡ chiều kia: bật "Chưa có" xoá màu; chọn một màu khi đang "Chưa có" thì bỏ "Chưa có" (màu tự nó
  // đã nghĩa là "dòng có ghi chú mang màu này").
  const batMau = (k: string) => dat({ mau: loc.mau.includes(k) ? loc.mau.filter((m) => m !== k) : [...loc.mau, k], ...(loc.ghiChu === "none" ? { ghiChu: "" as const } : {}) });
  const batGhiChu = (v: "has" | "none") => dat({ ghiChu: loc.ghiChu === v ? "" : v, mau: v === "none" ? [] : loc.mau });

  const mauNgay = mauNgayDangKhop(loc.tu, loc.den);
  const coNgay = !!(loc.tu || loc.den);
  const chonMauNgay = (k: string) => { if (!k) { dat({ tu: "", den: "" }); return; } if (k === "tuychon") return; const r = khoangNgay(k as KhoaMauNgay); dat({ tu: r.tu, den: r.den }); };

  // ĐIỆN THOẠI (≤820px, chỉ CSS quyết — xem .bl-mo-them trong styles.css): bộ lọc đầy đủ cao 397px, tức nửa màn 360×740 — thẻ báo
  // giá đầu tiên chỉ ló 66px (đo 2026-10-06). Thu gọn còn chip trạng thái + nút "Bộ lọc khác"; số trên nút = số nhóm lọc đang bật
  // mà đang bị giấu (người tạo, công ty, ngày, tiền, ghi chú) — để không ai quên mình đang lọc. Màn rộng hơn: nút ẩn, luôn hiện đủ.
  const [moRong, setMoRong] = useState(false);
  const demAn = demBoLoc({ ...loc, q: "", status: [] });
  const idThem = useId();

  return (
    <div className={`inv-filters bl-panel${moRong ? " is-mo" : ""}`}>
      <div className="toolbar inv-filter-row inv-filter-main">
        <div className="inv-quick-filters" role="group" aria-label="Trạng thái báo giá">
          {TT_CHINH.map(([v, nhan]) => (
            <button key={v} type="button" className={loc.status.includes(v) ? "active" : ""} aria-pressed={loc.status.includes(v)} onClick={() => batTT([v])}>
              {nhan}{facets && <b>{dTT[v] ?? 0}</b>}
            </button>
          ))}
          {(soCu > 0 || coCu) && (
            <button type="button" className={coCu ? "active" : ""} aria-pressed={coCu} title="Trạng thái cũ (Chờ duyệt / Đã duyệt / Bị từ chối / Đã gửi) — dữ liệu trước khi bỏ luồng duyệt nội bộ" onClick={() => batTT(TT_CU)}>
              Khác{facets && <b>{soCu}</b>}
            </button>
          )}
        </div>
        <button type="button" className="btn btn-sm bl-mo-them" aria-expanded={moRong} aria-controls={idThem} onClick={() => setMoRong((x) => !x)}>
          {moRong ? "Thu gọn bộ lọc" : "Bộ lọc khác"}{!moRong && demAn ? <span className="inv-filter-count">{demAn}</span> : null}
        </button>
        {/* `display: contents` (styles.css): bọc này không tạo hộp — ở màn rộng các ô vẫn là phần tử flex của hàng như trước. */}
        <div className="bl-them-trong">
          <ChonNhieu nhan="Người tạo" chon={loc.nguoi.map(String)} tenCu={tenNguoi.current} onChange={(v) => dat({ nguoi: v.map(Number) })}
            tuyChon={(facets?.creators ?? []).map((c) => ({ value: String(c.id), nhan: c.name, dem: c.count }))} trong="Chưa có người tạo nào" />
          <ChonNhieu nhan="Công ty" chon={loc.cty.map(String)} tenCu={tenCty.current} onChange={(v) => dat({ cty: v.map(Number) })}
            tuyChon={(facets?.companies ?? []).map((c) => ({ value: String(c.id), nhan: c.name, dem: c.count }))} trong="Chưa có công ty nào" />
          <div className="inv-quick-filters">
            <button type="button" className={laToi ? "active" : ""} aria-pressed={laToi} title="Chỉ báo giá do bạn tạo" onClick={() => dat({ nguoi: laToi ? [] : [meId] })}>
              Của tôi{facets && <b>{facets.mine}</b>}
            </button>
          </div>
        </div>
      </div>

      <div id={idThem} className="toolbar inv-filter-row inv-filter-extra bl-them-hang">
        <select value={coNgay ? (mauNgay || "tuychon") : ""} onChange={(e) => chonMauNgay(e.target.value)} aria-label="Mẫu ngày báo giá" title="Chọn nhanh khoảng ngày báo giá">
          <option value="">Ngày báo giá: Tất cả</option>
          {MAU_NGAY.map((m) => <option key={m.khoa} value={m.khoa}>{m.nhan}</option>)}
          {coNgay && !mauNgay && <option value="tuychon">Tự chọn…</option>}
        </select>
        <label className="inv-date-filter"><span>Từ</span><input type="date" aria-label="Ngày báo giá từ" value={loc.tu} max={loc.den || undefined} onChange={(e) => dat({ tu: e.target.value })} /></label>
        <label className="inv-date-filter"><span>Đến</span><input type="date" aria-label="Ngày báo giá đến" value={loc.den} min={loc.tu || undefined} onChange={(e) => dat({ den: e.target.value })} /></label>

        <span className="bl-tien" role="group" aria-label="Tổng tiền">
          <span className="bl-nhan" aria-hidden="true">Tổng tiền:</span>
          <OTien nhan="Tổng từ" goiY="Từ 100tr" value={loc.tienTu} onChange={(v) => dat({ tienTu: v })} />
          <OTien nhan="Tổng đến" goiY="Đến 1,5 tỷ" value={loc.tienDen} onChange={(v) => dat({ tienDen: v })} />
        </span>

        <span className="bl-ghichu" role="group" aria-label="Ghi chú">
          <span className="bl-nhan">Ghi chú:</span>
          {MAU_GHI_CHU.map((k) => {
            const n = facets?.note.colors[k];
            return (
              <button key={k} type="button" className={`bl-mau qn-c-${k}${loc.mau.includes(k) ? " is-on" : ""}`} aria-pressed={loc.mau.includes(k)}
                aria-label={`Màu ${NHAN_MAU[k]}${n !== undefined ? ` (${n})` : ""}`} title={`Lọc ghi chú màu ${NHAN_MAU[k].toLowerCase()}${n !== undefined ? ` — ${n} báo giá` : ""}`} onClick={() => batMau(k)} />
            );
          })}
          <span className="inv-quick-filters">
            <button type="button" className={loc.ghiChu === "has" ? "active" : ""} aria-pressed={loc.ghiChu === "has"} onClick={() => batGhiChu("has")}>Có ghi chú{facets && <b>{facets.note.has}</b>}</button>
            <button type="button" className={loc.ghiChu === "none" ? "active" : ""} aria-pressed={loc.ghiChu === "none"} onClick={() => batGhiChu("none")}>Chưa có{facets && <b>{facets.note.none}</b>}</button>
          </span>
        </span>

        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" type="button" disabled={!dem} onClick={xoa}>Xóa tất cả{dem ? <span className="inv-filter-count">{dem}</span> : null}</button>
      </div>
    </div>
  );
}

/**
 * Ô tiền gõ kiểu người Việt: "100tr", "1,5 tỷ", "500k", "1.250.000". Đọc khi rời ô / Enter — đọc được thì ô hiện lại dạng
 * đầy đủ "100.000.000" (người dùng thấy máy hiểu gì), không đọc được thì đánh dấu lỗi và KHÔNG đổi bộ lọc hiện có
 * (đoán bừa một con số tiền là tệ hơn báo "chưa hiểu").
 */
function OTien({ nhan, goiY, value, onChange }: { nhan: string; goiY: string; value: string; onChange: (chuSo: string) => void }) {
  const [chu, setChu] = useState(hienTien(value));
  const [loi, setLoi] = useState(false);
  useEffect(() => { setChu(hienTien(value)); setLoi(false); }, [value]);   // xoá lọc / đổi từ ngoài → ô theo
  const chot = () => {
    if (!chu.trim()) { setLoi(false); if (value) onChange(""); return; }
    const n = parseTien(chu);
    if (n === null) { setLoi(true); return; }
    setLoi(false);
    const v = String(n);
    setChu(hienTien(v));
    if (v !== value) onChange(v);
  };
  return (
    <>
      <input type="text" inputMode="decimal" className={`bl-o-tien${loi ? " is-loi" : ""}`} aria-label={nhan} placeholder={goiY} value={chu} aria-invalid={loi || undefined}
        title={loi ? "Chưa hiểu số tiền — thử 100tr, 1,5 tỷ, 500k hoặc 1.250.000" : "Gõ 100tr, 1,5 tỷ, 500k hoặc 1.250.000"}
        onChange={(e) => setChu(e.target.value)} onBlur={chot}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); chot(); } }} />
      {/* Lời nhắn HIỆN RA (không chỉ tooltip — tooltip phải rê chuột mới thấy): báo lỗi là việc của chữ, không chỉ của viền đỏ. */}
      {loi && <span className="bl-loi" role="alert">Chưa hiểu — thử 100tr, 1,5 tỷ</span>}
    </>
  );
}
