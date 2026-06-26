import { useCallback, useEffect, useRef, useState, type ReactNode, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type Ref } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, ApiError, type Me, type Personnel, type Summary, type Employee, type Project } from "./api";
import { INPUT_FIELDS, FIELD_BY_KEY, GROUPS, TABLE_COLS, SORTABLE, statusClass, type FieldSource, type FieldEdit } from "./fields";
import { EMP_FIELDS } from "./Employees";
import { useDebouncedValue } from "./query";
import { toast, confirmModal, toLocalInputDate, fieldErrorsFrom } from "./ui";

const fmtMoney = (v: unknown) => (v == null || v === "" ? "" : Number(v).toLocaleString("vi-VN"));
const fmtDate = (v: unknown) => (v ? new Date(v as string).toLocaleDateString("vi-VN") : "");
const toInputDate = toLocalInputDate;
const PAGE_SIZE = 50;
// Field LẤY TỪ DỰ ÁN — KHÔNG hiện ô nhập trong form, chỉ điền qua "Chọn dự án" (bắt buộc) rồi hiện "đã chọn".
const PROJECT_FIELDS = new Set(["projectName", "projectCode", "accountName", "company"]);

export function PersonnelPage({ me, query }: { me: Me; query: string }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [editing, setEditing] = useState<Personnel | null | undefined>(undefined);

  const canCreate = me.permissions.includes("personnel:create");
  const canManageAll = me.permissions.includes("personnel:manage:all");
  const canManageOwn = me.permissions.includes("personnel:manage:own");
  const canEditRow = (r: Personnel) => canManageAll || (canManageOwn && r.createdById === me.id);
  const canPay = me.permissions.includes("personnel:pay"); // kế toán + admin: bấm đánh dấu thanh toán
  const canConfirm = me.permissions.includes("personnel:confirm"); // CHỈ admin: bấm xác nhận đã ký
  const canAccountingNote = me.permissions.includes("personnel:accounting-note"); // kế toán + admin: ghi "Kế toán ghi chú"
  // AI được SỬA-TẠI-CHỖ field này trên hồ sơ r (khớp đúng endpoint+quyền backend).
  const canEditField = (edit: FieldEdit | undefined, r: Personnel): boolean =>
    edit === "owner" ? (canManageAll || (canManageOwn && r.createdById === me.id))
    : edit === "accounting" ? canAccountingNote
    : edit === "admin" ? canManageAll
    : edit === "pay" ? canPay
    : edit === "confirm" ? canConfirm
    : false;
  const isMobile = useIsMobile();
  const [editCell, setEditCell] = useState<{ id: number; field: string } | null>(null);
  const [payFor, setPayFor] = useState<Personnel | null>(null);   // hồ sơ đang mở dialog thanh toán (+ảnh)

  // Lưu 1 cột sửa-tại-chỗ qua đúng endpoint theo quyền.
  const saveField = async (r: Personnel, field: string, value: string) => {
    setEditCell(null);
    const cur = String(r[field] ?? "");
    if (value === cur) return;            // không đổi → bỏ qua
    const v = value.trim() === "" ? null : value;
    try {
      if (field === "teamNote") await api.setTeamNote(r.id, v);
      else if (field === "accountingNote") await api.setAccountingNote(r.id, v);
      else if (field === "note") await api.setPersonnelNote(r.id, v);
      toast("Đã lưu", "success"); reload();
    } catch (ex) { toast(ex instanceof ApiError ? ex.message : "Lưu thất bại", "error"); }
  };

  // Tải qua TanStack Query (cache + dedupe + SSE invalidate). Ô tìm debounce 300ms như cũ.
  const debouncedQ = useDebouncedValue(query, query ? 300 : 0);
  useEffect(() => { setPage(1); }, [debouncedQ, sort, order]);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["personnel", { q: debouncedQ, page, sort, order }],
    queryFn: () => api.listPersonnel(debouncedQ, page, PAGE_SIZE, sort, order),
    placeholderData: keepPreviousData,
  });
  const rows = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, pageCount: 1 };
  const summary: Summary = data?.summary ?? { salary: 0, pit: 0, taxableIncome: 0 };
  const loading = isPending;
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";
  const reload = () => { qc.invalidateQueries({ queryKey: ["personnel"] }); };

  const onDelete = async (r: Personnel) => {
    if (!(await confirmModal("Xóa hồ sơ", `Xóa hồ sơ "${r.fullName}"? Hành động này không thể hoàn tác.`, { danger: true, confirmText: "Xóa" }))) return;
    try { await api.deletePersonnel(r.id); toast("Đã xóa hồ sơ", "success"); reload(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Xóa thất bại", "error"); }
  };

  // ADMIN bấm cột "Xác nhận (C.Hồng)" → xác nhận đã ký / bỏ (lưu ngày hôm nay).
  const onToggleConfirm = async (r: Personnel) => {
    const signed = !!r.confirmedAt;
    const ok = await confirmModal(
      signed ? "Bỏ xác nhận đã ký" : "Xác nhận đã ký",
      signed ? `Bỏ xác nhận "đã ký" cho "${r.fullName}"?`
             : `Xác nhận ĐÃ KÝ cho "${r.fullName}" (ghi ngày hôm nay)?`,
      { confirmText: signed ? "Bỏ xác nhận" : "Đã ký", danger: signed },
    );
    if (!ok) return;
    try { await api.markConfirm(r.id, !signed); toast(signed ? "Đã bỏ xác nhận" : "Đã xác nhận đã ký", "success"); reload(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Thao tác thất bại", "error"); }
  };

  const toggleSort = (k: string) => {
    if (!SORTABLE.has(k)) return;
    if (sort === k) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(k); setOrder("asc"); }
  };

  const srcCls = (s?: FieldSource) => (s === "formula" ? "col-formula" : s === "ref-project" ? "col-ref" : "");
  // Màu header TỪNG CỘT — khớp y file Excel gốc (hồng/vàng; các cột còn lại để trắng).
  const HDR_COLOR: Record<string, "pink" | "yellow"> = {
    taxCode: "pink", birthYear: "pink", idCard: "pink", idIssueDate: "pink", idIssuePlace: "pink",
    address: "pink", bankAccount: "pink", bankName: "pink", phone: "pink",
    salary: "yellow", pit: "yellow", taxableIncome: "yellow",
    workStart: "yellow", workEnd: "yellow", workLocation: "yellow", projectName: "yellow",
    projectCode: "yellow", teamNote: "yellow", accountName: "yellow", company: "yellow",
    projectNameContract: "yellow",
    laborContractNo: "pink", laborContractDate: "pink", salesContractNo: "pink",
    salesContractDate: "pink", purchaseOrder: "pink", preTaxAmount: "pink", accountingNote: "pink",
    payment: "yellow", confirmed: "yellow",
  };
  const hdrCls = (k: string) => (HDR_COLOR[k] ? `hdr-${HDR_COLOR[k]}` : "");
  const STT_OF = (idx: number) => (meta.page - 1) * PAGE_SIZE + idx + 1;

  const renderCell = (k: string, r: Personnel, first: boolean) => {
    const f = FIELD_BY_KEY[k];
    const v = r[k];
    const cls = [first ? "sticky-2" : "", f?.type === "money" ? "num" : "", srcCls(f?.source)].filter(Boolean).join(" ");

    // THANH TOÁN: KẾ TOÁN (canPay) bấm → mở dialog đánh dấu + UP ẢNH chứng từ. Người khác chỉ xem badge.
    if (k === "payment") {
      const paid = !!r.paidAt;
      const dateStr = paid ? fmtDate(r.paidAt) : "";
      const by = (r.paidBy as { displayName?: string } | undefined)?.displayName;
      const title = paid ? `Đã thanh toán ${dateStr}${by ? ` · ${by}` : ""}${canPay ? " — bấm để xem/sửa + ảnh" : ""}` : (canPay ? "Bấm để đánh dấu + đính ảnh chứng từ" : "Chưa thanh toán");
      const inner = paid
        ? <><span className="status ok">Đã thanh toán</span>{dateStr && <span className="pay-date">{dateStr}</span>}{r.hasPaymentProof ? <span title="Có ảnh chứng từ"> 📎</span> : null}</>
        : <span className="status danger">Chưa thanh toán</span>;
      return (
        <td key={k} className={`pay-cell ${cls}`}>
          {canPay
            ? <button type="button" className="pay-btn" onClick={() => setPayFor(r)} title={title}>{inner}</button>
            : <span title={title}>{inner}</span>}
        </td>
      );
    }

    // XÁC NHẬN (C.Hồng): nút CHỈ cho ADMIN (canConfirm) bấm → đã ký / bỏ (kèm ngày). Người khác chỉ xem.
    if (k === "confirmed") {
      const signed = !!r.confirmedAt;
      const dateStr = signed ? fmtDate(r.confirmedAt) : "";
      const by = (r.confirmedBy as { displayName?: string } | undefined)?.displayName;
      const title = signed
        ? `Đã ký ${dateStr}${by ? ` · ${by}` : ""}${canConfirm ? " — bấm để bỏ" : ""}`
        : (canConfirm ? "Bấm để xác nhận đã ký" : "Chưa ký");
      const inner = signed
        ? <><span className="status ok">Đã ký</span>{dateStr && <span className="pay-date">{dateStr}</span>}</>
        : (canConfirm ? <span className="status neutral">Xác nhận đã ký</span> : <span className="muted">—</span>);
      return (
        <td key={k} className={`pay-cell ${cls}`}>
          {canConfirm
            ? <button type="button" className="pay-btn" onClick={() => onToggleConfirm(r)} title={title}>{inner}</button>
            : <span title={title}>{inner}</span>}
        </td>
      );
    }

    // SỬA-TẠI-CHỖ theo QUYỀN: Team ghi chú (account chủ dòng) · Kế toán ghi chú (kế toán) · Note (admin).
    if (f && (f.edit === "owner" || f.edit === "accounting" || f.edit === "admin")) {
      const editable = canEditField(f.edit, r);
      const text = v == null || v === "" ? "" : String(v);
      if (editCell?.id === r.id && editCell.field === k) {
        return <td key={k} className={cls}><InlineInput initial={text} multiline={f.type === "textarea"} onDone={(val) => saveField(r, k, val)} onCancel={() => setEditCell(null)} /></td>;
      }
      return (
        <td key={k} className={cls}>
          {editable
            ? <span className="inline-edit" role="button" tabIndex={0} title="Bấm để sửa" onClick={() => setEditCell({ id: r.id, field: k })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditCell({ id: r.id, field: k }); } }}>{text || <span className="muted ie-add">+ ghi…</span>}</span>
            : (text || <span className="muted">—</span>)}
        </td>
      );
    }

    let content: ReactNode;
    if (f?.type === "money") content = fmtMoney(v);
    else if (f?.type === "date") content = fmtDate(v);
    else if (f?.type === "status") content = v ? <span className={`status ${statusClass(v)}`}>{String(v)}</span> : <span className="muted">—</span>;
    else content = v == null || v === "" ? "" : String(v);
    return <td key={k} className={cls}>{content}</td>;
  };

  // GIÁ TRỊ 1 cột cho THẺ (mobile) — tái dùng đúng logic sửa-tại-chỗ/thanh toán/xác nhận theo quyền.
  const cardValue = (k: string, r: Personnel): ReactNode => {
    const f = FIELD_BY_KEY[k];
    const v = r[k];
    if (k === "payment") {
      const paid = !!r.paidAt;
      const badge = paid ? <span className="status ok">Đã TT{r.paidAt ? ` ${fmtDate(r.paidAt)}` : ""}{r.hasPaymentProof ? " 📎" : ""}</span> : <span className="status danger">Chưa TT</span>;
      return canPay ? <button type="button" className="pay-btn" onClick={() => setPayFor(r)}>{badge}</button> : badge;
    }
    if (k === "confirmed") {
      const signed = !!r.confirmedAt;
      const badge = signed ? <span className="status ok">Đã ký</span> : (canConfirm ? <span className="status neutral">Xác nhận ký</span> : <span className="muted">—</span>);
      return canConfirm ? <button type="button" className="pay-btn" onClick={() => onToggleConfirm(r)}>{badge}</button> : badge;
    }
    if (f && (f.edit === "owner" || f.edit === "accounting" || f.edit === "admin")) {
      const editable = canEditField(f.edit, r);
      const text = v == null || v === "" ? "" : String(v);
      if (editCell?.id === r.id && editCell.field === k) return <InlineInput initial={text} multiline={f.type === "textarea"} onDone={(val) => saveField(r, k, val)} onCancel={() => setEditCell(null)} />;
      return editable
        ? <span className="inline-edit" role="button" tabIndex={0} title="Bấm để sửa" onClick={() => setEditCell({ id: r.id, field: k })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditCell({ id: r.id, field: k }); } }}>{text || <span className="muted ie-add">+ ghi…</span>}</span>
        : (text || <span className="muted">—</span>);
    }
    if (f?.type === "money") return v ? fmtMoney(v) + " đ" : <span className="muted">—</span>;
    if (f?.type === "date") return fmtDate(v) || <span className="muted">—</span>;
    return v == null || v === "" ? <span className="muted">—</span> : String(v);
  };

  return (
    <div>
      <h1>Nhân sự</h1>
      <div className="src-legend">
        <span className="chip chip-input">🟡 Nhập tay</span>
        <span className="chip chip-ref">🩷 Tự lấy từ Dự án (theo Mã dự án)</span>
        <span className="chip chip-formula">🔵 Tự tính (Thuế = Lương/9 · Thu nhập = Lương×10/9)</span>
      </div>
      <div className="toolbar">
        {!canCreate && <span className="badge">Chỉ xem</span>}
        <span className="spacer" />
        {canCreate && <button className="btn btn-primary" onClick={() => setEditing(null)}>+ Thêm hồ sơ</button>}
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{query ? "Không tìm thấy hồ sơ khớp." : "Chưa có hồ sơ nào."}</div>
      ) : isMobile ? (
        /* MOBILE: mỗi hồ sơ 1 THẺ (label : value), sửa-tại-chỗ đúng ô theo role — không phải cuộn bảng rộng. */
        <div className="prs-cards">
          {rows.map((r, idx) => (
            <div className="prs-card" key={r.id}>
              <div className="prs-card-head">
                <strong>{STT_OF(idx)}. {r.fullName}</strong>
                <span className="prs-card-actions">
                  <button className="btn btn-sm" onClick={() => setEditing(r)}>{canEditRow(r) ? "Sửa" : "Xem"}</button>
                  {canEditRow(r) && <button className="btn btn-sm btn-danger" onClick={() => onDelete(r)}>Xóa</button>}
                </span>
              </div>
              <dl className="prs-card-body">
                {TABLE_COLS.filter((k) => k !== "fullName").map((k) => (
                  <div className="prs-crow" key={k}><dt>{FIELD_BY_KEY[k]?.label ?? k}</dt><dd>{cardValue(k, r)}</dd></div>
                ))}
                <div className="prs-crow"><dt>Người tạo</dt><dd>{r.createdBy?.displayName ?? "—"}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              {/* Hàng 1: STT + các cột (cột 15+16 gộp dưới 1 ô "THỜI GIAN LÀM VIỆC") */}
              <tr>
                <th rowSpan={2} className="sticky-1 hdr-stt">STT</th>
                {TABLE_COLS.map((k, i) => {
                  if (k === "workEnd") return null;   // nằm dưới ô gộp "THỜI GIAN LÀM VIỆC" (xử lý ở workStart)
                  const f = FIELD_BY_KEY[k];
                  const color = hdrCls(k);
                  if (k === "workStart") {
                    return <th key="tglv" colSpan={2} className={["merged", color].filter(Boolean).join(" ")}>THỜI GIAN LÀM VIỆC</th>;
                  }
                  const sortable = SORTABLE.has(k);
                  const arrow = sort === k ? (order === "asc" ? " ▲" : " ▼") : "";
                  return (
                    <th key={k} rowSpan={2} className={[i === 0 ? "sticky-2" : "", f?.type === "money" ? "num" : "", sortable ? "sortable" : "", color].filter(Boolean).join(" ")}
                        aria-sort={sortable ? (sort === k ? (order === "asc" ? "ascending" : "descending") : "none") : undefined}
                        onClick={() => toggleSort(k)} title={sortable ? "Bấm để sắp xếp" : f?.source === "ref-project" ? "Tự lấy từ Dự án theo Mã dự án" : f?.source === "formula" ? "Tự tính từ Lương" : f?.source === "action" ? (k === "confirmed" ? "Admin bấm để xác nhận đã ký (có ngày)" : "Kế toán bấm để đánh dấu đã thanh toán (có ngày)") : undefined}>
                      {f?.label ?? k}{arrow}
                    </th>
                  );
                })}
                <th rowSpan={2}>Người tạo</th>
                <th rowSpan={2} />
              </tr>
              {/* Hàng 2: chỉ 2 cột con của "THỜI GIAN LÀM VIỆC" — sắp xếp được theo ngày */}
              <tr>
                <th className={[hdrCls("workStart"), "sortable"].filter(Boolean).join(" ")} aria-sort={sort === "workStart" ? (order === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("workStart")} title="Bấm để sắp xếp">Ngày bắt đầu{sort === "workStart" ? (order === "asc" ? " ▲" : " ▼") : ""}</th>
                <th className={[hdrCls("workEnd"), "sortable"].filter(Boolean).join(" ")} aria-sort={sort === "workEnd" ? (order === "asc" ? "ascending" : "descending") : "none"} onClick={() => toggleSort("workEnd")} title="Bấm để sắp xếp">Ngày kết thúc{sort === "workEnd" ? (order === "asc" ? " ▲" : " ▼") : ""}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.id}>
                  <td className="sticky-1 num">{STT_OF(idx)}</td>
                  {TABLE_COLS.map((k, i) => renderCell(k, r, i === 0))}
                  <td className="muted">{r.createdBy?.displayName ?? ""}</td>
                  <td className="row-actions">
                    <button className="btn btn-sm" onClick={() => setEditing(r)}>{canEditRow(r) ? "Sửa" : "Xem"}</button>
                    {canEditRow(r) && <button className="btn btn-sm btn-danger" onClick={() => onDelete(r)}>Xóa</button>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="sum-row">
                <td className="sticky-1" />
                <td className="sticky-2"><strong>Tổng (toàn bộ lọc)</strong></td>
                {TABLE_COLS.slice(1).map((k) => (
                  <td key={k} className={FIELD_BY_KEY[k]?.type === "money" ? "num" : ""}>
                    {k === "salary" ? <strong>{fmtMoney(summary.salary)}</strong>
                      : k === "pit" ? <strong>{fmtMoney(summary.pit)}</strong>
                      : k === "taxableIncome" ? <strong>{fmtMoney(summary.taxableIncome)}</strong>
                      : ""}
                  </td>
                ))}
                <td /><td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* TỔNG (toàn bộ lọc) — luôn hiện rõ DƯỚI bảng/thẻ, không bị cuộn ngang che như dòng tổng trong bảng. */}
      <div className="prs-total" role="status">
        <span><b>{meta.total}</b> hồ sơ</span>
        <span>Σ Lương: <b>{fmtMoney(summary.salary)} đ</b></span>
        <span>Σ Thuế TNCN: <b>{fmtMoney(summary.pit)} đ</b></span>
        <span>Σ Thu nhập chịu thuế: <b>{fmtMoney(summary.taxableIncome)} đ</b></span>
      </div>
      <div className="list-foot">
        {meta.pageCount > 1 && (
          <div className="pager">
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Trước</button>
            <span className="muted">Trang {meta.page}/{meta.pageCount}</span>
            <button className="btn btn-sm" disabled={page >= meta.pageCount} onClick={() => setPage((p) => p + 1)}>Sau ›</button>
          </div>
        )}
      </div>

      {editing !== undefined && (
        <RecordForm
          rec={editing}
          readOnly={editing !== null && !canEditRow(editing)}
          onClose={() => setEditing(undefined)}
          onSaved={() => { setEditing(undefined); reload(); }}
        />
      )}

      {payFor && <PaymentDialog rec={payFor} onClose={() => setPayFor(null)} onDone={() => { setPayFor(null); reload(); }} />}
    </div>
  );
}

// Theo dõi màn hình hẹp (≤ 820px) → đổi sang dạng THẺ (responsive).
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

// Ô nhập sửa-tại-chỗ: tự focus, Enter/blur = lưu, Escape = hủy (textarea: Ctrl/Cmd+Enter = lưu).
function InlineInput({ initial, multiline, onDone, onCancel }: { initial: string; multiline?: boolean; onDone: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select?.(); }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    else if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); onDone(v); }
  };
  return multiline
    ? <textarea ref={ref as Ref<HTMLTextAreaElement>} className="inline-edit-input" rows={2} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onDone(v)} onKeyDown={onKeyDown} />
    : <input ref={ref as Ref<HTMLInputElement>} className="inline-edit-input" type="text" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => onDone(v)} onKeyDown={onKeyDown} />;
}

// Nén ảnh phía client: resize ≤ 1280px + JPEG 0.7 → data URL nhỏ (~50–200KB) để lưu base64 (S3 chưa bật).
function compressImage(file: File, maxDim = 1280, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (Math.max(width, height) > maxDim) { const s = maxDim / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
      const c = document.createElement("canvas"); c.width = width; c.height = height;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Ảnh không đọc được")); };
    img.src = url;
  });
}

// Dialog THANH TOÁN: kế toán đánh dấu đã/bỏ + đính/xem ẢNH chứng từ (nén client, lưu base64).
function PaymentDialog({ rec, onClose, onDone }: { rec: Personnel; onClose: () => void; onDone: () => void }) {
  const paid = !!rec.paidAt;
  const [proof, setProof] = useState<string | null>(null);     // ảnh MỚI chọn (base64)
  const [existing, setExisting] = useState<string | null>(null); // ảnh ĐÃ CÓ (tải on-demand)
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (rec.hasPaymentProof) api.getPaymentProof(rec.id).then((r) => setExisting(r.paymentProof)).catch(() => { /* ignore */ }); }, [rec]);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Chỉ chọn ảnh (png/jpg/webp)", "error"); return; }
    try { setProof(await compressImage(file)); } catch { toast("Ảnh không hợp lệ", "error"); }
  };
  const mark = async (markPaid: boolean) => {
    setBusy(true);
    try { await api.markPayment(rec.id, markPaid, markPaid ? (proof || undefined) : undefined); toast(markPaid ? "Đã đánh dấu thanh toán" : "Đã bỏ đánh dấu", "success"); onDone(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Thao tác thất bại", "error"); setBusy(false); }
  };
  const shown = proof || existing;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Thanh toán" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Thanh toán — {rec.fullName}</h3><button className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>{paid ? `Trạng thái: ĐÃ thanh toán${(rec.paidBy as { displayName?: string } | undefined)?.displayName ? ` · ${(rec.paidBy as { displayName?: string }).displayName}` : ""}.` : "Trạng thái: CHƯA thanh toán."}</p>
          {!paid && <label className="full"><span>Ảnh chứng từ (tùy chọn — sẽ nén tự động)</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} /></label>}
          {shown && <div className="pay-proof"><img src={shown} alt="ảnh chứng từ thanh toán" /></div>}
          {paid && !shown && <p className="muted">Chưa có ảnh chứng từ.</p>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Đóng</button>
          {paid
            ? <button className="btn btn-danger" disabled={busy} onClick={() => mark(false)}>{busy ? "…" : "Bỏ đánh dấu"}</button>
            : <button className="btn btn-primary" disabled={busy} onClick={() => mark(true)}>{busy ? "Đang lưu…" : "Đánh dấu đã thanh toán"}</button>}
        </div>
      </div>
    </div>
  );
}

function RecordForm({ rec, readOnly, onClose, onSaved }: {
  rec: Personnel | null; readOnly: boolean; onClose: () => void; onSaved: () => void;
}) {
  const buildInitial = () => {
    const init: Record<string, string> = {};
    for (const f of INPUT_FIELDS) {
      const v = rec ? rec[f.key] : "";
      init[f.key] = f.type === "date" ? toInputDate(v) : v == null ? "" : String(v);
    }
    return init;
  };
  const [form, setForm] = useState<Record<string, string>>(buildInitial);
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const set = (k: string, v: string) => { dirty.current = true; setForm((s) => ({ ...s, [k]: v })); setFieldErrors((fe) => (fe[k] ? { ...fe, [k]: "" } : fe)); };

  // Đóng có bảo vệ: nếu đã sửa mà chưa lưu → hỏi trước khi bỏ (chống mất dữ liệu khi
  // bấm nền / Đóng / Escape).
  const guardedClose = useCallback(async () => {
    if (dirty.current && !readOnly && !(await confirmModal("Bỏ thay đổi?", "Bạn có thay đổi chưa lưu. Đóng và bỏ hết?", { danger: true, confirmText: "Đóng, bỏ thay đổi" }))) return;
    onClose();
  }, [readOnly, onClose]);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void guardedClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [guardedClose]);

  const save = async () => {
    setErr(""); setFieldErrors({}); setSaving(true);
    try {
      if (rec) await api.updatePersonnel(rec.id, form);
      else await api.createPersonnel(form);
      toast(rec ? "Đã lưu thay đổi" : "Đã thêm hồ sơ", "success");
      onSaved();
    } catch (ex) {
      const fe = fieldErrorsFrom(ex);
      setFieldErrors(fe);
      setErr(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : (ex instanceof ApiError ? ex.message : "Lưu thất bại"));
      setSaving(false);
    }
  };

  const title = rec ? (readOnly ? "Xem hồ sơ" : "Sửa hồ sơ") : "Thêm hồ sơ";

  return (
    <div className="modal-backdrop" onClick={() => void guardedClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pf-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="pf-title">{title}</h3>
          <button className="x" onClick={() => void guardedClose()} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          {/* Chọn DỰ ÁN (BẮT BUỘC) — hiện cả khi tạo/sửa/xem. Chọn xong hiện "✓ đã chọn"; KHÔNG hiện ô riêng cho Tên/Mã dự án·Account·CTY (tự điền ngầm). */}
          <ProjectPicker
            selected={{ projectCode: form.projectCode, projectName: form.projectName, accountName: form.accountName, company: form.company }}
            readOnly={readOnly}
            onPick={(p) => { dirty.current = true; setForm((s) => ({ ...s, projectName: p.projectName, projectCode: p.projectCode, accountName: p.accountName, company: p.company })); toast(`Đã chọn dự án "${p.projectCode}"`, "success"); }}
            onClear={() => { dirty.current = true; setForm((s) => ({ ...s, projectName: "", projectCode: "", accountName: "", company: "" })); }}
          />
          {!rec && !readOnly && (
            <EmployeePicker onPick={(emp) => {
              dirty.current = true;
              setForm((s) => {
                const next = { ...s };
                for (const f of EMP_FIELDS) {
                  const v = emp[f.key];
                  next[f.key] = f.type === "date" ? toInputDate(v) : (v == null ? "" : String(v));
                }
                return next;
              });
              toast(`Đã điền thông tin của "${emp.fullName}"`, "success");
            }} />
          )}
          {GROUPS.filter((g) => INPUT_FIELDS.some((f) => f.group === g && !PROJECT_FIELDS.has(f.key))).map((g, gi) => (
            <fieldset key={g}>
              <legend>{g}</legend>
              <div className="grid">
                {INPUT_FIELDS.filter((f) => f.group === g && !PROJECT_FIELDS.has(f.key)).map((f, idx) => {
                  const isMoney = f.type === "money" || f.type === "number";
                  const isFirst = gi === 0 && idx === 0;
                  const fErr = fieldErrors[f.key];
                  const moneyVal = isMoney && form[f.key] !== "" && !isNaN(Number(form[f.key])) ? Number(form[f.key]) : null;
                  return (
                    <label key={f.key} className={f.type === "textarea" ? "full" : ""}>
                      <span>{f.label}{f.key === "fullName" && <b className="req"> *</b>}{f.type === "money" && <em className="unit"> (đ)</em>}</span>
                      {f.type === "textarea" ? (
                        <textarea value={form[f.key]} disabled={readOnly} aria-invalid={fErr ? true : undefined} onChange={(e) => set(f.key, e.target.value)} />
                      ) : (
                        <input
                          ref={isFirst ? firstRef : undefined}
                          type={f.type === "date" ? "date" : isMoney ? "number" : "text"}
                          {...(isMoney ? { min: "0", step: "1000", inputMode: "numeric" as const } : {})}
                          value={form[f.key]} disabled={readOnly} aria-invalid={fErr ? true : undefined} onChange={(e) => set(f.key, e.target.value)}
                        />
                      )}
                      {moneyVal != null && <small className="muted">= {moneyVal.toLocaleString("vi-VN")} đ</small>}
                      {fErr && <div className="field-err">{fErr}</div>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        {err && <div className="err">⚠ {err}</div>}
        <div className="modal-foot">
          {!readOnly && !form.projectCode && <span className="foot-hint">⚠ Cần chọn dự án trước khi lưu</span>}
          <button className="btn" onClick={() => void guardedClose()}>Đóng</button>
          {!readOnly && (
            <button className="btn btn-primary" disabled={saving || !form.fullName.trim() || !form.projectCode} onClick={save}>
              {saving ? "Đang lưu…" : "Lưu"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Ô tìm + chọn người từ Danh bạ nhân viên → tự điền 10 trường cá nhân vào form (chỉ khi THÊM mới).
function EmployeePicker({ onPick }: { onPick: (emp: Employee) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Employee[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      try { const res = await api.listEmployees(q, 1, 8); setResults(res.data); setOpen(true); } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <fieldset className="emp-picker-fs">
      <legend>Chọn từ danh bạ (tự điền)</legend>
      <div className="emp-picker">
        <input placeholder="🔎 Gõ tên / MST / SĐT để chọn người có sẵn…" value={q}
               onChange={(e) => setQ(e.target.value)} onFocus={() => results.length > 0 && setOpen(true)} />
        {open && results.length > 0 && (
          <div className="emp-picker-list">
            {results.map((e) => (
              <button type="button" key={e.id} className="emp-picker-item"
                      onClick={() => { onPick(e); setQ(""); setResults([]); setOpen(false); }}>
                <strong>{e.fullName}</strong>
                <span className="muted">{[e.taxCode, e.phone, e.idCard].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        )}
        {q.trim() && open && results.length === 0 && <div className="emp-picker-empty muted">Không có ai khớp — cứ nhập tay bên dưới.</div>}
      </div>
    </fieldset>
  );
}

// Chọn DỰ ÁN đã chốt (BẮT BUỘC). Chọn xong → hiện "✓ đã chọn"; Tên dự án (HĐ) + các cột HĐ tự hiện
// theo Mã dự án khi xem bảng → KHÔNG cần ô riêng cho Tên/Mã dự án · Account · CTY (đỡ rối form).
function ProjectPicker({ selected, onPick, onClear, readOnly }: {
  selected: { projectCode: string; projectName: string; accountName: string; company: string };
  onPick: (p: Project) => void; onClear: () => void; readOnly: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const has = !!selected.projectCode;
  useEffect(() => {
    if (has) return;   // đã chọn rồi thì không cần tải danh sách
    const t = setTimeout(async () => {
      try { const res = await api.listProjects(q); setResults(res.data); setLoaded(true); } catch { /* ignore */ }
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, has]);

  // ĐÃ CHỌN → hiện thẻ xác nhận (không có ô nhập nào cho dự án).
  if (has) {
    return (
      <fieldset className="emp-picker-fs proj-fs">
        <legend>Dự án {!readOnly && <b className="req">*</b>}</legend>
        <div className="proj-chosen">
          <div className="proj-chosen-info">
            <span className="proj-chosen-badge">✓ Đã chọn</span>
            <strong>{selected.projectCode}</strong>{selected.projectName ? ` — ${selected.projectName}` : ""}
            {(selected.accountName || selected.company) && (
              <div className="muted">{[selected.accountName, selected.company].filter(Boolean).join(" · ")}</div>
            )}
          </div>
          {!readOnly && <button type="button" className="btn btn-sm" onClick={onClear}>Đổi dự án</button>}
        </div>
      </fieldset>
    );
  }
  // CHƯA CHỌN + xem (readOnly) → không có dự án.
  if (readOnly) {
    return (
      <fieldset className="emp-picker-fs proj-fs">
        <legend>Dự án</legend>
        <div className="muted" style={{ padding: "4px 2px" }}>(chưa gắn dự án)</div>
      </fieldset>
    );
  }
  // CHƯA CHỌN + tạo/sửa → ô tìm (bắt buộc chọn).
  return (
    <fieldset className="emp-picker-fs proj-fs proj-fs-required">
      <legend>Chọn dự án đã chốt <b className="req">* bắt buộc</b></legend>
      <div className="emp-picker">
        <input placeholder="🔎 Gõ tên / mã dự án để chọn (chỉ dự án đã chốt của bạn)…" value={q}
               onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} />
        {open && results.length > 0 && (
          <div className="emp-picker-list">
            {results.map((p, i) => (
              <button type="button" key={p.projectCode + "#" + i} className="emp-picker-item"
                      onClick={() => { onPick(p); setQ(""); setOpen(false); }}>
                <strong>{p.projectCode} — {p.projectName || "(không tên)"}</strong>
                <span className="muted">{[p.sheetName, p.company, p.accountName].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        )}
        {open && loaded && results.length === 0 && <div className="emp-picker-empty muted">Chưa có dự án đã chốt nào của bạn khớp.</div>}
      </div>
    </fieldset>
  );
}
