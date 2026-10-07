import { useCallback, useEffect, useRef, useState } from "react";
import * as M from "../lib/quoteMath";
import { refRectsOfFormula, rowIndexOf, paintRectWith, toORef, goORef } from "./GridTable";
import { soDoDiaChi, chuCot, type CauHinhDiaChi, type CotDiaChi } from "../lib/soDoDiaChi";
import {
  congThucTongSheet, congThucDiscount, congThucTongCong, congThucVat, congThucVatSheet, congThucThanhTienSheet,
  congThucTongTungSheet, congThucCongSheet, congThucThanhTienBang, soVN, type CongThucO, type SheetBangTong,
} from "../lib/congThucTong";

// ── XEM CÔNG THỨC Ô TỔNG NHƯ Ô CÔNG THỨC CỦA LƯỚI ─────────────────────────────────────────────────────────────────
// Bấm vào số (hoặc nút ƒ) ở khối tổng của sheet / bảng "Tổng báo giá" → chính ô đó đổi sang hiện công thức bằng tham
// chiếu ô ("=SUM(G3:G5)+G8+G12"), các ô góp vào sáng lên bằng ĐÚNG lớp `cell-ref-active` + màu REF_COLORS mà lưới dùng
// khi bấm đúp ô Thành tiền nhóm (GridTable toORef). Bấm lại / bấm ra ngoài / Esc → về số. Chỉ đọc: không đổi dữ liệu,
// không đụng xuất Excel/PDF. Diễn giải bằng số thật nằm ở `title` của ô.
//
// Khác ô của lưới ở một chỗ, CỐ Ý: lưới đổi chữ ô bằng `td.textContent` (ô nằm trong DongNho ít khi vẽ lại); ô ở đây do
// React vẽ lại theo từng phím gõ của màn soạn nên công thức đi qua state, không ghi đè DOM. Cũng vì thế ô KHÔNG mang
// `data-fx-shown`: bộ lắng nghe toàn cục của GridTable "trả số" cho mọi ô mang cờ đó bằng textContent — làm vậy với nút
// React là xoá mất cây con của nó.

export type KetQuaXem = CongThucO & { oThamChieu: HTMLElement[][] };

/** Ô lưới mà công thức trỏ tới — CÙNG bộ dò tham chiếu (refRectsOfFormula) và cùng cách lấy ô (paintRectWith) với thanh fx. */
export function oLuoiTheoCongThuc(bang: ParentNode | null | undefined, congThuc: string, so: CotDiaChi[], soHang: number): HTMLElement[][] {
  if (!bang) return [];
  const cot = new Map(so.map((c, i) => [c.L, i]));
  // Như parseAddr của GridTable: nhận cả "$G$3"; ngoài sơ đồ cột / ngoài số hàng → không phải tham chiếu.
  const doc = (a: string) => {
    const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(a.trim()); if (!m) return null;
    const L = m[1].toUpperCase(), c = cot.get(L), row = parseInt(m[2], 10) - 1;
    return c == null || row < 0 || row >= soHang ? null : { row, f: so[c].f, L };
  };
  const idx = rowIndexOf(bang);
  return refRectsOfFormula(congThuc, doc, (L) => cot.get(L) ?? -1).map((rc) => {
    const ds: HTMLElement[] = [];
    paintRectWith(idx, rc.r0, rc.r1, rc.c0, rc.c1, (c) => so[c].f, (td) => ds.push(td));
    return ds;
  }).filter((ds) => ds.length);
}

/** Ô khối tổng gọi theo TÊN (data-o-tong) — trong cùng màn soạn. */
function oTheoMa(goc: HTMLElement, ma: string[]): HTMLElement[][] {
  const vung: ParentNode = goc.closest(".editor") ?? goc.ownerDocument;
  return ma.map((m) => vung.querySelector(`[data-o-tong="${m}"]`)?.closest("td") as HTMLElement | null).filter((td): td is HTMLElement => !!td).map((td) => [td]);
}

/** Địa chỉ A1 của một ô trong CHÍNH bảng chứa nó (hàng tiêu đề = hàng 1; ô gộp cột chiếm đủ số cột của nó). */
function diaChiTrongBang(td: HTMLElement): { L: string; r: number } {
  const tr = td.parentElement as HTMLTableRowElement;
  const bang = td.closest("table") as HTMLTableElement;
  let c = 0;
  for (const x of Array.from(tr.cells)) { if (x === td) break; c += x.colSpan || 1; }
  return { L: M.groupLetter(c), r: Array.from(bang.rows).indexOf(tr) + 1 };
}

/** Kéo ô được tô vào tầm nhìn: cuộn NGANG lưới tới cột Thành tiền; chỉ khi không ô nào lọt màn hình mới cuộn dọc, tới ô
 *  CUỐI (gần khối tổng nhất) — nhảy lên đầu một lưới 300 dòng thì ô công thức vừa bấm trôi mất khỏi màn hình. */
function choThay(nhom: HTMLElement[][]) {
  const tat = nhom.flat(); if (!tat.length) return;
  const cuoi = tat[tat.length - 1];
  const cuon = cuoi.closest(".tbl-scroll") as HTMLElement | null;
  if (cuon && cuon.scrollWidth > cuon.clientWidth) {
    const trai = cuoi.offsetLeft, phai = trai + cuoi.offsetWidth;
    if (trai < cuon.scrollLeft || phai > cuon.scrollLeft + cuon.clientWidth) cuon.scrollLeft = Math.max(0, trai - (cuon.clientWidth - cuoi.offsetWidth) / 2);
  }
  const cao = window.innerHeight || document.documentElement.clientHeight;
  const thay = tat.some((td) => { const r = td.getBoundingClientRect(); return r.bottom > 0 && r.top < cao; });
  if (!thay && typeof cuoi.scrollIntoView === "function") cuoi.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** Một ô số của khối tổng: hiện số; bấm → hiện công thức tại chỗ + tô ô góp vào. Thay `SummaryFormula` (toast) cũ. */
export function OCongThuc({ nhan, giaTri, tienTo = "", nguy = false, ma, tinh }: {
  nhan: string; giaTri: number; tienTo?: string; nguy?: boolean;
  /** Tên để ô KHÁC trỏ tới ô này (VAT trỏ "cong", "discount"…) — data-o-tong. */
  ma?: string;
  /** Tính công thức + các ô cần tô; nhận chính phần tử của ô để tìm bảng chứa nó. Chỉ chạy lúc bấm. */
  tinh: (goc: HTMLElement) => KetQuaXem;
}) {
  const gocRef = useRef<HTMLSpanElement | null>(null);
  const daTo = useRef<HTMLElement[]>([]);
  const soLucMo = useRef(giaTri);
  const [xem, setXem] = useState<CongThucO | null>(null);
  const dangXem = xem !== null;
  const boTo = useCallback(() => { daTo.current.forEach(goORef); daTo.current = []; }, []);

  useEffect(() => {
    if (!dangXem) return;
    const dong = () => { boTo(); setXem(null); };
    // Như lưới (GridTable: mousedown ra ngoài ô đang hiện công thức → về số). Bấm vào chính ô thì để onClick lo.
    const ngoai = (e: MouseEvent) => { const goc = gocRef.current; if (goc && e.target instanceof Node && goc.contains(e.target)) return; dong(); };
    const phim = (e: KeyboardEvent) => { if (e.key === "Escape") dong(); };
    document.addEventListener("mousedown", ngoai, true);
    document.addEventListener("keydown", phim, true);
    return () => { document.removeEventListener("mousedown", ngoai, true); document.removeEventListener("keydown", phim, true); };
  }, [dangXem, boTo]);
  // Số đổi trong lúc đang xem (Tab vào ô Discount rồi gõ, bản mới từ máy chủ) → công thức + ô tô đã cũ: tắt, không để
  // ô hiện một phép tính không còn đúng.
  useEffect(() => { if (dangXem && soLucMo.current !== giaTri) { boTo(); setXem(null); } }, [giaTri, dangXem, boTo]);
  useEffect(() => boTo, [boTo]);   // gỡ ô (đổi sheet, rời trang) → gỡ tô

  const bam = (e: React.MouseEvent<HTMLSpanElement>) => {
    if (e.detail > 1) return;   // nháy đúp (thói quen ở lưới) = MỘT lần mở, không mở rồi tắt ngay
    const goc = gocRef.current; if (!goc) return;
    if (dangXem) {
      const chon = window.getSelection?.();
      if (chon && !chon.isCollapsed && chon.anchorNode && goc.contains(chon.anchorNode)) return;   // đang bôi công thức để chép
      boTo(); setXem(null); return;
    }
    boTo();
    const kq = tinh(goc);
    kq.oThamChieu.forEach((nhom, ci) => nhom.forEach((td) => { toORef(td, ci); daTo.current.push(td); }));
    soLucMo.current = giaTri;
    setXem({ congThuc: kq.congThuc, dienGiai: kq.dienGiai, ghiChu: kq.ghiChu });
    choThay(kq.oThamChieu);
  };

  return (
    <span ref={gocRef} className={`summary-formula-value${nguy ? " danger" : ""}${xem ? " dang-xem" : ""}`} data-o-tong={ma} onClick={bam}
      title={xem ? [xem.dienGiai, ...xem.ghiChu].join("\n") : `Bấm để xem công thức ${nhan} — các ô được cộng sẽ sáng lên`}>
      {xem ? <code className="o-tong-cong-thuc">{xem.congThuc}</code> : <span>{tienTo}{M.fmtMoney(giaTri)}</span>}
      <button type="button" className="summary-fx-btn" aria-pressed={dangXem} aria-label={`${dangXem ? "Ẩn" : "Xem"} công thức ${nhan}`}>ƒ</button>
      {xem && <span className="sr-only" role="status">{xem.dienGiai}</span>}
    </span>
  );
}

/** Khối tổng của sheet ĐANG MỞ (Cộng/Tổng sheet · Discount · Tổng cộng · VAT · Thành tiền). Ô Thành tiền được tô nằm ở
 *  lưới chính — phần tử bọc `[data-luoi-chinh]` trong cùng `.editor` (QuoteEditor). */
export function xemKhoiTong(a: { items: M.Item[]; groupSubtotal: boolean; usesDays: boolean; numberSubs: boolean; diaChi: CauHinhDiaChi; tong: M.SheetTotals; vatPct: number; vat: number }) {
  const coDisc = a.tong.discount > 0;
  return {
    cong: (goc: HTMLElement): KetQuaXem => {
      const so = soDoDiaChi(a.diaChi);
      const ct = congThucTongSheet(a.items, { groupSubtotal: a.groupSubtotal, usesDays: a.usesDays, numberSubs: a.numberSubs, La: chuCot(so, "_amount"), Lq: chuCot(so, "quantity") });
      const luoi = goc.closest(".editor")?.querySelector("[data-luoi-chinh] table.excel-table");
      return { ...ct, oThamChieu: oLuoiTheoCongThuc(luoi, ct.congThuc, so, a.items.length) };
    },
    discount: (goc: HTMLElement): KetQuaXem => ({ ...congThucDiscount(a.tong), oThamChieu: oTheoMa(goc, ["cong"]) }),
    tongCong: (goc: HTMLElement): KetQuaXem => ({ ...congThucTongCong(a.tong), oThamChieu: oTheoMa(goc, ["cong", "discount"]) }),
    vat: (goc: HTMLElement): KetQuaXem => ({ ...congThucVatSheet(a.tong, a.vatPct, a.vat), oThamChieu: oTheoMa(goc, coDisc ? ["cong", "discount"] : ["cong"]) }),
    thanhTien: (goc: HTMLElement): KetQuaXem => ({ ...congThucThanhTienSheet(a.tong, a.vat), oThamChieu: oTheoMa(goc, coDisc ? ["cong", "discount", "vat"] : ["cong", "vat"]) }),
  };
}

/** Bảng "Tổng báo giá" (mọi sheet). Ô tổng của từng sheet mang `data-o-tong="bg-sheet-<i>"`, ô Tổng cộng / VAT mang
 *  "bg-tong-cong" / "bg-vat"; địa chỉ A1 đo từ vị trí THẬT của ô trong bảng nên thêm/bớt dòng không làm công thức lệch. */
export function xemBangTong(a: { cacSheet: SheetBangTong[]; tt: { subtotal: number; vat: number; total: number }; vatPct: number; sheetDangMo: number }) {
  const oMa = (goc: HTMLElement, m: string) => goc.closest("table")?.querySelector(`[data-o-tong="${m}"]`)?.closest("td") as HTMLElement | null | undefined;
  const cong = (goc: HTMLElement, chiDaDuyet: boolean, tong: number): KetQuaXem => {
    const ds = a.cacSheet.flatMap((s, i) => {
      const td = oMa(goc, `bg-sheet-${i}`);
      return td && (!chiDaDuyet || s.custStatus === "approved") ? [{ s, i, td, ...diaChiTrongBang(td) }] : [];
    });
    const kq = congThucCongSheet(ds, tong, a.cacSheet, chiDaDuyet);
    return { ...kq, oThamChieu: kq.dai.map((d) => d.chiSo.map((k) => ds[k].td)) };
  };
  const oTong = (goc: HTMLElement) => { const td = oMa(goc, "bg-tong-cong"); return td ? { td, ...diaChiTrongBang(td) } : null; };
  return {
    sheet: (i: number) => (goc: HTMLElement): KetQuaXem => {
      const s = a.cacSheet[i], dangMo = i === a.sheetDangMo;
      const kq = congThucTongTungSheet(s);
      return { ...kq, ghiChu: dangMo ? kq.ghiChu : [...kq.ghiChu, "Mở tab sheet đó để xem các ô góp vào."], oThamChieu: dangMo ? oTheoMa(goc, [s.tong.discount > 0 ? "tong-cong" : "cong"]) : [] };
    },
    daDuyet: (goc: HTMLElement) => cong(goc, true, a.cacSheet.reduce((acc, s) => (s.custStatus === "approved" ? acc + s.tong.net : acc), 0)),
    tongCong: (goc: HTMLElement) => cong(goc, false, a.tt.subtotal),
    vat: (goc: HTMLElement): KetQuaXem => {
      const t = oTong(goc);
      return { ...congThucVat({ congThuc: t ? `${t.L}${t.r}` : "Tổng cộng", dienGiai: soVN(a.tt.subtotal), giaTri: a.tt.subtotal }, a.vatPct, a.tt.vat), oThamChieu: t ? [[t.td]] : [] };
    },
    thanhTien: (goc: HTMLElement): KetQuaXem => {
      const t = oTong(goc), v = oMa(goc, "bg-vat");
      const dv = v ? diaChiTrongBang(v) : null;
      return { ...congThucThanhTienBang(t ? `${t.L}${t.r}` : "Tổng cộng", dv ? `${dv.L}${dv.r}` : "VAT", a.tt), oThamChieu: [t ? [t.td] : [], v ? [v] : []].filter((x) => x.length) };
    },
  };
}
