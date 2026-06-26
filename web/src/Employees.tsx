import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, ApiError, type Me, type Employee } from "./api";
import { FIELDS, type Field } from "./fields";
import { useDebouncedValue } from "./query";
import { toast, confirmModal, toLocalInputDate, fieldErrorsFrom } from "./ui";

// Danh bạ = 10 trường nhóm "Cá nhân" của trang Nhân sự (1 nguồn, không lặp).
export const EMP_FIELDS: Field[] = FIELDS.filter((f) => f.group === "Cá nhân");
const fmtDate = (v: unknown) => (v ? new Date(v as string).toLocaleDateString("vi-VN") : "");
const toInputDate = toLocalInputDate;
const PAGE_SIZE = 50;

export function EmployeesPage({ me, query }: { me: Me; query: string }) {
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
      <p className="muted" style={{ margin: "-10px 0 16px" }}>Kho thông tin cá nhân dùng chung — khi tạo hồ sơ Nhân sự có thể chọn từ đây để tự điền.</p>
      <div className="toolbar">
        {!canManage && <span className="badge">Chỉ xem</span>}{/* không có quyền ghi danh bạ nào */}
        <span className="spacer" />
        {canCreate && <button className="btn btn-primary" onClick={() => setEditing(null)}>+ Thêm nhân viên</button>}
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{query ? "Không tìm thấy nhân viên khớp." : "Chưa có nhân viên nào. Bấm “+ Thêm nhân viên”."}</div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th className="sticky-1 hdr-stt">STT</th>
                {EMP_FIELDS.map((f, i) => {
                  const sortable = f.key === "fullName";
                  const arrow = sortable && sort === f.key ? (order === "asc" ? " ▲" : " ▼") : "";
                  return (
                    <th key={f.key}
                        className={[i === 0 ? "sticky-2" : "", sortable ? "sortable" : ""].filter(Boolean).join(" ")}
                        aria-sort={sortable ? (sort === f.key ? (order === "asc" ? "ascending" : "descending") : "none") : undefined}
                        onClick={sortable ? () => toggleSort(f.key) : undefined}
                        title={sortable ? "Bấm để sắp xếp" : undefined}>
                      {f.label}{arrow}
                    </th>
                  );
                })}
                <th>Người tạo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="sticky-1 num">{stt(i)}</td>
                  {EMP_FIELDS.map((f, ci) => (
                    <td key={f.key} className={ci === 0 ? "sticky-2" : ""}>
                      {f.type === "date" ? fmtDate(r[f.key]) : (r[f.key] == null || r[f.key] === "" ? "" : String(r[f.key]))}
                    </td>
                  ))}
                  <td className="muted">{r.createdBy?.displayName ?? ""}</td>
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

      <div className="list-foot">
        <span className="muted">Tổng: {meta.total} nhân viên</span>
        {meta.pageCount > 1 && (
          <div className="pager">
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Trước</button>
            <span className="muted">Trang {meta.page}/{meta.pageCount}</span>
            <button className="btn btn-sm" disabled={page >= meta.pageCount} onClick={() => setPage((p) => p + 1)}>Sau ›</button>
          </div>
        )}
      </div>

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
                  <input
                    ref={idx === 0 ? firstRef : undefined}
                    type={f.type === "date" ? "date" : "text"}
                    value={form[f.key]} disabled={readOnly} aria-invalid={fErr ? true : undefined} onChange={(e) => set(f.key, e.target.value)}
                  />
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
