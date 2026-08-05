import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Me, type Venue, type VenueItemRow } from "../lib/api";
import { errMsg } from "../lib/format";
import { toast, confirmModal, fieldErrorsFrom } from "../lib/ui";
import { invalidateCatalog, norm, parseDim } from "../lib/venueCatalog";
import { qtyRound } from "../lib/quoteMath";

// Trang "Danh mục rạp" — nguồn dữ liệu cho GỢI Ý KÍCH THƯỚC khi tạo báo giá.
//
// MỘT MÀN HÌNH duy nhất (không nhảy trang): 1 ô tìm + hàng chip TỪ KHÓA + danh sách rạp mở
// ra được tại chỗ để xem/sửa hạng mục. Gõ gì cũng tìm: tên rạp · tên hạng mục · kích thước ·
// từ khóa. Gõ trúng hạng mục thì rạp TỰ MỞ và chỉ hiện những hạng mục khớp.
// Quyền: venue:read = xem · venue:manage = sửa. Mọi thay đổi → xoá cache gợi ý của editor.

const CATEGORIES = [
  "Quầy vé & quầy bắp", "Cover màn hình", "Bục soát vé", "Bọc ghế",
  "Standee & banner", "Wall / khu chờ", "Máy chiếu logo", "Bàn vuông/tròn",
];
const UNITS = ["m2", "bộ", "bảng", "ghế", "tấm", "cái"];

type FullVenue = Venue & { items?: VenueItemRow[] };

const areaOf = (it: { unit: string | null; w: number | null; h: number | null }) =>
  it.unit === "m2" && it.w && it.h ? qtyRound(it.w * it.h) : null;
const numText = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
// Con số sẽ được điền vào ô Số Lượng của báo giá (m² nếu tính được, không thì SL mặc định).
const slText = (it: VenueItemRow) => {
  const a = areaOf(it);
  return a != null ? `${numText(a)} m²` : it.qty != null ? numText(it.qty) : "—";
};

export function VenuesPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [tags, setTags] = useState<string[]>([]);          // chip đang bật (AND với nhau)
  const [open, setOpen] = useState<Set<number>>(new Set()); // rạp đang mở
  const [picked, setPicked] = useState<Set<number>>(new Set()); // chọn hàng loạt để gắn từ khóa/gộp
  const [editVenue, setEditVenue] = useState<FullVenue | null | undefined>(undefined);
  const [editItem, setEditItem] = useState<{ venueId: number; rec: VenueItemRow | null } | null>(null);
  const [merging, setMerging] = useState<FullVenue | null>(null);
  const [tagging, setTagging] = useState(false);

  const canManage = me.permissions.includes("venue:manage");

  // Tải TOÀN BỘ danh mục 1 lần (vài trăm rạp) → gõ tới đâu lọc tới đó, không chờ mạng.
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["venues", "full"],
    queryFn: () => api.listVenues("", true),
  });
  const all = useMemo<FullVenue[]>(() => data?.data ?? [], [data]);

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["venues"] });
    invalidateCatalog();   // editor lấy bản mới ở lần gõ kế tiếp
  };

  // Mọi từ khóa đang dùng + số rạp mỗi từ (để vẽ chip, xếp theo độ phổ biến).
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of all) for (const t of v.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"));
  }, [all]);

  // Lọc: chip (AND) rồi tới chữ đang gõ. Mỗi rạp trả kèm danh sách hạng mục KHỚP (nếu có).
  const results = useMemo(() => {
    const toks = norm(q).split(/\s+/).filter(Boolean);
    const out: { v: FullVenue; hits: VenueItemRow[]; byItem: boolean }[] = [];
    for (const v of all) {
      if (tags.length && !tags.every((t) => (v.tags ?? []).includes(t))) continue;
      const items = v.items ?? [];
      if (!toks.length) { out.push({ v, hits: items, byItem: false }); continue; }
      const vHay = norm(`${v.name} ${v.region} ${v.cluster || ""} ${v.code || ""} ${(v.tags ?? []).join(" ")}`);
      const venueMatch = toks.every((t) => vHay.includes(t));
      // Khớp hạng mục: ghép chuỗi rạp + hạng mục để "aeon quay bap" (nửa tên rạp, nửa hạng mục) vẫn ra.
      const hits = items.filter((it) => {
        const hay = `${vHay} ${norm(`${it.name} ${it.cat} ${it.dim || ""} ${it.note || ""}`)}`;
        return toks.every((t) => hay.includes(t));
      });
      if (venueMatch) out.push({ v, hits: items, byItem: false });
      else if (hits.length) out.push({ v, hits, byItem: true });
    }
    return out;
  }, [all, q, tags]);

  const totalItems = results.reduce((s, r) => s + (r.byItem ? r.hits.length : r.v.items?.length ?? 0), 0);
  const searching = q.trim().length > 0;

  const toggleOpen = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleTag = (t: string) => setTags((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const togglePick = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const onDeleteVenue = async (v: FullVenue) => {
    const n = v.items?.length ?? v.itemCount ?? 0;
    if (!(await confirmModal("Xóa rạp", `Xóa "${v.name}"${n ? ` và ${n} hạng mục của rạp này` : ""}? Không hoàn tác được.`, { danger: true, confirmText: "Xóa" }))) return;
    try { await api.deleteVenue(v.id); toast("Đã xóa rạp", "success"); reload(); }
    catch (ex) { toast(errMsg(ex, "Xóa thất bại"), "error"); }
  };
  const onDeleteItem = async (it: VenueItemRow) => {
    if (!(await confirmModal("Xóa hạng mục", `Xóa "${it.name}"? Không hoàn tác được.`, { danger: true, confirmText: "Xóa" }))) return;
    try { await api.deleteVenueItem(it.id); toast("Đã xóa hạng mục", "success"); reload(); }
    catch (ex) { toast(errMsg(ex, "Xóa thất bại"), "error"); }
  };

  return (
    <div>
      <h1>Danh mục rạp</h1>
      <p className="muted page-sub">
        Kích thước đo sẵn của từng rạp. Khi tạo báo giá, gõ tên hạng mục ở ô <b>Hạng Mục</b> là app gợi ý ra kích thước —
        hoặc bấm <b>📐 Chèn từ rạp</b> để chèn cả loạt. Sửa ở đây là lần gõ sau ra số mới ngay.
      </p>

      {/* MỘT ô tìm cho tất cả: tên rạp · tên hạng mục · kích thước · từ khóa */}
      <div className="toolbar">
        <input type="search" className="grow" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Gõ bất kỳ: tên rạp, tên hạng mục, kích thước, từ khóa… (không dấu cũng được)"
          aria-label="Tìm trong danh mục rạp" />
        {canManage && <button className="btn btn-primary" onClick={() => setEditVenue(null)}>+ Rạp mới</button>}
      </div>

      {/* Từ khóa nhanh: bấm 1 phát ra cả nhóm; bấm thêm chip nữa để thu hẹp trong nhóm đó */}
      {tagCounts.length > 0 && (
        <div className="vcat-tags">
          <span className="muted vcat-tags-lbl">Từ khóa nhanh:</span>
          {tagCounts.map(([t, n]) => (
            <button key={t} type="button" className={`vcat-chip${tags.includes(t) ? " on" : ""}`} onClick={() => toggleTag(t)}
              title={tags.includes(t) ? "Bấm để bỏ lọc từ khóa này" : `Lọc ${n} rạp có từ khóa "${t}"`}>
              {t} <span className="vcat-chip-n">{n}</span>
            </button>
          ))}
          {tags.length > 0 && <button type="button" className="vcat-chip clear" onClick={() => setTags([])}>✕ Bỏ lọc</button>}
        </div>
      )}

      {error && <div className="err">⚠ {errMsg(error)} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}

      {/* Thanh chọn hàng loạt — chỉ hiện khi đã tick rạp */}
      {canManage && picked.size > 0 && (
        <div className="vcat-bulk">
          <b>{picked.size} rạp đã chọn</b>
          <button className="btn btn-sm btn-primary" onClick={() => setTagging(true)}>🏷 Gắn từ khóa</button>
          <button className="btn btn-sm" onClick={() => setPicked(new Set())}>Bỏ chọn</button>
        </div>
      )}

      {isPending ? (
        <div className="skeleton-wrap">{Array.from({ length: 8 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : results.length === 0 ? (
        <div className="empty">
          Không tìm thấy gì khớp{q ? ` “${q}”` : ""}{tags.length ? ` với từ khóa ${tags.join(" + ")}` : ""}.
          {canManage && <div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={() => setEditVenue(null)}>+ Rạp mới</button></div>}
        </div>
      ) : (
        <>
          <div className="muted vcat-count">
            {results.length} rạp · {totalItems} hạng mục{searching ? " khớp" : ""}
            {results.length !== all.length && <> <span className="muted">(trong tổng {all.length} rạp)</span></>}
          </div>
          <div className="vcat-list">
            {results.map(({ v, hits, byItem }) => {
              const isOpen = open.has(v.id) || byItem;   // gõ trúng hạng mục → rạp tự mở
              const items = v.items ?? [];
              return (
                <div className={`vcat-venue${isOpen ? " open" : ""}`} key={v.id}>
                  <div className="vcat-head">
                    {canManage && (
                      <input type="checkbox" className="vcat-pick" checked={picked.has(v.id)} onChange={() => togglePick(v.id)}
                        onClick={(e) => e.stopPropagation()} title="Chọn để gắn từ khóa hàng loạt" aria-label={`Chọn ${v.name}`} />
                    )}
                    <button type="button" className="vcat-title" onClick={() => toggleOpen(v.id)} aria-expanded={isOpen}>
                      <span className="vcat-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                      <span className="vcat-name">{v.name}{!v.active && <span className="muted"> (đang tắt)</span>}</span>
                      <span className="vcat-meta">
                        {(v.tags ?? []).map((t) => <span className="vcat-tag" key={t}>{t}</span>)}
                        {v.code && <span className="vcat-code">{v.code}</span>}
                        <span className="vcat-n">{items.length} hạng mục{byItem && hits.length !== items.length ? ` · ${hits.length} khớp` : ""}</span>
                      </span>
                    </button>
                    {canManage && (
                      <span className="vcat-acts">
                        <button className="btn btn-sm" onClick={() => setEditVenue(v)}>Sửa rạp</button>
                        <button className="btn btn-sm" onClick={() => setMerging(v)} title="Chuyển hết hạng mục sang rạp khác rồi xoá rạp này (khi 1 rạp bị nhập trùng nhiều tên)">⇄ Gộp</button>
                        <button className="btn btn-sm btn-danger" onClick={() => onDeleteVenue(v)}>Xóa</button>
                      </span>
                    )}
                  </div>

                  {isOpen && (
                    <div className="vcat-body">
                      {(byItem ? hits : items).length === 0 ? (
                        <div className="muted vcat-noitem">Rạp này chưa có hạng mục nào.</div>
                      ) : (
                        <table className="vcat-items">
                          <thead>
                            <tr>
                              <th scope="col">Hạng mục</th>
                              <th scope="col">Kích thước</th>
                              <th scope="col">ĐVT</th>
                              <th scope="col" style={{ textAlign: "right" }}>SL tự điền</th>
                              <th scope="col">Nhóm</th>
                              {canManage && <th scope="col" aria-label="Thao tác" />}
                            </tr>
                          </thead>
                          <tbody>
                            {(byItem ? hits : items).map((it) => (
                              <tr key={it.id} className={it.active ? "" : "vcat-off"}>
                                <td><b>{it.name}</b>{!it.active && <span className="muted"> (tắt)</span>}
                                  {it.note && <div className="vcat-note">{it.note}</div>}</td>
                                <td>{it.dim || <span className="muted">—</span>}</td>
                                <td>{it.unit || <span className="muted">—</span>}</td>
                                <td style={{ textAlign: "right" }}>{slText(it)}</td>
                                <td><span className="muted">{it.cat}</span></td>
                                {canManage && (
                                  <td className="vcat-row-acts">
                                    <button className="btn btn-sm" onClick={() => setEditItem({ venueId: v.id, rec: it })}>Sửa</button>
                                    <button className="btn btn-sm btn-danger" onClick={() => onDeleteItem(it)}>Xóa</button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {byItem && hits.length !== items.length && (
                        <div className="muted vcat-noitem">Đang lọc theo ô tìm — rạp này còn {items.length - hits.length} hạng mục khác.</div>
                      )}
                      {canManage && <QuickAdd venueId={v.id} onAdded={reload} onFull={() => setEditItem({ venueId: v.id, rec: null })} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {editVenue !== undefined && (
        <VenueForm rec={editVenue} allTags={tagCounts.map(([t]) => t)}
          onClose={() => setEditVenue(undefined)} onSaved={() => { setEditVenue(undefined); reload(); }} />
      )}
      {editItem && (
        <ItemForm venueId={editItem.venueId} rec={editItem.rec} readOnly={!canManage}
          onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); reload(); }} />
      )}
      {merging && (
        <MergeForm venue={merging} venues={all.filter((x) => x.id !== merging.id)}
          onClose={() => setMerging(null)} onDone={() => { setMerging(null); reload(); }} />
      )}
      {tagging && (
        <BulkTagForm ids={[...picked]} allTags={tagCounts.map(([t]) => t)}
          onClose={() => setTagging(false)} onDone={() => { setTagging(false); setPicked(new Set()); reload(); }} />
      )}
    </div>
  );
}

// ── Thêm nhanh 1 hạng mục ngay trong rạp (không mở modal) ────────────────────
// Dán nguyên chuỗi kích thước kiểu sổ tay "(2.675W x 1H)m" là tự ra Rộng × Cao.
function QuickAdd({ venueId, onAdded, onFull }: { venueId: number; onAdded: () => void; onFull: () => void }) {
  const [cat, setCat] = useState(CATEGORIES[0]);
  const [name, setName] = useState("");
  const [dim, setDim] = useState("");
  const [unit, setUnit] = useState("m2");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const { w, h } = parseDim(dim);
  const area = unit === "m2" && w && h ? qtyRound(w * h) : null;

  const add = async () => {
    if (!name.trim()) { toast("Nhập tên hạng mục đã", "info"); nameRef.current?.focus(); return; }
    setBusy(true);
    try {
      await api.createVenueItem(venueId, { cat: cat.trim(), name: name.trim(), dim: dim.trim() || null, w, h, unit: unit.trim() || null });
      toast("Đã thêm hạng mục", "success");
      setName(""); setDim("");        // giữ Nhóm + ĐVT để nhập tiếp cho nhanh
      onAdded();
      nameRef.current?.focus();
    } catch (ex) { toast(errMsg(ex, "Thêm thất bại"), "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="vcat-quick">
      <input list="venue-cats" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="Nhóm" className="vcat-q-cat" aria-label="Nhóm" />
      <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên hạng mục (vd: Quầy bắp 2)" className="vcat-q-name" aria-label="Tên hạng mục"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} />
      <input value={dim} onChange={(e) => setDim(e.target.value)} placeholder="Dán kích thước: (2.675W x 1H)m" className="vcat-q-dim" aria-label="Kích thước"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} />
      <input list="venue-units" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ĐVT" className="vcat-q-unit" aria-label="ĐVT" />
      <span className="vcat-q-hint muted">
        {area != null ? <>→ SL <b>{numText(area)} m²</b></> : w || h ? <>→ {numText(w)}×{numText(h)} m</> : dim ? "chưa đọc được số" : ""}
      </span>
      <button className="btn btn-sm btn-primary" onClick={() => void add()} disabled={busy}>{busy ? "…" : "+ Thêm"}</button>
      <button className="btn btn-sm" onClick={onFull} title="Mở form đầy đủ (có SL mặc định, ghi chú…)">Nhiều ô hơn…</button>
      <datalist id="venue-cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="venue-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
    </div>
  );
}

// ── Ô nhập từ khóa dạng chip (dùng chung cho form rạp + gắn hàng loạt) ───────
function TagInput({ value, onChange, suggestions, autoFocus }: {
  value: string[]; onChange: (v: string[]) => void; suggestions: string[]; autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = (t: string) => {
    const v = t.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  const free = suggestions.filter((s) => !value.includes(s)).slice(0, 12);
  return (
    <div>
      <div className="vcat-taginput">
        {value.map((t) => (
          <span className="vcat-tag on" key={t}>{t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Bỏ từ khóa ${t}`}>✕</button>
          </span>
        ))}
        <input value={draft} autoFocus={autoFocus} placeholder={value.length ? "thêm…" : "vd: HCM, khách CGV, ưu tiên…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); }
            else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => add(draft)} />
      </div>
      {free.length > 0 && (
        <div className="vcat-tagsug">
          <span className="muted">Đang dùng:</span>
          {free.map((s) => <button type="button" key={s} className="vcat-chip sm" onClick={() => add(s)}>+ {s}</button>)}
        </div>
      )}
    </div>
  );
}

// ── Form rạp ────────────────────────────────────────────────────────────────
function VenueForm({ rec, allTags, onClose, onSaved }: {
  rec: FullVenue | null; allTags: string[]; onClose: () => void; onSaved: () => void;
}) {
  const isNew = !rec;
  const [name, setName] = useState(rec?.name ?? "");
  const [region, setRegion] = useState(rec?.region ?? "");
  const [cluster, setCluster] = useState(rec?.cluster ?? "");
  const [code, setCode] = useState(rec?.code ?? "");
  const [tags, setTags] = useState<string[]>(rec?.tags ?? []);
  const [note, setNote] = useState(rec?.note ?? "");
  const [active, setActive] = useState(rec?.active ?? true);
  const [err, setErr] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (!name.trim()) { setFieldErrors({ name: "Vui lòng nhập tên rạp" }); return; }
    setErr(""); setFieldErrors({}); setSaving(true);
    // Khu vực cũng nên là 1 từ khóa (để bấm chip ra được) — tự thêm nếu người dùng chưa thêm.
    const finalTags = region.trim() && !tags.includes(region.trim()) ? [...tags, region.trim()] : tags;
    const body = { name: name.trim(), region: region.trim(), cluster: cluster.trim() || null, code: code.trim() || null, tags: finalTags, note: note.trim() || null, active };
    try {
      if (isNew) await api.createVenue(body); else await api.updateVenue(rec!.id, body);
      toast("Đã lưu", "success"); onSaved();
    } catch (ex) {
      const fe = fieldErrorsFrom(ex);
      setFieldErrors(fe);
      setErr(Object.keys(fe).length ? "Vui lòng kiểm tra các ô được tô đỏ." : errMsg(ex, "Lưu thất bại"));
      setSaving(false);
    }
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
            <label className="full">
              <span>Từ khóa nhanh <em className="unit">(gõ xong nhấn Enter — bấm chip ở trang ngoài là ra cả nhóm)</em></span>
              <TagInput value={tags} onChange={setTags} suggestions={allTags} />
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
            <label>
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
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Form hạng mục (đầy đủ) ──────────────────────────────────────────────────
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
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toNum = (s: string) => { const t = s.trim().replace(",", "."); return t === "" ? null : Number(t); };
  const area = unit === "m2" ? (() => { const a = toNum(w), b = toNum(h); return a && b ? qtyRound(a * b) : null; })() : null;

  // Dán chuỗi kích thước → tự điền Rộng/Cao (chỉ khi 2 ô còn trống, không đè số đã sửa tay).
  const onDimChange = (v: string) => {
    setDim(v);
    if (w.trim() || h.trim()) return;
    const p = parseDim(v);
    if (p.w) setW(numText(p.w));
    if (p.h) setH(numText(p.h));
  };

  const save = async () => {
    const fe: Record<string, string> = {};
    if (!name.trim()) fe.name = "Vui lòng nhập tên hạng mục";
    if (!cat.trim()) fe.cat = "Vui lòng chọn nhóm";
    if (w.trim() && !Number.isFinite(toNum(w) as number)) fe.w = "Chiều rộng phải là số";
    if (h.trim() && !Number.isFinite(toNum(h) as number)) fe.h = "Chiều cao phải là số";
    if (Object.keys(fe).length) { setFieldErrors(fe); return; }
    setErr(""); setFieldErrors({}); setSaving(true);
    const body = { cat: cat.trim(), name: name.trim(), dim: dim.trim() || null, w: toNum(w), h: toNum(h), unit: unit.trim() || null, qty: toNum(qty), note: note.trim() || null, active };
    try {
      if (isNew) await api.createVenueItem(venueId, body); else await api.updateVenueItem(rec!.id, body);
      toast("Đã lưu", "success"); onSaved();
    } catch (ex) {
      const f = fieldErrorsFrom(ex);
      setFieldErrors(f);
      setErr(Object.keys(f).length ? "Vui lòng kiểm tra các ô được tô đỏ." : errMsg(ex, "Lưu thất bại"));
      setSaving(false);
    }
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
              <input list="venue-cats-f" value={cat} disabled={readOnly} aria-invalid={fieldErrors.cat ? true : undefined} onChange={(e) => setCat(e.target.value)} />
              <datalist id="venue-cats-f">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
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
              <span>Kích thước <em className="unit">(dán nguyên như sổ tay — Rộng/Cao tự điền)</em></span>
              <input value={dim ?? ""} disabled={readOnly} placeholder="VD: (2.675W x 1H)m" onChange={(e) => onDimChange(e.target.value)} />
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
              <input list="venue-units-f" value={unit ?? ""} disabled={readOnly} onChange={(e) => setUnit(e.target.value)} />
              <datalist id="venue-units-f">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            </label>
            <label>
              <span>SL mặc định <em className="unit">(khi ĐVT không phải m2)</em></span>
              <input value={qty} disabled={readOnly} inputMode="decimal" onChange={(e) => setQty(e.target.value)} />
            </label>
            <label className="full">
              <span>Ghi chú <em className="unit">(chất liệu, lưu ý — điền sẵn vào cột Ghi chú của báo giá)</em></span>
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
          {!readOnly && <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button>}
        </div>
      </div>
    </div>
  );
}

// ── Gắn từ khóa cho nhiều rạp một lượt ──────────────────────────────────────
function BulkTagForm({ ids, allTags, onClose, onDone }: {
  ids: number[]; allTags: string[]; onClose: () => void; onDone: () => void;
}) {
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    if (!add.length && !remove.length) { toast("Chọn từ khóa muốn gắn hoặc gỡ", "info"); return; }
    setBusy(true);
    try { const r = await api.bulkVenueTags(ids, add, remove); toast(`Đã cập nhật từ khóa cho ${r.updated} rạp`, "success"); onDone(); }
    catch (ex) { toast(errMsg(ex, "Cập nhật thất bại"), "error"); setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Gắn từ khóa" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🏷 Gắn từ khóa cho {ids.length} rạp</h3>
          <button className="x" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Đặt tên nhóm cho những rạp vừa chọn — sau này bấm chip đó là ra đúng nhóm này. Ví dụ trong HCM tách riêng “khách CGV”, “rạp trung tâm”…
          </p>
          <div className="grid">
            <label className="full">
              <span>Gắn thêm từ khóa</span>
              <TagInput value={add} onChange={setAdd} suggestions={allTags} autoFocus />
            </label>
            <label className="full">
              <span>Gỡ bỏ từ khóa <em className="unit">(tùy chọn)</em></span>
              <TagInput value={remove} onChange={setRemove} suggestions={allTags} />
            </label>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? "Đang lưu…" : "Áp dụng"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Gộp rạp (sheet gốc gọi 1 rạp bằng nhiều tên: "LM81" / "Landmark" / "CGV Landmark 81") ──
function MergeForm({ venue, venues, onClose, onDone }: {
  venue: FullVenue; venues: FullVenue[]; onClose: () => void; onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [intoId, setIntoId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const nItems = venue.items?.length ?? venue.itemCount ?? 0;
  const list = useMemo(() => {
    const nq = norm(q);
    return (nq ? venues.filter((v) => norm(`${v.name} ${v.region} ${(v.tags ?? []).join(" ")}`).includes(nq)) : venues).slice(0, 60);
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
      `Chuyển ${nItems} hạng mục của "${venue.name}" sang "${into?.name}" rồi XOÁ "${venue.name}"? Không hoàn tác được.`,
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
            Chọn rạp ĐÍCH — {nItems} hạng mục của “{venue.name}” sẽ chuyển sang đó, rồi “{venue.name}” bị xoá. Dùng khi cùng một rạp bị nhập trùng dưới nhiều tên.
          </p>
          <input className="vs-pick-search" autoFocus placeholder="Tìm rạp đích…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="vs-pick-body">
            {list.length === 0 && <div className="vs-empty muted">Không tìm thấy rạp nào</div>}
            {list.map((v) => (
              <label className="vs-item-row" key={v.id}>
                <input type="radio" name="into" checked={intoId === v.id} onChange={() => setIntoId(v.id)} />
                <span><b>{v.name}</b>{v.region && <span className="muted"> — {v.region}</span>}<br />
                  <span className="vs-line2">{v.items?.length ?? v.itemCount ?? 0} hạng mục</span></span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || intoId == null}>{busy ? "Đang gộp…" : "Gộp"}</button>
        </div>
      </div>
    </div>
  );
}
