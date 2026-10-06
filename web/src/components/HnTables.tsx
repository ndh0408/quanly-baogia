import { useEffect, useRef, useState, type ReactNode } from "react";
import * as M from "../lib/quoteMath";
import { type ItemK, nextK, type ThanhChung } from "../lib/gridShared";
import { GridTable } from "./GridTable";
import { type EditorTemplate } from "../lib/api";
import { confirmModal, toast } from "../lib/ui";
import { extraTableSum, removeTableFromList, loiXoaBangDaChi, type ExtraTable } from "./ExtraTables";
import { KhoiSheet } from "./KhoiSheet";
import type { DaChiTheoRid } from "../lib/daChiHang";
import { sapMauHienThi, mauMacDinhMoi } from "../lib/thuTuMau";

// KHÔNG GIAN LÀM VIỆC "BÁO GIÁ HÀ NỘI" — cấp BÁO GIÁ, không thuộc trang nào.
//
// Trước 2026-09-15 bảng HN nằm trong `QuoteSheet.extraTables` của từng trang, nên account Hà Nội
// phải làm việc bên trong cấu trúc trang của chủ báo giá: màn của họ lặp theo trang và in cả TÊN
// TRANG (lộ cấu trúc báo giá), lưu thì ghép theo `sheetId` mà mỗi lần chủ bấm Lưu là id đổi hết
// (lưu = xoá trang rồi tạo lại) → 409 "hãy tải lại trang", và chủ xoá một trang là bảng HN trên
// trang đó chết theo. Nay là `Quote.hnTables`: một danh sách phẳng của riêng họ.
//
// DÙNG CHUNG cho HAI màn — AccountHnView (người điền) và QuoteEditor (chủ báo giá xem/sửa) — cố ý:
// hai bên phải thấy ĐÚNG một thứ, và luật hiển thị/tính tổng không được có hai bản.
//
// Lưới là GridTable ĐẦY ĐỦ như lưới báo giá chính, kèm `fxBar` (thanh công thức). Trước đây chỉ
// lưới chính mới bật fxBar; phần HN là nơi người ta gõ giá nên cần đúng bộ Excel đó: công thức,
// copy/cắt/dán nhiều ô, fill-down, Ctrl+Z/Y, gõ tiếng Việt bằng IME.
//
// Cột THANH TOÁN CHỈ XEM (2026-10-06): kế toán tích ĐÃ CHI + ảnh chứng từ của hàng HN ở trang Hóa đơn đầu vào,
// như hàng Chi phí HCM / Phí KH; ở đây chỉ hiện đã chi chưa / ngày / ai tích — xem ExtraTables.tsx.
export type HnTable = Omit<ExtraTable, "category"> & { category?: string };

// ── DUYỆT TỪNG HÀNG (2026-10-06) ─────────────────────────────────────────────────────────────────────
// Trạng thái hàng do MÁY CHỦ sở hữu (src/hnDuyetHang.ts): "dang-lam" · "cho-duyet" · "da-duyet" · "tra-lai". Cột DUYỆT
// hiện trạng thái và nút thao tác — mỗi nút gọi máy chủ NGAY (POST /:id/hn/submit|review), không đi qua nút Lưu.
export type TrangThaiHangHn = "dang-lam" | "cho-duyet" | "da-duyet" | "tra-lai";
export type ThaoTacHangHn = "gui" | "duyet" | "tra" | "bo-duyet";
export const NHAN_TRANG_THAI_HN: Record<TrangThaiHangHn, string> = {
  "dang-lam": "Đang làm", "cho-duyet": "Chờ duyệt", "da-duyet": "✓ Đã duyệt", "tra-lai": "↩ Bị trả",
};
type HangHn = { kind?: string; rid?: string | null; trangThaiDuyet?: string | null; lyDoTra?: string | null; approvedAt?: string | null };
const CAU_TRUC = new Set(["section", "subsection", "info"]);
export const trangThaiHn = (it: HangHn | null | undefined): TrangThaiHangHn => {
  const v = it?.trangThaiDuyet;
  return v === "cho-duyet" || v === "da-duyet" || v === "tra-lai" ? v : "dang-lam";
};
/**
 * Hàng có bị KHOÁ trên màn này không — BẢN SAO luật máy chủ (reconcileTrangThaiHn): đã duyệt khoá với mọi người; đang
 * chờ duyệt khoá với Account HN (`cheDo` "account") và với người không có quyền duyệt. Máy chủ vẫn là chốt cuối (409).
 */
export function hangHnBiKhoa(it: HangHn | null | undefined, cheDo: "chu" | "account", canApprove: boolean): boolean {
  if (!it || CAU_TRUC.has(String(it.kind))) return false;
  const tt = trangThaiHn(it);
  return tt === "da-duyet" || (tt === "cho-duyet" && (cheDo === "account" || !canApprove));
}
/** Các hàng tiền (có rid — đã lưu) theo trạng thái — cho nút hàng loạt. */
export function ridTheoTrangThai(tables: HnTable[], tt: TrangThaiHangHn[]): string[] {
  return tables.flatMap((x) => (x.items || []) as HangHn[]).filter((it) => !CAU_TRUC.has(String(it.kind)) && it.rid && tt.includes(trangThaiHn(it))).map((it) => String(it.rid));
}
/** Bảng HN có thay đổi CHƯA LƯU trên màn này không (cờ gắn vào chính mảng — nạp / lưu lại là mảng mới, cờ tự mất).
 *  Thao tác duyệt / gửi hàng chạy trên bản MÁY CHỦ: còn sửa dở thì phải Lưu trước, không là duyệt nhầm bản cũ. */
type CoBan = { _hnBan?: boolean };
export const hnCoThayDoi = (tables: unknown) => !!(tables as CoBan | null)?._hnBan;
/** Gộp trạng thái duyệt từng hàng (theo rid) từ bản máy chủ vào bảng đang soạn — khi KHÔNG được thay cả bảng. */
export function gopTrangThaiHn(dich: HnTable[], nguon: unknown) {
  const theoRid = new Map<string, Record<string, unknown>>();
  for (const x of Array.isArray(nguon) ? nguon as HnTable[] : []) for (const it of (x.items || []) as Record<string, unknown>[]) if (typeof it.rid === "string") theoRid.set(it.rid, it);
  for (const x of dich) for (const it of (x.items || []) as Record<string, unknown>[]) {
    const m = typeof it.rid === "string" ? theoRid.get(it.rid) : undefined;
    if (m) for (const k of ["trangThaiDuyet", "approved", "approvedAt", "approvedBy", "lyDoTra"]) it[k] = m[k];
  }
}
/** Trường của hàng mà khoá giữ nguyên (nội dung + trạng thái). `boNoiBo`: người quản lý HN sửa được NS · Chứng từ · Lưu kho. */
const TRUONG_KHOA = ["kind", "label", "name", "detail", "unit", "quantity", "quantityExact", "unitPrice", "days", "notes", "formulas",
  "trangThaiDuyet", "approved", "approvedAt", "approvedBy", "lyDoTra"];
const TRUONG_NOI_BO = ["ns", "luuKho", "chungTu"];

/** Mẫu cột của một bảng HN: `templateId` của bảng, thiếu thì mẫu đầu của công ty (không có thì mẫu đầu
 *  danh sách). MỘT luật cho lưới, tổng và đường Lưu (QuoteEditor / AccountHnView dọn `days` theo nó — L64). */
export function mauBangHn(t: { templateId?: number }, templates: EditorTemplate[], companyId?: number): EditorTemplate | undefined {
  const ds0 = templates.filter((x) => x.companyId === companyId);
  const ds = ds0.length ? ds0 : templates;
  return templates.find((x) => x.id === (t.templateId || ds[0]?.id)) || ds[0];
}

export function HnTables({ tables, templates, companyId, editable, canApprove, onMarkDirty, moMacDinh = false, thanhChung, phuHieu, dieuKhien, daChi,
  cheDo = "chu", moCotNoiBo = false, onHanhDong, dangXuLy = false, dongBo }: {
  /** Mảng bảng HN — MUTATE TẠI CHỖ, đúng quy ước state của editor (qRef giữ object, không copy). */
  tables: HnTable[];
  templates: EditorTemplate[];
  companyId?: number;
  editable: boolean;
  canApprove?: boolean;
  onMarkDirty: () => void;
  /** Mở sẵn khối. `AccountHnView` bật (cả trang chỉ có mỗi nó); trang soạn báo giá để TẮT, vì ở đó
   *  khối này là một trong ba luồng và mở hết là trang dài ra mấy màn hình. */
  moMacDinh?: boolean;
  /** Thanh "+ Thêm hàng…" dùng chung ở đáy trang soạn báo giá. Vắng = tự vẽ tại chỗ (AccountHnView). */
  thanhChung?: ThanhChung;
  /** Thẻ trạng thái trên tiêu đề khối (vd "Account đang làm") — xem KhoiSheet. */
  phuHieu?: ReactNode;
  /** Khối giao việc / duyệt / trả lại, dán đầu thân khối — xem KhoiSheet. */
  dieuKhien?: ReactNode;
  /** Trạng thái ĐÃ CHI từng hàng (phía "hn" của useDaChiBaoGia) — cột Thanh toán CHỈ XEM; tích ở trang Hóa đơn đầu vào. */
  daChi?: DaChiTheoRid | null;
  /** "account" = màn Account HN (hàng đã gửi cũng khoá, nút "Gửi"); "chu" = trình soạn báo giá (nút Duyệt / Trả cho người
   *  có quyền duyệt). */
  cheDo?: "chu" | "account";
  /** Hàng khoá vẫn mở NS · Chứng từ · Lưu kho (người quản lý phần HN — khớp máy chủ). */
  moCotNoiBo?: boolean;
  /** Thao tác trạng thái hàng (gọi máy chủ). Vắng = cột Duyệt chỉ hiện trạng thái. */
  onHanhDong?: (loai: ThaoTacHangHn, rids: string[]) => void;
  /** Đang gọi máy chủ — tắt các nút của cột Duyệt. */
  dangXuLy?: boolean;
  /** Đổi giá trị khi nơi gọi vừa GỘP trạng thái mới từ máy chủ vào `tables` (không thay mảng) — chụp lại các hàng khoá. */
  dongBo?: unknown;
}) {
  const [, setTick] = useState(0);
  const redraw = () => setTick((t) => t + 1);
  // ── GIỮ HÀNG KHOÁ ─────────────────────────────────────────────────────────────────────────────────
  // Ô của hàng khoá đã tắt trong lưới (GridTable `khoaHang`), nhưng dán nhiều ô / kéo điền / cắt / Ctrl+Z vẫn chạm được
  // model. Chụp nội dung các hàng khoá (theo rid) ở mỗi mốc đồng bộ với máy chủ (mảng mới, hoặc `dongBo` đổi), rồi sau
  // MỖI lần lưới báo đổi thì trả hàng khoá về đúng bản chụp — kể cả hàng bị xoá (chèn lại đúng chỗ). Máy chủ vẫn chặn
  // (409) nếu có đường nào lọt.
  const [vKhoa, setVKhoa] = useState(0);
  const truongKhoa = moCotNoiBo ? TRUONG_KHOA : [...TRUONG_KHOA, ...TRUONG_NOI_BO];
  const khoaRef = useRef<{ nguon: unknown; dongBo: unknown; ds: { rid: string; t: HnTable; idx: number; goc: Record<string, unknown> }[] } | null>(null);
  if (!khoaRef.current || khoaRef.current.nguon !== tables || khoaRef.current.dongBo !== dongBo) {
    const ds: { rid: string; t: HnTable; idx: number; goc: Record<string, unknown> }[] = [];
    for (const x of tables) (x.items || []).forEach((it, idx) => {
      const r = it as unknown as Record<string, unknown>;
      if (typeof r.rid === "string" && hangHnBiKhoa(it as HangHn, cheDo, !!canApprove)) ds.push({ rid: r.rid, t: x, idx, goc: JSON.parse(JSON.stringify(r)) });
    });
    khoaRef.current = { nguon: tables, dongBo, ds };
  }
  const giuHangKhoa = (): boolean => {
    let vi = false;
    for (const k of khoaRef.current?.ds ?? []) {
      if (!tables.includes(k.t)) continue;   // bảng có hàng khoá không xoá được (xoaBang chặn)
      const items = k.t.items as unknown as Record<string, unknown>[];
      const it = items.find((x) => x.rid === k.rid);
      if (!it) {
        const ban = JSON.parse(JSON.stringify(k.goc)) as Record<string, unknown>; ban._k = nextK();
        items.splice(Math.min(k.idx, items.length), 0, ban); vi = true; continue;
      }
      for (const f of truongKhoa) {
        if (JSON.stringify(it[f] ?? null) !== JSON.stringify(k.goc[f] ?? null)) {
          if (k.goc[f] === undefined) delete it[f]; else it[f] = JSON.parse(JSON.stringify(k.goc[f]));
          vi = true;
        }
      }
    }
    return vi;
  };
  const danhDau = () => { (tables as unknown as CoBan)._hnBan = true; onMarkDirty(); };
  const onChange = () => {
    if (giuHangKhoa()) {
      setVKhoa((v) => v + 1);   // vẽ lại lưới từ model đã trả về
      toast("Hàng đã duyệt / đã gửi duyệt bị khoá — phần sửa vào hàng đó đã được hoàn lại.", "error");
    }
    danhDau(); redraw();
  };
  const khoa = (it: HangHn) => hangHnBiKhoa(it, cheDo, !!canApprove);
  const bangCoHangKhoa = (x: HnTable | null) => !!x && (x.items || []).some((it) => khoa(it as HangHn));
  const [active, setActive0] = useState(0);
  const [mo, setMo] = useState(moMacDinh);
  const setActive = (i: number) => { setActive0(i); redraw(); };
  // L61: component còn gắn không — hộp hỏi xoá bảng không tự đóng khi rời trang (xem xoaBang).
  const songRef = useRef(true);
  useEffect(() => { songRef.current = true; return () => { songRef.current = false; }; }, []);

  tables.forEach((x) => { if (x._k == null) x._k = nextK(); (x.items || []).forEach((it) => { if (it._k == null) it._k = nextK(); }); });

  const tplList0 = templates.filter((t) => t.companyId === companyId);
  const tplList = tplList0.length ? tplList0 : templates;
  const defTplId = tplList[0]?.id;
  // Bảng HN MỚI (chưa có bảng nào để theo) chọn sẵn mẫu đầu theo thứ tự hiển thị; defTplId giữ làm dự phòng cho bảng cũ.
  const mauBangMoi = mauMacDinhMoi(templates, companyId)?.id || defTplId;
  const tplOf = (t: HnTable) => mauBangHn(t, templates, companyId);

  // L64 (đợt 3): KHÔNG còn xoá `days` lúc vẽ khi bảng dùng mẫu không ngày — đổi mẫu qua lại là mất số
  // Ngày vĩnh viễn, và mở bảng còn days cũ là bị coi "đã sửa". Tổng chỉ nhân ngày khi mẫu CÓ ngày (xem
  // `tongBang`); đường Lưu của QuoteEditor / AccountHnView gửi days: null cho mẫu không ngày.

  let ai = active;
  if (ai >= tables.length) ai = tables.length - 1;
  if (ai < 0) ai = 0;
  const t = tables[ai] || null;
  const tpl = t ? tplOf(t) : null;
  const usesDays = !!tpl?.layout?.hasDays, showDetail = !!tpl?.layout?.hasDetail, numberSubs = !!tpl?.layout?.numberSubsections;
  const addrDetail = !!(tpl?.layout?.reserveDetail ?? tpl?.layout?.hasDetail);
  /* ── MỘT CON SỐ MỘT CHỖ ───────────────────────────────────────────────────────────────────
     Bản trước in CÙNG một số tiền ở BA nơi: "Tổng:" trên đầu khối, "Tổng sheet:" do GridTable tự
     vẽ dưới lưới, rồi "Tổng sheet này:" do chính tệp này vẽ thêm — hai dòng cuối cách nhau đúng
     một hàng nút, nhãn gần như giống hệt. Người dùng báo: "trình bày hơi rườm rà".

     Mà khi có NHIỀU sheet thì lại thiếu đúng thứ cần: không thấy từng sheet góp bao nhiêu, phải
     bấm qua từng tab mới biết ("chưa có tổng các sheet như báo giá").

     Nay:
       · 1 sheet  → chỉ "Tổng:" trên đầu. Đúng một con số, vì cả ba vốn bằng nhau.
       · ≥2 sheet → "Tổng:" là tổng cộng, và MỖI TAB tự mang số của nó. Thông tin nằm ngay chỗ
         mắt đang nhìn, không tốn thêm khối nào.
     Dòng của GridTable tắt ở cả hai ca (`sheetTotalLine={false}`). */
  const ID_LUOI = "hn";
  const tongBang = tables.map((x) => extraTableSum(x as ExtraTable, !!tplOf(x)?.layout?.hasDays));
  const tong = tongBang.reduce((a, b) => a + b, 0);
  const hienTongTab = tables.length > 1;

  const themBang = () => {
    const it = M.blankItem(false) as ItemK; it._k = nextK();
    tables.push({ templateId: t?.templateId || mauBangMoi, name: "", groupSubtotal: true, items: [it], _k: nextK() });
    setMo(true);   // bấm "+ Thêm sheet" khi khối đang đóng mà không mở ra thì tưởng nút hỏng
    setActive(tables.length - 1);
    onChange();
  };
  const xoaBang = async (i: number) => {
    if (bangCoHangKhoa(tables[i] ?? null)) { toast("Sheet có hàng đã duyệt / đã gửi duyệt — không xoá được. Bỏ duyệt (hoặc chờ trả lại) trước.", "error"); return; }
    // L61 (đợt 3): trả lời hộp treo sau khi editor / màn Account HN đã gỡ = coi như Hủy — không xoá bảng
    // của báo giá đã rời, không gọi mark() của màn đã gỡ (bật cờ `__editorDirty` DÙNG CHUNG trang mới).
    const r = await removeTableFromList(tables as ExtraTable[], i, ai, (tbl) => confirmModal(
      "Xoá sheet Hà Nội?",
      `Sheet "${tbl.name || `Bảng ${i + 1}`}" đã có dòng điền — xoá là mất luôn ngăn hoàn tác của lưới, Ctrl+Z không lấy lại được. Tiếp tục?`,
      { danger: true, confirmText: "Xoá" },
    ).then((dong) => dong && songRef.current));
    // Bảng có hàng kế toán đã đánh dấu ĐÃ CHI: lõi chặn trước cả hộp hỏi (xem removeTableFromList).
    if (r.chan) { toast(loiXoaBangDaChi(r.chan), "error"); return; }
    if (!r.removed) return;
    setActive(r.active);
    onChange();
  };

  /** Ô cột DUYỆT của một hàng: trạng thái + nút (Account HN: Gửi; người có quyền duyệt: Duyệt / Bỏ duyệt / Trả). */
  const oDuyet = (it: HangHn) => {
    const tt = trangThaiHn(it);
    const rid = typeof it.rid === "string" ? it.rid : null;
    const lam = (loai: ThaoTacHangHn) => { if (rid && onHanhDong && !dangXuLy) onHanhDong(loai, [rid]); };
    return (
      <span className="hn-duyet" data-tt={tt}>
        <span className={`hn-tt hn-tt-${tt}`} title={tt === "tra-lai" && it.lyDoTra ? `Lý do trả: ${it.lyDoTra}` : undefined}>
          {NHAN_TRANG_THAI_HN[tt]}{tt === "da-duyet" && it.approvedAt ? ` ${M.fmtDate(it.approvedAt)}` : ""}
        </span>
        {tt === "tra-lai" && it.lyDoTra ? <span className="hn-ly-do muted"> — {it.lyDoTra}</span> : null}
        {onHanhDong && !rid ? <span className="muted" title="Hàng mới — bấm Lưu trước rồi mới gửi / duyệt"> · chưa lưu</span> : null}
        {onHanhDong && rid && cheDo === "account" && (tt === "dang-lam" || tt === "tra-lai") && (
          <button type="button" className="btn btn-xs hn-nut-gui" disabled={dangXuLy} onClick={() => lam("gui")} title="Gửi hàng này cho chủ báo giá duyệt">Gửi</button>
        )}
        {onHanhDong && rid && cheDo === "chu" && canApprove && (
          <>
            <label className="ap-wrap"><input name="approved" type="checkbox" checked={tt === "da-duyet"} disabled={dangXuLy}
              aria-label={tt === "da-duyet" ? "Bỏ duyệt hàng này" : "Duyệt hàng này"}
              onChange={(e) => lam(e.target.checked ? "duyet" : "bo-duyet")} /> Duyệt</label>
            {(tt === "cho-duyet" || tt === "da-duyet") && (
              <button type="button" className="btn btn-xs hn-nut-tra" disabled={dangXuLy} onClick={() => lam("tra")} title="Trả hàng này lại cho Account HN sửa">↩ Trả</button>
            )}
          </>
        )}
      </span>
    );
  };

  return (
    <KhoiSheet
      loai="hanoi" nhan="Báo Giá Hà Nội" soSheet={tables.length} tong={tong}
      duoiTong={<span className="muted">→ Quản lý dự án</span>}
      phuHieu={phuHieu} dieuKhien={dieuKhien}
      mo={mo}
      onDoiMo={() => setMo((v) => {
        // Đóng khối trong khi nó đang chiếm thanh nút ở đáy → trả thanh về báo giá chính, không thì
        // thanh trỏ vào một lưới đã tháo khỏi DOM và biến mất sạch.
        if (v && thanhChung?.dangLam === ID_LUOI) thanhChung.datDangLam("chinh", "Báo giá chính");
        return !v;
      })}
      dangSua
      cacSheet={tables.map((x, i) => ({ ten: x.name || `Bảng ${i + 1}`, tong: tongBang[i] }))}
      nutThem={editable ? <button type="button" className="btn btn-sm extra-add-in" data-cat="hanoi" onClick={themBang}>+ Thêm sheet</button> : null}
    >
      {tables.length > 0 && (
        <div className="sheet-tabs extra-sheet-tabs" role="tablist" aria-label="Các sheet Hà Nội">
          {tables.map((tt, i) => (
            // Bàn phím: <div> trần không nhận tiêu điểm → người dùng bàn phím không đổi được sheet.
            // Dùng lại đúng khuôn của QuoteEditor: role + tabIndex + Enter/Space.
            <div key={tt._k ?? i} role="tab" tabIndex={0} aria-selected={i === ai}
              className={`sheet-tab ${i === ai ? "active" : ""}`}
              onClick={() => setActive(i)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActive(i); } }}>
              <span>{tt.name || `Bảng ${i + 1}`}</span>
              {hienTongTab && <span className="sheet-tab-tong" title="Tổng của sheet này">{M.fmtMoney(tongBang[i])}</span>}
              {editable && tables.length > 1 && (
                <button type="button" className="rm-tab" title="Xoá sheet này" aria-label={`Xoá sheet Hà Nội ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); void xoaBang(i); }}
                  onKeyDown={(e) => e.stopPropagation()}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}

      {t ? (
        <div className="extra-table extra-table-inline">
          <div className="extra-table-head" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
            {/* `key` theo bảng: input uncontrolled (defaultValue) chỉ đọc giá trị lúc MOUNT, nên đổi
                tab mà không đổi key thì ô tên vẫn hiện tên của bảng trước. */}
            <input name="tenSheet" key={`ten-${t._k ?? ai}`} className="extra-name" defaultValue={t.name || ""} placeholder={`Tên sheet — đang hiện "${t.name || `Bảng ${ai + 1}`}"`} aria-label="Tên sheet Hà Nội" disabled={!editable || bangCoHangKhoa(t)} title={bangCoHangKhoa(t) ? "Sheet có hàng đã duyệt — tên sheet đi theo khoản chi nên bị khoá" : undefined} onInput={(e) => { t.name = (e.target as HTMLInputElement).value; danhDau(); }} />
            {editable && !bangCoHangKhoa(t) && (
              <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>Mẫu:
                <select name="templateId" value={t.templateId || defTplId} className="extra-tpl extra-add-cat" onChange={(e) => { t.templateId = Number(e.target.value); onChange(); }}>
                  {sapMauHienThi(tplList).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <GridTable key={`hn-${ai}-${t.templateId}-${t._k}-${vKhoa}`} items={t.items} fxBar
            clfTheme={!!tplOf(t)?.code?.startsWith("clofull")}   // bảng phụ của báo giá Colorfull phải cùng màu với lưới chính và với tệp Excel
            usesDays={usesDays} showDetail={showDetail} addrDetail={addrDetail} numberSubs={numberSubs}
            editable={editable} internalNote={false} cotNoiBo
            approveCol canApprove={!!canApprove} payCol daChi={daChi}
            khoaHang={(it) => khoa(it as HangHn)} moCotNoiBoKhiKhoa={moCotNoiBo}
            oDuyet={(i) => oDuyet(t.items[i] as unknown as HangHn)}
            duyetSig={`${cheDo}|${!!onHanhDong}|${dangXuLy}`}
            groupSubtotal={!!t.groupSubtotal} onGroupSubtotal={(v) => { t.groupSubtotal = v; onChange(); }} onChange={onChange}
            sheetTotalLine={false}
            dock={thanhChung ? thanhChung.dock : undefined}
            anThanhThem={!!thanhChung && thanhChung.dangLam !== ID_LUOI}
            onDangDung={thanhChung ? () => thanhChung.datDangLam(ID_LUOI, `Hà Nội · ${t.name || `Bảng ${ai + 1}`}`) : undefined} />
        </div>
      ) : (
        <div className="muted" style={{ padding: "6px 0 2px" }}>Chưa có sheet Hà Nội — bấm “+ Thêm sheet” phía trên.</div>
      )}
    </KhoiSheet>
  );
}
