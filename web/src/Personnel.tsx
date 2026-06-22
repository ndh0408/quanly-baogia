import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Me, type Personnel } from "./api";
import { FIELDS, FIELD_BY_KEY, GROUPS, TABLE_COLS } from "./fields";

const fmtMoney = (v: unknown) => (v == null || v === "" ? "" : Number(v).toLocaleString("vi-VN"));
const fmtDate = (v: unknown) => (v ? new Date(v as string).toLocaleDateString("vi-VN") : "");
const toInputDate = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : "");

export function PersonnelPage({ me }: { me: Me }) {
  const [rows, setRows] = useState<Personnel[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // undefined = đóng form; null = tạo mới; object = sửa/xem
  const [editing, setEditing] = useState<Personnel | null | undefined>(undefined);

  const canCreate = me.permissions.includes("personnel:create");
  const canManageAll = me.permissions.includes("personnel:manage:all");
  const canManageOwn = me.permissions.includes("personnel:manage:own");
  const canEditRow = (r: Personnel) => canManageAll || (canManageOwn && r.createdById === me.id);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const res = await api.listPersonnel(q);
      setRows(res.data); setTotal(res.meta.total);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Lỗi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0); // debounce khi gõ tìm kiếm
    return () => clearTimeout(t);
  }, [load, q]);

  const onDelete = async (r: Personnel) => {
    if (!confirm(`Xóa hồ sơ "${r.fullName}"?`)) return;
    try { await api.deletePersonnel(r.id); load(); }
    catch (ex) { alert(ex instanceof ApiError ? ex.message : "Xóa thất bại"); }
  };

  return (
    <div>
      <div className="toolbar">
        <h2>Nhân sự</h2>
        {!canCreate && <span className="badge">Chỉ xem</span>}
        <span className="spacer" />
        <input className="search" placeholder="Tìm: tên, dự án, mã, MST, SĐT…" value={q} onChange={(e) => setQ(e.target.value)} />
        {canCreate && <button className="btn btn-primary" onClick={() => setEditing(null)}>+ Thêm hồ sơ</button>}
      </div>

      {err && <div className="err">{err}</div>}

      {loading ? (
        <div className="muted">Đang tải…</div>
      ) : rows.length === 0 ? (
        <div className="empty">Chưa có hồ sơ nào.</div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                {TABLE_COLS.map((k) => <th key={k} className={FIELD_BY_KEY[k]?.type === "money" ? "num" : ""}>{FIELD_BY_KEY[k]?.label ?? k}</th>)}
                <th>Người tạo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {TABLE_COLS.map((k) => {
                    const f = FIELD_BY_KEY[k];
                    const v = r[k];
                    const text = f?.type === "money" ? fmtMoney(v) : f?.type === "date" ? fmtDate(v) : (v == null ? "" : String(v));
                    return <td key={k} className={f?.type === "money" ? "num" : ""}>{text}</td>;
                  })}
                  <td className="muted">{r.createdBy?.displayName ?? ""}</td>
                  <td className="row-actions">
                    <button className="btn btn-sm" onClick={() => setEditing(r)}>{canEditRow(r) ? "Sửa" : "Xem"}</button>
                    {canEditRow(r) && <button className="btn btn-sm btn-danger" onClick={() => onDelete(r)}>Xóa</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted total">Tổng: {total} hồ sơ</div>

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
  const set = (k: string, v: string) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setErr(""); setSaving(true);
    try {
      if (rec) await api.updatePersonnel(rec.id, form);
      else await api.createPersonnel(form);
      onSaved();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Lưu thất bại");
      setSaving(false);
    }
  };

  const title = rec ? (readOnly ? "Xem hồ sơ" : "Sửa hồ sơ") : "Thêm hồ sơ";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          {GROUPS.map((g) => (
            <fieldset key={g}>
              <legend>{g}</legend>
              <div className="grid">
                {FIELDS.filter((f) => f.group === g).map((f) => (
                  <label key={f.key} className={f.type === "textarea" ? "full" : ""}>
                    <span>{f.label}{f.key === "fullName" && <b className="req"> *</b>}</span>
                    {f.type === "textarea" ? (
                      <textarea value={form[f.key]} disabled={readOnly} onChange={(e) => set(f.key, e.target.value)} />
                    ) : (
                      <input
                        type={f.type === "date" ? "date" : f.type === "money" || f.type === "number" ? "number" : "text"}
                        value={form[f.key]} disabled={readOnly} onChange={(e) => set(f.key, e.target.value)}
                      />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        {err && <div className="err">{err}</div>}
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
