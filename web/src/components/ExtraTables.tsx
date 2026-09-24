import { useEffect, useRef, useState } from "react";
import * as M from "../lib/quoteMath";
import { type ItemK, nextK, type ThanhChung } from "../lib/gridShared";
import { GridTable, safeImgSrc } from "./GridTable";
import { api, ApiError, type EditorTemplate } from "../lib/api";
import { confirmModal, toast, useEscClose } from "../lib/ui";
import { KhoiSheet } from "./KhoiSheet";

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
// đường Lưu (QuoteEditor / AccountHnView) mới gửi days: null. Không truyền → như máy chủ (nhân days > 0):
// dữ liệu đã lưu vốn đã được dọn lúc Lưu (InternalQuoteView gọi kiểu này).
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
    if (Array.isArray(it.images) && it.images.length > 0) return true;
    if (it.formulas && Object.keys(it.formulas).length > 0) return true;
    // cờ duyệt (approveCol) + cờ thanh toán nội bộ (payCol, xem PayDialog bên dưới)
    return !!(it.approved || r.paid || r.hasPaidProof || r.paidAt);
  });
}

// LÕI DÙNG CHUNG của MỌI đường xoá bảng nội bộ: bảng đã có dữ liệu thì phải HỎI trước, huỷ thì
// không đụng vào mảng; trả luôn chỉ số tab đang mở sau khi xoá.
// Có hai màn hình xoá bảng loại này — "Bảng nội bộ" ở editor (dưới đây) và bảng Hà Nội ở
// AccountHnView — và trước đây màn HN CHÉP TAY lại toàn bộ logic (hasData + hỏi + splice + dịch
// tab). Hai bản chép tay trôi khỏi nhau là chuyện thời gian: nới `extraTableHasData` ở một chỗ thì
// bên kia vẫn xoá thẳng. Nay cả hai gọi chung hàm này.
export async function removeTableFromList(
  tables: ExtraTable[] | undefined,
  i: number,
  active: number,
  confirmRemove: (t: ExtraTable) => Promise<boolean>,
): Promise<{ removed: boolean; active: number }> {
  if (!Array.isArray(tables) || !tables[i]) return { removed: false, active };
  if (extraTableHasData(tables[i]) && !(await confirmRemove(tables[i]))) return { removed: false, active };
  tables.splice(i, 1);
  let a = active || 0; if (a > i) a--; if (a >= tables.length) a = tables.length - 1; if (a < 0) a = 0;
  return { removed: true, active: a };
}

// ĐƯỜNG XOÁ DUY NHẤT của sheet nội bộ ở editor. Trước đây nút ✕ (nằm sát nhãn tab) splice thẳng,
// không hỏi: bấm nhầm là mất cả cờ duyệt/thanh toán từng hàng lẫn phần tổng đổ sang Quản lý dự án,
// mà Ctrl+Z không cứu được vì ngăn hoàn tác nằm TRONG GridTable của chính sheet vừa bị gỡ khỏi cây.
// Tách khỏi component để kiểm thử được ngoài trình duyệt (web/ không có jsdom).
export async function removeExtraTableAt(
  sheet: { extraTables?: ExtraTable[]; _activeExtra?: number },
  i: number,
  confirmRemove: (t: ExtraTable) => Promise<boolean>,
): Promise<boolean> {
  const r = await removeTableFromList(sheet.extraTables, i, sheet._activeExtra || 0, confirmRemove);
  if (r.removed) sheet._activeExtra = r.active;
  return r.removed;
}

export function ExtraTables({ sheet, templates, companyId, editable, editableCat, canApprove, canPay, quoteId, onMarkDirty, onQuoteTouched, thanhChung }: {
  sheet: Sheet; templates: EditorTemplate[]; companyId?: number; editable: boolean; canApprove: boolean;
  /**
   * PHẠM VI theo TỪNG LOẠI bảng — dành cho "account phụ" chỉ được giao một phần (vd chỉ bảng Hà
   * Nội). CỐ Ý chỉ trả lời "có được giao loại này không", KHÔNG nhân với `editable`: cột THANH
   * TOÁN cũng gác bằng nó, mà thanh toán là năng lực ĐỘC LẬP với việc báo giá còn sửa được hay
   * không (kế toán vẫn tích được trên báo giá đã chốt). Không truyền → mọi loại đều trong phạm vi,
   * hành vi y như trước (AccountHnView đang gọi như vậy). Là HÀM chứ không phải Set/mảng:
   * gridPropsEqual bỏ qua prop hàm nên memo của lưới không bị phá.
   */
  editableCat?: (cat: string) => boolean;
  canPay?: boolean; quoteId?: number; onMarkDirty: () => void;
  /** Thanh "+ Thêm hàng…" dùng chung ở đáy trang. Vắng = mỗi lưới tự vẽ tại chỗ (đường cũ). */
  thanhChung?: ThanhChung;
  /** Mốc `updatedAt` MỚI sau khi route /pay bump — editor phải nhận để khỏi tự đâm 409 giả (xem ExtraPayDialog). */
  onQuoteTouched?: (updatedAt: string) => void;
}) {
  const [, setTick] = useState(0);
  const trongPhamVi = (cat: string) => (editableCat ? editableCat(cat) : true);
  const suaDuoc = (cat: string) => editable && trongPhamVi(cat);
  const redraw = () => setTick((t) => t + 1);
  const onChange = () => { onMarkDirty(); redraw(); };
  const [payRow, setPayRow] = useState<ItemK | null>(null); // hàng đang mở dialog thanh toán
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
    tables.push({ category: cat, templateId: defTplId, name: "", groupSubtotal: true, items: [it], _k: nextK() });
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
    ).then((dong) => dong && songRef.current));
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
                      <input className="extra-name" defaultValue={t.name || ""} placeholder={`Tên sheet — đang hiện "${t.name || `Bảng ${active + 1}`}"`} disabled={!suaDuoc(cat)} onInput={(e) => { t.name = (e.target as HTMLInputElement).value; onChange(); }} />
                      {suaDuoc(cat) && <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>Mẫu: <select value={t.templateId || defTplId} className="extra-tpl extra-add-cat" onChange={(e) => { t.templateId = Number(e.target.value); onChange(); }}>{tplList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
                      {/* "Chuyển loại" chỉ liệt kê loại người này ĐƯỢC PHÉP sửa — không thì họ kéo
                          bảng sang loại ngoài phạm vi rồi sửa ở đó (server sẽ 409, nhưng để họ gõ
                          xong mới báo là kiểu tệ nhất). */}
                      {suaDuoc(cat) && <label className="muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>Chuyển loại: <select value={t.category} className="extra-cat-sel extra-add-cat" onChange={(e) => { t.category = e.target.value; onChange(); }}>{EXTRA_CATS.filter(([v]) => v === t.category || suaDuoc(v)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
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
                      usesDays={usesDays} showDetail={showDetail} addrDetail={addrDetail} numberSubs={numberSubs} editable={suaDuoc(cat)} internalNote={false}
                      approveCol={t.category === "hcm" || t.category === "khach"} canApprove={canApprove}
                      payCol canPay={!!canPay && !!quoteId && trongPhamVi(cat)}
                      onPayRow={(it) => { if (!(it as Record<string, unknown>).rid) { toast("Lưu báo giá trước khi đánh dấu thanh toán", "error"); return; } setPayRow(it); }}
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
      {payRow && quoteId && sheet.id != null && (
        <ExtraPayDialog quoteId={quoteId} sheetId={sheet.id} item={payRow} onQuoteTouched={onQuoteTouched}
          onClose={() => setPayRow(null)}
          onSaved={(paid, hasProof) => { (payRow as Record<string, unknown>).paid = paid; (payRow as Record<string, unknown>).paidAt = paid ? new Date().toISOString() : null; (payRow as Record<string, unknown>).hasPaidProof = hasProof; setPayRow(null); redraw(); }} />
      )}
    </>
  );
}

// Dialog tích "đã thanh toán" + up ẢNH chứng từ cho 1 HÀNG nội bộ (gọi API /pay — không lưu cả báo giá).
export function ExtraPayDialog({ quoteId, sheetId, hn, item, onClose, onSaved, onQuoteTouched }: {
  /** `hn` = hàng thuộc bảng Hà Nội (cấp báo giá, không có sheetId) → gọi cặp route /hn/:rid/*. */
  quoteId: number; sheetId?: number | null; hn?: boolean; item: ItemK; onClose: () => void; onSaved: (paid: boolean, hasProof: boolean) => void;
  onQuoteTouched?: (updatedAt: string) => void;
}) {
  const it = item as Record<string, unknown>;
  const [paid, setPaid] = useState(!!it.paid);
  const [proof, setProof] = useState<string | null>(null);      // ảnh MỚI chọn
  const [existing, setExisting] = useState<string | null>(null); // ảnh đã có (fetch on-demand)
  useEscClose(onClose); // ESC đóng — đồng bộ với 12 modal còn lại của app
  const [saving, setSaving] = useState(false);
  const rid = String(it.rid);
  useEffect(() => { if (it.hasPaidProof) (hn ? api.getHnProof(quoteId, rid) : api.getExtraProof(quoteId, sheetId as number, rid)).then((r) => setExisting(r.paidProof)).catch(() => {}); }, [quoteId, sheetId, hn, rid, it.hasPaidProof]);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { toast("Chỉ nhận ảnh PNG/JPG/WEBP", "error"); return; }
    try { setProof(await compressImage(f)); } catch { toast("Không đọc được ảnh", "error"); }
  };
  const save = async () => {
    setSaving(true);
    try {
      const r = hn
        ? await api.markHnPay(quoteId, rid, paid, paid && proof ? proof : (paid ? undefined : ""))
        : await api.markExtraPay(quoteId, sheetId as number, rid, paid, paid && proof ? proof : (paid ? undefined : ""));
      // Route /pay BUMP `Quote.updatedAt` để chống lost-update chéo. Người tích ô này thường ĐANG MỞ
      // chính báo giá đó, mà editor gửi `baseUpdatedAt` đã tải lúc Lưu — không nhận mốc mới thì lần
      // Lưu kế tiếp ăn 409 "Báo giá vừa được người khác cập nhật" do CHÍNH HỌ, và phần vừa gõ có
      // nguy cơ mất khi họ tải lại theo lời khuyên của thông báo.
      if (r?.updatedAt) onQuoteTouched?.(r.updatedAt);
      toast("Đã lưu thanh toán", "success");
      onSaved(paid, paid ? (!!proof || !!existing) : false);
    } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); setSaving(false); }
  };
  const img = proof || existing;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Thanh toán dòng nội bộ" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Thanh toán: {String(it.name || "(dòng nội bộ)").slice(0, 60)}</h3><button className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            <span><strong>Đã thanh toán</strong> dòng này</span>
          </label>
          {paid && <div style={{ marginTop: 12 }}>
            <label className="muted" style={{ fontSize: 13 }}>Ảnh chứng từ (tuỳ chọn):</label>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files?.[0])} style={{ display: "block", marginTop: 5 }} />
            {img && <img src={safeImgSrc(img)} alt="chứng từ" style={{ maxWidth: "100%", maxHeight: 240, marginTop: 8, borderRadius: 8, border: "1px solid var(--line)" }} />}
          </div>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Đang lưu…" : "Lưu"}</button>
        </div>
      </div>
    </div>
  );
}

// Nén ảnh client (≤1280px, JPEG 0.7) → base64 data URL (giống PaymentDialog nhân sự).
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => {
        const max = 1280; let { width: w, height: h } = im;
        if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d"); if (!ctx) return reject(new Error("no ctx"));
        ctx.drawImage(im, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.7));
      };
      im.onerror = reject; im.src = String(r.result);
    };
    r.onerror = reject; r.readAsDataURL(file);
  });
}
