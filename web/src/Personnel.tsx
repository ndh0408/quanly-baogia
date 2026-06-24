import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type Me, type Personnel, type Summary, type Employee, type Project } from "./api";
import { INPUT_FIELDS, FIELD_BY_KEY, GROUPS, TABLE_COLS, SORTABLE, statusClass, type FieldSource } from "./fields";
import { EMP_FIELDS } from "./Employees";
import { toast, confirmModal } from "./ui";

const fmtMoney = (v: unknown) => (v == null || v === "" ? "" : Number(v).toLocaleString("vi-VN"));
const fmtDate = (v: unknown) => (v ? new Date(v as string).toLocaleDateString("vi-VN") : "");
const toInputDate = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : "");
const PAGE_SIZE = 50;
// Field LẤY TỪ DỰ ÁN — KHÔNG hiện ô nhập trong form, chỉ điền qua "Chọn dự án" (bắt buộc) rồi hiện "đã chọn".
const PROJECT_FIELDS = new Set(["projectName", "projectCode", "accountName", "company"]);

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
  const canPay = me.permissions.includes("personnel:pay"); // kế toán + admin: bấm đánh dấu thanh toán

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

  // KẾ TOÁN bấm cột "Thanh toán" → đánh dấu đã/chưa (lưu ngày hôm nay).
  const onTogglePay = async (r: Personnel) => {
    const paid = !!r.paidAt;
    const ok = await confirmModal(
      paid ? "Bỏ đánh dấu thanh toán" : "Xác nhận đã thanh toán",
      paid ? `Bỏ đánh dấu đã thanh toán cho "${r.fullName}"?`
           : `Đánh dấu ĐÃ THANH TOÁN cho "${r.fullName}" (ghi ngày hôm nay)?`,
      { confirmText: paid ? "Bỏ đánh dấu" : "Đã thanh toán", danger: paid },
    );
    if (!ok) return;
    try { await api.markPayment(r.id, !paid); toast(paid ? "Đã bỏ đánh dấu thanh toán" : "Đã đánh dấu thanh toán", "success"); load(); }
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

    // THANH TOÁN: nút cho KẾ TOÁN (canPay) bấm → đánh dấu đã/chưa (kèm ngày). Người khác chỉ xem badge.
    if (k === "payment") {
      const paid = !!r.paidAt;
      const dateStr = paid ? fmtDate(r.paidAt) : "";
      const by = (r.paidBy as { displayName?: string } | undefined)?.displayName;
      const title = paid
        ? `Đã thanh toán ${dateStr}${by ? ` · ${by}` : ""}${canPay ? " — bấm để bỏ đánh dấu" : ""}`
        : (canPay ? "Bấm để đánh dấu đã thanh toán" : "Chưa thanh toán");
      const inner = paid
        ? <><span className="status ok">Đã thanh toán</span>{dateStr && <span className="pay-date">{dateStr}</span>}</>
        : <span className="status danger">Chưa thanh toán</span>;
      return (
        <td key={k} className={`pay-cell ${cls}`}>
          {canPay
            ? <button type="button" className="pay-btn" onClick={() => onTogglePay(r)} title={title}>{inner}</button>
            : <span title={title}>{inner}</span>}
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

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{query ? "Không tìm thấy hồ sơ khớp." : "Chưa có hồ sơ nào."}</div>
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
                        onClick={() => toggleSort(k)} title={sortable ? "Bấm để sắp xếp" : f?.source === "ref-project" ? "Tự lấy từ Dự án theo Mã dự án" : f?.source === "formula" ? "Tự tính từ Lương" : f?.source === "action" ? "Kế toán bấm để đánh dấu đã thanh toán (có ngày)" : undefined}>
                      {f?.label ?? k}{arrow}
                    </th>
                  );
                })}
                <th rowSpan={2}>Người tạo</th>
                <th rowSpan={2} />
              </tr>
              {/* Hàng 2: chỉ 2 cột con của "THỜI GIAN LÀM VIỆC" */}
              <tr>
                <th className={hdrCls("workStart")}>Ngày bắt đầu</th>
                <th className={hdrCls("workEnd")}>Ngày kết thúc</th>
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
    for (const f of INPUT_FIELDS) {
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
          {/* Chọn DỰ ÁN (BẮT BUỘC) — hiện cả khi tạo/sửa/xem. Chọn xong hiện "✓ đã chọn"; KHÔNG hiện ô riêng cho Tên/Mã dự án·Account·CTY (tự điền ngầm). */}
          <ProjectPicker
            selected={{ projectCode: form.projectCode, projectName: form.projectName, accountName: form.accountName, company: form.company }}
            readOnly={readOnly}
            onPick={(p) => { setForm((s) => ({ ...s, projectName: p.projectName, projectCode: p.projectCode, accountName: p.accountName, company: p.company })); toast(`Đã chọn dự án "${p.projectCode}"`, "success"); }}
            onClear={() => setForm((s) => ({ ...s, projectName: "", projectCode: "", accountName: "", company: "" }))}
          />
          {!rec && !readOnly && (
            <EmployeePicker onPick={(emp) => {
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
          {!readOnly && !form.projectCode && <span className="foot-hint">⚠ Cần chọn dự án trước khi lưu</span>}
          <button className="btn" onClick={onClose}>Đóng</button>
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
