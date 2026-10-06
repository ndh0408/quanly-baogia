import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, type Me, type QuoteRow, type QuoteListNote, type QuoteListResult } from "../lib/api";
import { useDebouncedValue } from "../lib/query";
import { toast, confirmModal, useEscClose } from "../lib/ui";
import { statusLabel, fmtMoney, fmtDate, codeLabel, tieuDeHienThi, errMsg, dash } from "../lib/format";
import { xuatBaoGia } from "../lib/exportQuote";
import { useTrangAnToan } from "../lib/phienBan";
import { QuoteNote, type GhiChuThayDoi } from "../components/QuoteNote";
import { BoLocBaoGia } from "../components/BoLocBaoGia";
import { LOC_RONG, demBoLoc, docTuUrl, ghiLenUrl, thamSoApi, type BoLocDS } from "../lib/locDanhSach";

// Port "Danh sách báo giá" (renderList) — bê ĐẦY ĐỦ: tìm thông minh (debounce) + bộ lọc (trạng thái, người tạo, công ty,
// ngày, tổng tiền, ghi chú/màu — components/BoLocBaoGia) + SORT mọi cột + phân trang + LƯU bộ lọc vào URL
// (#/list?q=&status=&company=&creator=&from=&to=&min=&max=&note=&color=&sort=&page=) + thao tác (mở→editor ·
// Excel · Nhân bản · Bản mới · Xóa) + cột theo vai trò (admin: Người tạo; account_hn: rút gọn HN)
// + empty/error. "Tạo báo giá" → wizard (#/new iframe); mở/nhân-bản → editor (#/quotes/:id iframe).
// Định dạng chung (tiền/ngày/mã/tiêu đề/trạng thái) dùng ../lib/format — KHÔNG tự chế lại ở đây.
const HN_LIST_STATUS: Record<string, { label: string; cls: string }> = { assigned: { label: "Đang làm", cls: "sent" }, submitted: { label: "Chờ duyệt", cls: "pending" }, approved: { label: "Đã duyệt", cls: "approved" }, rejected: { label: "Bị trả", cls: "rejected" } };
const hnBadge = (st?: string | null) => HN_LIST_STATUS[st || ""] || { label: "Chưa giao", cls: "draft" };
// Cột sắp xếp — KHỚP COT_SAP_XEP_CU / COT_SAP_XEP_MOI ở src/quoteListFilter.ts. Bốn cột CŨ là thứ duy nhất view lược
// (account HN / tài khoản chi phí) được sắp theo; các cột MỚI máy chủ chỉ cho view đầy đủ (sắp theo thứ người ta không
// thấy là cách dò nó), nên view lược không vẽ mũi tên ở đó.
const SORT_CU = ["createdAt", "quoteDate", "total", "quoteNumber"];
const SORT_MOI = ["title", "toCompany", "status", "company", "creator", "customerCode"];
const PAGE_SIZE = 20;

export function QuoteListPage({ me }: { me: Me }) {
  useTrangAnToan();   // chỉ xem/lọc (bộ lọc nằm trên URL) — tải lại không mất gì (dải "Có bản mới", lib/phienBan.ts)
  const qc = useQueryClient();
  const can = useCallback((perm: string) => me.permissions.includes(perm) || (perm.endsWith(":own") && me.permissions.includes(perm.replace(/:own$/, ":all"))), [me]);
  // Theo QUYỀN (không theo role cứng): thấy mọi báo giá → hiện cột "Người tạo"; người điền HN → bản lược HN.
  const isAdmin = me.permissions.includes("quote:read:all");
  const isAccountHn = me.permissions.includes("quote:hn:fill");
  const isInternalViewer = !isAccountHn && me.permissions.includes("quote:internal:view"); // chi phí: chỉ thấy nội bộ
  const stripped = isAccountHn || isInternalViewer; // ẩn giá/khách/nút (bản lược)
  const payProg = (r: { internalPaidRows?: number; internalRows?: number }) => r.internalRows ? `${r.internalPaidRows ?? 0}/${r.internalRows}` : "—";
  const isMobile = useIsMobile();
  // KHỚP server (quotes.routes.js): 'converted' là TERMINAL → KHÔNG ai xóa; delete:all xóa mọi trạng thái khác;
  // delete:own chỉ xóa báo giá CỦA MÌNH ở draft/rejected. (Trước đây short-circuit delete:all hiện nhầm nút trên 'Đã chốt'.)
  const canDelete = (q: QuoteRow) => q.status !== "converted" && (can("quote:delete:all") || (can("quote:delete:own") && q.createdById === me.id && (q.status === "draft" || q.status === "rejected")));

  // "PHỤ": báo giá của người khác mà mình được thêm vào làm cùng (account phụ). quoteScopeWhere
  // đã lọc danh sách nên ai còn thấy hàng này thì hoặc là chủ, hoặc là thành viên, hoặc xem-tất-cả
  // — nên chỉ cần so người tạo, không phải hỏi thêm server. Quản trị/người xem nội bộ đã có cột
  // "Người tạo" riêng nên không dán nhãn cho họ.
  const laPhu = (r: QuoteRow) => !isAdmin && !isInternalViewer && !isAccountHn && r.createdById != null && r.createdById !== me.id;

  // GHI CHÚ + MÀU ở dòng (chủ repo 2026-09-30). Chỉ view đầy đủ thấy cột này (hai view lược không được máy chủ
  // trả trường `listNote`). Sửa được khi có quote:update:* — KHỚP cổng `canOnQuote(update)` ở máy chủ; dòng của
  // người khác mà mình chỉ là thành viên chỉ-xem thì máy chủ từ chối (403) và ô báo lỗi + trả về bản thật.
  const choSuaGhiChu = can("quote:update:own");
  // Cập nhật TẠM (optimistic) mọi trang đã nạp trong cache rồi mới gọi máy chủ: gõ xong Enter là thấy ngay,
  // không chờ một vòng mạng. Lỗi → nạp lại từ máy chủ (không tự đoán "bản trước" vì hai lần lưu chồng nhau
  // — đổi màu rồi gõ chữ — có thể về không đúng thứ tự). Thành công chỉ bồi thêm người ghi/giờ ghi: chữ và màu
  // đã đúng ở lần cập nhật tạm, và máy chủ trộn theo từng trường nên không có gì để sửa lại.
  const luuGhiChu = async (r: QuoteRow, p: GhiChuThayDoi) => {
    const ghi = (fn: (x: QuoteListNote | null) => QuoteListNote | null) =>
      qc.setQueriesData<QuoteListResult>({ queryKey: ["quotes"] }, (cu) => cu && { ...cu, data: cu.data.map((x) => (x.id === r.id ? { ...x, listNote: fn(x.listNote ?? null) } : x)) });
    ghi((x) => {
      const note = p.note !== undefined ? p.note.trim() : (x?.note ?? "");
      const color = p.color !== undefined ? p.color : (x?.color ?? null);
      return note || color ? { note, color, updatedByName: me.displayName, updatedAt: new Date().toISOString() } : null;
    });
    try {
      const kq = await api.setQuoteListNote(r.id, p);
      ghi((x) => (x ? { ...x, updatedByName: kq.updatedByName, updatedAt: kq.updatedAt } : x));
      // Số đếm "Có ghi chú / Chưa có / từng màu" đổi theo. Chỉ làm tươi SỐ ĐẾM, không nạp lại danh sách: dòng vừa sửa
      // phải ở yên (đang lọc "Chưa có" mà gõ ghi chú xong, dòng biến mất ngay dưới tay người dùng là rất khó chịu).
      qc.invalidateQueries({ queryKey: ["quoteFacets"] });
    } catch (ex) {
      toast(errMsg(ex, "Không lưu được ghi chú"), "error");
      reload();
    }
  };

  const sp0 = new URLSearchParams((location.hash.split("?")[1]) || "");
  // BỘ LỌC (components/BoLocBaoGia). View lược chỉ có ô tìm + trạng thái + ngày (xem thanh lọc bên dưới): giá trị khác
  // trên URL (gõ tay / link cũ) bị bỏ, thay vì áp NGẦM một bộ lọc mà màn hình không hề hiện ra.
  const [loc, setLoc] = useState<BoLocDS>(() => { const l = docTuUrl(sp0); return stripped ? { ...LOC_RONG, q: l.q, status: l.status, tu: l.tu, den: l.den } : l; });
  const datLoc = (p: Partial<BoLocDS>) => setLoc((c) => ({ ...c, ...p }));
  const xoaLoc = () => setLoc(LOC_RONG);
  const dangLoc = demBoLoc(loc) > 0;
  const sortHopLe = (s: string | null): s is string => !!s && (SORT_CU.includes(s) || (!stripped && SORT_MOI.includes(s)));
  const [sort, setSort] = useState(sortHopLe(sp0.get("sort")) ? sp0.get("sort")! : "createdAt");
  const [order, setOrder] = useState<"asc" | "desc">(sp0.get("order") === "asc" ? "asc" : "desc");
  const busy = useRef(false);

  // Tải qua TanStack Query. Ô tìm debounce 300ms như cũ (chỉ debounce theo q; các bộ lọc khác áp ngay — ô tiền chỉ
  // báo thay đổi khi rời ô / Enter nên không cần).
  const debouncedQ = useDebouncedValue(loc.q, loc.q ? 300 : 0);
  const tham = thamSoApi({ ...loc, q: debouncedQ });   // tham số gửi máy chủ: chỉ khoá có giá trị
  // TRANG GẮN VỚI BỘ LỌC NÓ THUỘC VỀ (L75). Trước đây `useEffect(() => setPage(1), [debouncedQ, status,
  // sort, order])` chạy cả lúc MOUNT: F5 / Back về #/list?page=3 luôn nhảy về trang 1 (kèm một request
  // page=3 bỏ phí); còn đổi bộ lọc thì lượt dựng đầu vẫn mang trang CŨ → hai request (page=2 với từ khoá
  // mới rồi page=1). Nay trang đi cùng khoá bộ lọc: khoá đổi thì NGAY lượt dựng đó trang là 1 — một
  // request; lúc mount khoá khớp nên giữ trang đọc từ URL.
  const boLoc = JSON.stringify([tham, sort, order]);
  const [trang, setTrang] = useState(() => ({ boLoc, so: Math.max(1, parseInt(sp0.get("page") || "1", 10) || 1) }));
  if (trang.boLoc !== boLoc) setTrang({ boLoc, so: 1 });   // đồng bộ ngay trong lượt dựng: đổi lọc rồi đổi LẠI vẫn ở trang 1
  const page = trang.boLoc === boLoc ? trang.so : 1;
  const setPage = (f: (p: number) => number) => setTrang({ boLoc, so: Math.max(1, f(page)) });

  // Ghi filter lên URL bằng replaceState (không bắn hashchange → React shell không re-route).
  useEffect(() => {
    const p = ghiLenUrl(loc);
    if (sort !== "createdAt") p.set("sort", sort);
    if (order !== "desc") p.set("order", order);
    if (page > 1) p.set("page", String(page));
    // Dấu phẩy ngăn các giá trị ("status=draft,converted") để NGUYÊN: URLSearchParams mã hoá nó thành %2C — hợp lệ nhưng
    // khó đọc khi người dùng dán link cho nhau; docTuUrl đọc cả hai dạng như nhau.
    const qs = p.toString().replace(/%2C/gi, ",");
    try { history.replaceState(null, "", "#/list" + (qs ? "?" + qs : "")); } catch { /* ignore */ }
  }, [loc, sort, order, page]);

  const { data, isPending, isPlaceholderData, error, refetch } = useQuery({
    queryKey: ["quotes", { ...tham, sort, order, page }],
    queryFn: () => api.listQuotes({ ...tham, sort, order, page, size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  // SỐ ĐẾM trên từng ô lọc (mỗi nhóm đếm theo mọi bộ lọc KHÁC của nó). Chỉ view đầy đủ: view lược bị máy chủ từ chối (403)
  // vì số đếm theo người tạo / ghi chú là cách dò thứ họ không được thấy. Lỗi / đang tải → bộ lọc vẫn dùng, chỉ thiếu số.
  const { data: facets } = useQuery({
    queryKey: ["quoteFacets", tham],
    queryFn: () => api.quoteFacets(tham),
    enabled: !stripped,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const rows = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, pageCount: 1 };
  // Trang từ URL nay được GIỮ, nên có thể trỏ quá số trang hiện có (báo giá bị xoá bớt từ lúc lưu link):
  // máy chủ không kẹp trang, trả danh sách rỗng và thanh phân trang ẩn theo — kéo về trang cuối.
  const soTrangThat = data && !isPlaceholderData ? data.meta.pageCount : undefined;   // bản giữ tạm (keepPreviousData) là của khoá CŨ
  useEffect(() => { if (soTrangThat !== undefined && page > Math.max(1, soTrangThat)) setTrang({ boLoc, so: Math.max(1, soTrangThat) }); }, [soTrangThat, page, boLoc]);
  const loading = isPending;
  const err = error ? errMsg(error) : "";
  const reload = () => { qc.invalidateQueries({ queryKey: ["quotes"] }); qc.invalidateQueries({ queryKey: ["quoteFacets"] }); };

  const toggleSort = (f: string) => {
    if (sort === f) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(f); setOrder(f === "quoteDate" || f === "total" ? "desc" : "asc"); }
  };
  const open = (id: number) => { location.hash = "#/quotes/" + id; };
  const act = async (a: string, qr: QuoteRow, e?: { stopPropagation: () => void }) => {
    e?.stopPropagation();
    // ── XUẤT FILE KHÔNG ĐI QUA `busy` ─────────────────────────────────────────
    // `busy` là MỘT cờ dùng chung cho MỌI hành động trong hàm này (Xuất / Nhân bản / Bản mới / Xoá),
    // và nó chặn IM LẶNG (`if (busy.current) return;` — không toast, không nút mờ).
    // Chuyện đó vô hại khi Xuất còn là `window.open`: nó trả quyền điều khiển về ngay lập tức.
    // Nay Xuất `await` tới HÀNG PHÚT ở đường nền — giữ `busy` suốt quãng đó nghĩa là trong lúc chờ
    // file, người dùng bấm Xoá hay Nhân bản một báo giá KHÁC thì KHÔNG CÓ GÌ XẢY RA và không có
    // lời giải thích nào. Họ sẽ nghĩ trang bị treo.
    // `xuatBaoGia` đã tự chặn bấm lại theo (báo giá, định dạng) và tự báo lỗi, nên nó không cần
    // `busy` — cho nó ra ngoài.
    if (a === "excel") { await xuatBaoGia(qr.id, "xlsx"); return; }
    if (busy.current) return; busy.current = true;
    try {
      if (a === "dup") { const nq = await api.duplicateQuote(qr.id); toast("Đã nhân bản. Bạn đang sửa bản mới.", "success"); open(nq.id); }
      else if (a === "revise") { const nq = await api.duplicateQuote(qr.id, true); toast(`Đã tạo bản mới cùng mã dự án (${codeLabel(nq)}).`, "success"); open(nq.id); }
      else if (a === "del") {
        if (!(await confirmModal("Xóa báo giá", `Xóa báo giá ${qr.projectCode || qr.quoteNumber}? Hành động không thể hoàn tác.`, { danger: true, confirmText: "Xóa" }))) return;
        await api.deleteQuote(qr.id); toast("Đã xóa", "success"); reload();
      }
    } catch (ex) { toast(errMsg(ex, "Lỗi"), "error"); }
    finally { busy.current = false; }
  };

  // Dấu cách KHÔNG NGẮT trước mũi tên: ở laptop tiêu đề cột được xuống 2 dòng (styles.css, vùng đặc ≤1700px) — dấu cách thường
  // để mũi tên rơi xuống dòng một mình.
  const arrow = (f: string) => sort === f ? (order === "asc" ? " ▲" : " ▼") : "";
  const aria = (f: string): "ascending" | "descending" | "none" => sort === f ? (order === "asc" ? "ascending" : "descending") : "none";
  // Cột nào cũng bấm được để sắp xếp — trừ view lược ở các cột máy chủ không cho họ sắp (xem SORT_MOI): ở đó chỉ là chữ.
  const SortTh = ({ f, label, right }: { f: string; label: string; right?: boolean }) => stripped && !SORT_CU.includes(f) ? (
    <th scope="col" className={right ? "num" : undefined}>{label}</th>
  ) : (
    <th scope="col" className={`sortable${right ? " num" : ""}`} aria-sort={aria(f)} title="Bấm để sắp xếp" tabIndex={0}
        onClick={() => toggleSort(f)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(f); } }}>{label}{arrow(f)}</th>
  );

  return (
    <div>
      <h1>Danh sách báo giá</h1>
      <p className="muted page-sub">Tìm, lọc và mở báo giá — báo giá Đã chốt sẽ chuyển sang Quản lý dự án.</p>
      {stripped ? (
        // VIEW LƯỢC (account HN / tài khoản chi phí): ô tìm + trạng thái + ngày — những thứ họ thấy trên dòng. Không người tạo /
        // tổng tiền / ghi chú / số đếm: lọc theo thứ người ta không được thấy là cách dò nó (máy chủ cũng bỏ các bộ lọc đó).
        <div className="toolbar">
          <input type="search" className="grow" placeholder="Tìm theo số, tiêu đề, khách…" value={loc.q} onChange={(e) => datLoc({ q: e.target.value })} aria-label="Tìm báo giá" />
          <select value={loc.status.join(",")} onChange={(e) => datLoc({ status: e.target.value ? e.target.value.split(",") : [] })} aria-label="Lọc theo trạng thái">
            <option value="">— Tất cả trạng thái —</option>
            <option value="draft">Nháp</option><option value="converted">Đã chốt</option><option value="lost">Không chốt</option>
            {/* Deep-link từ Pipeline Dashboard (#/list?status=pending…): trạng thái ngoài bộ chuẩn vẫn phải
                hiện trong select — không thì ô trống, user không biết đang lọc gì. */}
            {loc.status.length > 0 && !["draft", "converted", "lost"].includes(loc.status.join(",")) && <option value={loc.status.join(",")}>{loc.status.map(statusLabel).join(", ")}</option>}
          </select>
          <label className="inv-date-filter"><span>Từ</span><input type="date" aria-label="Ngày báo giá từ" value={loc.tu} max={loc.den || undefined} onChange={(e) => datLoc({ tu: e.target.value })} /></label>
          <label className="inv-date-filter"><span>Đến</span><input type="date" aria-label="Ngày báo giá đến" value={loc.den} min={loc.tu || undefined} onChange={(e) => datLoc({ den: e.target.value })} /></label>
          <button className="btn btn-sm btn-ghost" type="button" onClick={xoaLoc} disabled={!dangLoc}>Xóa lọc</button>
          {can("quote:create") && <button className="btn btn-primary" onClick={() => { location.hash = "#/new"; }}>+ Tạo báo giá</button>}
        </div>
      ) : (
        <>
          <div className="toolbar">
            {/* Tìm THÔNG MINH: nhiều từ, không dấu, không cần đúng thứ tự; mỗi từ khớp mã / tiêu đề / khách (cả trong danh mục) /
                người tạo / công ty / ghi chú — luật ở src/quoteListFilter.ts. */}
            <input type="search" className="grow" placeholder="Tìm theo mã, tiêu đề, khách, người tạo, ghi chú…" title="Gõ nhiều từ, không cần dấu, không cần đúng thứ tự — ví dụ: sao mai hcm" value={loc.q} onChange={(e) => datLoc({ q: e.target.value })} aria-label="Tìm báo giá" />
            {can("quote:create") && <button className="btn btn-primary" onClick={() => { location.hash = "#/new"; }}>+ Tạo báo giá</button>}
          </div>
          <BoLocBaoGia loc={loc} dat={datLoc} xoa={xoaLoc} facets={facets} meId={me.id} />
        </>
      )}

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          {dangLoc ? "Không tìm thấy báo giá phù hợp." : "Chưa có báo giá nào."}
          {dangLoc && <div style={{ marginTop: 12 }}><button className="btn btn-sm" onClick={xoaLoc}>Xóa tất cả bộ lọc</button></div>}
          {!dangLoc && can("quote:create") && <div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={() => { location.hash = "#/new"; }}>+ Tạo báo giá</button></div>}
        </div>
      ) : isMobile ? (
        /* MOBILE: thẻ React (không cuộn bảng rộng) — giữ nguyên cột/nút theo ROLE. */
        <div className="ql-cards">
          {rows.map((r) => (
            // Bàn phím: bản bảng có <a href> nên mở được; bản thẻ trước đây chỉ nghe onClick → Tab chạy
            // qua cả danh sách không dừng ở báo giá nào (chỉ dừng ở nút Xoá!). Cùng mẫu Projects.tsx.
            <div className="ql-card" key={r.id} role="link" tabIndex={0} aria-label={`Mở báo giá ${codeLabel(r)}`}
              onClick={(e) => { if ((e.target as HTMLElement).closest("button,a,input,textarea")) return; open(r.id); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !(e.target as HTMLElement).closest("button,a,input,textarea")) open(r.id); }}>
              <div className="ql-card-head">
                <strong>{codeLabel(r)}</strong>
                {isAccountHn ? <span className={`status ${hnBadge(r.hnStatus).cls}`}>{hnBadge(r.hnStatus).label}</span> : <span className={`status ${r.status}`}>{statusLabel(r.status)}</span>}
              </div>
              {(r.shortTitle || r.title) && <div className="ql-card-title">{tieuDeHienThi(r)}</div>}
              {!stripped && <div className="ql-card-note"><QuoteNote ghiChu={r.listNote} choSua={choSuaGhiChu} nhan={codeLabel(r)} onLuu={(p) => luuGhiChu(r, p)} /></div>}
              <dl className="ql-card-body">
                {(isAdmin || isInternalViewer) && <div className="ql-crow"><dt>Người tạo</dt><dd>{r.createdBy?.displayName || dash}</dd></div>}
                {isAccountHn && <div className="ql-crow"><dt>Người giao</dt><dd>{r.createdBy?.displayName || dash}</dd></div>}
                <div className="ql-crow"><dt>Ngày</dt><dd>{fmtDate(r.quoteDate) || dash}</dd></div>
                <div className="ql-crow"><dt>Sheet</dt><dd>{isAccountHn ? (r.hnSheetCount ?? 0) : (r.sheetCount ?? 0)}</dd></div>
                {isAccountHn
                  ? <div className="ql-crow"><dt>Tổng HN</dt><dd>{r.hnTotal == null ? dash : <b>{fmtMoney(r.hnTotal)}</b>}</dd></div>
                  : isInternalViewer
                  ? <div className="ql-crow"><dt>Đã thanh toán</dt><dd><b>{payProg(r)} hàng</b></dd></div>
                  : <div className="ql-crow"><dt>Tổng (VNĐ)</dt><dd>{r.total == null ? dash : <b>{fmtMoney(r.total)}</b>}</dd></div>}
                <div className="ql-crow"><dt>Công ty</dt><dd>{r.company?.shortName || r.company?.name || dash}</dd></div>
                {!stripped && <div className="ql-crow"><dt>Khách</dt><dd>{r.toCompany || dash}{r.customerCode ? ` · ${r.customerCode}` : ""}</dd></div>}
              </dl>
              {!stripped && (
                <div className="ql-card-actions">
                  <button className="qa-btn" title="Tải file Excel" onClick={(e) => act("excel", r, e)}><span className="qa-ico">📥</span><span className="qa-label">Excel</span></button>
                  {/* Account phụ: cả hai đường đều tạo báo giá MỚI đứng tên người bấm và mang mã
                      dự án của họ — server 403 (duplicateQuote), nên ẩn thay vì để bấm rồi báo lỗi. */}
                  {!laPhu(r) && <button className="qa-btn" title="Nhân bản" onClick={(e) => act("dup", r, e)}><span className="qa-ico">📋</span><span className="qa-label">Nhân bản</span></button>}
                  {!laPhu(r) && <button className="qa-btn" title="Bản mới cùng mã dự án" onClick={(e) => act("revise", r, e)}><span className="qa-ico">➕</span><span className="qa-label">Bản mới</span></button>}
                  {canDelete(r) && <button className="qa-btn qa-danger" title="Xóa" onClick={(e) => act("del", r, e)}><span className="qa-ico">🗑</span><span className="qa-label">Xóa</span></button>}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="list-wrap">
          <table className="list-table ql-table">
            <thead>
              <tr>
                <SortTh f="quoteNumber" label="Mã dự án" />
                {(isAdmin || isInternalViewer) && <SortTh f="creator" label="Người tạo" />}{isAccountHn && <SortTh f="creator" label="Người giao" />}
                <SortTh f="title" label="Tiêu đề" />
                <SortTh f="quoteDate" label="Ngày" />
                <th scope="col" className="num">Sheet</th>
                {!stripped && <SortTh f="total" label="Tổng (VNĐ)" right />}
                <SortTh f="company" label="Công ty" />
                {isAccountHn ? <th scope="col" className="num">Tổng HN</th> : isInternalViewer ? <th scope="col" className="num">Đã TT</th> : <><SortTh f="toCompany" label="Khách" /><SortTh f="customerCode" label="Mã KH" /></>}
                <SortTh f="status" label="Trạng thái" />
                {!stripped && <th scope="col" className="ql-note-th">Ghi chú</th>}
                {!stripped && <th scope="col" className="actions" aria-label="Thao tác" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="qrow" title="Bấm để mở báo giá"
                    onClick={(e) => { if ((e.target as HTMLElement).closest("button,a,input,textarea")) return; open(r.id); }}>
                  <td><a href={`#/quotes/${r.id}`}><strong>{codeLabel(r)}</strong></a>{laPhu(r) && <span className="muted" title="Bạn được thêm vào làm cùng — báo giá này của người khác" style={{ marginLeft: 6, fontSize: 11 }}>· phụ</span>}</td>
                  {(isAdmin || isInternalViewer) && <td>{r.createdBy?.displayName || dash}</td>}{isAccountHn && <td>{r.createdBy?.displayName || dash}</td>}
                  <td title={r.title}>{tieuDeHienThi(r)}</td>
                  <td>{fmtDate(r.quoteDate) || dash}</td>
                  <td className="num">{isAccountHn ? (r.hnSheetCount ?? 0) : (r.sheetCount ?? 0)}</td>
                  {!stripped && <td className="num">{r.total == null ? dash : fmtMoney(r.total)}</td>}
                  <td>{r.company?.shortName || r.company?.name || dash}</td>
                  {isAccountHn ? <td className="num">{r.hnTotal == null ? dash : fmtMoney(r.hnTotal)}</td> : isInternalViewer ? <td className="num">{payProg(r)} hàng</td> : <><td>{r.toCompany || dash}</td><td>{r.customerCode ? <strong>{r.customerCode}</strong> : dash}</td></>}
                  <td>{isAccountHn ? <span className={`status ${hnBadge(r.hnStatus).cls}`}>{hnBadge(r.hnStatus).label}</span> : <span className={`status ${r.status}`}>{statusLabel(r.status)}</span>}</td>
                  {/* Cuối hàng, TRƯỚC cột nút thao tác (yêu cầu chủ repo). */}
                  {!stripped && <td className="ql-note-cell"><QuoteNote ghiChu={r.listNote} choSua={choSuaGhiChu} nhan={codeLabel(r)} onLuu={(p) => luuGhiChu(r, p)} /></td>}
                  {!stripped && (
                    <td className="row-actions qa-cell">
                      <RowMenu r={r} act={act} canDelete={canDelete(r)} canDuplicate={!laPhu(r)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="list-foot">
          <span className="muted">Hiển thị {(meta.page - 1) * PAGE_SIZE + 1}–{(meta.page - 1) * PAGE_SIZE + rows.length} / {meta.total} báo giá</span>
          {(meta.pageCount || 1) > 1 && (
            <div className="pager">
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Trước</button>
              <span className="muted">Trang {meta.page}/{meta.pageCount || 1}</span>
              <button className="btn btn-sm" disabled={page >= (meta.pageCount || 1)} onClick={() => setPage((p) => p + 1)}>Sau →</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Thao tác 1 dòng (desktop): giữ Excel hiện sẵn (hay dùng), gộp Nhân bản/Bản mới/Xóa vào menu "⋯".
// Menu render qua portal + position:fixed → KHÔNG bị .list-table overflow:hidden cắt mất.
function RowMenu({ r, act, canDelete, canDuplicate }: { r: QuoteRow; act: (a: string, qr: QuoteRow, e?: { stopPropagation: () => void }) => void; canDelete: boolean; canDuplicate: boolean }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos != null;
  // Gần đáy màn thì LẬT LÊN trên nút: đo chiều cao thật của menu trước khi trình duyệt vẽ. Bản trước luôn mở xuống — nút ⋯ cách
  // đáy dưới ~125px thì cả 3 mục rơi khỏi màn (đo 2026-10-06, 1366×768), mà cuộn trang để thấy thì menu tự đóng.
  // Không lặp: sau khi lật, top + cao = đỉnh nút − 3 ≤ đáy màn → điều kiện dưới sai; nút sát đáy hẳn thì top tính lại y hệt → bỏ qua.
  useLayoutEffect(() => {
    if (!pos || !menuRef.current || !btnRef.current) return;
    const cao = menuRef.current.offsetHeight;
    if (!cao || pos.top + cao <= window.innerHeight - 8) return;
    const top = Math.max(8, btnRef.current.getBoundingClientRect().top - 3 - cao);
    if (top !== pos.top) setPos({ ...pos, top });
  }, [pos]);
  // Escape → đóng menu + TRẢ FOCUS về nút "⋯" (a11y — role=menu chuẩn).
  useEscClose(() => { setPos(null); btnRef.current?.focus(); }, open);
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  const toggle = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    if (open || !btnRef.current) { setPos(null); return; }
    const rc = btnRef.current.getBoundingClientRect();
    setPos({ top: rc.bottom + 3, right: Math.max(8, window.innerWidth - rc.right) });
  };
  const run = (a: string) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); setPos(null); act(a, r, e); };
  return (
    <>
      <button className="qa-btn" title="Tải file Excel" aria-label="Tải Excel" onClick={(e) => act("excel", r, e)}><span className="qa-ico">📥</span><span className="qa-label">Excel</span></button>
      <button ref={btnRef} className="qa-btn" title="Thao tác khác" aria-label="Thao tác khác" aria-haspopup="menu" aria-expanded={open} onClick={toggle}><span className="qa-ico" aria-hidden="true">⋯</span></button>
      {open && pos && createPortal(
        <div ref={menuRef} className="qa-menu" role="menu" style={{ top: pos.top, right: pos.right }}
             onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {canDuplicate && <button role="menuitem" onClick={run("dup")}>📋 Nhân bản</button>}
          {canDuplicate && <button role="menuitem" onClick={run("revise")}>➕ Bản mới cùng mã dự án</button>}
          {canDelete && <button role="menuitem" className="qa-menu-danger" onClick={run("del")}>🗑 Xóa</button>}
        </div>, document.body)}
    </>
  );
}

// Màn hình hẹp (≤ 820px) → đổi sang dạng THẺ React (responsive, không cuộn bảng rộng).
function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}
