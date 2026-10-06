import { useEffect, useRef, useState } from "react";
import * as M from "../lib/quoteMath";
import { type ItemK, nextK, type ThanhChung } from "../lib/gridShared";
import { GridTable } from "./GridTable";
import { type EditorTemplate } from "../lib/api";
import { confirmModal, toast } from "../lib/ui";
import { KhoiSheet } from "./KhoiSheet";
import type { DaChiTheoRid } from "../lib/daChiHang";
import { sapMauHienThi, mauMacDinhMoi } from "../lib/thuTuMau";

// Port "Bảng nội bộ" (public/js/editor.js drawExtraTables). Mỗi LOẠI (HCM · HN · Phí KH) tách RIÊNG;
// mỗi loại có N sheet (lưới ĐẦY ĐỦ như báo giá: template/công thức/nhóm/copy-paste/undo — qua GridTable)
// nhưng KHÔNG xuất Excel. Tổng từng loại đổ riêng sang "Quản lý dự án" (HCM/Phí-KH chỉ cộng hàng ĐÃ DUYỆT).

// "Báo Giá Hà Nội" KHÔNG còn ở đây từ 2026-09-15: nó lên cấp BÁO GIÁ (Quote.hnTables) và có màn
// riêng — xem components/HnTables.tsx. Bảng theo TRANG nay chỉ còn hai loại.
const EXTRA_CATS: [string, string][] = [["hcm", "Chi Phí HCM"], ["khach", "Phí Khách Hàng"]];

export type ExtraTable = { category: string; templateId?: number; name?: string; groupSubtotal?: boolean; items: ItemK[]; _k?: number };
type Sheet = { id?: number; extraTables?: ExtraTable[]; _activeExtra?: number; templateId?: number };

// Tổng 1 bảng nội bộ — KHỚP src/quoteUtils.js extraTableSum (số đổ sang Quản lý dự án): bỏ
// section/subsection/info; HCM/Phí-KH chỉ cộng hàng đã DUYỆT; qty×(days nếu>0)×price làm tròn từng dòng.
//
// `usesDays` (L64, đợt 3): mẫu của bảng có cột Số Ngày không. `false` → KHÔNG nhân days: bảng đang soạn
// dùng mẫu không ngày vẫn GIỮ số Ngày cũ (đổi mẫu qua lại không mất — trước đây bị xoá ngay lúc vẽ), và
// đường Lưu (QuoteEditor / AccountHnView) mới gửi days: null. Không truyền → nhân days > 0 như trước.
// Đợt 4: mọi nơi hiện tổng đều truyền theo mẫu — kể cả InternalQuoteView và máy chủ (quoteUtils
// extraTableSum + bangNoiBoCoNgay, cùng luật chọn mẫu với mauBangHn) — để dữ liệu CŨ còn days ở bảng mẫu
// không ngày ra MỘT con số trên màn soạn, trang chi phí nội bộ và Quản lý dự án.
export function extraTableSum(t: ExtraTable, usesDays?: boolean): number {
  const approvedOnly = t && (t.category === "hcm" || t.category === "khach");
  return (t?.items || []).reduce((acc, it) => {
    if (it.kind === "section" || it.kind === "subsection" || it.kind === "info") return acc;
    if (approvedOnly && !it.approved) return acc;
    const qty = M.qtyForAmount(it), price = Number(it.unitPrice) || 0;
    const days = usesDays !== false && it.days != null ? Number(it.days) : null;
    return acc + Math.round(days && days > 0 ? qty * days * price : qty * price);
  }, 0);
}

// Sheet đã có người điền vào chưa? Dùng để quyết định có phải HỎI trước khi xoá: sheet mới tạo còn
// trống thì xoá nhầm cũng chẳng mất gì.
//
// Trước đây phép đo này CHỈ nhìn name/detail/quantity/unitPrice, nên bảng mà mọi dòng chỉ có GHI
// CHÚ, CÔNG THỨC, ẢNH, hoặc đã tích DUYỆT/THANH TOÁN bị coi là "trống" và xoá THẲNG không hỏi —
// trong khi cờ duyệt/thanh toán (có chứng từ đính kèm) mới là thứ không dựng lại được.
//
// KHÔNG tính `days`: `M.blankItem(usesDays)` đặt sẵn days = 1 cho mẫu có cột Số Ngày
// (shared/quote-math.ts:125) → tính vào thì bảng mới tinh cũng bị hỏi vô cớ.
export function extraTableHasData(t: ExtraTable | null | undefined): boolean {
  return (t?.items || []).some((it) => {
    const r = it as unknown as Record<string, unknown>;
    const chu = (v: unknown) => typeof v === "string" && v.trim() !== "";
    if (chu(it.name) || chu(it.detail) || it.quantity || it.unitPrice) return true;
    if (chu(it.unit) || chu(it.notes) || chu(it.internalNote) || chu(r.label)) return true;
    // ba cột nội bộ (NS · CHỨNG TỪ · LƯU KHO) — bảng chỉ mới điền chúng vẫn là bảng CÓ dữ liệu
    if (chu(r.ns) || chu(r.chungTu) || r.luuKho === true) return true;
    if (Array.isArray(it.images) && it.images.length > 0) return true;
    if (it.formulas && Object.keys(it.formulas).length > 0) return true;
    // cờ duyệt (approveCol) + cờ đã chi / ảnh chứng từ (LỚP PHỦ máy chủ gắn theo khoản kế toán — bảng có hàng
    // `paid === true` thì removeTableFromList chặn hẳn trước khi tới đây; cờ lẻ còn lại vẫn đáng hỏi)
    return !!(it.approved || r.paid || r.hasPaidProof || r.paidAt);
  });
}

/** Số hàng kế toán đã đánh dấu ĐÃ CHI trong một bảng. `paid === true` là giá trị LỚP PHỦ máy chủ gắn theo khoản
 *  (trang Hóa đơn đầu vào) — màn soạn không ghi được nó. Bỏ nhóm / nhóm con / dòng thông tin như máy chủ
 *  (hangCuaPhia, src/khoanChi.ts). */
export function soHangDaChi(t: ExtraTable | null | undefined): number {
  return (t?.items || []).filter((it) => it.kind !== "section" && it.kind !== "subsection" && it.kind !== "info"
    && (it as unknown as Record<string, unknown>).paid === true).length;
}

/** Số hàng ĐÃ CHI trong bảng nội bộ của MỘT trang — chỉ Chi phí HCM / Phí KH, tức phía "sheet" của máy chủ: bản
 *  "hanoi" cũ còn sót trong trang không thuộc phía nào (hangCuaPhia) nên không tính. Màn soạn chặn xoá trang theo nó. */
export function soHangDaChiCuaTrang(extraTables: unknown[] | undefined): number {
  return (Array.isArray(extraTables) ? (extraTables as ExtraTable[]) : [])
    .reduce((n, t) => n + (t && EXTRA_CATS.some(([c]) => c === t.category) ? soHangDaChi(t) : 0), 0);
}

/** Câu báo khi chặn xoá sheet (bảng nội bộ / bảng Hà Nội / trang báo giá) có hàng ĐÃ CHI — một chỗ cho mọi nơi gọi. */
export const loiXoaBangDaChi = (soHang: number) =>
  `Không xoá được sheet: có ${soHang} khoản kế toán đã đánh dấu ĐÃ CHI — nhờ kế toán bỏ đánh dấu ở trang Hóa đơn đầu vào trước.`;

// LÕI DÙNG CHUNG của MỌI đường xoá bảng nội bộ: bảng đã có dữ liệu thì phải HỎI trước, huỷ thì
// không đụng vào mảng; trả luôn chỉ số tab đang mở sau khi xoá.
// Có hai màn hình xoá bảng loại này — "Bảng nội bộ" ở editor (dưới đây) và bảng Hà Nội ở
// AccountHnView — và trước đây màn HN CHÉP TAY lại toàn bộ logic (hasData + hỏi + splice + dịch
// tab). Hai bản chép tay trôi khỏi nhau là chuyện thời gian: nới `extraTableHasData` ở một chỗ thì
// bên kia vẫn xoá thẳng. Nay cả hai gọi chung hàm này.
//
// 2026-10-06 — CHẶN bảng có hàng ĐÃ CHI (kế toán đánh dấu ở trang Hóa đơn đầu vào): không hỏi, không xoá, trả
// `chan` = số hàng đó để nơi gọi báo (loiXoaBangDaChi). Máy chủ vốn từ chối lần Lưu làm mất hàng đã chi (400
// 'hang-da-chi'), nhưng xoá cả BẢNG thì Ctrl+Z không cứu được (xem removeExtraTableAt) — để tới lúc Lưu mới biết
// là đẩy người dùng tới tải lại trang, mất luôn phần chưa lưu khác. Đo bằng cờ của lớp phủ, nên màn nạp TRƯỚC lần
// tích không biết hàng đó đã chi — khi ấy lần Lưu vẫn bị máy chủ chặn đúng.
export async function removeTableFromList(
  tables: ExtraTable[] | undefined,
  i: number,
  active: number,
  confirmRemove: (t: ExtraTable) => Promise<boolean>,
): Promise<{ removed: boolean; active: number; chan?: number }> {
  if (!Array.isArray(tables) || !tables[i]) return { removed: false, active };
  const chan = soHangDaChi(tables[i]);
  if (chan > 0) return { removed: false, active, chan };
  if (extraTableHasData(tables[i]) && !(await confirmRemove(tables[i]))) return { removed: false, active };
  tables.splice(i, 1);
  let a = active || 0; if (a > i) a--; if (a >= tables.length) a = tables.length - 1; if (a < 0) a = 0;
  return { removed: true, active: a };
}

// ĐƯỜNG XOÁ DUY NHẤT của sheet nội bộ ở editor. Trước đây nút ✕ (nằm sát nhãn tab) splice thẳng,
// không hỏi: bấm nhầm là mất cả cờ duyệt/thanh toán từng hàng lẫn phần tổng đổ sang Quản lý dự án,
// mà Ctrl+Z không cứu được vì ngăn hoàn tác nằm TRONG GridTable của chính sheet vừa bị gỡ khỏi cây.
// Tách khỏi component để kiểm thử được ngoài trình duyệt (web/ không có jsdom).
// `baoChan`: bảng có hàng ĐÃ CHI bị lõi chặn → nhận số hàng để báo. Hàm này không tự toast (chạy được ngoài DOM).
export async function removeExtraTableAt(
  sheet: { extraTables?: ExtraTable[]; _activeExtra?: number },
  i: number,
  confirmRemove: (t: ExtraTable) => Promise<boolean>,
  baoChan?: (soHang: number) => void,
): Promise<boolean> {
  const r = await removeTableFromList(sheet.extraTables, i, sheet._activeExtra || 0, confirmRemove);
  if (r.chan) baoChan?.(r.chan);
  if (r.removed) sheet._activeExtra = r.active;
  return r.removed;
}

// Cột THANH TOÁN (2026-10-06): việc tích ĐÃ CHI + ảnh chứng từ ở trang Hóa đơn đầu vào của kế toán (InvoicesIn);
// ở đây chỉ HIỆN đã chi chưa / ngày / ai tích (chủ repo: "cái thanh toán hiện đã thanh toán ở đây ngày như nào chứ")
// — cột chỉ xem, không nút, không ghi gì vào hàng. Nguồn `daChi` (lib/daChiHang), thiếu thì cờ lớp phủ lúc nạp.
export function ExtraTables({ sheet, templates, companyId, editable, editableCat, canApprove, moCotNoiBo = false, onMarkDirty, thanhChung, daChi }: {
  sheet: Sheet; templates: EditorTemplate[]; companyId?: number; editable: boolean; canApprove: boolean;
  /** Hàng ĐÃ DUYỆT vẫn mở NS · Chứng từ · Lưu kho (chủ báo giá / người có quyền duyệt — khớp máy chủ). */
  moCotNoiBo?: boolean;
  /**
   * PHẠM VI theo TỪNG LOẠI bảng — dành cho "account phụ" chỉ được giao một phần (vd chỉ bảng Hà
   * Nội). CỐ Ý chỉ trả lời "có được giao loại này không", KHÔNG nhân với `editable` — `suaDuoc`
   * ghép hai điều kiện. Không truyền → mọi loại đều trong phạm vi, hành vi y như trước
   * (AccountHnView đang gọi như vậy). Là HÀM chứ không phải Set/mảng: gridPropsEqual bỏ qua prop
   * hàm nên memo của lưới không bị phá.
   */
  editableCat?: (cat: string) => boolean;
  onMarkDirty: () => void;
  /** Thanh "+ Thêm hàng…" dùng chung ở đáy trang. Vắng = mỗi lưới tự vẽ tại chỗ (đường cũ). */
  thanhChung?: ThanhChung;
  /** Trạng thái ĐÃ CHI từng hàng (phía "sheet" của useDaChiBaoGia) — cột Thanh toán chỉ xem. */
  daChi?: DaChiTheoRid | null;
}) {
  const [, setTick] = useState(0);
  const trongPhamVi = (cat: string) => (editableCat ? editableCat(cat) : true);
  const suaDuoc = (cat: string) => editable && trongPhamVi(cat);
  const redraw = () => setTick((t) => t + 1);
  const onChange = () => { onMarkDirty(); redraw(); };
  /* Khối nào đang mở. Chưa đụng tới thì theo mặc định: ĐÓNG HẾT — trang soạn báo giá vốn đã dài,
     và tiêu đề đã nói đủ số sheet + số tiền nên đóng vẫn đọc được. Xem KhoiSheet.tsx. */
  const [mo, setMo] = useState<Record<string, boolean>>({});
  // L61: component còn gắn không — hộp hỏi xoá bảng không tự đóng khi rời trang (xem removeTable).
  const songRef = useRef(true);
  useEffect(() => { songRef.current = true; return () => { songRef.current = false; }; }, []);

  if (!Array.isArray(sheet.extraTables)) sheet.extraTables = [];
  const tables = sheet.extraTables;
  tables.forEach((x) => { if (x._k == null) x._k = nextK(); (x.items || []).forEach((it) => { if (it._k == null) it._k = nextK(); }); });

  const tplList0 = templates.filter((t) => t.companyId === companyId);
  const tplList = tplList0.length ? tplList0 : templates;
  const defTplId = tplList[0]?.id || sheet.templateId;
  // Bảng MỚI chọn sẵn mẫu đầu theo thứ tự hiển thị (Không ngày → Banner → Có ngày). KHÔNG đổi defTplId: nó là mẫu
  // dự phòng của bảng CŨ chưa gắn mẫu, quyết định có nhân Số Ngày — đổi là đổi tiền báo giá cũ.
  const mauBangMoi = mauMacDinhMoi(templates, companyId)?.id || defTplId;
  const tplOf = (t: ExtraTable) => templates.find((x) => x.id === (t.templateId || defTplId)) || tplList[0];
  // L64 (đợt 3): KHÔNG còn xoá `days` lúc vẽ khi bảng dùng mẫu không ngày (bản cũ, theo drawExtraTables
  // SPA) — đổi mẫu qua lại là mất số Ngày vĩnh viễn, và mở bảng còn days cũ là bị coi "đã sửa". Tổng chỉ
  // nhân ngày khi mẫu CÓ ngày (`coNgay`), còn save() của QuoteEditor gửi days: null cho mẫu không ngày.
  const coNgay = (x: ExtraTable) => !!tplOf(x)?.layout?.hasDays;
  const catTotal = (cat: string) => tables.reduce((a, x) => a + (x?.category === cat ? extraTableSum(x, coNgay(x)) : 0), 0);
  const idLuoi = (cat: string) => `extra:${cat}`;

  let active = Number.isInteger(sheet._activeExtra) ? (sheet._activeExtra as number) : 0;
  if (active >= tables.length) active = tables.length - 1;
  if (active < 0) active = 0;
  sheet._activeExtra = active;
  const t = tables[active] || null;
  const tpl = t ? tplOf(t) : null;
  const showDetail = !!tpl?.layout?.hasDetail, usesDays = !!tpl?.layout?.hasDays, numberSubs = !!tpl?.layout?.numberSubsections;
  const addrDetail = !!(tpl?.layout?.reserveDetail ?? tpl?.layout?.hasDetail);   // giữ chỗ địa chỉ ô (xem QuoteEditor)

  const addTable = (cat: string) => {
    const it = M.blankItem(false) as ItemK; it._k = nextK();
    tables.push({ category: cat, templateId: mauBangMoi, name: "", groupSubtotal: true, items: [it], _k: nextK() });
    setMo((m) => ({ ...m, [cat]: true }));   // thêm vào khối đang đóng thì phải mở ra mới thấy
    sheet._activeExtra = tables.length - 1; onChange();
  };
  const removeTable = async (i: number) => {
    // L61 (đợt 3): trả lời hộp treo sau khi đã gỡ (Back lúc hộp đang mở) = coi như Hủy — không xoá bảng
    // của báo giá đã rời, không gọi mark() của editor đã gỡ (bật cờ `__editorDirty` DÙNG CHUNG trang mới).
    const ok = await removeExtraTableAt(sheet, i, (tbl) => confirmModal(
      "Xoá sheet nội bộ?",
      `Sheet "${tbl.name || `Bảng ${i + 1}`}" đã có dòng điền — xoá là mất luôn ngăn hoàn tác của lưới, Ctrl+Z không lấy lại được. Tiếp tục?`,
      { danger: true, confirmText: "Xoá sheet" },
    ).then((dong) => dong && songRef.current), (n) => toast(loiXoaBangDaChi(n), "error"));
    if (ok) onChange();
  };

  /* GẬP HAI TẦNG LÀ THỪA: trước đây cả cụm nằm trong một <details> "Bảng nội bộ", bên trong lại là
     các loại luôn mở. Muốn tới một loại phải bấm hai lần, mà mở ra thì MỌI loại bung cùng lúc. Nay
     bỏ tầng ngoài, mỗi LOẠI tự gập — đúng thứ người dùng xin ("có đóng mở từng cái"). */
  return (
    <>
      <div className="extra-tables-wrap">
        <div className="extra-cat-groups">
          {EXTRA_CATS.map(([cat, label]) => {
            const idxs: number[] = []; tables.forEach((x, i) => { if (x?.category === cat) idxs.push(i); });
            const hasActive = t != null && idxs.includes(active);   // sheet ĐANG sửa thuộc loại này?
            const dangMo = mo[cat] ?? false;
            return (
              <KhoiSheet key={cat}
                loai={cat} nhan={label} soSheet={idxs.length} tong={catTotal(cat)}
                duoiTong={<span className="muted">→ Quản lý dự án</span>}
                dangSua={hasActive}
                mo={dangMo}
                onDoiMo={() => {
                  // Đóng khối đang chiếm thanh nút ở đáy → trả thanh về báo giá chính, không thì
                  // thanh trỏ vào một lưới đã tháo khỏi DOM và biến mất sạch.
                  if (dangMo && thanhChung?.dangLam === idLuoi(cat)) thanhChung.datDangLam("chinh", "Báo giá chính");
                  setMo((m) => ({ ...m, [cat]: !dangMo }));
                }}
                cacSheet={idxs.map((i, n) => ({ ten: tables[i].name || `Bảng ${n + 1}`, tong: extraTableSum(tables[i], coNgay(tables[i])) }))}
                giaiThich="Sheet đầy đủ như báo giá (mẫu · công thức · nhóm · copy/dán) nhưng KHÔNG xuất Excel. Tổng của loại này đổ riêng sang Quản lý dự án."
                nutThem={suaDuoc(cat) ? <button type="button" className="btn btn-sm extra-add-in" data-cat={cat} onClick={() => addTable(cat)}>+ Thêm sheet</button> : null}
              >
                {idxs.length > 0 && (
                  <div className="sheet-tabs extra-sheet-tabs">
                    {idxs.map((i) => (
                      // BÀN PHÍM: một <div> trần không nhận được tiêu điểm, nên phím Tab đi thẳng
                      // qua cả dải tab — người dùng bàn phím không đổi được sheet, cũng không xoá
                      // được. Hai nơi vẽ đúng dải tab này (QuoteEditor, AccountHnView) đã sửa; đây
                      // là chỗ cuối còn sót. Dùng lại y nguyên mẫu của QuoteEditor để quy ước khỏi
                      // trôi tiếp: role + tabIndex + Enter/Space cho tab, còn nút xoá là <button>
                      // thật (tự vào thứ tự Tab, tự nhận Enter/Space, có tên đọc lên được thay vì
                      // mỗi dấu ✕ trần).
                      <div key={tables[i]._k ?? i} role="button" tabIndex={0} aria-pressed={i === active}
                        className={`sheet-tab ${i === active ? "active" : ""}`} title={label}
                        onClick={() => { sheet._activeExtra = i; redraw(); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sheet._activeExtra = i; redraw(); } }}>
                        <span>{tables[i].name || ("Bảng " + (i + 1))}</span>
                        {/* Trước đây loại có 5 sheet vẫn chỉ hiện MỘT con số — tổng của cả loại — nên
                            muốn biết sheet nào góp bao nhiêu thì phải bấm qua từng tab rồi tự cộng
                            nhẩm. Người dùng báo: "mỗi cái chưa có tổng các sheet như báo giá".
                            Một sheet thì không in: "Tổng:" của loại ngay trên đã đúng bằng nó. */}
                        {idxs.length > 1 && <span className="sheet-tab-tong" title="Tổng của sheet này">{M.fmtMoney(extraTableSum(tables[i], coNgay(tables[i])))}</span>}
                        {/* onKeyDown chặn nổi bọt: nếu không, Enter trên nút xoá còn kích hoạt luôn
                            handler của tab cha ở trên → vừa xoá vừa đổi sheet trong một nhịp phím. */}
                        {suaDuoc(cat) && <button type="button" className="rm-tab" title="Xoá sheet nội bộ này"
                          aria-label={`Xoá sheet nội bộ ${i + 1}`}
                          onClick={(e) => { e.stopPropagation(); void removeTable(i); }}
                          onKeyDown={(e) => e.stopPropagation()}>✕</button>}
                      </div>
                    ))}
                  </div>
                )}
                {/* Lưới nằm NGAY TRONG loại đang chọn (dưới tab của nó) → rõ "đang ở đâu". */}
                {hasActive && t && (
                  <div className="extra-table extra-table-inline">
                    <div className="extra-table-head">
                      <span className={`extra-here cat-${cat}`}>📍 Đang ở: {label}</span>
                      <input name="tenSheet" className="extra-name" defaultValue={t.name || ""} placeholder={`Tên sheet — đang hiện "${t.name || `Bảng ${active + 1}`}"`} disabled={!suaDuoc(cat)} onInput={(e) => { t.name = (e.target as HTMLInputElement).value; onChange(); }} />
                      {suaDuoc(cat) && <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>Mẫu: <select name="templateId" value={t.templateId || defTplId} className="extra-tpl extra-add-cat" onChange={(e) => { t.templateId = Number(e.target.value); onChange(); }}>{sapMauHienThi(tplList).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
                      {/* "Chuyển loại" chỉ liệt kê loại người này ĐƯỢC PHÉP sửa — không thì họ kéo
                          bảng sang loại ngoài phạm vi rồi sửa ở đó (server sẽ 409, nhưng để họ gõ
                          xong mới báo là kiểu tệ nhất). */}
                      {suaDuoc(cat) && <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>Chuyển loại: <select name="category" value={t.category} className="extra-cat-sel extra-add-cat" onChange={(e) => { t.category = e.target.value; onChange(); }}>{EXTRA_CATS.filter(([v]) => v === t.category || suaDuoc(v)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
                    </div>
                    {/* `fxBar`: THANH CÔNG THỨC. Trước đây chỉ lưới chính và sheet Hà Nội mới có,
                        nên sheet HCM / Phí Khách Hàng thiếu hẳn ô địa chỉ + ô công thức, không xem
                        được công thức của ô đang chọn, không bấm-kéo ô khác để chèn tham chiếu qua
                        thanh, và không dùng được Alt+↓ gợi ý tên hạng mục. Cùng một thứ dữ liệu,
                        cùng một người nhập — không có lý do gì để ba lưới khác bộ công cụ. */}
                    <GridTable key={`extra-${active}-${t.templateId}-${t._k}`} items={t.items} fxBar
                      clfTheme={!!tplOf(t)?.code?.startsWith("clofull")}   // bảng phụ của báo giá Colorfull phải cùng màu với lưới chính và với tệp Excel
                      dock={thanhChung ? thanhChung.dock : undefined}
                      anThanhThem={!!thanhChung && thanhChung.dangLam !== idLuoi(cat)}
                      onDangDung={thanhChung ? () => thanhChung.datDangLam(idLuoi(cat), `${label} · ${t.name || `Bảng ${active + 1}`}`) : undefined}
                      usesDays={usesDays} showDetail={showDetail} addrDetail={addrDetail} numberSubs={numberSubs} editable={suaDuoc(cat)} internalNote={false} cotNoiBo
                      approveCol={t.category === "hcm" || t.category === "khach"} canApprove={canApprove}
                      /* KHOÁ HÀNG ĐÃ DUYỆT (2026-10-06, như bảng HN): ô tắt, không xoá được — kể cả với người có quyền duyệt.
                         Bỏ tích Duyệt là mở lại ngay; máy chủ chặn bản CSDL đã duyệt (409 'hang-hcm-da-khoa'). */
                      khoaHang={(it) => it.approved === true && (t.category === "hcm" || t.category === "khach")}
                      moCotNoiBoKhiKhoa={moCotNoiBo}
                      payCol={t.category === "hcm" || t.category === "khach"} daChi={daChi}
                      groupSubtotal={!!t.groupSubtotal} onGroupSubtotal={(v) => { t.groupSubtotal = v; onChange(); }} onChange={onChange}
                      sheetTotalLine={false} />
                  </div>
                )}
                {idxs.length === 0 && <div className="khoi-sheet-note muted">Chưa có sheet — bấm “+ Thêm sheet”.</div>}
              </KhoiSheet>
            );
          })}
        </div>
      </div>
    </>
  );
}
