import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MAU_GHI_CHU, NHAN_MAU, GHI_CHU_TOI_DA, laMauGhiChu, type MauGhiChu } from "../lib/ghiChuMau";
import { dangGoIME } from "../lib/gridShared";
import type { QuoteListNote } from "../lib/api";
import { fmtDate } from "../lib/format";

// Ô GHI CHÚ + MÀU ở dòng của Danh sách báo giá (chủ repo 2026-09-30: "thêm ghi chú cho họ đánh vào, cho chọn
// màu, 5 màu chủ đạo, chọn theo kiểu Zalo"). Một ô = một chấm màu (bấm → bảng 5 màu) + chữ ghi chú (bấm → MỞ
// KHUNG xem đủ chữ và sửa). Ghi chú là siêu dữ liệu của DÒNG (bảng QuoteListNote), không phải nội dung báo giá —
// xem chú thích ở prisma/schema.prisma.
//
// VÌ SAO CLICK MỞ KHUNG chứ không sửa tại chỗ: ô trên bảng chỉ đủ 2 dòng chữ (bảng đã rộng, cột ghi chú không
// được nới), nên ghi chú dài bị cắt "…". Chủ repo: "không thấy được hết chữ, click vào thấy hết chứ". Một <input>
// tại chỗ cũng chỉ thấy một dòng cuộn ngang — khung nổi (portal, không bị bảng cắt) cho xem TOÀN VĂN, xuống dòng
// tự nhiên, và cả người chỉ-đọc cũng mở ra đọc được.
//
// Component CHỈ lo hiển thị + thu ý định; việc gọi API, cập nhật tạm (optimistic) và báo lỗi nằm ở
// Danh sách báo giá (`onLuu`) — để ô này dùng lại được cho cả bảng lẫn thẻ mobile.

export type GhiChuThayDoi = { note?: string; color?: MauGhiChu | null };

const BANG_RONG = 232;   // bề rộng bảng chọn màu (khớp .qn-pop) — để kẹp vào khung nhìn
const KHUNG_RONG = 340;  // bề rộng khung xem/sửa ghi chú (khớp .qn-edit)
/** Ghi chú hiển thị một khối: xuống dòng (dán từ Excel…) → một dấu cách. Khớp chuanHoaGhiChu ở máy chủ. */
const mot = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

export function QuoteNote({ ghiChu, choSua, nhan, onLuu }: {
  ghiChu: QuoteListNote | null | undefined;
  /** Có quyền sửa không. Không → chỉ đọc: chấm không bấm được, bấm chữ chỉ mở khung ĐỌC. */
  choSua: boolean;
  /** Định danh dòng cho trình đọc màn hình ("FP_A26_001"). */
  nhan: string;
  onLuu: (p: GhiChuThayDoi) => void | Promise<void>;
}) {
  const chu = ghiChu?.note ?? "";
  const mau: MauGhiChu | null = laMauGhiChu(ghiChu?.color) ? ghiChu!.color : null;
  const [mo, setMo] = useState(false);   // khung xem/sửa toàn văn
  const [bang, setBang] = useState<{ top: number; left: number } | null>(null);   // bảng chọn màu
  const chuRef = useRef<HTMLButtonElement>(null);
  const cham = useRef<HTMLButtonElement>(null);

  const dongBang = useCallback((traTieuDiem = false) => {
    setBang(null);
    if (traTieuDiem) cham.current?.focus();
  }, []);
  const moBang = () => {
    const rc = cham.current?.getBoundingClientRect();
    if (!rc) return;
    setMo(false);
    setBang({ top: rc.bottom + 6, left: Math.max(8, Math.min(rc.left - 8, window.innerWidth - BANG_RONG - 8)) });
  };
  const chonMau = (k: MauGhiChu | null) => { dongBang(true); void onLuu({ color: k }); };
  // Đóng khung xem/sửa; `luu` = có chữ mới cần ghi. Không đổi gì so với bản đã lưu thì khỏi gọi máy chủ.
  const dongKhung = useCallback((luu: string | null, traTieuDiem: boolean) => {
    setMo(false);
    if (traTieuDiem) requestAnimationFrame(() => chuRef.current?.focus());
    if (luu !== null && mot(luu) !== chu) void onLuu({ note: mot(luu) });
  }, [chu, onLuu]);

  const nguoiGhi = ghiChu?.updatedByName ? `${ghiChu.updatedByName}${ghiChu.updatedAt ? ` · ${fmtDate(ghiChu.updatedAt)}` : ""}` : "";
  const tip = chu ? `${chu}${nguoiGhi ? `\n— ${nguoiGhi}` : ""}` : undefined;
  const tenMau = mau ? NHAN_MAU[mau] : "chưa chọn màu";
  // Bấm chữ được khi sửa được (kể cả chưa có chữ: "thêm") HOẶC khi có chữ để ĐỌC. Chỉ-đọc mà trống thì không có gì để mở.
  const bamDuoc = choSua || !!chu;

  return (
    <div className={`qn${mau ? ` qn-c-${mau} has-color` : ""}${chu ? " has-text" : ""}`}>
      {choSua ? (
        <button ref={cham} type="button" className="qn-dot" aria-haspopup="dialog" aria-expanded={bang != null}
          aria-label={`Màu ghi chú của ${nhan}: ${tenMau}. Bấm để đổi`} title={mau ? `Màu ${NHAN_MAU[mau]} — bấm để đổi` : "Chọn màu"}
          onClick={() => (bang ? dongBang() : moBang())} />
      ) : (
        <span className="qn-dot" role="img" aria-label={`Màu ghi chú: ${tenMau}`} />
      )}
      {bamDuoc ? (
        <button ref={chuRef} type="button" className="qn-text" aria-haspopup="dialog" aria-expanded={mo} title={tip ?? "Thêm ghi chú"}
          aria-label={chu ? `Ghi chú của ${nhan}: ${chu}. Bấm để ${choSua ? "xem đủ và sửa" : "xem đủ"}` : `Thêm ghi chú cho ${nhan}`}
          onClick={() => { setBang(null); setMo(true); }}>
          <span className="qn-clamp">{chu || <span className="qn-empty">Ghi chú…</span>}</span>
        </button>
      ) : (
        <span className="qn-text"><span className="qn-clamp"><span className="qn-empty">—</span></span></span>
      )}
      {mo && <KhungGhiChu neo={chuRef} nhan={nhan} chu={chu} choSua={choSua} nguoiGhi={nguoiGhi} onDong={dongKhung} />}
      {bang && <BangChonMau viTri={bang} hienTai={mau} nutMo={cham} onChon={chonMau} onDong={dongBang} />}
    </div>
  );
}

/**
 * Khung xem TOÀN VĂN + sửa ghi chú: portal + position:fixed (không bị `.list-table` cắt), bám theo ô khi cuộn.
 * Sửa được: ô nhập nhiều dòng tự cao; Enter / "Lưu" / bấm ra ngoài = lưu, Esc / "Hủy" = huỷ. Chỉ-đọc: hiện chữ.
 */
function KhungGhiChu({ neo, nhan, chu, choSua, nguoiGhi, onDong }: {
  neo: React.RefObject<HTMLButtonElement | null>;
  nhan: string; chu: string; choSua: boolean; nguoiGhi: string;
  onDong: (luu: string | null, traTieuDiem: boolean) => void;
}) {
  const hop = useRef<HTMLDivElement>(null);
  const o = useRef<HTMLTextAreaElement>(null);
  const [con, setCon] = useState(chu.length);
  // Một phiên chỉ CHỐT một lần: Enter rồi bấm ra ngoài / gỡ khung có thể bắn thêm sự kiện — cờ này chặn gửi trùng.
  const daChot = useRef(false);
  const chot = useCallback((luu: string | null, traTieuDiem: boolean) => {
    if (daChot.current) return;
    daChot.current = true;
    onDong(luu, traTieuDiem);
  }, [onDong]);
  const giaTri = () => o.current?.value ?? chu;

  // Bám ô chữ: tính lại khi cuộn (trang / khung cuộn ngang của bảng) và đổi cỡ cửa sổ. Kẹp vào khung nhìn; không
  // đủ chỗ phía dưới thì mở lên trên.
  const [vt, setVt] = useState<{ top: number; left: number; toiDa: number }>({ top: 0, left: 0, toiDa: 320 });
  const tinhVt = useCallback(() => {
    const rc = neo.current?.getBoundingClientRect();
    if (!rc) return;
    const duoi = window.innerHeight - rc.bottom - 12, tren = rc.top - 12;
    // Chiều cao THẬT của khung (đo từ lần vẽ trước; lần đầu chưa có thì tạm 240). Bản trước dùng hằng 240 trong khi khung thường
    // chỉ cao ~156px → khung mở-lên-trên lơ lửng cách ô 78–90px và đè lên ghi chú của dòng khác (đo 2026-10-06).
    const cao = hop.current?.offsetHeight || 240;
    const xuong = duoi >= cao || duoi >= tren;
    const toiDa = Math.max(160, xuong ? duoi : tren);
    const moi = {
      left: Math.max(8, Math.min(rc.left, window.innerWidth - Math.min(KHUNG_RONG, window.innerWidth - 16) - 8)),
      top: xuong ? rc.bottom + 6 : Math.max(8, rc.top - 6 - Math.min(cao, toiDa)),
      toiDa,
    };
    // Trả lại CHÍNH đối tượng cũ khi không đổi: `tinhVt` chạy sau MỖI lần vẽ (layout effect bên dưới) — setState đối tượng mới mỗi
    // lần là vòng lặp vô hạn.
    setVt((cu) => (cu.top === moi.top && cu.left === moi.left && cu.toiDa === moi.toiDa ? cu : moi));
  }, [neo]);
  // Sau MỖI lần vẽ: lần đầu mới đo được chiều cao thật; ô nhập tự cao khi gõ thêm chữ → khung mở-lên-trên phải dời theo.
  useLayoutEffect(() => { tinhVt(); });
  useEffect(() => {
    const ngoai = (e: Event) => { if (!hop.current?.contains(e.target as Node) && !neo.current?.contains(e.target as Node)) chot(choSua ? giaTri() : null, false); };
    const cuon = (e: Event) => { if (!hop.current?.contains(e.target as Node)) tinhVt(); };   // cuộn BÊN TRONG khung (chữ dài) không được kéo khung đi
    const phim = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); chot(null, true); } };
    document.addEventListener("mousedown", ngoai);
    document.addEventListener("scroll", cuon, true);
    window.addEventListener("resize", tinhVt);
    document.addEventListener("keydown", phim, true);
    return () => {
      document.removeEventListener("mousedown", ngoai);
      document.removeEventListener("scroll", cuon, true);
      window.removeEventListener("resize", tinhVt);
      document.removeEventListener("keydown", phim, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chot, tinhVt, neo, choSua]);
  // Ô tự cao theo chữ (tối đa ~40% khung nhìn rồi cuộn trong ô) + con trỏ về CUỐI chữ cũ (sửa ghi chú thường là
  // viết thêm; trình duyệt mặc định đặt con trỏ ở ĐẦU).
  const tuCao = () => { const t = o.current; if (t) { t.style.height = "auto"; t.style.height = `${Math.min(t.scrollHeight + 2, Math.round(window.innerHeight * 0.4))}px`; } };
  useLayoutEffect(() => {
    const t = o.current;
    if (!t) { hop.current?.focus(); return; }
    tuCao();
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }, []);

  return createPortal(
    <div ref={hop} className="qn-edit" role="dialog" aria-label={`Ghi chú của ${nhan}`} tabIndex={-1}
      style={{ top: vt.top, left: vt.left, maxHeight: vt.toiDa }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="qn-edit-head">Ghi chú · {nhan}</div>
      {choSua ? (
        <>
          <textarea ref={o} className="qn-area" rows={3} maxLength={GHI_CHU_TOI_DA} defaultValue={chu} placeholder="Gõ ghi chú…" aria-label={`Ghi chú của ${nhan}`}
            onInput={(e) => { setCon(e.currentTarget.value.length); tuCao(); }}
            onKeyDown={(e) => {
              // Enter chốt một từ của bộ gõ tiếng Việt (OpenKey/Unikey) KHÔNG phải lệnh lưu — xem dangGoIME.
              if (dangGoIME(e)) return;
              if (e.key === "Enter") { e.preventDefault(); chot(giaTri(), true); }   // ghi chú là MỘT khối chữ: Enter = lưu, không chèn dòng mới
            }} />
          <div className="qn-edit-foot">
            <span className={`qn-count${con >= GHI_CHU_TOI_DA ? " is-max" : ""}`} aria-live="polite">{con}/{GHI_CHU_TOI_DA}</span>
            {nguoiGhi && <span className="qn-who" title={`Người ghi gần nhất: ${nguoiGhi}`}>{nguoiGhi}</span>}
            <span className="qn-edit-act">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => chot(null, true)}>Hủy</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => chot(giaTri(), true)}>Lưu</button>
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="qn-doc" tabIndex={0}>{chu}</div>
          <div className="qn-edit-foot">
            {nguoiGhi && <span className="qn-who" title={`Người ghi gần nhất: ${nguoiGhi}`}>{nguoiGhi}</span>}
            <span className="qn-edit-act"><button type="button" className="btn btn-sm" onClick={() => chot(null, true)}>Đóng</button></span>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}

/**
 * Bảng 5 màu kiểu Zalo: một hàng chấm tròn, chấm đang chọn có dấu ✓; bấm lại chính nó là BỎ màu.
 * Dựng bằng portal + position:fixed (như menu "⋯" của danh sách) để bảng không bị `.list-table`
 * (overflow:hidden) cắt. Đóng khi bấm ra ngoài / cuộn / đổi cỡ cửa sổ / Esc (trả tiêu điểm về chấm).
 */
function BangChonMau({ viTri, hienTai, nutMo, onChon, onDong }: {
  viTri: { top: number; left: number };
  hienTai: MauGhiChu | null;
  nutMo: React.RefObject<HTMLButtonElement | null>;
  onChon: (k: MauGhiChu | null) => void;
  onDong: (traTieuDiem?: boolean) => void;
}) {
  const hop = useRef<HTMLDivElement>(null);
  // Vị trí THẬT: mặc định ngay dưới chấm (viTri); thiếu chỗ phía dưới mà phía trên đủ thì LẬT LÊN. Đo chiều cao thật của bảng trong
  // layout effect — trước khi trình duyệt vẽ — nên không bao giờ thấy bảng nhảy. Bản trước luôn mở xuống: chấm cách đáy màn dưới ~90px
  // thì cả 5 chấm màu bị cắt (đo 2026-10-06 ở 1366×768 và thẻ 390×844), mà cuộn trang để thấy thì bảng tự đóng.
  const [top, setTop] = useState(viTri.top);
  useLayoutEffect(() => {
    const rc = nutMo.current?.getBoundingClientRect();
    const cao = hop.current?.offsetHeight ?? 0;
    if (!rc || !cao) return;
    const thieuDuoi = viTri.top + cao > window.innerHeight - 8;
    const lenDuoc = rc.top - 6 - cao >= 8;
    setTop(thieuDuoi && lenDuoc ? rc.top - 6 - cao : viTri.top);
  }, [viTri, nutMo]);
  useEffect(() => {
    const dong = (e: Event) => {
      // Bấm vào CHÍNH chấm mở bảng: để onClick của chấm tự đóng, đừng đóng ở đây rồi để nó mở lại.
      if (e.type === "mousedown" && nutMo.current?.contains(e.target as Node)) return;
      onDong();
    };
    const phim = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onDong(true); } };
    document.addEventListener("mousedown", dong);
    document.addEventListener("scroll", dong, true);
    window.addEventListener("resize", dong);
    document.addEventListener("keydown", phim, true);
    return () => {
      document.removeEventListener("mousedown", dong);
      document.removeEventListener("scroll", dong, true);
      window.removeEventListener("resize", dong);
      document.removeEventListener("keydown", phim, true);
    };
  }, [onDong, nutMo]);
  // Bàn phím: mở bảng là tiêu điểm vào chấm đang chọn (hoặc chấm đầu) — mũi tên ←/→ đi giữa các chấm.
  useLayoutEffect(() => {
    const nut = hop.current?.querySelectorAll<HTMLButtonElement>(".qn-swatch");
    if (!nut) return;
    // preventScroll: lúc này bảng có thể còn ở vị trí "dưới chấm" (chưa kịp lật lên) — focus mặc định CUỘN trang tới nó, mà cuộn
    // trang là đóng bảng (listener scroll bên trên).
    (nut[hienTai ? MAU_GHI_CHU.indexOf(hienTai) : 0] ?? nut[0])?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const diChuyen = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const ds = [...(hop.current?.querySelectorAll<HTMLButtonElement>(".qn-swatch") ?? [])];
    const i = ds.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    ds[(i + (e.key === "ArrowRight" ? 1 : ds.length - 1)) % ds.length].focus();
  };
  return createPortal(
    <div ref={hop} className="qn-pop" role="dialog" aria-label="Chọn màu ghi chú" style={{ top, left: viTri.left }}
      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onKeyDown={diChuyen}>
      <div className="qn-swatches" role="radiogroup" aria-label="Năm màu">
        {MAU_GHI_CHU.map((k) => {
          const dang = k === hienTai;
          return (
            <button key={k} type="button" role="radio" aria-checked={dang} aria-label={NHAN_MAU[k]} title={dang ? `${NHAN_MAU[k]} — bấm lại để bỏ màu` : NHAN_MAU[k]}
              className={`qn-swatch qn-c-${k}${dang ? " is-on" : ""}`} onClick={() => onChon(dang ? null : k)}>
              {/* Dấu ✓ vẽ bằng SVG (không dùng chữ ✓: phông hệ thống vẽ nó lệch cỡ) — và nó là thứ báo "đang chọn"
                  cho người không phân biệt được màu, không chỉ mỗi viền đậm. */}
              {dang && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>}
            </button>
          );
        })}
      </div>
      {hienTai && <button type="button" className="qn-clear" onClick={() => onChon(null)}>Bỏ màu</button>}
    </div>,
    document.body,
  );
}
