import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Me, type Venue, type VenueItemRow } from "../lib/api";
import { errMsg } from "../lib/format";
import { toast, confirmModal, fieldErrorsFrom } from "../lib/ui";
import { invalidateCatalog, norm } from "../lib/venueCatalog";

// Trang "Danh mục rạp" — nguồn dữ liệu cho GỢI Ý KÍCH THƯỚC khi tạo báo giá.
// Hai tầng: (1) danh sách rạp → (2) chi tiết 1 rạp + bảng hạng mục (thêm/sửa/xoá/gộp).
// Quyền: venue:read = xem; venue:manage = sửa. Mọi thay đổi → xoá cache gợi ý (invalidateCatalog).

const CATEGORIES = [
  "Quầy vé & quầy bắp", "Cover màn hình", "Bục soát vé", "Bọc ghế",
  "Standee & banner", "Wall / khu chờ", "Máy chiếu logo", "Bàn vuông/tròn",
];

const m2 = (w: number | null, h: number | null) => (w && h ? Math.round(w * h * 100) / 100 : null);
const numText = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

export function VenuesPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Venue | null | undefined>(undefined);

  const canManage = me.permissions.includes("venue:manage");

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["venues"],
    queryFn: () => api.listVenues(""),
  });
  const all = useMemo(() => data?.data ?? [], [data]);
  // Lọc tại client (danh mục vài trăm rạp) → gõ tới đâu lọc tới đó, không chờ mạng.
  const rows = useMemo(() => {
    const nq = norm(q);
    return nq ? all.filter((v) => norm(`${v.name} ${v.region} ${v.cluster || ""} ${v.code || ""}`).includes(nq)) : all;
  }, [all, q]);

  const reload = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["venues"] });
    qc.invalidateQueries({ queryKey: ["venue"] });
    invalidateCatalog();   // gợi ý trong editor lấy bản mới ở lần gõ kế tiếp
  }, [qc]);

  const onDelete = async (v: Venue) => {
    const n = v.itemCount ?? 0;
    if (!(await confirmModal("Xóa rạp", `Xóa "${v.name}"${n ? ` và ${n} hạng mục của rạp này` : ""}? Không hoàn tác được.`, { danger: true, confirmText: "Xóa" }))) return;
    try { const r = await api.deleteVenue(v.id); toast(`Đã xóa rạp${r.removedItems ? ` + ${r.removedItems} hạng mục` : ""}`, "success"); if (openId === v.id) setOpenId(null); reload(); }
    catch (ex) { toast(errMsg(ex, "Xóa thất bại"), "error"); }
  };

  if (openId != null) {
    return <VenueDetail id={openId} canManage={canManage} venues={all} onBack={() => { setOpenId(null); reload(); }} onChanged={reload} />;
  }

  const totalItems = all.reduce((s, v) => s + (v.itemCount ?? 0), 0);

  return (
    <div>
      <h1>Danh mục rạp</h1>
      <p className="muted page-sub">
        Kích thước đo sẵn của từng rạp (quầy vé, quầy bắp, cover màn hình, bục soát vé…). Khi tạo báo giá, gõ tên hạng mục ở ô <b>Hạng Mục</b> là app gợi ý ra kích thước — hoặc bấm <b>📐 Chèn từ rạp</b> để chèn cả loạt.
      </p>

      <div className="toolbar">
        <input type="search" className="grow" placeholder="Tìm rạp… (gõ không dấu cũng được)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm rạp" />
        {canManage && <button className="btn btn-primary" onClick={() => setEditing(null)}>+ Rạp mới</button>}
      </div>

      {error && <div className="err">⚠ {errMsg(error)} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}

      {isPending ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty">
          {q ? `Không tìm thấy rạp nào khớp “${q}”.` : "Chưa có rạp nào trong danh mục."}
          {!q && canManage && <div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={() => setEditing(null)}>+ Rạp mới</button></div>}
        </div>
      ) : (
        <div className="list-wrap">
          <table className="list-table">
            <thead>
              <tr>
                <th scope="col">Tên rạp</th>
                <th scope="col">Khu vực</th>
                <th scope="col">Cụm</th>
                <th scope="col">Viết tắt</th>
                <th scope="col" style={{ textAlign: "right" }}>Hạng mục</th>
                <th scope="col" className="actions" aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>
                    <button className="btn-link-cell" onClick={() => setOpenId(v.id)} title="Xem/sửa hạng mục của rạp này">
                      <strong>{v.name}</strong>
                    </button>
                    {!v.active && <span className="muted"> (đang tắt)</span>}
                  </td>
                  <td>{v.region || <span className="muted">—</span>}</td>
                  <td>{v.cluster || <span className="muted">—</span>}</td>
                  <td>{v.code || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: "right" }}>{v.itemCount ?? 0}</td>
                  <td className="row-actions">
                    <button className="btn btn-sm" onClick={() => setOpenId(v.id)}>Hạng mục</button>
                    {canManage && <button className="btn btn-sm" onClick={() => setEditing(v)}>Sửa</button>}
                    {canManage && <button className="btn btn-sm btn-danger" onClick={() => onDelete(v)}>Xóa</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="list-foot">
          <span className="muted">{rows.length} rạp{rows.length !== all.length ? ` (lọc từ ${all.length})` : ""} · tổng {totalItems} hạng mục</span>
        </div>
      )}

      {editing !== undefined && (
        <VenueForm rec={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); reload(); }} />
      )}
    </div>
  );
}

// ── Chi tiết 1 rạp: thông tin + bảng hạng mục ────────────────────────────────
function VenueDetail({ id, canManage, venues, onBack, onChanged }: {
  id: number; canManage: boolean; venues: Venue[]; onBack: () => void; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [editItem, setEditItem] = useState<VenueItemRow | null | undefined>(undefined);
  const [merging, setMerging] = useState(false);

  const { data: venue, isPending, error, refetch } = useQuery({
    queryKey: ["venue", id],
    queryFn: () => api.getVenue(id),
  });
  const reload = () => { qc.invalidateQueries({ queryKey: ["venue", id] }); onChanged(); };

  const onDeleteItem = async (it: VenueItemRow) => {
    if (!(await confirmModal("Xóa hạng mục", `Xóa "${it.name}"? Không hoàn tác được.`, { danger: true, confirmText: "Xóa" }))) return;
    try { await api.deleteVenueItem(it.id); toast("Đã xóa hạng mục", "success"); reload(); }
    catch (ex) { toast(errMsg(ex, "Xóa thất bại"), "error"); }
  };

  const items = venue?.items ?? [];

  return (
    <div>
      <button className="btn btn-sm" onClick={onBack} style={{ marginBottom: 10 }}>‹ Danh sách rạp</button>
      <h1>{venue?.name ?? "Đang tải…"}</h1>
      <p className="muted page-sub">
        {venue ? [venue.region, venue.cluster, venue.code].filter(Boolean).join(" · ") || "Chưa có thông tin khu vực/cụm" : ""}
        {venue?.note ? ` — ${venue.note}` : ""}
      </p>

      <div className="toolbar">
        {canManage && <button className="btn btn-primary" onClick={() => setEditItem(null)}>+ Hạng mục</button>}
        {canManage && venues.length > 1 && <button className="btn" onClick={() => setMerging(true)} title="Chuyển hết hạng mục sang rạp khác rồi xoá rạp này (dùng khi 1 rạp bị nhập trùng dưới nhiều tên)">⇄ Gộp vào rạp khác</button>}
      </div>

      {error && <div className="err">⚠ {errMsg(error)} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}

      {isPending ? (
        <div className="skeleton-wrap">{Array.from({ length: 5 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : items.length === 0 ? (
        <div className="empty">
          Rạp này chưa có hạng mục nào.
          {canManage && <div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={() => setEditItem(null)}>+ Hạng mục</button></div>}
        </div>
      ) : (
        <div className="list-wrap">
          <table className="list-table">
            <thead>
              <tr>
                <th scope="col">Nhóm</th>
                <th scope="col">Hạng mục</th>
                <th scope="col">Kích thước</th>
                <th scope="col">ĐVT</th>
                <th scope="col" style={{ textAlign: "right" }}>SL tự tính</th>
                <th scope="col">Ghi chú</th>
                <th scope="col" className="actions" aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const area = it.unit === "m2" ? m2(it.w, it.h) : null;
                return (
                  <tr key={it.id}>
                    <td><span className="muted">{it.cat}</span></td>
                    <td><strong>{it.name}</strong>{!it.active && <span className="muted"> (tắt)</span>}</td>
                    <td>{it.dim || <span className="muted">—</span>}</td>
                    <td>{it.unit || <span className="muted">—</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      {area != null ? `${numText(area)} m²` : it.qty != null ? numText(it.qty) : <span className="muted">—</span>}
                    </td>
                    <td>{it.note || <span className="muted">—</span>}</td>
                    <td className="row-actions">
                      <button className="btn btn-sm" onClick={() => setEditItem(it)}>{canManage ? "Sửa" : "Xem"}</button>
                      {canManage && <button className="btn btn-sm btn-danger" onClick={() => onDeleteItem(it)}>Xóa</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && <div className="list-foot"><span className="muted">{items.length} hạng mục</span></div>}

      {editItem !== undefined && venue && (
        <ItemForm venueId={venue.id} rec={editItem} readOnly={!canManage}
          onClose={() => setEditItem(undefined)} onSaved={() => { setEditItem(undefined); reload(); }} />
      )}
      {merging && venue && (
        <MergeForm venue={venue} venues={venues.filter((v) => v.id !== venue.id)}
          onClose={() => setMerging(false)} onDone={() => { setMerging(false); onBack(); }} />
      )}
    </div>
  );
}

// ── Form rạp ────────────────────────────────────────────────────────────────
function VenueForm({ rec, onClose, onSaved }: { rec: Venue | null; onClose: () => void; onSaved: () => void }) {
  const isNew = !rec;
  const [name, setName] = useState(rec?.name ?? "");
  const [region, setRegion] = useState(rec?.region ?? "");
  const [cluster, setCluster] = useState(rec?.cluster ?? "");
  const [code, setCode] = useState(rec?.code ?? "");
  const [note, setNote] = useState(rec?.note ?? "");
  const [active, setActive] = useState(rec?.active ?? true);
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), region: region.trim(), cluster: cluster.trim() || null, code: code.trim() || null, note: note.trim() || null, active };
      return isNew ? api.createVenue(body) : api.updateVenue(rec!.id, body);
    },
    onSuccess: () => { toast("Đã lưu", "success"); onSaved(); },
    onError: (ex) => {
      const fe = fieldErrorsFrom(ex);
      setFieldErrors(fe);
      setErr(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : errMsg(ex, "Lưu thất bại"));
    },
  });

  const submit = () => {
    if (!name.trim()) { setFieldErrors({ name: "Vui lòng nhập tên rạp" }); return; }
    setErr(""); setFieldErrors({}); save.mutate();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="vf-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="vf-title">{isNew ? "Thêm rạp" : "Sửa rạp"}</h3>
          <button className="x" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          {err && <div className="err">⚠ {err}</div>}
          <div className="grid">
            <label className="full">
              <span>Tên rạp <b className="req">*</b></span>
              <input ref={firstRef} value={name} placeholder="VD: CGV Aeon Tân Phú"
                aria-invalid={fieldErrors.name ? true : undefined}
                onChange={(e) => { setName(e.target.value); setFieldErrors((f) => (f.name ? { ...f, name: "" } : f)); }} />
              {fieldErrors.name && <div className="field-err">{fieldErrors.name}</div>}
            </label>
            <label>
              <span>Khu vực</span>
              <input value={region} placeholder="HCM / Hà Nội / Đà Nẵng…" onChange={(e) => setRegion(e.target.value)} />
            </label>
            <label>
              <span>Cụm</span>
              <input value={cluster ?? ""} placeholder="CGV / Lotte / Cinestar…" onChange={(e) => setCluster(e.target.value)} />
            </label>
            <label>
              <span>Viết tắt</span>
              <input value={code ?? ""} placeholder="HVP, VLM, SVH…" onChange={(e) => setCode(e.target.value)} />
            </label>
            <label className="full">
              <span>Ghi chú</span>
              <input value={note ?? ""} onChange={(e) => setNote(e.target.value)} />
            </label>
            <label className="full" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: "auto" }} />
              <span>Đang dùng <em className="unit">(bỏ tick = ẩn khỏi gợi ý, vẫn giữ dữ liệu)</em></span>
            </label>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={submit} disabled={save.isPending}>{save.isPending ? "Đang lưu…" : "Lưu"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Form hạng mục ───────────────────────────────────────────────────────────
function ItemForm({ venueId, rec, readOnly, onClose, onSaved }: {
  venueId: number; rec: VenueItemRow | null; readOnly: boolean; onClose: () => void; onSaved: () => void;
}) {
  const isNew = !rec;
  const [cat, setCat] = useState(rec?.cat ?? CATEGORIES[0]);
  const [name, setName] = useState(rec?.name ?? "");
  const [dim, setDim] = useState(rec?.dim ?? "");
  const [w, setW] = useState(numText(rec?.w));
  const [h, setH] = useState(numText(rec?.h));
  const [unit, setUnit] = useState(rec?.unit ?? "m2");
  const [qty, setQty] = useState(numText(rec?.qty));
  const [note, setNote] = useState(rec?.note ?? "");
  const [active, setActive] = useState(rec?.active ?? true);
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Cho gõ dấu phẩy thập phân kiểu VN ("1,6") — đổi sang chấm khi gửi lên server.
  const toNum = (s: string) => { const t = s.trim().replace(",", "."); return t === "" ? null : Number(t); };
  const area = unit === "m2" ? m2(toNum(w), toNum(h)) : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        cat: cat.trim(), name: name.trim(), dim: dim.trim() || null,
        w: toNum(w), h: toNum(h), unit: unit.trim() || null, qty: toNum(qty),
        note: note.trim() || null, active,
      };
      return isNew ? api.createVenueItem(venueId, body) : api.updateVenueItem(rec!.id, body);
    },
    onSuccess: () => { toast("Đã lưu", "success"); onSaved(); },
    onError: (ex) => {
      const fe = fieldErrorsFrom(ex);
      setFieldErrors(fe);
      setErr(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : errMsg(ex, "Lưu thất bại"));
    },
  });

  const submit = () => {
    const fe: Record<string, string> = {};
    if (!name.trim()) fe.name = "Vui lòng nhập tên hạng mục";
    if (!cat.trim()) fe.cat = "Vui lòng chọn nhóm";
    if (w.trim() && Number.isNaN(toNum(w))) fe.w = "Chiều rộng phải là số";
    if (h.trim() && Number.isNaN(toNum(h))) fe.h = "Chiều cao phải là số";
    if (Object.keys(fe).length) { setFieldErrors(fe); return; }
    setErr(""); setFieldErrors({}); save.mutate();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="if-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="if-title">{isNew ? "Thêm hạng mục" : readOnly ? "Xem hạng mục" : "Sửa hạng mục"}</h3>
          <button className="x" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          {err && <div className="err">⚠ {err}</div>}
          <div className="grid">
            <label>
              <span>Nhóm <b className="req">*</b></span>
              <input list="venue-cats" value={cat} disabled={readOnly}
                aria-invalid={fieldErrors.cat ? true : undefined}
                onChange={(e) => setCat(e.target.value)} />
              <datalist id="venue-cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
              {fieldErrors.cat && <div className="field-err">{fieldErrors.cat}</div>}
            </label>
            <label>
              <span>Tên hạng mục <b className="req">*</b></span>
              <input ref={firstRef} value={name} disabled={readOnly} placeholder="VD: Quầy bắp 2"
                aria-invalid={fieldErrors.name ? true : undefined}
                onChange={(e) => { setName(e.target.value); setFieldErrors((f) => (f.name ? { ...f, name: "" } : f)); }} />
              {fieldErrors.name && <div className="field-err">{fieldErrors.name}</div>}
            </label>
            <label className="full">
              <span>Kích thước <em className="unit">(ghi như sổ tay — hiện nguyên văn trong gợi ý)</em></span>
              <input value={dim ?? ""} disabled={readOnly} placeholder="VD: (2.675W x 1H)m" onChange={(e) => setDim(e.target.value)} />
            </label>
            <label>
              <span>Rộng <em className="unit">(mét)</em></span>
              <input value={w} disabled={readOnly} inputMode="decimal" placeholder="2,675"
                aria-invalid={fieldErrors.w ? true : undefined} onChange={(e) => setW(e.target.value)} />
              {fieldErrors.w && <div className="field-err">{fieldErrors.w}</div>}
            </label>
            <label>
              <span>Cao <em className="unit">(mét)</em></span>
              <input value={h} disabled={readOnly} inputMode="decimal" placeholder="1"
                aria-invalid={fieldErrors.h ? true : undefined} onChange={(e) => setH(e.target.value)} />
              {fieldErrors.h && <div className="field-err">{fieldErrors.h}</div>}
            </label>
            <label>
              <span>ĐVT</span>
              <input list="venue-units" value={unit ?? ""} disabled={readOnly} onChange={(e) => setUnit(e.target.value)} />
              <datalist id="venue-units"><option value="m2" /><option value="bộ" /><option value="bảng" /><option value="ghế" /><option value="tấm" /><option value="cái" /></datalist>
            </label>
            <label>
              <span>SL mặc định <em className="unit">(khi ĐVT không phải m2)</em></span>
              <input value={qty} disabled={readOnly} inputMode="decimal" onChange={(e) => setQty(e.target.value)} />
            </label>
            <label className="full">
              <span>Ghi chú <em className="unit">(chất liệu, lưu ý thi công… — điền sẵn vào cột Ghi chú của báo giá)</em></span>
              <input value={note ?? ""} disabled={readOnly} placeholder="VD: PP in KTS, diecut theo hình" onChange={(e) => setNote(e.target.value)} />
            </label>
            <label className="full" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={active} disabled={readOnly} onChange={(e) => setActive(e.target.checked)} style={{ width: "auto" }} />
              <span>Đang dùng <em className="unit">(bỏ tick = ẩn khỏi gợi ý)</em></span>
            </label>
          </div>
          <p className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
            {area != null
              ? <>Khi chọn hạng mục này, báo giá tự điền <b>SL = {numText(area)} m²</b> (Rộng × Cao).</>
              : <>Điền <b>Rộng</b> + <b>Cao</b> và để ĐVT là <b>m2</b> thì báo giá sẽ tự tính số lượng m².</>}
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>{readOnly ? "Đóng" : "Hủy"}</button>
          {!readOnly && <button className="btn btn-primary" onClick={submit} disabled={save.isPending}>{save.isPending ? "Đang lưu…" : "Lưu"}</button>}
        </div>
      </div>
    </div>
  );
}

// ── Gộp rạp (sheet gốc gọi 1 rạp bằng nhiều tên: "LM81" / "Landmark" / "CGV Landmark 81") ──
function MergeForm({ venue, venues, onClose, onDone }: {
  venue: Venue & { items: VenueItemRow[] }; venues: Venue[]; onClose: () => void; onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [intoId, setIntoId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => {
    const nq = norm(q);
    return (nq ? venues.filter((v) => norm(`${v.name} ${v.region}`).includes(nq)) : venues).slice(0, 60);
  }, [venues, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    if (intoId == null) { toast("Chọn rạp đích trước", "info"); return; }
    const into = venues.find((v) => v.id === intoId);
    if (!(await confirmModal("Gộp rạp",
      `Chuyển ${venue.items.length} hạng mục của "${venue.name}" sang "${into?.name}" rồi XOÁ "${venue.name}"? Không hoàn tác được.`,
      { danger: true, confirmText: "Gộp" }))) return;
    setBusy(true);
    try { const r = await api.mergeVenue(venue.id, intoId); toast(`Đã gộp ${r.movedItems} hạng mục vào "${r.into.name}"`, "success"); onDone(); }
    catch (ex) { toast(errMsg(ex, "Gộp thất bại"), "error"); setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Gộp rạp" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⇄ Gộp “{venue.name}” vào rạp khác</h3>
          <button className="x" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Chọn rạp ĐÍCH — {venue.items.length} hạng mục của “{venue.name}” sẽ chuyển sang đó, rồi “{venue.name}” bị xoá. Dùng khi cùng một rạp bị nhập trùng dưới nhiều tên.
          </p>
          <input className="vs-pick-search" autoFocus placeholder="Tìm rạp đích…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="vs-pick-body">
            {list.length === 0 && <div className="vs-empty muted">Không tìm thấy rạp nào</div>}
            {list.map((v) => (
              <label className="vs-item-row" key={v.id}>
                <input type="radio" name="into" checked={intoId === v.id} onChange={() => setIntoId(v.id)} />
                <span><b>{v.name}</b>{v.region && <span className="muted"> — {v.region}</span>}<br />
                  <span className="vs-line2">{v.itemCount ?? 0} hạng mục</span></span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || intoId == null}>{busy ? "Đang gộp…" : "Gộp"}</button>
        </div>
      </div>
    </div>
  );
}
