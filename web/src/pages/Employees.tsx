import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, ApiError, type Me, type Employee } from "../lib/api";
import { FIELDS, type Field } from "../lib/fields";
import { dash, fmtDate } from "../lib/format";
import { useDebouncedValue } from "../lib/query";
import { toast, confirmModal, toLocalInputDate, fieldErrorsFrom, useIsMobile } from "../lib/ui";

// Danh bạ = 10 trường nhóm "Cá nhân" của trang Nhân sự (1 nguồn, không lặp).
export const EMP_FIELDS: Field[] = FIELDS.filter((f) => f.group === "Cá nhân");
const toInputDate = toLocalInputDate;
const PAGE_SIZE = 50;

// Ô trống thống nhất hiện "—" mờ (dash) — dùng chung cho cả thẻ mobile lẫn bảng desktop.
const empCell = (f: Field, r: Employee): ReactNode => {
  const v = r[f.key];
  if (f.type === "date") return fmtDate(v as string | null) || dash;
  return v == null || v === "" ? dash : String(v);
};

export function EmployeesPage({ me, query, onQuery }: { me: Me; query: string; onQuery?: (v: string) => void }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("fullName");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [editing, setEditing] = useState<Employee | null | undefined>(undefined);

  // Quyền RIÊNG của Danh bạ (employee:*) — tách khỏi personnel:*. Kho dùng chung nên :own = thao tác cả danh bạ.
  const has = (p: string) => me.permissions.includes(p);
  const canCreate = has("employee:create");
  const canEdit = has("employee:edit:own") || has("employee:edit:all");
  const canDelete = has("employee:delete:own") || has("employee:delete:all");
  const canManage = canCreate || canEdit || canDelete; // có bất kỳ quyền ghi → không phải "chỉ xem"
  const isMobile = useIsMobile();

  // Tải qua TanStack Query (cache + dedupe + SSE invalidate). Ô tìm debounce 300ms như cũ.
  const debouncedQ = useDebouncedValue(query, query ? 300 : 0);
  useEffect(() => { setPage(1); }, [debouncedQ, sort, order]);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["employees", { q: debouncedQ, page, sort, order }],
    queryFn: () => api.listEmployees(debouncedQ, page, PAGE_SIZE, sort, order),
    placeholderData: keepPreviousData,
  });
  const rows = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, pageCount: 1 };
  const loading = isPending;
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";
  const reload = () => { qc.invalidateQueries({ queryKey: ["employees"] }); };

  // Backend chỉ cho sort theo fullName (cột hiển thị) — bấm header "Họ & Tên" để đảo chiều.
  const toggleSort = (k: string) => {
    if (k !== "fullName") return;
    if (sort === k) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(k); setOrder("asc"); }
  };

  const onDelete = async (r: Employee) => {
    if (!(await confirmModal("Xóa nhân viên", `Xóa "${r.fullName}" khỏi danh bạ? Hành động này không thể hoàn tác.`, { danger: true, confirmText: "Xóa" }))) return;
    try { await api.deleteEmployee(r.id); toast("Đã xóa", "success"); reload(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Xóa thất bại", "error"); }
  };

  const stt = (i: number) => (meta.page - 1) * PAGE_SIZE + i + 1;

  return (
    <div>
      <h1>Danh bạ nhân sự</h1>
      <p className="muted page-sub">Kho thông tin cá nhân dùng chung — khi tạo hồ sơ Nhân sự có thể chọn từ đây để tự điền.</p>
      <div className="toolbar">
        {!canManage && <span className="badge">Chỉ xem</span>}{/* không có quyền ghi danh bạ nào */}
        {/* Trang lọc theo ô tìm TOÀN CỤC trên header — hiện chip báo để khỏi tưởng thiếu dữ liệu. */}
        {query && (
          <span className="badge" title="Kết quả đang lọc theo ô tìm kiếm trên đầu trang">
            Đang lọc: “{query}”
            {onQuery && <button type="button" className="ky-undo" aria-label="Xóa lọc" style={{ marginLeft: 4 }} onClick={() => onQuery("")}>✕</button>}
          </span>
        )}
        <span className="spacer" />
        {canCreate && <button className="btn btn-primary" onClick={() => setEditing(null)}>+ Thêm nhân viên</button>}
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          {query ? "Không tìm thấy nhân viên khớp." : "Chưa có nhân viên nào."}
          {!query && canCreate && <div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={() => setEditing(null)}>+ Thêm nhân viên</button></div>}
        </div>
      ) : isMobile ? (
        /* MOBILE: mỗi người 1 THẺ (label : value) — không phải cuộn bảng nhiều cột. */
        <div className="prs-cards">
          {rows.map((r, i) => (
            <div className="prs-card" key={r.id}>
              <div className="prs-card-head">
                <strong>{stt(i)}. {r.fullName}</strong>
                <span className="prs-card-actions">
                  <button className="btn btn-sm" onClick={() => setEditing(r)}>{canEdit ? "Sửa" : "Xem"}</button>
                  {canDelete && <button className="btn btn-sm btn-danger" onClick={() => onDelete(r)}>Xóa</button>}
                </span>
              </div>
              <dl className="prs-card-body">
                {EMP_FIELDS.filter((f) => f.key !== "fullName").map((f) => (
                  <div className="prs-crow" key={f.key}><dt>{f.label}</dt><dd>{empCell(f, r)}</dd></div>
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
              <tr>
                <th scope="col" className="sticky-1 hdr-stt">STT</th>
                {EMP_FIELDS.map((f, i) => {
                  const sortable = f.key === "fullName";
                  const arrow = sortable && sort === f.key ? (order === "asc" ? " ▲" : " ▼") : "";
                  return (
                    <th key={f.key}
                        scope="col"
                        className={[i === 0 ? "sticky-2" : "", sortable ? "sortable" : ""].filter(Boolean).join(" ")}
                        aria-sort={sortable ? (sort === f.key ? (order === "asc" ? "ascending" : "descending") : "none") : undefined}
                        tabIndex={sortable ? 0 : undefined}
                        onClick={sortable ? () => toggleSort(f.key) : undefined}
                        onKeyDown={sortable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(f.key); } } : undefined}
                        title={sortable ? "Bấm để sắp xếp" : undefined}>
                      {f.label}{arrow}
                    </th>
                  );
                })}
                <th scope="col">Người tạo</th>
                <th scope="col" className="actions" aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="sticky-1 num">{stt(i)}</td>
                  {EMP_FIELDS.map((f, ci) => {
                    const v = r[f.key];
                    const clip = f.key === "address"; // Địa chỉ dài → cắt chữ, xem đủ qua title
                    return (
                      <td key={f.key}
                          className={[ci === 0 ? "sticky-2" : "", clip ? "cell-clip" : ""].filter(Boolean).join(" ")}
                          title={clip && v != null && v !== "" ? String(v) : undefined}>
                        {empCell(f, r)}
                      </td>
                    );
                  })}
                  <td className="muted">{r.createdBy?.displayName ?? "—"}</td>
                  <td className="row-actions">
                    <button className="btn btn-sm" onClick={() => setEditing(r)}>{canEdit ? "Sửa" : "Xem"}</button>
                    {canDelete && <button className="btn btn-sm btn-danger" onClick={() => onDelete(r)}>Xóa</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="list-foot">
          <span className="muted">Hiển thị {(meta.page - 1) * PAGE_SIZE + 1}–{(meta.page - 1) * PAGE_SIZE + rows.length} / {meta.total}</span>
          {meta.pageCount > 1 && (
            <div className="pager">
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Trước</button>
              <span className="muted">Trang {meta.page}/{meta.pageCount}</span>
              <button className="btn btn-sm" disabled={page >= meta.pageCount} onClick={() => setPage((p) => p + 1)}>Sau →</button>
            </div>
          )}
        </div>
      )}

      {editing !== undefined && (
        <EmployeeForm rec={editing} readOnly={editing !== null && !canEdit} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); reload(); }} />
      )}
    </div>
  );
}

function EmployeeForm({ rec, readOnly, onClose, onSaved }: {
  rec: Employee | null; readOnly: boolean; onClose: () => void; onSaved: () => void;
}) {
  const buildInitial = () => {
    const init: Record<string, string> = {};
    for (const f of EMP_FIELDS) {
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

  // Đóng có bảo vệ: hỏi trước khi bỏ thay đổi chưa lưu (chống mất dữ liệu khi bấm nền / Đóng / Escape).
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
      if (rec) await api.updateEmployee(rec.id, form);
      else await api.createEmployee(form);
      toast(rec ? "Đã lưu thay đổi" : "Đã thêm nhân viên", "success");
      onSaved();
    } catch (ex) {
      const fe = fieldErrorsFrom(ex);
      setFieldErrors(fe);
      setErr(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : (ex instanceof ApiError ? ex.message : "Lưu thất bại"));
      setSaving(false);
    }
  };

  const title = rec ? (readOnly ? "Xem nhân viên" : "Sửa nhân viên") : "Thêm nhân viên";

  return (
    <div className="modal-backdrop" onClick={() => void guardedClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ef-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="ef-title">{title}</h3>
          <button className="x" onClick={() => void guardedClose()} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          <div className="grid">
            {EMP_FIELDS.map((f, idx) => {
              const fErr = fieldErrors[f.key];
              return (
                <label key={f.key} className={f.type === "textarea" ? "full" : ""}>
                  <span>{f.label}{f.key === "fullName" && <b className="req"> *</b>}</span>
                  {f.type === "textarea" ? (
                    <textarea
                      value={form[f.key]} disabled={readOnly} aria-invalid={fErr ? true : undefined} onChange={(e) => set(f.key, e.target.value)}
                    />
                  ) : (
                    <input
                      ref={idx === 0 ? firstRef : undefined}
                      type={f.type === "date" ? "date" : "text"}
                      value={form[f.key]} disabled={readOnly} aria-invalid={fErr ? true : undefined} onChange={(e) => set(f.key, e.target.value)}
                    />
                  )}
                  {fErr && <div className="field-err">{fErr}</div>}
                </label>
              );
            })}
          </div>
        </div>
        {err && <div className="err">⚠ {err}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={() => void guardedClose()}>Đóng</button>
          {!readOnly && (
            <button className="btn btn-primary" disabled={saving || !form.fullName.trim()} onClick={save}>
              {saving ? "Đang lưu…" : "Lưu"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
