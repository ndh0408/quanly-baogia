import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Me, type Venue, type VenueItemRow } from "../lib/api";
import { errMsg } from "../lib/format";
import { toast, confirmModal } from "../lib/ui";
import { invalidateCatalog, norm, parseDim } from "../lib/venueCatalog";
import { qtyRound } from "../lib/quoteMath";

// Trang "Danh mục rạp" — kho kích thước để lúc làm báo giá gõ tên là app điền sẵn.
//
// Bố cục kiểu DANH BẠ: trái = danh sách rạp, phải = hạng mục của rạp đang chọn.
// Cố ý giữ ÍT thứ trên màn: không checkbox chọn hàng loạt, không thanh công cụ,
// không cột "nhóm/khu vực/cụm/viết tắt" (đó là di sản file Excel cũ, người dùng không cần khai).
// Thêm mới không cần bấm nút mở form: ô nhập nằm sẵn ở đầu danh sách và cuối bảng.

type FullVenue = Venue & { items?: VenueItemRow[] };

const numText = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
// Con số app sẽ điền vào ô Số Lượng của báo giá.
const slOf = (it: VenueItemRow) =>
  it.unit === "m2" && it.w && it.h ? qtyRound(it.w * it.h) : it.qty ?? null;

export function VenuesPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");           // 1 từ khóa đang lọc ("" = tất cả)
  const [selId, setSelId] = useState<number | null>(null);
  const canManage = me.permissions.includes("venue:manage");

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["venues", "full"],
    queryFn: () => api.listVenues("", true),
  });
  const all = useMemo<FullVenue[]>(() => data?.data ?? [], [data]);

  const reload = () => {
    qc.invalidateQueries({ queryKey: ["venues"] });
    invalidateCatalog();   // gợi ý trong báo giá lấy bản mới ngay
  };

  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of all) for (const t of v.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"));
  }, [all]);

  // Tìm 1 ô cho tất cả: khớp tên rạp HOẶC tên hạng mục (không dấu). Rạp khớp nhờ hạng mục thì
  // ghi rõ "khớp N hạng mục" để người dùng hiểu vì sao nó hiện ra.
  const list = useMemo(() => {
    const toks = norm(q).split(/\s+/).filter(Boolean);
    return all
      .filter((v) => !tag || (v.tags ?? []).includes(tag))
      .map((v) => {
        if (!toks.length) return { v, hitNames: [] as string[] };
        const vHay = norm(`${v.name} ${(v.tags ?? []).join(" ")}`);
        if (toks.every((t) => vHay.includes(t))) return { v, hitNames: [] };
        const hits = (v.items ?? []).filter((it) => {
          const hay = `${vHay} ${norm(`${it.name} ${it.dim || ""} ${it.note || ""}`)}`;
          return toks.every((t) => hay.includes(t));
        });
        return hits.length ? { v, hitNames: hits.map((h) => h.name) } : null;
      })
      .filter(Boolean) as { v: FullVenue; hitNames: string[] }[];
  }, [all, q, tag]);

  // Rạp đang chọn: nếu nó rơi khỏi kết quả lọc thì tự nhảy về rạp đầu tiên.
  const sel = useMemo(() => {
    const found = all.find((v) => v.id === selId);
    if (found && list.some((r) => r.v.id === selId)) return found;
    return list[0]?.v ?? null;
  }, [all, list, selId]);

  useEffect(() => { if (sel && sel.id !== selId) setSelId(sel.id); }, [sel, selId]);

  const addVenue = async (name: string) => {
    const n = name.trim();
    if (!n) return;
    try {
      const v = await api.createVenue({ name: n });
      toast(`Đã thêm rạp "${n}"`, "success");
      setSelId(v.id); setQ(""); setTag("");
      reload();
    } catch (ex) { toast(errMsg(ex, "Thêm rạp thất bại"), "error"); }
  };

  if (error) {
    return (
      <div>
        <h1>Danh mục rạp</h1>
        <div className="err">⚠ {errMsg(error)} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>
      </div>
    );
  }

  return (
    <div>
      <h1>Danh mục rạp</h1>
      <p className="muted page-sub">
        Lưu sẵn kích thước của từng rạp. Khi làm báo giá, gõ tên hạng mục ở ô <b>Hạng Mục</b> là app tự điền kích thước và số lượng — khỏi mở file đi dò.
      </p>

      {isPending ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : all.length === 0 ? (
        <FirstVenue canManage={canManage} onAdd={addVenue} />
      ) : (
        <div className={`vn-split${sel ? " has-sel" : ""}`}>
          {/* ── TRÁI: danh sách rạp ── */}
          <aside className="vn-left">
            <input type="search" className="vn-search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm rạp hoặc hạng mục…" aria-label="Tìm rạp hoặc hạng mục" />

            {tags.length > 0 && (
              <div className="vn-tagbar">
                <button type="button" className={`vn-tag${tag === "" ? " on" : ""}`} onClick={() => setTag("")}>Tất cả</button>
                {tags.map(([t, n]) => (
                  <button type="button" key={t} className={`vn-tag${tag === t ? " on" : ""}`} onClick={() => setTag(tag === t ? "" : t)}>
                    {t} <i>{n}</i>
                  </button>
                ))}
              </div>
            )}

            {canManage && <AddVenueRow onAdd={addVenue} />}

            <div className="vn-vlist">
              {list.length === 0 && <div className="vn-none muted">Không có rạp nào khớp “{q}”.</div>}
              {list.map(({ v, hitNames }) => (
                <button type="button" key={v.id} className={`vn-vrow${v.id === sel?.id ? " on" : ""}`} onClick={() => setSelId(v.id)}>
                  <span className="vn-vname">{v.name}{!v.active && <span className="muted"> (tắt)</span>}</span>
                  <span className="vn-vsub">
                    {hitNames.length
                      ? <em>khớp {hitNames.length} hạng mục</em>
                      : `${v.items?.length ?? 0} hạng mục`}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          {/* ── PHẢI: hạng mục của rạp đang chọn ── */}
          <section className="vn-right">
            {sel
              ? <VenueDetail key={sel.id} venue={sel} venues={all} canManage={canManage} highlight={q}
                  onBack={() => setSelId(null)} onChanged={reload} onGone={() => { setSelId(null); reload(); }} />
              : <div className="vn-none muted">Chọn một rạp bên trái.</div>}
          </section>
        </div>
      )}
    </div>
  );
}

// ── Màn hình khi CHƯA CÓ GÌ: dạy đúng 3 bước, và cho nhập ngay ───────────────
function FirstVenue({ canManage, onAdd }: { canManage: boolean; onAdd: (n: string) => void }) {
  const [name, setName] = useState("");
  if (!canManage) return <div className="empty">Danh mục chưa có rạp nào.</div>;
  return (
    <div className="vn-first">
      <h2>Bắt đầu: thêm rạp đầu tiên</h2>
      <ol className="vn-steps">
        <li>Thêm <b>tên rạp</b> (vd: CGV Aeon Tân Phú).</li>
        <li>Thêm các <b>hạng mục</b> của rạp đó kèm kích thước (vd: Quầy vé lớn — 6.5 × 1 m).</li>
        <li>Xong. Lúc làm báo giá, gõ “quầy vé” là app hiện ra và tự điền kích thước + số lượng.</li>
      </ol>
      <div className="vn-firstform">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên rạp…"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(name); setName(""); } }} />
        <button className="btn btn-primary" onClick={() => { onAdd(name); setName(""); }}>Thêm rạp</button>
      </div>
    </div>
  );
}

// ── Ô thêm rạp nằm SẴN đầu danh sách (không phải bấm nút mở form) ────────────
function AddVenueRow({ onAdd }: { onAdd: (n: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="vn-addv">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="+ Thêm rạp mới…"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAdd(name); setName(""); } }} />
      {name.trim() && <button className="btn btn-sm btn-primary" onClick={() => { onAdd(name); setName(""); }}>Thêm</button>}
    </div>
  );
}

// ── PHẢI: tên rạp + từ khóa + bảng hạng mục + hàng thêm ─────────────────────
function VenueDetail({ venue, venues, canManage, highlight, onBack, onChanged, onGone }: {
  venue: FullVenue; venues: FullVenue[]; canManage: boolean; highlight: string;
  onBack: () => void; onChanged: () => void; onGone: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(venue.name);
  const [editing, setEditing] = useState<VenueItemRow | null>(null);
  const [merging, setMerging] = useState(false);
  const items = venue.items ?? [];
  const hl = norm(highlight).split(/\s+/).filter(Boolean);
  const isHit = (it: VenueItemRow) =>
    hl.length > 0 && hl.every((t) => norm(`${it.name} ${it.dim || ""}`).includes(t));

  const rename = async () => {
    const n = name.trim();
    if (!n || n === venue.name) { setRenaming(false); setName(venue.name); return; }
    try { await api.updateVenue(venue.id, { name: n }); toast("Đã đổi tên rạp", "success"); setRenaming(false); onChanged(); }
    catch (ex) { toast(errMsg(ex, "Đổi tên thất bại"), "error"); }
  };
  const setTags = async (next: string[]) => {
    try { await api.updateVenue(venue.id, { tags: next }); onChanged(); }
    catch (ex) { toast(errMsg(ex, "Lưu từ khóa thất bại"), "error"); }
  };
  const delVenue = async () => {
    if (!(await confirmModal("Xoá rạp", `Xoá "${venue.name}"${items.length ? ` và ${items.length} hạng mục` : ""}? Không lấy lại được.`, { danger: true, confirmText: "Xoá" }))) return;
    try { await api.deleteVenue(venue.id); toast("Đã xoá rạp", "success"); onGone(); }
    catch (ex) { toast(errMsg(ex, "Xoá thất bại"), "error"); }
  };
  const delItem = async (it: VenueItemRow) => {
    if (!(await confirmModal("Xoá hạng mục", `Xoá "${it.name}"?`, { danger: true, confirmText: "Xoá" }))) return;
    try { await api.deleteVenueItem(it.id); toast("Đã xoá", "success"); onChanged(); }
    catch (ex) { toast(errMsg(ex, "Xoá thất bại"), "error"); }
  };

  return (
    <>
      <div className="vn-rhead">
        <button className="btn btn-sm vn-back" onClick={onBack}>‹ Danh sách</button>
        {renaming ? (
          <input className="vn-rename" autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") { setRenaming(false); setName(venue.name); } }} />
        ) : (
          <h2 className="vn-rtitle" onDoubleClick={() => canManage && setRenaming(true)} title={canManage ? "Bấm đúp để đổi tên" : undefined}>{venue.name}</h2>
        )}
        {canManage && !renaming && (
          <span className="vn-racts">
            <button className="btn btn-sm" onClick={() => setRenaming(true)}>Đổi tên</button>
            {venues.length > 1 && <button className="btn btn-sm" onClick={() => setMerging(true)} title="Dồn hạng mục sang rạp khác rồi xoá rạp này">Gộp</button>}
            <button className="btn btn-sm btn-danger" onClick={() => void delVenue()}>Xoá rạp</button>
          </span>
        )}
      </div>

      <TagRow tags={venue.tags ?? []} all={venues.flatMap((v) => v.tags ?? [])} canManage={canManage} onChange={setTags} />

      {items.length === 0 ? (
        <p className="muted vn-hint">Rạp này chưa có hạng mục. Thêm dòng đầu tiên ở dưới — ví dụ “Quầy vé lớn”, kích thước “6.5 x 1”.</p>
      ) : (
        <table className="vn-items">
          <thead>
            <tr>
              <th scope="col">Hạng mục</th>
              <th scope="col">Kích thước</th>
              <th scope="col">Đơn vị</th>
              <th scope="col" style={{ textAlign: "right" }}>Số lượng</th>
              {canManage && <th scope="col" aria-label="Thao tác" />}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const sl = slOf(it);
              return (
                <tr key={it.id} className={`${isHit(it) ? "hit" : ""}${it.active ? "" : " off"}`}>
                  <td><b>{it.name}</b>{!it.active && <span className="muted"> (tắt)</span>}
                    {it.note && <div className="vn-note">{it.note}</div>}</td>
                  <td>{it.dim || <span className="muted">—</span>}</td>
                  <td>{it.unit || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: "right" }}>{sl != null ? numText(sl) : <span className="muted">—</span>}</td>
                  {canManage && (
                    <td className="vn-iacts">
                      <button className="btn btn-sm" onClick={() => setEditing(it)}>Sửa</button>
                      <button className="btn btn-sm btn-danger" onClick={() => void delItem(it)}>Xoá</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {canManage && <AddItemRow venueId={venue.id} onAdded={onChanged} />}

      {editing && <ItemModal rec={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
      {merging && <MergeModal venue={venue} venues={venues.filter((v) => v.id !== venue.id)} onClose={() => setMerging(false)} onDone={onGone} />}
    </>
  );
}

// ── Từ khóa: sửa TẠI CHỖ bằng chip, không qua form ──────────────────────────
function TagRow({ tags, all, canManage, onChange }: {
  tags: string[]; all: string[]; canManage: boolean; onChange: (t: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const others = [...new Set(all)].filter((t) => !tags.includes(t)).slice(0, 8);
  const add = (t: string) => {
    const v = t.trim();
    setDraft(""); setAdding(false);
    if (v && !tags.includes(v)) onChange([...tags, v]);
  };
  if (!canManage && !tags.length) return null;
  return (
    <div className="vn-tagrow">
      <span className="muted">Từ khóa:</span>
      {tags.map((t) => (
        <span className="vn-tag on" key={t}>{t}
          {canManage && <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Bỏ ${t}`}>✕</button>}
        </span>
      ))}
      {canManage && (adding ? (
        <input className="vn-taginput" autoFocus value={draft} list="vn-tag-sug" placeholder="tên nhóm…"
          onChange={(e) => setDraft(e.target.value)} onBlur={() => add(draft)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(draft); } if (e.key === "Escape") { setDraft(""); setAdding(false); } }} />
      ) : (
        <button type="button" className="vn-tag add" onClick={() => setAdding(true)}>+ từ khóa</button>
      ))}
      <datalist id="vn-tag-sug">{others.map((t) => <option key={t} value={t} />)}</datalist>
      {!tags.length && canManage && <span className="muted vn-taghint">— đặt tên nhóm (vd “hcm”) để lọc nhanh ở cột trái</span>}
    </div>
  );
}

// ── Hàng thêm hạng mục nằm SẴN cuối bảng. Dán nhiều dòng = thêm nhiều hạng mục ──
function AddItemRow({ venueId, onAdded }: { venueId: number; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [dim, setDim] = useState("");
  const [unit, setUnit] = useState("m2");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const { w, h } = parseDim(dim);
  const sl = unit === "m2" && w && h ? qtyRound(w * h) : null;

  const add = async () => {
    if (!name.trim()) { nameRef.current?.focus(); return; }
    setBusy(true);
    try {
      await api.createVenueItem(venueId, { name: name.trim(), dim: dim.trim() || null, w, h, unit: unit.trim() || null });
      setName(""); setDim("");            // giữ Đơn vị để gõ dòng tiếp cho nhanh
      onAdded(); nameRef.current?.focus();
    } catch (ex) { toast(errMsg(ex, "Thêm thất bại"), "error"); }
    finally { setBusy(false); }
  };

  // Dán nhiều dòng (từ Excel/sheet) → mỗi dòng 1 hạng mục. Tách tên & kích thước theo TAB,
  // theo chữ "Dimension:", hoặc theo dấu "(" mở đầu cụm số — cách nào có trước thì dùng.
  const onPaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text/plain");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return;                   // 1 dòng → dán bình thường
    e.preventDefault();
    setBusy(true);
    let ok = 0;
    for (const line of lines) {
      let nm = line, dm = "";
      const tab = line.split("\t");
      const dimAt = line.search(/Dimension\s*:/i);
      const parenAt = line.search(/\((?=[^)]*[x×])/i);
      if (tab.length > 1) { nm = tab[0]; dm = tab.slice(1).join(" "); }
      else if (dimAt >= 0) { nm = line.slice(0, dimAt); dm = line.slice(dimAt).replace(/Dimension\s*:/i, ""); }
      else if (parenAt > 0) { nm = line.slice(0, parenAt); dm = line.slice(parenAt); }
      nm = nm.replace(/^[.\-–—•\s]+/, "").trim();
      dm = dm.trim();
      if (!nm) continue;
      const p = parseDim(dm);
      try {
        await api.createVenueItem(venueId, { name: nm, dim: dm || null, w: p.w, h: p.h, unit: unit.trim() || null });
        ok++;
      } catch { /* bỏ qua dòng lỗi, báo tổng ở cuối */ }
    }
    setBusy(false); setName(""); setDim("");
    toast(ok ? `Đã thêm ${ok}/${lines.length} dòng` : "Không thêm được dòng nào", ok ? "success" : "error");
    onAdded();
  };

  return (
    <div className="vn-additem">
      <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} onPaste={(e) => void onPaste(e)}
        placeholder="Tên hạng mục (vd: Quầy vé lớn)" className="vn-ai-name" aria-label="Tên hạng mục"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} />
      <input value={dim} onChange={(e) => setDim(e.target.value)} placeholder="Kích thước (vd: 6.5 x 1)" className="vn-ai-dim" aria-label="Kích thước"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }} />
      <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Đơn vị" className="vn-ai-unit" aria-label="Đơn vị" list="vn-units" />
      <datalist id="vn-units"><option value="m2" /><option value="bộ" /><option value="cái" /><option value="ghế" /><option value="tấm" /></datalist>
      <span className="vn-ai-sl muted">{sl != null ? <>= <b>{numText(sl)}</b></> : ""}</span>
      <button className="btn btn-sm btn-primary" onClick={() => void add()} disabled={busy}>{busy ? "…" : "Thêm"}</button>
      <div className="vn-ai-hint muted">Gõ xong nhấn Enter. Dán nhiều dòng cùng lúc cũng được.</div>
    </div>
  );
}

// ── Sửa 1 hạng mục (chỉ mở khi bấm Sửa) ─────────────────────────────────────
function ItemModal({ rec, onClose, onSaved }: { rec: VenueItemRow; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(rec.name);
  const [dim, setDim] = useState(rec.dim ?? "");
  const [w, setW] = useState(numText(rec.w));
  const [h, setH] = useState(numText(rec.h));
  const [unit, setUnit] = useState(rec.unit ?? "");
  const [qty, setQty] = useState(numText(rec.qty));
  const [note, setNote] = useState(rec.note ?? "");
  const [active, setActive] = useState(rec.active);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toNum = (s: string) => { const t = s.trim().replace(",", "."); return t === "" ? null : Number(t); };
  const sl = unit === "m2" ? (() => { const a = toNum(w), b = toNum(h); return a && b ? qtyRound(a * b) : null; })() : toNum(qty);
  const onDim = (v: string) => {
    setDim(v);
    if (w.trim() || h.trim()) return;   // đã sửa tay thì không đè
    const p = parseDim(v);
    if (p.w) setW(numText(p.w));
    if (p.h) setH(numText(p.h));
  };

  const save = async () => {
    if (!name.trim()) { setErr("Chưa có tên hạng mục"); return; }
    setErr(""); setSaving(true);
    try {
      await api.updateVenueItem(rec.id, { name: name.trim(), dim: dim.trim() || null, w: toNum(w), h: toNum(h), unit: unit.trim() || null, qty: toNum(qty), note: note.trim() || null, active });
      toast("Đã lưu", "success"); onSaved();
    } catch (ex) { setErr(errMsg(ex, "Lưu thất bại")); setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Sửa hạng mục" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Sửa hạng mục</h3><button className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          {err && <div className="err">⚠ {err}</div>}
          <div className="grid">
            <label className="full"><span>Tên hạng mục</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="full"><span>Kích thước <em className="unit">(ghi sao cũng được — Rộng/Cao tự đọc ra)</em></span>
              <input value={dim} onChange={(e) => onDim(e.target.value)} placeholder="6.5 x 1" /></label>
            <label><span>Rộng</span><input value={w} inputMode="decimal" onChange={(e) => setW(e.target.value)} /></label>
            <label><span>Cao</span><input value={h} inputMode="decimal" onChange={(e) => setH(e.target.value)} /></label>
            <label><span>Đơn vị</span><input value={unit} onChange={(e) => setUnit(e.target.value)} list="vn-units-m" />
              <datalist id="vn-units-m"><option value="m2" /><option value="bộ" /><option value="cái" /><option value="ghế" /><option value="tấm" /></datalist></label>
            <label><span>Số lượng <em className="unit">(khi không tính theo m²)</em></span>
              <input value={qty} inputMode="decimal" onChange={(e) => setQty(e.target.value)} /></label>
            <label className="full"><span>Ghi chú <em className="unit">(điền sẵn vào cột Ghi chú của báo giá)</em></span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="vd: PP in KTS" /></label>
            <label className="full" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: "auto" }} />
              <span>Đang dùng <em className="unit">(bỏ tick = ẩn khỏi gợi ý)</em></span></label>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            {sl != null ? <>Báo giá sẽ tự điền số lượng <b>{numText(sl)}</b>{unit === "m2" ? " m²" : ""}.</> : "Điền Rộng + Cao và để đơn vị là m2 thì số lượng tự tính."}
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button>
        </div>
      </div>
    </div>
  );
}

// ── Gộp rạp (khi lỡ tạo trùng tên) ──────────────────────────────────────────
function MergeModal({ venue, venues, onClose, onDone }: {
  venue: FullVenue; venues: FullVenue[]; onClose: () => void; onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [intoId, setIntoId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const n = venue.items?.length ?? 0;
  const list = useMemo(() => {
    const nq = norm(q);
    return (nq ? venues.filter((v) => norm(v.name).includes(nq)) : venues).slice(0, 60);
  }, [venues, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    if (intoId == null) return;
    const into = venues.find((v) => v.id === intoId);
    if (!(await confirmModal("Gộp rạp", `Dồn ${n} hạng mục của "${venue.name}" sang "${into?.name}" rồi xoá "${venue.name}"?`, { danger: true, confirmText: "Gộp" }))) return;
    setBusy(true);
    try { const r = await api.mergeVenue(venue.id, intoId); toast(`Đã dồn ${r.movedItems} hạng mục sang "${r.into.name}"`, "success"); onDone(); }
    catch (ex) { toast(errMsg(ex, "Gộp thất bại"), "error"); setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Gộp rạp" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Gộp “{venue.name}” vào rạp khác</h3><button className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>Chọn rạp giữ lại — {n} hạng mục sẽ dồn sang đó, rạp này bị xoá.</p>
          <input className="vs-pick-search" autoFocus placeholder="Tìm rạp…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="vs-pick-body">
            {list.length === 0 && <div className="vs-empty muted">Không tìm thấy</div>}
            {list.map((v) => (
              <label className="vs-item-row" key={v.id}>
                <input type="radio" name="into" checked={intoId === v.id} onChange={() => setIntoId(v.id)} />
                <span><b>{v.name}</b><br /><span className="vs-line2">{v.items?.length ?? 0} hạng mục</span></span>
              </label>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Huỷ</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || intoId == null}>{busy ? "Đang gộp…" : "Gộp"}</button>
        </div>
      </div>
    </div>
  );
}
