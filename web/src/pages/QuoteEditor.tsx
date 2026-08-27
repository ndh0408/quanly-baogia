import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Me, type QuoteFull, type EditorCompany, type EditorTemplate, type QuoteVersion, type AssignableUser } from "../lib/api";
import { toast, confirmModal, promptModal } from "../lib/ui";
import { xuatBaoGia } from "../lib/exportQuote";
import * as M from "../lib/quoteMath";
import { type ItemK, nextK } from "../lib/gridShared";
import { GridTable } from "../components/GridTable";
import { ExtraTables } from "../components/ExtraTables";
import { ImportExcelModal, NEW_SHEET, type ImportApplyPayload } from "../components/ImportExcelModal";
import { takePendingNewQuote } from "../lib/pendingQuote";

// Mảng rỗng DÙNG CHUNG, identity cố định — để `_templates || []` không đẻ mảng mới mỗi lần render.
const RONG: never[] = [];

// ───────────────────────────────────────────────────────────────────────────────
// Port "Editor báo giá" (public/js/editor.js renderEditor) sang React. Form (KH/người gửi/meta) +
// multi-sheet + LƯỚI (component GridTable dùng chung) + summary + Lưu/Chốt/Không-chốt + Excel/PDF/
// Phiên-bản/Thành-viên + BẢNG NỘI BỘ (component ExtraTables). Lưới + công thức + dán + undo nằm trong
// GridTable. Ô nhập UNCONTROLLED + key _k giữ focus; qRef + tick để vẽ lại tổng.
// ───────────────────────────────────────────────────────────────────────────────

const stampKeys = (q: QuoteFull) => {
  (q.sheets as Sheet[] | undefined)?.forEach((s) => (s.items || []).forEach((it) => { (it as ItemK)._k = nextK(); }));
};
// Ý kiến khách theo TỪNG SHEET (khách chốt sheet này, chưa chốt sheet kia) — server giữ, đổi bằng
// endpoint riêng (không đi qua Lưu) nên không lẫn với trạng thái CẢ báo giá (q.status).
type Sheet = M.Sheet & {
  _k?: number;
  custStatus?: string | null; custStatusAt?: string | null; custNote?: string | null;
  custStatusBy?: { id: number; displayName: string } | null;
};
const CUST_LABEL: Record<string, string> = { approved: "Khách đã duyệt", rejected: "Khách không duyệt" };
const CUST_DOT: Record<string, string> = { approved: "✓", rejected: "✗" };
const DEFAULT_NOTE = "Tất cả các hạng mục trên là thuê, Gia Nguyễn thu hồi toàn bộ sau khi tháo dỡ";
type WinDirty = Window & { __editorDirty?: boolean };

function SummaryFormula({ label, formula, value, prefix = "", danger = false }: { label: string; formula: string; value: number; prefix?: string; danger?: boolean }) {
  const show = () => toast(`${label}: ${formula} = ${prefix}${M.fmtMoney(value)}`, "info");
  return <span className={`summary-formula-value${danger ? " danger" : ""}`} onDoubleClick={show} title={`Bấm đúp hoặc bấm ƒ để xem: ${formula}`}>
    <span>{prefix}{M.fmtMoney(value)}</span>
    <button type="button" className="summary-fx-btn" onClick={show} aria-label={`Xem công thức ${label}`}>ƒ</button>
  </span>;
}

let _companies: EditorCompany[] | null = null;
let _templates: EditorTemplate[] | null = null;

// Lấy thông báo lỗi CỤ THỂ (vd "Vui lòng nhập tên khách hàng") từ details[] thay vì "Dữ liệu không hợp lệ".
const errText = (ex: unknown): string => {
  if (ex instanceof ApiError) {
    const d = (ex.body as { details?: { message?: string }[] } | undefined)?.details;
    if (Array.isArray(d) && d[0]?.message) return d[0].message;
    return ex.message;
  }
  return "Có lỗi xảy ra";
};

export function QuoteEditorPage({ me, quoteId, isNew }: { me: Me; quoteId?: number; isNew: boolean }) {
  const qRef = useRef<QuoteFull | null>(null);
  const [, setTick] = useState(0);
  // HAI mức vẽ lại. `redraw()` là mức MẶC ĐỊNH: tăng `gridVerRef` nên <GridTable> (đã bọc memo)
  // cũng vẽ lại — dùng cho MỌI đường có thể đụng tới items (onChange của chính lưới, nạp Excel,
  // tải lại báo giá…). `redrawMeta()` chỉ vẽ lại phần NGOÀI lưới, dành cho các ô meta gõ-từng-phím
  // (Ngày báo giá · VAT · Giảm giá · Tên sheet): chúng không đổi gì trong lưới, mà mỗi lượt vẽ lưới
  // ở sheet lớn là hàng chục ms chặn luồng chính.
  // CON SỐ ĐO ĐƯỢC là 73ms/phím ở 1000 dòng, và nó đo đường gõ TRONG lưới, không phải ở đây —
  // nguồn: web/src/components/GridTable.tsx (grep "73ms": nay ở dòng 786 và 1366).
  // Chi phí gõ ô meta ở QuoteEditor thì CHƯA ĐO RIÊNG, chỉ SUY RA: nếu không có redrawMeta thì
  // mỗi phím ở đây cũng kéo theo đúng lượt vẽ lại <GridTable> đã đo nói trên.
  // src/bench.tsx KHÔNG đo được việc này — nó gắn một <GridTable> trần, không dựng QuoteEditor,
  // nên trang đo không có ô meta nào để gõ (các phép đo của nó: vẽ lần đầu · gõ ô chữ/ô số trong
  // lưới · thêm/xoá hàng · cuộn · đổi đơn giá).
  // Quên dùng redrawMeta ở đâu đó = chỉ mất phần tối ưu, KHÔNG sai màn hình — xem gridPropsEqual.
  const gridVerRef = useRef(0);
  const redraw = useCallback(() => { gridVerRef.current++; setTick((t) => t + 1); }, []);
  const redrawMeta = useCallback(() => setTick((t) => t + 1), []);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);
  const mark = useCallback(() => { dirtyRef.current = true; (window as WinDirty).__editorDirty = true; }, []);
  const [versions, setVersions] = useState<QuoteVersion[] | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [othersEditing, setOthersEditing] = useState<{ id: number; name: string }[]>([]); // presence: người KHÁC đang mở báo giá này
  // ĐANG TẢI FILE — để nút MỜ ĐI và đổi chữ. `xuatBaoGia` đã tự chặn bấm lại ở tầng dưới, nhưng
  // chặn không phải là BÁO: hai nút Tải nằm trong menu "…", đóng menu rồi mở lại là bấm được tiếp,
  // và `window.open` cũ thì trình duyệt tự hiện chỉ báo tải nên người dùng biết có chuyện đang xảy
  // ra. Nay không còn chỉ báo đó — nút phải tự nói.
  //
  // ⚠️ HOOK PHẢI Ở ĐÂY, cạnh các hook khác. Bản đầu tôi khai nó ngay trên `exportFile` (dòng ~375),
  // tức SAU hai early return ở dòng 197-198 (`if (err) return …` / `if (!ready) return …`) — React
  // gọi hook theo THỨ TỰ, nên một hook nằm sau early return sẽ khiến thứ tự đổi giữa các lượt
  // render và toàn bộ state của component lệch nhau. eslint (react-hooks/rules-of-hooks) bắt được;
  // đừng chuyển nó xuống lại cho "gần chỗ dùng".
  const [dangTai, setDangTai] = useState<"xlsx" | "pdf" | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const noteWrapRef = useRef<HTMLDivElement>(null);
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  // Kebab ⋯: đóng khi bấm ngoài cụm hoặc nhấn Esc (như SPA more-menu).
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [moreOpen]);

  // Cảnh báo CHƯA LƯU: chặn F5/đóng tab (beforeunload) theo dirtyRef; cờ global __editorDirty để Shell
  // chặn điều hướng menu (giống leaveEditorGuard SPA). Dọn cờ khi rời editor.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => { window.removeEventListener("beforeunload", h); (window as WinDirty).__editorDirty = false; };
  }, []);

  // PRESENCE: báo "tôi đang mở báo giá này" + nghe ai khác đang sửa → hiện banner. Chỉ báo giá ĐÃ LƯU.
  useEffect(() => {
    if (isNew || !quoteId) return;
    let alive = true;
    const sync = (list: { id: number; name: string }[]) => { if (alive) setOthersEditing(list.filter((u) => u.id !== me.id)); };
    api.presence(quoteId, "open").then((r) => sync(r.editing)).catch(() => { /* presence không critical */ });
    const hb = setInterval(() => { api.presence(quoteId, "heartbeat").catch(() => {}); }, 30_000);
    const onPresence = (e: Event) => {
      const d = (e as CustomEvent).detail as { quoteId?: number; editing?: { id: number; name: string }[] };
      if (d?.quoteId === quoteId) sync(d.editing || []);
    };
    window.addEventListener("realtime:presence", onPresence);
    return () => {
      alive = false;
      clearInterval(hb);
      window.removeEventListener("realtime:presence", onPresence);
      api.presence(quoteId, "close").catch(() => {});
    };
  }, [quoteId, isNew, me.id]);

  // `|| RONG` chứ không phải `|| []`: `_templates` là cache MỨC MODULE nên khi đã tải xong nó vốn
  // giữ nguyên identity, nhưng nhánh CHƯA tải thì `[]` đẻ mảng mới mỗi lần render và phá mọi
  // useCallback nhận `templates` làm phụ thuộc. Một hằng rỗng dùng chung là đủ, KHÔNG cần useMemo —
  // useMemo ở đây còn tệ hơn vì `_templates` là biến ngoài phạm vi component, khai nó làm phụ thuộc
  // là nói dối React (đổi giá trị không hề kích hoạt render).
  const templates = _templates || RONG;
  const companies = _companies || RONG;

  // ── load catalogs + quote ──────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!_companies || !_templates) {
          const [cs, ts] = await Promise.all([api.metaCompanies(), api.metaTemplates()]);
          _companies = cs; _templates = ts;
        }
        let q: QuoteFull;
        if (isNew) {
          // Draft từ Wizard Tạo-mới (công ty/mẫu/khách/logo đã chọn); nếu vào thẳng #/rnew thì dựng mặc định.
          const pend = takePendingNewQuote();
          if (pend) { q = pend; }
          else {
            const firstTpl = _templates![0];
            q = {
              id: 0, _new: true, status: "draft", title: "", quoteNumber: "", companyId: firstTpl?.companyId,
              city: "TP. Hồ Chí Minh", quoteDate: new Date().toISOString().slice(0, 10), vatPercent: 0, discount: 0, showTotals: true,
              greeting: "Chân thành cảm ơn Quí khách hàng đã quan tâm đến dịch vụ của chúng tôi, chúng tôi xin gởi bảng báo giá theo yêu cầu như sau:",
              sheets: [{ templateId: firstTpl?.id, groupSubtotal: true, items: [], extraTables: [] }],
            };
          }
        } else {
          q = await api.getQuote(quoteId!);
        }
        if (q.quoteDate && q.quoteDate.length > 10) q.quoteDate = q.quoteDate.slice(0, 10);
        if (q.executionDate && q.executionDate.length > 10) q.executionDate = q.executionDate.slice(0, 10);
        if (!q.sheets || !(q.sheets as Sheet[]).length) q.sheets = [{ templateId: _templates![0]?.id, groupSubtotal: true, items: [], extraTables: [] }];
        (q.sheets as Sheet[]).forEach((s) => { if (!Array.isArray(s.extraTables)) s.extraTables = []; });
        (q as QuoteFull & { _activeSheet: number })._activeSheet = 0;
        stampKeys(q);
        qRef.current = q;
        if (alive) { dirtyRef.current = false; setReady(true); }
      } catch (ex) {
        if (alive) setErr(ex instanceof ApiError ? ex.message : "Lỗi tải báo giá");
      }
    })();
    return () => { alive = false; };
     
  }, [quoteId, isNew]);

  // Ba hàm truyền cho <ImportExcelModal>. TRƯỚC ĐÂY viết inline ngay trong JSX nên identity đổi mỗi
  // lần QuoteEditor render — mà editor render lại theo TỪNG PHÍM gõ ở ô Ngày báo giá / VAT / Giảm
  // giá / Tên sheet. useMemo dựng bảng xem-trước bên trong modal khai đúng ba hàm này làm phụ thuộc,
  // nên nó tính lại toàn bộ bảng đối chiếu ở mỗi lần đó: memo có mà như không.
  //
  // Đặt TRƯỚC hai lệnh `return` sớm bên dưới: hook gọi sau một return sớm là gọi CÓ ĐIỀU KIỆN, tức
  // thứ tự hook đổi giữa các lần render và React vỡ trạng thái. Trạng thái báo giá đọc qua `qRef`
  // (ref ổn định) nên phụ thuộc chỉ còn `templates` — đúng thứ ta muốn: càng ít đổi càng tốt.
  const usesDaysOf = useCallback((tid?: number) => !!templates.find((t) => t.id === tid)?.layout?.hasDays, [templates]);
  const addrDetailOf = useCallback((tid?: number) => { const t = templates.find((x) => x.id === tid); return !!(t?.layout?.reserveDetail ?? t?.layout?.hasDetail); }, [templates]);
  // Sheet MỚI: dùng đúng mẫu app đoán được từ file, miễn mẫu đó thuộc công ty của báo giá;
  // không đoán ra thì theo mẫu của sheet đang mở.
  const newSheetTemplateId = useCallback((code?: string | null) => {
    const cur = qRef.current as (QuoteFull & { _activeSheet: number }) | null;
    const cuaSheet = cur ? (cur.sheets as Sheet[])[cur._activeSheet]?.templateId : undefined;
    return templates.find((t) => t.code === code && t.companyId === cur?.companyId)?.id ?? cuaSheet;
     
  }, [templates]);

  if (err) return <div className="err" style={{ margin: 24 }}>⚠ {err} <a href="#/list" className="btn btn-sm">Về danh sách</a></div>;
  if (!ready || !qRef.current) return <div className="skeleton-wrap" style={{ padding: 24 }}>{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>;

  const q = qRef.current as QuoteFull & { _activeSheet: number };
  const sheets = q.sheets as Sheet[];
  const ai = q._activeSheet;
  const activeSheet = sheets[ai];
  const tpl = templates.find((t) => t.id === activeSheet.templateId);
  const usesDays = !!tpl?.layout?.hasDays;
  const showDetail = !!tpl?.layout?.hasDetail;
  // Chi Tiết đã bỏ; chỉ giữ khe địa chỉ nội bộ để công thức báo giá cũ không lệch cột.
  const addrDetail = !!(tpl?.layout?.reserveDetail ?? tpl?.layout?.hasDetail);
  const numberSubs = !!tpl?.layout?.numberSubsections;

  // editable (mirror server + renderEditor): admin sửa tất; manager/member sửa khi chưa chốt/mất.
  const isMember = (q.members || []).some((m) => m.id === me.id);
  const hasPerm = (p: string) => me.permissions.includes(p) || me.permissions.includes(p.replace(/:own$/, ":all"));
  const canUpdate = hasPerm("quote:update:all") || q.createdById === me.id || isMember || isNew;
  // báo giá ĐÃ CHỐT/KHÔNG-CHỐT là TERMINAL — server (canEdit) chặn 403 → khoá UI cho khớp, tránh "sửa được" giả.
  const isTerminal = q.status === "converted" || q.status === "lost";
  // Ai có quyền "gửi khách" (admin/account) sửa được mọi trạng thái; còn lại chỉ nháp/trả-lại (khớp canEdit server).
  const editable = isNew || (!isTerminal && canUpdate && (hasPerm("quote:send") || q.status === "draft" || q.status === "rejected"));
  const senderCo = companies.find((c) => c.id === q.companyId);
  if (senderCo?.address) q.fromAddress = senderCo.address;

  const back = async () => {
    if (dirtyRef.current && !(await confirmModal("Rời khỏi mà chưa lưu?", "Bạn có thay đổi chưa lưu. Rời đi sẽ mất các thay đổi này.", { danger: true, confirmText: "Rời, bỏ thay đổi" }))) return;
    location.hash = "#/list";
  };

  // ── field setters ──────────────────────────────────────────────────────────
  const setQ = (k: string, v: unknown) => { (q as Record<string, unknown>)[k] = v; mark(); };

  // ── sheet ops ──────────────────────────────────────────────────────────────
  const switchSheet = (i: number) => { q._activeSheet = i; redraw(); };
  const addSheet = () => {
    const t = templates.filter((x) => x.companyId === q.companyId)[0] || templates[0];
    sheets.push({ templateId: t?.id, name: "", groupSubtotal: true, items: [], extraTables: [] });
    q._activeSheet = sheets.length - 1; mark(); redraw();
  };
  const removeSheet = async (i: number) => {
    if (sheets.length <= 1) return;
    if (!(await confirmModal("Xóa sheet", `Xóa sheet "${sheets[i].name || "Sheet " + (i + 1)}"?`, { danger: true, confirmText: "Xóa" }))) return;
    sheets.splice(i, 1);
    if (q._activeSheet >= sheets.length) q._activeSheet = sheets.length - 1;
    mark(); redraw();
  };

  // ── save ───────────────────────────────────────────────────────────────────
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...q,
        sheets: sheets.map((s, i) => {
          const stpl = templates.find((t) => t.id === s.templateId);
          const sUsesDays = !!stpl?.layout?.hasDays;
          return {
            // GỬI KÈM id sheet: lưu = server xoá-tạo-lại sheet, có id nó mới BÊ được trạng thái
            // mức sheet sang bản mới (khách duyệt sheet, chữ ký, số hoá đơn…). Giá trị vẫn do
            // server quyết — client chỉ dùng id để ghép.
            id: s.id, templateId: s.templateId, name: s.name, order: i + 1, groupSubtotal: !!s.groupSubtotal, showImages: !!s.showImages,
            items: (s.items || []).map((it, j) => { const o = { ...it, order: j + 1, days: sUsesDays ? it.days : null }; delete (o as ItemK)._k; return o; }),
            // dọn days bảng nội bộ theo template TỪNG bảng (đối xứng lưới chính) → tổng nội bộ không phồng.
            extraTables: (Array.isArray(s.extraTables) ? s.extraTables : []).map((x) => {
              const xx = x as { templateId?: number; items?: ItemK[] } & Record<string, unknown>;
              const xUsesDays = !!templates.find((t) => t.id === xx.templateId)?.layout?.hasDays;
              return { ...xx, items: (xx.items || []).map((it) => { const o = { ...it, days: xUsesDays ? it.days : null }; delete (o as ItemK)._k; return o; }) };
            }),
          };
        }),
      };
      delete payload._new; delete payload._activeSheet;
      // Khóa lạc quan: gửi mốc updatedAt đã tải → server chặn ghi đè nếu người khác vừa lưu (409).
      // Sau khi lưu, q được refresh từ `saved` (bên dưới) nên base luôn mới cho lần lưu kế.
      payload.baseUpdatedAt = (q as { updatedAt?: string }).updatedAt;
      if (isNew) { delete payload.quoteNumber; delete payload.baseUpdatedAt; }
      const saved = isNew ? await api.createQuote(payload) : await api.updateQuote(q.id, payload);
      dirtyRef.current = false; (window as WinDirty).__editorDirty = false;
      toast("Đã lưu", "success");
      // chuyển sang chế độ sửa bản đã lưu (hash → #/quotes/:id) — F5/back resolve đúng.
      if (isNew) location.hash = "#/quotes/" + saved.id;
      else { qRef.current = { ...saved, _activeSheet: ai } as QuoteFull; stampKeys(qRef.current); redraw(); }
    } catch (ex) {
      // Khóa lạc quan: server trả 409 khi NGƯỜI KHÁC vừa lưu báo giá này (baseUpdatedAt lệch) →
      // KHÔNG ghi đè ngầm. Hỏi rõ + cho TẢI LẠI bản mới (reload đảm bảo nạp đúng toàn bộ luồng load).
      if (ex instanceof ApiError && ex.status === 409) {
        const reload = await confirmModal(
          "Báo giá đã bị người khác sửa",
          "Một người khác vừa lưu báo giá này trong lúc bạn đang sửa. Nếu tải lại bản mới nhất, thay đổi CHƯA LƯU của bạn sẽ mất — hãy chép phần cần giữ trước. Tải lại ngay?",
          { danger: true, confirmText: "Tải lại bản mới" }
        );
        if (reload) { dirtyRef.current = false; (window as WinDirty).__editorDirty = false; location.reload(); }
        // Hủy → giữ nguyên màn hình + thay đổi của bạn (chưa lưu) để bạn tự xem/chép rồi tải lại sau.
      } else {
        toast(errText(ex), "error");
      }
    } finally { setSaving(false); }
  };
  const convert = async () => {
    if (!(await confirmModal("Khách chốt", "Khách đã đồng ý — đánh dấu báo giá này ĐÃ CHỐT?", { confirmText: "Đã chốt" }))) return;
    try { const u = await api.markConverted(q.id); qRef.current = { ...u, _activeSheet: ai } as QuoteFull; stampKeys(qRef.current); toast("Đã chốt báo giá", "success"); redraw(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };
  const lost = async () => {
    const reason = await promptModal("Không chốt được đơn này", "Lý do (không bắt buộc):", { placeholder: "VD: Khách chọn nhà cung cấp khác, giá cao…" });
    if (reason === null) return;
    try { const u = await api.markLost(q.id, reason); qRef.current = { ...u, _activeSheet: ai } as QuoteFull; stampKeys(qRef.current); toast("Đã đánh dấu không chốt", "success"); redraw(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };
  // ── NẠP dữ liệu đọc từ file Excel vào lưới (chưa ghi DB — bấm Lưu mới ghi) ──────────────────
  const applyImport = (payload: ImportApplyPayload) => {
    let nAdd = 0, nSheet = 0, nNew = 0, nRemoved = 0;
    for (const p of payload.plans) {
      const stamped = p.items.map((it) => { const o = { ...it } as ItemK; o._k = nextK(); return o; });
      // File có nhiều sheet hơn báo giá → TẠO THÊM sheet, đặt tên đúng tên tab trong file.
      if (p.targetIndex === NEW_SHEET) {
        sheets.push({
          _k: nextK(), templateId: p.templateId ?? activeSheet.templateId,
          name: p.file.name, groupSubtotal: !!p.file.groupSubtotal,
          items: stamped, extraTables: [],
        } as Sheet);
        nAdd += stamped.length; nSheet++; nNew++;
        continue;
      }
      const target = sheets[p.targetIndex];
      if (!target) continue;
      if (p.mode === "append") target.items.push(...stamped);
      else {
        target.items.splice(0, target.items.length, ...stamped);
        // Dòng nhóm trong file có ghi Thành Tiền ⇒ báo giá đó bật "tổng tiền theo nhóm" → theo file.
        target.groupSubtotal = !!p.file.groupSubtotal;
      }
      nAdd += stamped.length; nSheet++;
    }
    for (const idx of [...(payload.removeTargetIndexes || [])].sort((a, b) => b - a)) {
      if (idx < 0 || idx >= sheets.length) continue;
      sheets.splice(idx, 1); nRemoved++;
    }
    if (!sheets.length) sheets.push({ _k: nextK(), templateId: activeSheet.templateId, name: "", groupSubtotal: true, items: [], extraTables: [] } as Sheet);
    q._activeSheet = Math.max(0, Math.min(q._activeSheet, sheets.length - 1));
    if (payload.totals) {
      if (payload.totals.vatPercent != null) q.vatPercent = payload.totals.vatPercent;
      if (payload.totals.discount != null) q.discount = payload.totals.discount;
    }
    mark(); redraw();
    toast(`Đã nạp ${nAdd} dòng vào ${nSheet} sheet${nNew ? ` · thêm ${nNew} sheet` : ""}${nRemoved ? ` · xóa ${nRemoved} sheet` : ""} — kiểm tra lại rồi bấm Lưu`, "success");
  };

  // ── Ý KIẾN KHÁCH theo TỪNG SHEET (ghi ngay, KHÔNG đợi Lưu — giống Chốt/Không chốt) ──────────
  // KHÔNG chặn khi lưới còn thay đổi chưa lưu: ý kiến khách ghi thẳng vào DB theo sheet, và lúc
  // bấm Lưu server tự bê trạng thái này sang bản sheet mới (carrySheetState) → không mất gì.
  // Chỉ cần sheet đã tồn tại trong DB thì mới có chỗ để ghi.
  const decideSheet = async (status: "approved" | "rejected" | "") => {
    const s = activeSheet;
    if (!s.id) {
      toast("Sheet này chưa lưu lần nào — bấm Lưu xong mới ghi nhận được ý kiến khách", "info");
      return;
    }
    let note: string | undefined;
    if (status === "rejected") {
      const n = await promptModal("Khách không duyệt sheet này", "Lý do (không bắt buộc):", { placeholder: "VD: giá cao, đổi phương án, gộp sang sheet khác…" });
      if (n === null) return;
      note = n;
    }
    try {
      const r = await api.sheetCustomerDecision(s.id, status, note);
      s.custStatus = r.custStatus; s.custStatusAt = r.custStatusAt; s.custNote = r.custNote; s.custStatusBy = r.custStatusBy;
      toast(status === "approved" ? "Đã ghi: khách duyệt sheet này" : status === "rejected" ? "Đã ghi: khách không duyệt sheet này" : "Đã gỡ đánh dấu", "success");
      redraw();
    } catch (ex) { toast(errText(ex), "error"); }
  };

  const exportFile = async (ext: "xlsx" | "pdf") => {
    if (dangTai) return;
    if (dirtyRef.current && !(await confirmModal("Có thay đổi chưa lưu", "File tải về là BẢN ĐÃ LƯU gần nhất — KHÔNG gồm thay đổi vừa sửa. Hãy Lưu trước rồi tải lại.", { confirmText: "Vẫn tải bản cũ" }))) return;
    // Xem web/src/lib/exportQuote.ts: đường đồng bộ trước, gặp 413 thì tự chuyển sang xuất nền.
    // Bản cũ dùng window.open nên KHÔNG BAO GIỜ thấy 413 — báo giá quá 20.000 dòng chỉ ra một tab
    // in JSON lỗi, dù báo giá 60.000 dòng là LƯU ĐƯỢC.
    setDangTai(ext);
    try { await xuatBaoGia(q.id, ext); } finally { setDangTai(null); }
  };

  // ── summary tổng báo giá (mọi sheet) ─────────────────────────────────────────
  const subtotalAll = sheets.reduce((acc, s) => { const t = templates.find((x) => x.id === s.templateId); return acc + M.sheetSubtotalGrouped(s.items, !!t?.layout?.hasDays, s.groupSubtotal); }, 0);
  const tt = M.quoteTotals(subtotalAll, q.vatPercent, q.discount);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1>{isNew ? "Tạo báo giá mới" : "Báo giá " + M.codeLabel(q)}{!isNew && <span className={`status ${q.status}`} style={{ marginLeft: 10 }}>{M.statusLabel(q.status)}</span>}</h1>
        <button className="btn" onClick={back}>← Quay lại</button>
      </div>

      {othersEditing.length > 0 && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 12,
          background: "var(--warn-bg, #fff7e6)", border: "1px solid var(--warn-border, #ffd591)", borderRadius: "var(--radius-sm)", fontSize: 13 }}>
          <span aria-hidden>👤</span>
          <span><b>{othersEditing.map((u) => u.name).join(", ")}</b> đang mở báo giá này — cẩn thận tránh ghi đè lên nhau (lưu sau sẽ được cảnh báo).</span>
        </div>
      )}

      <div className="editor">
        <div className="meta-2col">
          <fieldset className="meta-col">
            <legend>Bên nhận · Khách hàng</legend>
            <label>Tên khách hàng<input defaultValue={q.toCompany || ""} placeholder="Tên công ty khách" disabled={!editable} onInput={(e) => setQ("toCompany", (e.target as HTMLInputElement).value)} /></label>
            <label>Người liên hệ<input defaultValue={q.toContact || ""} placeholder="Người liên hệ phía KH" disabled={!editable} onInput={(e) => setQ("toContact", (e.target as HTMLInputElement).value)} /></label>
            <label>Email<input type="email" defaultValue={q.toEmail || ""} placeholder="Email khách (hiện ở 'Kính gửi')" disabled={!editable} onInput={(e) => setQ("toEmail", (e.target as HTMLInputElement).value)} /></label>
            <label>Điện thoại<input defaultValue={q.toPhone || ""} placeholder="SĐT khách hàng" disabled={!editable} onInput={(e) => setQ("toPhone", (e.target as HTMLInputElement).value)} /></label>
            <label>Địa chỉ<input defaultValue={q.toAddress || ""} placeholder="Địa chỉ khách hàng" disabled={!editable} onInput={(e) => setQ("toAddress", (e.target as HTMLInputElement).value)} /></label>
          </fieldset>
          <fieldset className="meta-col">
            <legend>Bên gửi · Công ty báo giá</legend>
            <label>Công ty <span className="muted" style={{ fontSize: 11 }}>(đã chọn lúc tạo)</span>
              <select value={q.companyId} disabled title="Công ty đã chọn khi tạo báo giá — không đổi ở đây">{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Người gửi<input defaultValue={q.fromContact || ""} placeholder="Người phụ trách" disabled={!editable} onInput={(e) => setQ("fromContact", (e.target as HTMLInputElement).value)} /></label>
            <label>Chức danh<input defaultValue={q.fromTitle || ""} placeholder="VD: Trưởng phòng KD" disabled={!editable} onInput={(e) => setQ("fromTitle", (e.target as HTMLInputElement).value)} /></label>
            <label>Điện thoại<input defaultValue={q.fromPhone || ""} placeholder="SĐT người gửi" disabled={!editable} onInput={(e) => setQ("fromPhone", (e.target as HTMLInputElement).value)} /></label>
            <label>Địa chỉ <span className="muted" style={{ fontSize: 11 }}>(tự theo công ty)</span><input value={q.fromAddress || ""} readOnly title="Tự lấy theo Công ty bên gửi" disabled={!editable} /></label>
          </fieldset>
        </div>

        <div className="meta-row">
          <label>Số xuất Excel <span className="muted" style={{ fontSize: 11 }}>(GN…)</span><input value={q.quoteNumber || ""} placeholder={isNew ? "Tự động cấp khi lưu" : ""} readOnly disabled={!editable} /></label>
          <label>Ngày báo giá<input type="date" defaultValue={q.quoteDate} disabled={!editable} onInput={(e) => { setQ("quoteDate", (e.target as HTMLInputElement).value); redrawMeta(); }} /></label>
          <label>Ngày thi công <span className="muted" style={{ fontSize: 11 }}>(nội bộ)</span><input type="date" defaultValue={q.executionDate || ""} disabled={!editable} onInput={(e) => setQ("executionDate", (e.target as HTMLInputElement).value)} /></label>
          <label>VAT (%)<input type="number" step="0.1" defaultValue={q.vatPercent} disabled={!editable} onInput={(e) => { setQ("vatPercent", Number((e.target as HTMLInputElement).value) || 0); redrawMeta(); }} /></label>
          <label>Giảm giá (VNĐ) <span className="muted" style={{ fontSize: 11 }}>(trừ vào tổng)</span><input type="number" step="1000" min="0" defaultValue={Number(q.discount) || 0} disabled={!editable} onInput={(e) => { setQ("discount", Number((e.target as HTMLInputElement).value) || 0); redrawMeta(); }} /></label>
        </div>

        <div className="center-line">{M.vnDateText(q.quoteDate, q.city)}</div>
        <input className="title-input" defaultValue={q.title || ""} placeholder="Tên báo giá (chung cho mọi sheet)" disabled={!editable} onInput={(e) => setQ("title", (e.target as HTMLInputElement).value)} />
        <div className="quote-no">(Số: {q.quoteNumber || ""})</div>
        <textarea className="greeting" rows={2} defaultValue={q.greeting || ""} disabled={!editable} onInput={(e) => setQ("greeting", (e.target as HTMLTextAreaElement).value)} />

        {/* sheet tabs */}
        <div className="sheet-tabs">
          {sheets.map((s, i) => (
            // BÀN PHÍM: `aria-pressed` trên một <div> KHÔNG có role bị công nghệ hỗ trợ BỎ QUA, và
            // <div> thì không nhận focus. Nghĩa là người dùng chỉ bàn phím (hoặc dùng trình đọc màn
            // hình) KHÔNG chuyển được sheet — tab là thao tác cốt lõi của editor, không phải trang
            // trí. Thêm role + tabIndex + Enter/Space là đủ, không phải dựng lại component.
            <div key={s._k ?? i} role="button" tabIndex={0} className={`sheet-tab ${i === ai ? "active" : ""}`} aria-pressed={i === ai}
              onClick={() => switchSheet(i)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchSheet(i); } }}>
              <span>{sheets.length > 1 ? `${i + 1}. ` : ""}{s.name || templates.find((t) => t.id === s.templateId)?.name || "Sheet " + (i + 1)}</span>
              {/* Khách đã cho ý kiến sheet này → dấu ✓/✗ ngay trên tab để nhìn phát thấy */}
              {s.custStatus && (
                <span className={`cust-dot ${s.custStatus === "approved" ? "txt-ok" : "txt-danger"}`}
                  title={CUST_LABEL[s.custStatus]} aria-label={CUST_LABEL[s.custStatus]}>{CUST_DOT[s.custStatus]}</span>
              )}
              {/* <button> thật: tự vào được thứ tự Tab, tự nhận Enter/Space, và có tên đọc lên được
                  ("Xóa sheet 2") thay vì chỉ một dấu ✕ mà trình đọc màn hình không diễn giải nổi. */}
              {editable && sheets.length > 1 && (
                <button type="button" className="rm-tab" title="Xóa sheet" aria-label={`Xóa sheet ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); removeSheet(i); }}
                  onKeyDown={(e) => e.stopPropagation()}>✕</button>
              )}
            </div>
          ))}
          {editable && <button className="btn btn-sm add-sheet" onClick={addSheet}>+ Thêm sheet</button>}
        </div>

        <div className="sheet-meta" style={{ display: "flex", gap: 14, margin: "8px 0", alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>Tên sheet: <input value={activeSheet.name || ""} disabled={!editable} onChange={(e) => { activeSheet.name = e.target.value; mark(); redrawMeta(); }} style={{ padding: "6px 10px", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", background: "var(--surface)" }} /></label>
          <label style={{ fontSize: 13 }}>Template: <select value={activeSheet.templateId} disabled={!editable} onChange={(e) => { activeSheet.templateId = Number(e.target.value); const t = templates.find((x) => x.id === activeSheet.templateId); if (!t?.layout?.hasDays) activeSheet.items.forEach((it) => { if (it.days != null) it.days = null; }); mark(); redraw(); }}>{templates.filter((t) => t.companyId === q.companyId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          {/* Nạp file Excel khách gửi lại — khỏi gõ tay/copy-paste; xem trước rồi mới nạp vào lưới. */}
          {editable && (
            <button type="button" className="btn btn-sm" title="Nạp hạng mục từ file Excel (bản khách đã sửa hoặc file ngoài)"
              onClick={() => setImportOpen(true)}>⬆ Nhập từ Excel</button>
          )}
        </div>

        {/* Ý KIẾN KHÁCH cho RIÊNG sheet đang mở — khách duyệt sheet này, sheet kia chưa duyệt vẫn theo dõi được */}
        {!isNew && (
          <div className="cust-decide" style={{ margin: "2px 0 10px" }}>
            {/* Nhãn tên sheet lấy ĐÚNG như trên tab (tên tự đặt → tên mẫu → "Sheet N") để khỏi
                lệch nhau: tab ghi "CLF (không ngày)" mà dòng này lại ghi "Sheet 1" thì rối. */}
            <span className="muted" style={{ fontSize: 13 }}>
              Khách duyệt sheet “{activeSheet.name || templates.find((t) => t.id === activeSheet.templateId)?.name || `Sheet ${ai + 1}`}”:
            </span>
            <span className={`cust-chip ${activeSheet.custStatus || ""}`}>
              {activeSheet.custStatus ? CUST_LABEL[activeSheet.custStatus] : "Chưa có ý kiến"}
            </span>
            {activeSheet.custStatusAt && (
              <span className="muted" style={{ fontSize: 12 }}>
                {M.fmtDate(activeSheet.custStatusAt)}{activeSheet.custStatusBy?.displayName ? ` · ${activeSheet.custStatusBy.displayName} ghi nhận` : ""}
              </span>
            )}
            {activeSheet.custNote && <span className="muted" style={{ fontSize: 12 }}>· lý do: {activeSheet.custNote}</span>}
            {hasPerm("quote:send") && (
              <>
                {activeSheet.custStatus !== "approved" && <button type="button" className="btn btn-sm" onClick={() => decideSheet("approved")}>✓ Khách duyệt</button>}
                {activeSheet.custStatus !== "rejected" && <button type="button" className="btn btn-sm" onClick={() => decideSheet("rejected")}>✗ Không duyệt</button>}
                {activeSheet.custStatus && <button type="button" className="btn btn-sm btn-ghost" onClick={() => decideSheet("")}>Gỡ đánh dấu</button>}
              </>
            )}
          </div>
        )}

        <GridTable key={`main-${ai}-${activeSheet.templateId}`} items={activeSheet.items as ItemK[]} fxBar dataVersion={gridVerRef.current}
          clfTheme={!!tpl?.code?.startsWith("clofull")}
          usesDays={usesDays} showDetail={showDetail} addrDetail={addrDetail} numberSubs={numberSubs} editable={editable} internalNote
          groupSubtotal={!!activeSheet.groupSubtotal} onGroupSubtotal={(v) => { activeSheet.groupSubtotal = v; mark(); redraw(); }}
          showImages={!!activeSheet.showImages} onShowImages={(v) => { activeSheet.showImages = v; mark(); redraw(); }}
          onChange={() => { mark(); redraw(); }} />

        {editable && (
          <label className="toggle-totals" style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: "16px 0 6px", fontSize: 13.5, cursor: "pointer" }}>
            <input type="checkbox" defaultChecked={q.showTotals !== false} onChange={(e) => { setQ("showTotals", e.target.checked); redraw(); }} />
            <span>Hiển thị bảng <strong>Tổng cộng / VAT / Thành tiền</strong> (cả màn hình lẫn Excel/PDF)</span>
          </label>
        )}
        {editable ? (
          <>
            <div className="muted" style={{ margin: "4px 0 6px", fontSize: 12.5 }}>Mẹo: để <strong>giảm giá</strong>, bấm “+ Thêm hàng”, ghi nội dung rồi nhập <strong>số tiền âm</strong> ở Đơn giá — sẽ tự trừ vào tổng.</div>
            <label className="toggle-totals" style={{ display: "inline-flex", alignItems: "center", gap: 8, margin: "8px 0 4px", fontSize: 13.5, cursor: "pointer" }}>
              <input type="checkbox" defaultChecked={!!q.notes} onChange={(e) => {
                if (e.target.checked) { if (!(q.notes || "").trim()) { setQ("notes", DEFAULT_NOTE); if (noteInputRef.current) noteInputRef.current.value = DEFAULT_NOTE; } if (noteWrapRef.current) noteWrapRef.current.style.display = ""; noteInputRef.current?.focus(); }
                else { setQ("notes", ""); if (noteInputRef.current) noteInputRef.current.value = ""; if (noteWrapRef.current) noteWrapRef.current.style.display = "none"; }
              }} />
              <span>Thêm <strong>Ghi chú</strong> cuối báo giá (in vào file Excel/PDF)</span>
            </label>
            <div ref={noteWrapRef} style={{ display: q.notes ? "" : "none", margin: "0 0 10px" }}>
              <textarea ref={noteInputRef} rows={2} defaultValue={q.notes || ""} placeholder="VD: Tất cả các hạng mục trên là thuê, Gia Nguyễn thu hồi toàn bộ sau khi tháo dỡ" style={{ width: "100%", boxSizing: "border-box", padding: 8, border: "1px solid var(--border,#ccc)", borderRadius: 6, font: "inherit", resize: "vertical" }} onInput={(e) => setQ("notes", (e.target as HTMLTextAreaElement).value)} />
            </div>
          </>
        ) : (q.notes ? <div className="muted" style={{ margin: "8px 0" }}><strong>Ghi chú:</strong> {q.notes}</div> : null)}

        {q.showTotals !== false && (
          <div className="quote-summary">
            <h3 style={{ margin: "18px 0 6px" }}>Tổng báo giá ({sheets.length} sheet)</h3>
            <table className="summary-table">
              <thead><tr><th scope="col">STT</th><th scope="col">Sheet</th><th scope="col">Khách duyệt</th><th scope="col" style={{ textAlign: "right" }}>Tổng (VNĐ)</th></tr></thead>
              <tbody>
                {sheets.map((s, i) => { const t = templates.find((x) => x.id === s.templateId); const sub = M.sheetSubtotalGrouped(s.items, !!t?.layout?.hasDays, s.groupSubtotal); const name = s.name || t?.name || `Sheet ${i + 1}`; return <tr key={s._k ?? i}><td style={{ textAlign: "center" }}>{i + 1}</td><td>{name}</td><td>{s.custStatus ? <span className={`cust-chip ${s.custStatus}`}>{CUST_LABEL[s.custStatus]}</span> : <span className="muted">—</span>}</td><td style={{ textAlign: "right" }}><SummaryFormula label={`Tổng sheet ${name}`} formula={`=TỔNG_SHEET("${name}")`} value={sub} /></td></tr>; })}
              </tbody>
              <tfoot>
                {/* Chỉ cộng các sheet KHÁCH ĐÃ DUYỆT — báo giá nhiều sheet hay chốt từng phần. */}
                {sheets.some((s) => s.custStatus === "approved") && (
                  <tr><td colSpan={3}>Tổng phần khách đã duyệt</td><td style={{ textAlign: "right" }}>
                    <SummaryFormula label="Tổng phần khách đã duyệt" formula="=SUM(Các sheet khách đã duyệt)" value={sheets.reduce((acc, s) => { if (s.custStatus !== "approved") return acc; const t = templates.find((x) => x.id === s.templateId); return acc + M.sheetSubtotalGrouped(s.items, !!t?.layout?.hasDays, s.groupSubtotal); }, 0)} />
                  </td></tr>
                )}
                <tr><td colSpan={3}>Tổng cộng</td><td style={{ textAlign: "right" }}><SummaryFormula label="Tổng cộng" formula="=SUM(Tổng từng sheet)" value={tt.subtotal} /></td></tr>
                <tr><td colSpan={3}>VAT ({Number(q.vatPercent) || 0}%)</td><td style={{ textAlign: "right" }}><SummaryFormula label="VAT" formula={`=ROUND(Tổng cộng*${Number(q.vatPercent) || 0}%;0)`} value={tt.vat} /></td></tr>
                {tt.discount > 0 && <tr><td colSpan={3}>Giảm giá</td><td style={{ textAlign: "right" }}><SummaryFormula label="Giảm giá" formula="=Giảm giá đã nhập" value={tt.discount} prefix="-" /></td></tr>}
                <tr><td colSpan={3}><strong>Thành tiền</strong></td><td style={{ textAlign: "right" }}><SummaryFormula label="Thành tiền" formula={`=Tổng cộng+VAT${tt.discount > 0 ? "-Giảm giá" : ""}`} value={tt.total} danger /></td></tr>
              </tfoot>
            </table>
          </div>
        )}

        {!isNew && hasPerm("quote:hn:manage") && (
          <HnManagerPanel quoteId={q.id} hnStatus={q.hnStatus} hnRejectNote={(q as Record<string, unknown>).hnRejectNote as string | undefined}
            onReload={async () => { try { const u = await api.getQuote(q.id); qRef.current = { ...u, _activeSheet: ai } as QuoteFull; stampKeys(qRef.current); redraw(); } catch { /* ignore */ } }} />
        )}

        <ExtraTables key={`extra-sheet-${ai}`} sheet={activeSheet as Parameters<typeof ExtraTables>[0]["sheet"]} templates={templates} companyId={q.companyId} editable={editable} canApprove={hasPerm("quote:internal:approve")} canPay={hasPerm("quote:internal:pay")} quoteId={q.id} onMarkDirty={mark} />

        <div className="actions">
          {editable && <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button>}
          {!isNew && !["converted", "lost"].includes(q.status) && hasPerm("quote:send") && <button className="btn btn-success" onClick={convert}>✓ Khách chốt</button>}
          {!isNew && !["converted", "lost"].includes(q.status) && hasPerm("quote:send") && <button className="btn btn-danger" onClick={lost}>✗ Khách không chốt</button>}
          {!isNew && (
            <div className="kebab-wrap" ref={moreRef} style={{ position: "relative" }}>
              <button className="btn kebab-btn" aria-haspopup="true" aria-expanded={moreOpen} title="Thêm thao tác" onClick={() => setMoreOpen((o) => !o)}>⋯</button>
              {moreOpen && (
                <div className="kebab-menu" role="menu">
                  <button role="menuitem" disabled={!!dangTai} onClick={() => { setMoreOpen(false); exportFile("xlsx"); }}>{dangTai === "xlsx" ? "Đang tạo Excel…" : "Tải Excel gửi khách"}</button>
                  <button role="menuitem" disabled={!!dangTai} onClick={() => { setMoreOpen(false); exportFile("pdf"); }}>{dangTai === "pdf" ? "Đang tạo PDF…" : "Tải PDF gửi khách"}</button>
                  <button role="menuitem" onClick={async () => { setMoreOpen(false); try { const r = await api.quoteVersions(q.id); setVersions(r.data); } catch (ex) { toast(errText(ex), "error"); } }}>Lịch sử phiên bản</button>
                  {(hasPerm("quote:update:all") || q.createdById === me.id) && <button role="menuitem" onClick={() => { setMoreOpen(false); setMembersOpen(true); }}>Thành viên phụ trách</button>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {importOpen && (
        <ImportExcelModal
          quoteId={isNew ? undefined : q.id}
          sheets={sheets}
          templates={templates}
          usesDaysOf={usesDaysOf}
          addrDetailOf={addrDetailOf}
          newSheetTemplateId={newSheetTemplateId}
          onApply={applyImport}
          onClose={() => setImportOpen(false)}
        />
      )}
      {versions && <VersionsModal quoteId={q.id} versions={versions} onClose={() => setVersions(null)} />}
      {membersOpen && <MembersModal quoteId={q.id} createdById={q.createdById} current={(q.members || []).map((m) => m.id)} onClose={() => setMembersOpen(false)} onSaved={(ids) => { q.members = ids.map((id) => ({ id })); setMembersOpen(false); }} />}
    </div>
  );
}

// Port renderManagerHnPanel — manager/admin GIAO phần Hà Nội cho Account HN + DUYỆT/TRẢ LẠI khi gửi.
function HnManagerPanel({ quoteId, hnStatus, hnRejectNote, onReload }: { quoteId: number; hnStatus?: string | null; hnRejectNote?: string | null; onReload: () => void }) {
  const [accounts, setAccounts] = useState<{ id: number; displayName?: string; username?: string }[]>([]);
  const [accId, setAccId] = useState("");
  const st = hnStatus || "";
  const label = ({ assigned: "Account đang làm", submitted: "Account đã gửi — chờ bạn DUYỆT", approved: "✓ Đã duyệt", rejected: "↩ Đã trả lại" } as Record<string, string>)[st] || "Chưa giao";
  const canAssign = !st || st === "rejected" || st === "approved";
  useEffect(() => { if (canAssign) api.hnAccounts().then((r) => setAccounts(r.data || [])).catch(() => {}); }, [canAssign]);
  const assign = async () => {
    if (!accId) return toast("Chọn Account HN trước", "error");
    try { await api.hnAssign(quoteId, Number(accId)); toast("Đã giao phần HN cho Account", "success"); onReload(); } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi giao", "error"); }
  };
  const review = async (decision: "approve" | "reject") => {
    let note: string | undefined;
    if (decision === "reject") { const n = await promptModal("Trả lại phần Hà Nội", "Lý do trả lại (Account sẽ thấy):", { placeholder: "VD: thiếu giá vật tư mục 3…" }); if (n === null) return; note = n; }
    try { await api.hnReview(quoteId, decision, note); toast(decision === "approve" ? "Đã duyệt phần HN" : "Đã trả lại phần HN", "success"); onReload(); } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); }
  };
  return (
    <div className="hn-mgr-panel" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "12px 0" }}>
      <span className="extra-cat-badge cat-hanoi">Phần Hà Nội (Account)</span>
      <span className={`ahn-status ahn-${st || "none"}`}>{label}</span>
      {canAssign && (
        <>
          <select className="extra-add-cat" value={accId} onChange={(e) => setAccId(e.target.value)}><option value="">— chọn Account HN —</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName || a.username}</option>)}</select>
          <button type="button" className="btn btn-sm" onClick={assign}>{st ? "Giao lại" : "Giao cho Account HN"}</button>
        </>
      )}
      {st === "submitted" && <><button type="button" className="btn btn-sm btn-primary" onClick={() => review("approve")}>✓ Duyệt</button><button type="button" className="btn btn-sm" onClick={() => review("reject")}>↩ Trả lại</button></>}
      {st === "rejected" && hnRejectNote && <span className="muted" style={{ fontSize: 12 }}>lý do trả: {hnRejectNote}</span>}
    </div>
  );
}

const FIELD_VN: Record<string, string> = { title: "Tiêu đề", toCompany: "Khách hàng", vatPercent: "VAT %", discount: "Giảm giá", notes: "Ghi chú", greeting: "Lời chào", sheets: "Nội dung sheet", quoteDate: "Ngày báo giá", showTotals: "Hiện tổng" };
const diffVal = (v: unknown) => { if (v == null) return "—"; if (typeof v === "object") { const s = JSON.stringify(v); return s.length > 80 ? s.slice(0, 80) + "…" : s; } return String(v); };
function VersionsModal({ quoteId, versions, onClose }: { quoteId: number; versions: QuoteVersion[]; onClose: () => void }) {
  const sorted = [...versions].sort((a, b) => a.versionNo - b.versionNo);
  const [a, setA] = useState(sorted[0]?.versionNo ?? 0);
  const [b, setB] = useState(sorted[sorted.length - 1]?.versionNo ?? 0);
  const [changes, setChanges] = useState<{ key: string; before: unknown; after: unknown }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const doDiff = async () => { setBusy(true); try { const r = await api.versionDiff(quoteId, a, b); setChanges(r.changes); } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); } finally { setBusy(false); } };
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Lịch sử phiên bản">
        <div className="modal-head"><h3>Lịch sử phiên bản</h3><button className="icon-btn" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          {versions.length === 0 ? <p className="muted">Chưa có phiên bản nào.</p> : (
            <table className="list-table"><thead><tr><th>Phiên bản</th><th>Thời gian</th><th style={{ textAlign: "right" }}>Tổng (VNĐ)</th></tr></thead>
              <tbody>{sorted.map((v) => <tr key={v.id}><td>#{v.versionNo}</td><td>{M.fmtDate(v.createdAt)}</td><td style={{ textAlign: "right" }}>{M.fmtMoney(v.total)}</td></tr>)}</tbody></table>
          )}
          {versions.length >= 2 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong>So sánh:</strong>
                <select value={a} onChange={(e) => setA(Number(e.target.value))}>{sorted.map((v) => <option key={v.versionNo} value={v.versionNo}>#{v.versionNo}</option>)}</select>
                <span>→</span>
                <select value={b} onChange={(e) => setB(Number(e.target.value))}>{sorted.map((v) => <option key={v.versionNo} value={v.versionNo}>#{v.versionNo}</option>)}</select>
                <button className="btn btn-sm btn-primary" onClick={doDiff} disabled={busy || a === b}>{busy ? "Đang xem…" : "Xem khác biệt"}</button>
              </div>
              {changes && (changes.length === 0 ? <p className="muted" style={{ marginTop: 8 }}>Hai phiên bản giống nhau.</p> : (
                <table className="list-table" style={{ marginTop: 8 }}><thead><tr><th>Trường</th><th>#{a}</th><th>#{b}</th></tr></thead>
                  <tbody>{changes.map((c) => <tr key={c.key}><td>{FIELD_VN[c.key] || c.key}</td><td style={{ color: "var(--danger)" }}>{diffVal(c.before)}</td><td style={{ color: "#0a7d28" }}>{diffVal(c.after)}</td></tr>)}</tbody></table>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot"><button className="btn btn-primary" onClick={onClose}>Đóng</button></div>
      </div>
    </div>
  );
}

const ROLE_LABEL_FULL: Record<string, string> = { admin: "Quản trị (Giám đốc)", manager: "Account", account_hn: "Account Hà Nội", hr: "Nhân sự (HR)", accountant: "Kế toán" };
function MembersModal({ quoteId, createdById, current, onClose, onSaved }: { quoteId: number; createdById?: number; current: number[]; onClose: () => void; onSaved: (ids: number[]) => void }) {
  const [users, setUsers] = useState<AssignableUser[] | null>(null);
  const [sel, setSel] = useState<number[]>(current);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.assignableUsers().then((r) => setUsers(r.data)).catch(() => setUsers([])); }, []);
  const toggle = (id: number) => { if (id === createdById) return; setSel((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]); };
  const save = async () => { setSaving(true); try { await api.setMembers(quoteId, sel.filter((id) => id !== createdById)); toast("Đã lưu thành viên", "success"); onSaved([...new Set([...(createdById ? [createdById] : []), ...sel])]); } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lỗi", "error"); setSaving(false); } };
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Thành viên phụ trách">
        <div className="modal-head"><h3>Thành viên phụ trách</h3><button className="icon-btn" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>Cho phép xem & sửa báo giá này. Người tạo luôn là thành viên.</p>
          {!users ? <div className="skeleton-wrap">{Array.from({ length: 4 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div> : (
            <div className="list-wrap">{users.map((u) => { const isCreator = u.id === createdById; return (
              <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: isCreator ? "default" : "pointer" }}>
                <input type="checkbox" checked={isCreator || sel.includes(u.id)} disabled={isCreator} onChange={() => toggle(u.id)} />
                <span>{u.displayName}<span className="muted"> · {ROLE_LABEL_FULL[u.role || ""] || u.role}{u.title ? " · " + u.title : ""}{isCreator ? " — người tạo" : ""}</span></span>
              </label>); })}</div>
          )}
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>Hủy</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button></div>
      </div>
    </div>
  );
}
