import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, isPreviewMode, type EditorTemplate, type QuoteFull } from "../lib/api";
import { toast, confirmModal } from "../lib/ui";
import * as M from "../lib/quoteMath";
import { type ItemK, nextK } from "../lib/gridShared";
import { extraTableSum } from "../components/ExtraTables";
import { HnTables, type HnTable } from "../components/HnTables";
import { ImportExcelModal, NEW_SHEET, type ImportApplyPayload } from "../components/ImportExcelModal";
import { khoaBanNhap, ghiBanNhap, docBanNhap, xoaBanNhap } from "../lib/localDraft";

// MÀN CỦA ACCOUNT HÀ NỘI — từ 2026-09-15 là một TRÌNH SOẠN ĐẦY ĐỦ của riêng họ.
//
// Trước đây màn này lặp theo TRANG của chủ báo giá (`hnSheets`) và in cả tên trang: người chỉ được
// giao điền giá lại biết báo giá có mấy trang, tên từng trang là gì. Lưu thì ghép theo `sheetId`,
// mà chủ bấm Lưu một lần là mọi id đổi (lưu = xoá trang rồi tạo lại) → họ gõ nửa tiếng rồi nhận
// 409 "hãy tải lại trang". Nay bảng HN ở `Quote.hnTables` (cấp báo giá): không gian riêng, phẳng,
// tự thêm/xoá/đặt tên sheet, dán từ Excel, NHẬP tệp Excel, công thức — đúng bộ của lưới báo giá
// chính (xem components/HnTables.tsx).
//
// KHÔNG hiện thông tin khách / người gửi / ngày / VAT / lời chào: những thứ đó theo báo giá gốc,
// account HN không điền và không cần thấy. Server cũng không gửi (presentQuoteForAccountHn).

let _templates: EditorTemplate[] | null = null;
type WinDirty = Window & { __editorDirty?: boolean };
const STATUS: Record<string, string> = { assigned: "Đang làm", submitted: "Đã gửi — chờ quản lý duyệt", approved: "✓ Đã duyệt", rejected: "↩ Bị trả lại" };

export function AccountHnView({ quoteId, meId }: { quoteId: number; meId?: number }) {
  const qRef = useRef<QuoteFull | null>(null);
  const [, setTick] = useState(0);
  const redraw = useCallback(() => setTick((t) => t + 1), []);
  const dirtyRef = useRef(false);
  // `mark` PHẢI vẽ lại màn, không chỉ đánh dấu "đã sửa".
  //
  // ĐO ĐƯỢC bằng trình duyệt thật (Cốc Cốc) 2026-09-16: gõ một hàng giá 3 × 1.500.000 vào sheet
  // mới thì đầu khối hiện `Tổng: 14.000.000 · 3 sheet` (đúng, vì HnTables tự vẽ lại) còn thẻ cuối
  // màn vẫn `TỔNG TẤT CẢ 2 SHEET HÀ NỘI — 9.500.000`. Hai con số TIỀN đá nhau trên cùng một màn,
  // và chỉ khớp lại sau khi Lưu rồi tải lại. Người đang gõ giá không biết tin con số nào.
  //
  // GOM NHỊP chứ không vẽ lại mỗi phím: một lượt gõ trong lưới bắn `mark` liên tục, mà vẽ lại cả
  // màn mỗi phím thì lưới lớn giật. `GridTable` có `key` ổn định nên lượt vẽ lại này KHÔNG gắn lại
  // nó — con trỏ và vùng chọn giữ nguyên (đã kiểm bằng trình duyệt thật).
  const nhipVe = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── BẢN NHÁP CỤC BỘ (GRID-16 / FE-13) ────────────────────────────────────────────────────────
  // Màn này là nơi gõ giá hàng loạt, vậy mà trước đây KHÔNG có lưới an toàn nào ngoài beforeunload:
  // tab sập / mất điện là mất trắng. Dùng lại localDraft: khoá riêng `hn<id>` theo người dùng, mốc là
  // `hnRev` (máy chủ đổi hnRev mỗi lần phần HN được ghi) — lệch mốc thì không đề nghị khôi phục.
  const khoaNhapRef = useRef<string | null>(null);
  const mocNhapRef = useRef<string | null>(null);
  const henNhapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ghiNhapNgay = () => {
    if (henNhapRef.current) { clearTimeout(henNhapRef.current); henNhapRef.current = null; }
    if (!dirtyRef.current || !qRef.current || !khoaNhapRef.current) return;
    ghiBanNhap(khoaNhapRef.current, { hnTables: qRef.current.hnTables }, mocNhapRef.current, meId);
  };
  const mark = () => {
    dirtyRef.current = true; (window as WinDirty).__editorDirty = true;
    if (henNhapRef.current) clearTimeout(henNhapRef.current);
    henNhapRef.current = setTimeout(ghiNhapNgay, 1200);
    if (nhipVe.current) return;
    nhipVe.current = setTimeout(() => { nhipVe.current = null; redraw(); }, 120);
  };
  useEffect(() => () => { if (nhipVe.current) clearTimeout(nhipVe.current); if (henNhapRef.current) clearTimeout(henNhapRef.current); }, []);
  // GRID-17: Ctrl/⌘+S = Lưu (không gửi duyệt), như trình soạn báo giá. Xem QuoteEditor.
  const saveRef = useRef<(() => unknown) | null>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.key !== "s" && e.key !== "S")) return;
      e.preventDefault();
      if (document.querySelector('[data-focus-trap="own"]')) return;
      saveRef.current?.();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  // app#15: bản sao của `saving` cho closure cũ (hàm onApply mà ImportExcelModal giữ khi chờ hộp xác nhận).
  const savingRef = useRef(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    // FE-13: sắp rời / ẩn trang → ghi bản nháp NGAY, không đợi 1,2s ngừng gõ.
    const ghi = () => ghiNhapNgayRef.current();
    const khiAn = () => { if (document.visibilityState === "hidden") ghi(); };
    window.addEventListener("pagehide", ghi);
    document.addEventListener("visibilitychange", khiAn);
    // app#17 (như FE-12 ở QuoteEditor): người dùng CHỦ ĐỘNG chọn "Rời, bỏ thay đổi" (Shell.guardLeave bắn
    // editor:discard) → xoá luôn bản nháp, không thì lần mở sau bị mời khôi phục đúng phần vừa bỏ.
    // Hạ dirtyRef TRƯỚC để pagehide/visibilitychange ngay sau đó không ghi lại bản nháp.
    const boThayDoi = () => {
      if (henNhapRef.current) { clearTimeout(henNhapRef.current); henNhapRef.current = null; }
      dirtyRef.current = false;
      if (khoaNhapRef.current) xoaBanNhap(khoaNhapRef.current);
    };
    window.addEventListener("editor:discard", boThayDoi);
    return () => { window.removeEventListener("beforeunload", h); window.removeEventListener("pagehide", ghi); document.removeEventListener("visibilitychange", khiAn); window.removeEventListener("editor:discard", boThayDoi); };
  }, []);

  // L58: hộp hỏi (confirmModal) là DOM tự dựng, KHÔNG tự đóng khi rời trang — Back lúc hộp đang mở thì
  // Shell gỡ view này (đổi `key`) mà hộp vẫn nằm đè lên trang mới. Trả lời hộp treo đó từng xoá bản
  // nháp giá HN của báo giá CŨ và bật/tắt cờ "chưa lưu" của trang MỚI. Mỗi lượt nạp nhận một hàm
  // `conSong`; sau MỌI `await` hỏi lại nó rồi mới đụng bản nháp / qRef / cờ (khuôn 01b07dc bên QuoteEditor).
  const songRef = useRef(true);
  useEffect(() => { songRef.current = true; return () => { songRef.current = false; }; }, []);
  // X1 (đợt 3): bản giữ lại ':xungdot' chỉ hỏi ở lượt nạp ĐẦU của mỗi lần gắn view, và lại sau một 409
  // mới (save → "Tải lại"). Hủy không còn xoá nó, mà save() nạp lại qua load() → trước đây MỖI lần Lưu
  // bật lại hai hộp danger; lỡ bấm "Mở bản của tôi" ngay sau Lưu là giá VỪA LƯU bị thay bằng giá cũ lúc
  // xung đột. Hộp hứa "lần mở sau sẽ hỏi lại", không phải sau mỗi lần Lưu.
  const daHoiXdRef = useRef(false);
  const load = useCallback(async (conSong: () => boolean = () => songRef.current) => {
    try {
      if (!_templates) _templates = await api.metaTemplates();
      const q = await api.getQuote(quoteId);
      if (!conSong()) return;
      if (!Array.isArray(q.hnTables)) q.hnTables = [];
      // L63 (như QuoteEditor): XEM THỬ QUYỀN — lệnh ghi chỉ "thành công giả" mà meId vẫn là admin THẬT →
      // không đọc / hỏi / ghi / xoá bản nháp. Khoá null thì mark, ghiNhapNgay, save đều tự bỏ qua.
      const khoa = isPreviewMode() ? null : khoaBanNhap(`hn${quoteId}`, meId);
      const moc = String((q as { hnRev?: string }).hnRev ?? (q as { updatedAt?: string }).updatedAt ?? "");
      const suaDuoc = !q.hnStatus || ["assigned", "rejected"].includes(String(q.hnStatus));
      let khoiPhuc = false;
      // X1: hỏi bản nháp THƯỜNG trước, bản giữ lại ':xungdot' sau (cùng thứ tự với QuoteEditor). Bản giữ
      // lại nay sống qua nhiều phiên (Hủy không xoá nó); hỏi nó trước rồi `else if` chặn bản nháp thường
      // là giấu luôn phần gõ MỚI HƠN (mốc hnRev khớp máy chủ) — phím gõ đầu tiên sau đó ghi đè mất nó.
      const nhap = khoa ? docBanNhap(khoa, meId) : null;
      if (khoa && nhap && nhap.baseUpdatedAt === moc && suaDuoc) {
        const dong = await confirmModal("Có giá Hà Nội chưa lưu từ lần trước", `Lần trước bạn rời trang lúc ${new Date(nhap.luuLuc).toLocaleString("vi-VN")} khi còn giá CHƯA LƯU. Khôi phục?`, { confirmText: "Khôi phục" });
        if (!conSong()) return;
        if (dong) {
          q.hnTables = ((nhap.quote as { hnTables?: unknown[] }).hnTables) ?? q.hnTables; khoiPhuc = true;
        } else xoaBanNhap(khoa);
      }
      // Bản giữ lại lúc xung đột 409 (xem save) — mở ra thì mang mốc MỚI, Lưu là chủ động ghi đè. Đã khôi
      // phục bản nháp thường thì không hỏi (bản giữ lại vẫn nằm đó, lần mở sau hỏi tiếp). Lượt nạp sau Lưu
      // cũng không hỏi (daHoiXdRef).
      const hoiXd = !daHoiXdRef.current;
      daHoiXdRef.current = true;
      const xd = khoa && !khoiPhuc && hoiXd ? docBanNhap(khoa + ":xungdot", meId) : null;
      if (khoa && xd && suaDuoc) {
        const moLai = await confirmModal("Giá Hà Nội bạn gõ trước khi bị xung đột", "Phần Hà Nội vừa được ghi ở nơi khác trong lúc bạn đang gõ. Phần bạn gõ khi đó được giữ lại trên máy này. Mở lại? Lưu sau khi mở sẽ GHI ĐÈ bản vừa được ghi. Hủy thì bản này vẫn được giữ, bạn sẽ được hỏi có xoá không.", { confirmText: "Mở bản của tôi", danger: true });
        if (!conSong()) return;
        if (moLai) {
          q.hnTables = ((xd.quote as { hnTables?: unknown[] }).hnTables) ?? q.hnTables; khoiPhuc = true;
          xoaBanNhap(khoa + ":xungdot");   // đã mở → bản nháp THƯỜNG (mốc mới) tiếp quản lưới an toàn
        } else {
          // X1 (cùng dạng app#13 bên QuoteEditor): tiêu điểm mặc định của hộp danger ở "Hủy" — Enter theo
          // phản xạ, Esc, bấm ra ngoài đều về đây, và nhánh này từng XOÁ VĨNH VIỄN bản sao duy nhất của
          // phần đã gõ. Chỉ xoá khi người dùng chọn rõ ràng; giữ thì hạn 7 ngày / Đăng xuất vẫn dọn nó.
          const bo = await confirmModal(
            "Bỏ bản của bạn?",
            "Giá Hà Nội bạn gõ trước khi bị xung đột sẽ bị XOÁ vĩnh viễn khỏi máy này. Chọn Hủy để giữ lại — lần mở sau sẽ hỏi lại (tối đa 7 ngày).",
            { danger: true, confirmText: "Xoá bản này" },
          );
          if (!conSong()) return;
          if (bo) xoaBanNhap(khoa + ":xungdot");
        }
      }
      khoaNhapRef.current = khoa; mocNhapRef.current = moc;
      qRef.current = q; dirtyRef.current = khoiPhuc; (window as WinDirty).__editorDirty = khoiPhuc; setReady(true); redraw();
    } catch (ex) { if (conSong()) setErr(ex instanceof ApiError ? ex.message : "Lỗi tải"); }
  }, [quoteId, redraw, meId]);
  const ghiNhapNgayRef = useRef(ghiNhapNgay);
  ghiNhapNgayRef.current = ghiNhapNgay;
  useEffect(() => { let alive = true; daHoiXdRef.current = false; load(() => alive); return () => { alive = false; }; }, [load]);

  if (err) return <div className="err" style={{ margin: 24 }}>⚠ {err} <button type="button" className="btn btn-sm" onClick={() => { setErr(""); load(); }}>Thử lại</button> <a className="btn btn-sm" href="#/list">Về danh sách</a></div>;
  if (!ready || !qRef.current) return <div className="skeleton-wrap" style={{ padding: 24 }}>{Array.from({ length: 5 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>;

  const templates = _templates || [];
  const q = qRef.current as QuoteFull & { hnStatus?: string; hnRejectNote?: string; companyName?: string; updatedAt?: string; hnRev?: string };
  const hnTables = q.hnTables as HnTable[];
  const hnStatus = q.hnStatus || "assigned";
  const editable = !q.hnStatus || ["assigned", "rejected"].includes(q.hnStatus);

  const tplList0 = templates.filter((x) => x.companyId === q.companyId);
  const tplList = tplList0.length ? tplList0 : templates;
  const defTplId = tplList[0]?.id;
  const tplOf = (id?: number) => templates.find((x) => x.id === (id || defTplId)) || tplList[0];
  const usesDaysOf = (id?: number) => !!tplOf(id)?.layout?.hasDays;
  const addrDetailOf = (id?: number) => !!(tplOf(id)?.layout?.reserveDetail ?? tplOf(id)?.layout?.hasDetail);
  const newSheetTemplateId = (code?: string | null) => (code ? templates.find((x) => x.code === code)?.id : undefined) ?? hnTables[0]?.templateId ?? defTplId;

  const tong = hnTables.reduce((a, t) => a + extraTableSum(t as never), 0);

  // NẠP TỪ EXCEL — dùng CHUNG modal với trình soạn báo giá (xem trước từng tab rồi mới nạp).
  // Bảng HN có đúng hình dạng { name, templateId, groupSubtotal, items } mà modal cần, nên truyền
  // thẳng. Không có Discount/VAT ở đây: hai thứ đó thuộc báo giá gửi khách, không thuộc phần HN.
  const applyImport = (payload: ImportApplyPayload) => {
    // app#15: đang Lưu, hoặc Lưu xong `load()` đã thay qRef → `hnTables` của closure này là mảng CŨ,
    // nạp vào đó là mất im lặng.
    if (savingRef.current || qRef.current !== q) { toast("Phần Hà Nội đang lưu / vừa lưu — mở lại hộp Nhập từ Excel rồi nạp lại", "info"); return; }
    let nAdd = 0, nBang = 0, nMoi = 0;
    for (const p of payload.plans) {
      const stamped = p.items.map((it) => { const o = { ...it } as ItemK; o._k = nextK(); return o; });
      if (p.targetIndex === NEW_SHEET) {
        hnTables.push({ _k: nextK(), templateId: p.templateId ?? defTplId, name: p.file.name, groupSubtotal: !!p.file.groupSubtotal, items: stamped });
        nAdd += stamped.length; nBang++; nMoi++;
        continue;
      }
      const target = hnTables[p.targetIndex];
      if (!target) continue;
      if (p.mode === "append") target.items.push(...stamped);
      else target.items.splice(0, target.items.length, ...stamped);
      if (p.templateId) target.templateId = p.templateId;
      nAdd += stamped.length; nBang++;
    }
    for (const i of [...(payload.removeTargetIndexes || [])].sort((a, b) => b - a)) hnTables.splice(i, 1);
    setImportOpen(false);
    mark(); redraw();
    toast(`Đã nạp ${nAdd} dòng vào ${nBang} sheet${nMoi ? ` (${nMoi} sheet mới)` : ""} — nhớ bấm Lưu`, "success");
  };

  const save = async (thenSubmit: boolean) => {
    // GRID-07: chốt ô đang gõ vào model trước khi gói dữ liệu; bảng khoá suốt lúc lưu (editable &&
    // !saving) — gõ thêm lúc đang chờ thì `load()` sau đó thay qRef và phần đó mất im lặng.
    const dangGo = document.activeElement as HTMLElement | null;
    if (dangGo && dangGo !== document.body && typeof dangGo.blur === "function") dangGo.blur();
    setSaving(true); savingRef.current = true;
    try {
      // Dọn `_k` (khoá React nội bộ) trước khi gửi, y như đường lưu của trình soạn báo giá.
      const goi = hnTables.map((t) => ({
        name: t.name, templateId: t.templateId, groupSubtotal: !!t.groupSubtotal,
        items: (t.items || []).map((it) => { const o = { ...it }; delete (o as ItemK)._k; return o; }),
      }));
      await api.saveHn(q.id, goi, q.updatedAt, q.hnRev);
      dirtyRef.current = false; (window as WinDirty).__editorDirty = false;
      // Đã lên máy chủ → bản nháp hết lý do tồn tại (giữ lại là lần mở sau hỏi khôi phục thứ cũ hơn).
      if (henNhapRef.current) { clearTimeout(henNhapRef.current); henNhapRef.current = null; }
      if (khoaNhapRef.current) xoaBanNhap(khoaNhapRef.current);
      if (thenSubmit) { await api.submitHn(q.id); toast("Đã gửi duyệt phần Hà Nội", "success"); }
      else toast("Đã lưu phần Hà Nội", "success");
      await load();
    } catch (ex) {
      // GRID-16: 409 = phần HN vừa được ghi ở nơi khác (hnRev/updatedAt lệch). Trước đây chỉ là toast:
      // không lối tải lại, mà tự tải lại thì mất phần đang gõ. Nay giữ phần đang gõ vào khoá `…:xungdot`
      // rồi mới tải lại; đường nạp hỏi có mở lại không (y như GRID-08 ở trình soạn báo giá).
      if (ex instanceof ApiError && ex.status === 409 && khoaNhapRef.current && qRef.current) {
        // app#12: ghi bản giữ lại TRƯỚC khi hỏi và chọn đường theo KẾT QUẢ ghi. Không ghi được (bộ nhớ
        // đầy / bị chặn / quá lớn) thì KHÔNG hứa "được GIỮ LẠI" và KHÔNG tải lại — quay về hành vi cũ:
        // báo lỗi, giữ nguyên màn hình để người dùng chép phần đang gõ.
        if (henNhapRef.current) { clearTimeout(henNhapRef.current); henNhapRef.current = null; }
        const khoaXd = khoaNhapRef.current + ":xungdot";
        const kq = ghiBanNhap(khoaXd, { hnTables: qRef.current.hnTables }, mocNhapRef.current, meId);
        if (kq !== "da-ghi" && kq !== "da-ghi-bo-anh") {
          toast(`${ex.message}. Trình duyệt không giữ được bản tạm trên máy này — hãy chép phần đang gõ trước khi tải lại trang.`, "error");
        } else {
          const tai = await confirmModal("Phần Hà Nội đã thay đổi ở nơi khác", `${ex.message}. Tải lại bản mới nhất? Phần bạn đang gõ được GIỮ LẠI trên máy này và bạn sẽ được hỏi mở lại.`, { danger: true, confirmText: "Tải lại bản mới" });
          if (tai) {
            dirtyRef.current = false; (window as WinDirty).__editorDirty = false;
            daHoiXdRef.current = false;   // vừa ghi bản giữ lại → lượt nạp này phải hỏi mở lại
            await load();
          } else xoaBanNhap(khoaXd);   // Hủy → ở lại; bỏ bản giữ lại để lần mở sau không hỏi một bản cũ
        }
      } else toast(ex instanceof ApiError ? ex.message : "Lỗi lưu phần HN", "error");
    }
    finally { setSaving(false); savingRef.current = false; }
  };
  saveRef.current = editable && !saving ? () => save(false) : null;
  // Đợt 3 (họ L58/L61): hộp không tự đóng khi Back — xác nhận nó sau khi view đã gỡ từng Lưu + GỬI DUYỆT
  // báo giá CŨ (account không tự rút lại được) và hạ cờ bẩn DÙNG CHUNG của trang đang mở.
  const submit = async () => {
    if (!(await confirmModal("Gửi duyệt phần Hà Nội", "Sau khi gửi sẽ KHÔNG sửa được cho tới khi quản lý duyệt / trả lại. Tiếp tục?", { confirmText: "Gửi duyệt" }))) return;
    if (!songRef.current) return;
    save(true);
  };

  return (
    <div className="account-hn-view ahn-card">
      <div className="ahn-head">
        <div className="ahn-head-titles"><h1 className="ahn-title">Phần Giá Hà Nội</h1>
          <div className="muted ahn-sub">{q.projectCode || q.quoteNumber || ""}{q.title ? " · " + q.title : ""}{q.companyName ? " · " + q.companyName : ""}</div></div>
        <span className={`ahn-status ahn-${hnStatus}`}>{STATUS[hnStatus] || "Đang làm"}</span>
      </div>
      {q.hnStatus === "rejected" && q.hnRejectNote && <div className="ahn-reject">↩ <strong>Quản lý trả lại:</strong> {q.hnRejectNote}</div>}
      <div className="muted" style={{ margin: "8px 0 4px" }}>Bạn chỉ điền <strong>giá Hà Nội</strong> (số nội bộ — KHÔNG xuất cho khách, không thấy phần báo giá khác). Sheet ở đây là <strong>của riêng bạn</strong>: tự thêm, tự đặt tên, dán hoặc nạp từ Excel.</div>

      {editable && (
        <div style={{ margin: "6px 0 2px" }}>
          <button type="button" className="btn btn-sm" title="Nạp hạng mục từ file Excel (xem trước rồi mới nạp)" disabled={saving} onClick={() => setImportOpen(true)}>⬆ Nhập từ Excel</button>
        </div>
      )}

      <HnTables moMacDinh tables={hnTables} templates={templates} companyId={q.companyId}
        editable={editable && !saving} canApprove={false} canPay={false} quoteId={q.id}
        onMarkDirty={mark} onQuoteTouched={(u) => { (q as { updatedAt?: string }).updatedAt = u; }} />

      <div className="ahn-grand-card"><span className="ahn-grand-label">Tổng tất cả {hnTables.length} sheet Hà Nội</span><span className="ahn-grand-val">{M.fmtMoney(tong)}</span></div>

      <div className="ahn-actions" style={{ marginTop: 14 }}>
        {editable ? <>
          <button className="btn btn-sm" onClick={() => save(false)} disabled={saving}>💾 Lưu</button>
          <button className="btn btn-sm btn-primary" onClick={submit} disabled={saving}>✓ Gửi duyệt</button>
        </> : <span className="muted">{hnStatus === "submitted" ? "Đã gửi, chờ quản lý duyệt — không sửa được lúc này." : hnStatus === "approved" ? "Phần Hà Nội đã được duyệt." : ""}</span>}
      </div>

      {importOpen && (
        <ImportExcelModal
          quoteId={q.id}
          sheets={hnTables as never}
          templates={templates}
          usesDaysOf={usesDaysOf}
          addrDetailOf={addrDetailOf}
          newSheetTemplateId={newSheetTemplateId}
          khongCoTongTien
          onApply={applyImport}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}
