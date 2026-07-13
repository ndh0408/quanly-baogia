import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, ApiError, type Me, type Customer } from "../lib/api";
import { useDebouncedValue } from "../lib/query";
import { toast, confirmModal, fieldErrorsFrom } from "../lib/ui";

// Port 1:1 màn "Mã khách hàng" của SPA cũ (renderCustomers/editCustomer) sang React.
// Giữ nguyên: toolbar (tìm + "+ Khách mới"), bảng [Mã KH | Tên công ty | Sửa/Xóa],
// tìm-debounce, sort theo Tên, phân trang, skeleton/empty/error, modal thêm/sửa, confirm xóa.
// Bảo mật: server tự cô lập theo ownerId (CUSTOMER_READ_ALL) — UI không nới lỏng gì.
const PAGE_SIZE = 20;

export function CustomersPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [editing, setEditing] = useState<Customer | null | undefined>(undefined);

  // Quyền NGUYÊN TỬ: tạo / sửa / xóa RIÊNG (đúng guard server). read:own thấy "Xem", không nút ghi.
  const has = (p: string) => me.permissions.includes(p);
  const canCreate = has("customer:create");
  const canEdit = has("customer:edit:own") || has("customer:edit:all");
  const canDelete = has("customer:delete:own") || has("customer:delete:all");

  // Tải qua TanStack Query (cache + dedupe + SSE invalidate). Ô tìm debounce 300ms như cũ.
  const debouncedQ = useDebouncedValue(q, q ? 300 : 0);
  useEffect(() => { setPage(1); }, [debouncedQ, sort, order]);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["customers", { q: debouncedQ, page, sort, order }],
    queryFn: () => api.listCustomers(debouncedQ, page, PAGE_SIZE, sort, order),
    placeholderData: keepPreviousData,
  });
  const rows = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, pageCount: 1 };
  const loading = isPending;
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";
  const reload = () => { qc.invalidateQueries({ queryKey: ["customers"] }); };

  const toggleSort = (k: string) => {
    if (k !== "name") return;
    if (sort === k) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else { setSort(k); setOrder("asc"); }
  };

  const onDelete = async (c: Customer) => {
    if (!(await confirmModal("Xóa khách hàng", `Xóa khách hàng "${c.code} — ${c.name}"?`, { danger: true, confirmText: "Xóa" }))) return;
    try { await api.deleteCustomer(c.id); toast("Đã xóa", "success"); reload(); }
    catch (ex) { toast(ex instanceof ApiError ? ex.message : "Xóa thất bại", "error"); }
  };

  const nameArrow = sort === "name" ? (order === "asc" ? " ▲" : " ▼") : "";
  const nameAria: "ascending" | "descending" | "none" = sort === "name" ? (order === "asc" ? "ascending" : "descending") : "none";

  return (
    <div>
      <h1>Mã khách hàng</h1>
      <div className="toolbar">
        <input className="grow" placeholder="Tìm theo mã hoặc tên công ty…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm khách hàng" />
        {canCreate && <button className="btn btn-primary" onClick={() => setEditing(null)}>+ Khách mới</button>}
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          {q ? "Không tìm thấy khách hàng phù hợp." : "Chưa có khách hàng nào."}
          {!q && canCreate && <div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={() => setEditing(null)}>+ Thêm khách hàng</button></div>}
        </div>
      ) : (
        <div className="list-wrap">
          <table className="list-table">
            <thead>
              <tr>
                <th>Mã khách hàng</th>
                <th className="sortable" aria-sort={nameAria} onClick={() => toggleSort("name")} title="Bấm để sắp xếp">Tên công ty{nameArrow}</th>
                <th title="Hạn công nợ riêng từng công ty: quá số ngày này sau Ngày HĐơn mà chưa thanh toán → trang Hóa đơn báo ĐỎ">Công nợ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.code}</strong></td>
                  <td>{c.name}</td>
                  <td>{c.debtDays != null ? `${c.debtDays} ngày` : <span className="muted">Mặc định</span>}</td>
                  <td className="row-actions">
                    <button className="btn btn-sm" onClick={() => setEditing(c)}>{canEdit ? "Sửa" : "Xem"}</button>
                    {canDelete && <button className="btn btn-sm btn-danger" onClick={() => onDelete(c)}>Xóa</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer pager — GIỐNG Y SPA (admin pagerHtml): "Hiển thị x–y / total" + Trước/Trang/Sau, luôn hiện khi có dữ liệu. */}
      {rows.length > 0 && (
        <div className="list-foot">
          <span className="muted">Hiển thị {(meta.page - 1) * PAGE_SIZE + 1}–{(meta.page - 1) * PAGE_SIZE + rows.length} / {meta.total}</span>
          {/* Chỉ hiện nút phân trang khi CÓ nhiều hơn 1 trang — ẩn "Trang 1/1" vô nghĩa. */}
          {(meta.pageCount || 1) > 1 && (
            <div className="pager">
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Trước</button>
              <span className="muted">Trang {meta.page}/{meta.pageCount || 1}</span>
              <button className="btn btn-sm" disabled={page >= (meta.pageCount || 1)} onClick={() => setPage((p) => p + 1)}>Sau →</button>
            </div>
          )}
        </div>
      )}

      {editing !== undefined && (
        <CustomerForm rec={editing} readOnly={editing !== null && !canEdit}
          onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); reload(); }} />
      )}
    </div>
  );
}

function CustomerForm({ rec, readOnly, onClose, onSaved }: {
  rec: Customer | null; readOnly: boolean; onClose: () => void; onSaved: () => void;
}) {
  const isNew = !rec;
  const [code, setCode] = useState(rec?.code ?? "");
  const [name, setName] = useState(rec?.name ?? "");
  const [debtDays, setDebtDays] = useState<string>(rec?.debtDays != null ? String(rec.debtDays) : "");
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(isNew);
  const firstRef = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);

  // Sửa: nạp đủ chi tiết (đề phòng list trả thiếu) — giống SPA gọi GET /customers/:id.
  useEffect(() => {
    if (isNew) return;
    api.getCustomer(rec!.id).then((c) => { setCode(c.code || ""); setName(c.name || ""); setDebtDays(c.debtDays != null ? String(c.debtDays) : ""); setLoaded(true); }).catch(() => setLoaded(true));
  }, [isNew, rec]);

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
    if (!name.trim()) { setFieldErrors({ name: "Vui lòng nhập tên công ty" }); return; }
    setErr(""); setFieldErrors({}); setSaving(true);
    try {
      const dd = debtDays.trim() === "" ? null : Number(debtDays);
      if (isNew) await api.createCustomer({ name: name.trim(), debtDays: dd, ...(code.trim() ? { code: code.trim() } : {}) });
      else await api.updateCustomer(rec!.id, { name: name.trim(), debtDays: dd });
      toast("Đã lưu", "success");
      onSaved();
    } catch (ex) {
      const fe = fieldErrorsFrom(ex);
      setFieldErrors(fe);
      setErr(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : (ex instanceof ApiError ? ex.message : "Lưu thất bại"));
      setSaving(false);
    }
  };

  const title = isNew ? "Tạo khách hàng" : readOnly ? "Xem khách hàng" : "Sửa khách hàng";

  return (
    <div className="modal-backdrop" onClick={() => void guardedClose()}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="cf-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="cf-title">{title}</h3>
          <button className="x" onClick={() => void guardedClose()} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          <div className="grid">
            <label className="full">
              <span>Mã khách hàng {isNew && <em className="unit">(để trống = tự cấp KH…)</em>}</span>
              <input ref={isNew ? firstRef : undefined} value={code} disabled={readOnly || !isNew}
                placeholder="VD: CGV, KH001…"
                aria-invalid={fieldErrors.code ? true : undefined}
                onChange={(e) => { dirty.current = true; setCode(e.target.value); }} />
              {fieldErrors.code && <div className="field-err">{fieldErrors.code}</div>}
            </label>
            <label className="full">
              <span>Tên công ty <b className="req">*</b></span>
              <input ref={!isNew ? firstRef : undefined} value={name} disabled={readOnly}
                aria-invalid={fieldErrors.name ? true : undefined}
                onChange={(e) => { dirty.current = true; setName(e.target.value); setFieldErrors((fe) => (fe.name ? { ...fe, name: "" } : fe)); }} />
              {fieldErrors.name && <div className="field-err">{fieldErrors.name}</div>}
            </label>
            <label className="full">
              <span>Hạn công nợ <em className="unit">(ngày — để trống = dùng mặc định trang Hóa đơn)</em></span>
              <input inputMode="numeric" value={debtDays} disabled={readOnly}
                placeholder="VD: 30"
                aria-invalid={fieldErrors.debtDays ? true : undefined}
                onChange={(e) => { dirty.current = true; setDebtDays(e.target.value.replace(/[^\d]/g, "")); setFieldErrors((fe) => (fe.debtDays ? { ...fe, debtDays: "" } : fe)); }} />
              <em className="unit">Chưa thanh toán quá số ngày này (tính từ Ngày HĐơn) → trang Hóa đơn báo <b style={{ color: "#b91c1c" }}>ĐỎ</b> để đi đòi.</em>
              {fieldErrors.debtDays && <div className="field-err">{fieldErrors.debtDays}</div>}
            </label>
          </div>
          {!loaded && <div className="muted" style={{ marginTop: 8 }}>Đang tải…</div>}
        </div>
        {err && <div className="err">⚠ {err}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={() => void guardedClose()}>Đóng</button>
          {!readOnly && (
            <button className="btn btn-primary" disabled={saving || !name.trim()} onClick={save}>
              {saving ? "Đang lưu…" : "Lưu"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
