import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Me, type Employee } from "./api";
import { FIELDS, type Field } from "./fields";
import { toast, confirmModal } from "./ui";

// Danh bạ = 10 trường nhóm "Cá nhân" của trang Nhân sự (1 nguồn, không lặp).
export const EMP_FIELDS: Field[] = FIELDS.filter((f) => f.group === "Cá nhân");
const fmtDate = (v: unknown) => (v ? new Date(v as string).toLocaleDateString("vi-VN") : "");
const toInputDate = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : "");
const PAGE_SIZE = 50;

export function EmployeesPage({ me, query }: { me: Me; query: string }) {
  const [rows, setRows] = useState<Employee[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageCount: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Employee | null | undefined>(undefined);

  const canManage = me.permissions.includes("personnel:create");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const res = await api.listEmployees(query, page, PAGE_SIZE);
      setRows(res.data);
      setMeta({ total: res.meta.total, page: res.meta.page, pageCount: res.meta.pageCount });
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Lỗi tải dữ liệu");
    } finally { setLoading(false); }
  }, [query, page]);

  useEffect(() => { const t = setTimeout(load, query ? 300 : 0); return () => clearTimeout(t); }, [load, query]);
  useEffect(() => { setPage(1); }, [query]);

  const onDelete = async (r: Employee) => {
    if (!(await confirmModal("Xóa nhân viên", `Xóa "${r.fullName}" khỏi danh bạ? Hành động này không thể hoàn tác.`, { danger: true, confirmText: "Xóa" }))) return;
    try { await api.deleteEmployee(r.id); toast("Đã xóa", "success"); load(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Xóa thất bại", "error"); }
  };

  const stt = (i: number) => (meta.page - 1) * PAGE_SIZE + i + 1;

  return (
    <div>
      <h1>Danh bạ nhân viên</h1>
      <p className="muted" style={{ margin: "-10px 0 16px" }}>Kho thông tin cá nhân dùng chung — khi tạo hồ sơ Nhân sự có thể chọn từ đây để tự điền.</p>
      <div className="toolbar">
        {!canManage && <span className="badge">Chỉ xem</span>}
        <span className="spacer" />
        {canManage && <button className="btn btn-primary" onClick={() => setEditing(null)}>+ Thêm nhân viên</button>}
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}

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
                {EMP_FIELDS.map((f, i) => <th key={f.key} className={i === 0 ? "sticky-2" : ""}>{f.label}</th>)}
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
                    <button className="btn btn-sm" onClick={() => setEditing(r)}>{canManage ? "Sửa" : "Xem"}</button>
                    {canManage && <button className="btn btn-sm btn-danger" onClick={() => onDelete(r)}>Xóa</button>}
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
        <EmployeeForm rec={editing} readOnly={editing !== null && !canManage} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); load(); }} />
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
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const set = (k: string, v: string) => setForm((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setErr(""); setSaving(true);
    try {
      if (rec) await api.updateEmployee(rec.id, form);
      else await api.createEmployee(form);
      toast(rec ? "Đã lưu thay đổi" : "Đã thêm nhân viên", "success");
      onSaved();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Lưu thất bại");
      setSaving(false);
    }
  };

  const title = rec ? (readOnly ? "Xem nhân viên" : "Sửa nhân viên") : "Thêm nhân viên";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ef-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="ef-title">{title}</h3>
          <button className="x" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          <div className="grid">
            {EMP_FIELDS.map((f, idx) => (
              <label key={f.key} className={f.type === "textarea" ? "full" : ""}>
                <span>{f.label}{f.key === "fullName" && <b className="req"> *</b>}</span>
                <input
                  ref={idx === 0 ? firstRef : undefined}
                  type={f.type === "date" ? "date" : "text"}
                  value={form[f.key]} disabled={readOnly} onChange={(e) => set(f.key, e.target.value)}
                />
              </label>
            ))}
          </div>
        </div>
        {err && <div className="err">⚠ {err}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Đóng</button>
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
