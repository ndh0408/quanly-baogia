import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type Me, type Personnel, type Summary } from "./api";
import { FIELDS, FIELD_BY_KEY, GROUPS, TABLE_COLS, SORTABLE, statusClass } from "./fields";
import { toast, confirmModal } from "./ui";

const fmtMoney = (v: unknown) => (v == null || v === "" ? "" : Number(v).toLocaleString("vi-VN"));
const fmtDate = (v: unknown) => (v ? new Date(v as string).toLocaleDateString("vi-VN") : "");
const toInputDate = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : "");
const PAGE_SIZE = 50;

export function PersonnelPage({ me, query }: { me: Me; query: string }) {
  const [rows, setRows] = useState<Personnel[]>([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pageCount: 1 });
  const [summary, setSummary] = useState<Summary>({ salary: 0, pit: 0, taxableIncome: 0 });
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Personnel | null | undefined>(undefined);

  const canCreate = me.permissions.includes("personnel:create");
  const canManageAll = me.permissions.includes("personnel:manage:all");
  const canManageOwn = me.permissions.includes("personnel:manage:own");
  const canEditRow = (r: Personnel) => canManageAll || (canManageOwn && r.createdById === me.id);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const res = await api.listPersonnel(query, page, PAGE_SIZE, sort, order);
      setRows(res.data);
      setMeta({ total: res.meta.total, page: res.meta.page, pageCount: res.meta.pageCount });
      setSummary(res.summary);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Lỗi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }, [query, page, sort, order]);

  useEffect(() => { const t = setTimeout(load, query ? 300 : 0); return () => clearTimeout(t); }, [load, query]);
  useEffect(() => { setPage(1); }, [query, sort, order]);

  const onDelete = async (r: Personnel) => {
    if (!(await confirmModal("Xóa hồ sơ", `Xóa hồ sơ "${r.fullName}"? Hành động này không thể hoàn tác.`, { danger: true, confirmText: "Xóa" }))) return;
    try { await api.deletePersonnel(r.id); toast("Đã xóa hồ sơ", "success"); load(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Xóa thất bại", "error"); }
  };

  const toggleSort = (k: string) => {
    if (!SORTABLE.has(k)) return;
    if (sort === k) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(k); setOrder("asc"); }
  };

  const renderCell = (k: string, r: Personnel, first: boolean) => {
    const f = FIELD_BY_KEY[k];
    const v = r[k];
    const cls = first ? "sticky-col" : f?.type === "money" ? "num" : "";
    let content: ReactNode;
    if (f?.type === "money") content = fmtMoney(v);
    else if (f?.type === "date") content = fmtDate(v);
    else if (f?.type === "status") content = v ? <span className={`status ${statusClass(v)}`}>{String(v)}</span> : <span className="muted">—</span>;
    else content = v == null || v === "" ? "" : String(v);
    return <td key={k} className={cls}>{content}</td>;
  };

  return (
    <div>
      <h1>Nhân sự</h1>
      <div className="toolbar">
        {!canCreate && <span className="badge">Chỉ xem</span>}
        <span className="spacer" />
        {canCreate && <button className="btn btn-primary" onClick={() => setEditing(null)}>+ Thêm hồ sơ</button>}
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{query ? "Không tìm thấy hồ sơ khớp." : "Chưa có hồ sơ nào."}</div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                {TABLE_COLS.map((k, i) => {
                  const f = FIELD_BY_KEY[k];
                  const sortable = SORTABLE.has(k);
                  const arrow = sort === k ? (order === "asc" ? " ▲" : " ▼") : "";
                  return (
                    <th key={k} className={`${i === 0 ? "sticky-col" : ""} ${f?.type === "money" ? "num" : ""} ${sortable ? "sortable" : ""}`}
                        onClick={() => toggleSort(k)} title={sortable ? "Bấm để sắp xếp" : undefined}>
                      {f?.label ?? k}{arrow}
                    </th>
                  );
                })}
                <th>Người tạo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
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
                <td className="sticky-col"><strong>Tổng (toàn bộ lọc)</strong></td>
                {TABLE_COLS.slice(1).map((k) => (
                  <td key={k} className={FIELD_BY_KEY[k]?.type === "money" ? "num" : ""}>
                    {k === "salary" ? <strong>{fmtMoney(summary.salary)}</strong>
                      : k === "pit" ? <strong>{fmtMoney(summary.pit)}</strong>
                      : ""}
                  </td>
                ))}
                <td /><td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="list-foot">
        <span className="muted">Tổng: {meta.total} hồ sơ · Lương: {fmtMoney(summary.salary)} đ · Thuế TNCN: {fmtMoney(summary.pit)} đ</span>
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
          onSaved={() => { setEditing(undefined); load(); }}
        />
      )}
    </div>
  );
}

function RecordForm({ rec, readOnly, onClose, onSaved }: {
  rec: Personnel | null; readOnly: boolean; onClose: () => void; onSaved: () => void;
}) {
  const buildInitial = () => {
    const init: Record<string, string> = {};
    for (const f of FIELDS) {
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
      if (rec) await api.updatePersonnel(rec.id, form);
      else await api.createPersonnel(form);
      toast(rec ? "Đã lưu thay đổi" : "Đã thêm hồ sơ", "success");
      onSaved();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Lưu thất bại");
      setSaving(false);
    }
  };

  const title = rec ? (readOnly ? "Xem hồ sơ" : "Sửa hồ sơ") : "Thêm hồ sơ";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pf-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="pf-title">{title}</h3>
          <button className="x" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          {GROUPS.map((g) => (
            <fieldset key={g}>
              <legend>{g}</legend>
              <div className="grid">
                {FIELDS.filter((f) => f.group === g).map((f, idx) => {
                  const isMoney = f.type === "money" || f.type === "number";
                  const isFirst = g === GROUPS[0] && idx === 0;
                  return (
                    <label key={f.key} className={f.type === "textarea" ? "full" : ""}>
                      <span>{f.label}{f.key === "fullName" && <b className="req"> *</b>}{f.type === "money" && <em className="unit"> (đ)</em>}</span>
                      {f.type === "textarea" ? (
                        <textarea value={form[f.key]} disabled={readOnly} onChange={(e) => set(f.key, e.target.value)} />
                      ) : (
                        <input
                          ref={isFirst ? firstRef : undefined}
                          type={f.type === "date" ? "date" : isMoney ? "number" : "text"}
                          {...(isMoney ? { min: "0", step: "1000", inputMode: "numeric" as const } : {})}
                          value={form[f.key]} disabled={readOnly} onChange={(e) => set(f.key, e.target.value)}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
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
