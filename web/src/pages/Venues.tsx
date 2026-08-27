import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me, type Venue, type VenueItemRow } from "../lib/api";
import { errMsg } from "../lib/format";
import { toast, confirmModal } from "../lib/ui";
import { invalidateCatalog, norm } from "../lib/venueCatalog";
import { dangGoIME } from "../lib/gridShared";

// Trang "Danh mục rạp" — danh sách hạng mục thường dùng theo từng rạp.
//
// Bố cục kiểu DANH BẠ: trái = danh sách rạp, phải = hạng mục của rạp đang chọn.
// Cố ý giữ ÍT thứ trên màn: không checkbox chọn hàng loạt, không thanh công cụ,
// không cột "nhóm/khu vực/cụm/viết tắt" (đó là di sản file Excel cũ, người dùng không cần khai).
// Thêm mới không cần bấm nút mở form: ô nhập nằm sẵn ở đầu danh sách và cuối bảng.

type FullVenue = Venue & { items?: VenueItemRow[] };
type AddVenueHandler = (name: string) => Promise<boolean>;

const normItemText = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
const normItemUnit = (v: string) => /^m\s*(?:\^?\s*2|²)$/.test(normItemText(v)) ? "m2" : normItemText(v);
const quickUnits = new Set(["m2", "m", "md", "bộ", "cái", "ghế", "tấm", "bảng", "set", "kg"]);

const parseQuickItemLine = (line: string, fallbackUnit: string) => {
  const cells = line.split("\t").map((cell) => cell.trim());
  let name = cells[0] ?? "";
  const dimAt = name.search(/Dimension\s*:/i);
  const parenAt = name.search(/\((?=[^)]*\d[^)]*[x×][^)]*\d)/i);
  if (dimAt >= 0) name = name.slice(0, dimAt);
  else if (parenAt > 0) name = name.slice(0, parenAt);
  name = name.replace(/^[.\-–—•\s]+/, "").trim();
  const rowUnit = cells.slice(1).find((cell) => quickUnits.has(normItemUnit(cell))) ?? fallbackUnit;
  return { name, unit: rowUnit.trim() };
};

export function VenuesPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const addVenueBusyRef = useRef(false);
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

  const addVenue: AddVenueHandler = async (name) => {
    const n = name.trim();
    if (!n || addVenueBusyRef.current) return false;
    addVenueBusyRef.current = true;
    try {
      const v = await api.createVenue({ name: n });
      toast(`Đã thêm rạp "${n}"`, "success");
      setSelId(v.id); setQ(""); setTag("");
      reload();
      return true;
    } catch (ex) {
      toast(errMsg(ex, "Thêm rạp thất bại"), "error");
      return false;
    } finally {
      addVenueBusyRef.current = false;
    }
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
        Lưu danh sách hạng mục thường dùng của từng rạp. Khi làm báo giá, gõ tên ở ô <b>Hạng Mục</b> để tìm và chèn nhanh.
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
function FirstVenue({ canManage, onAdd }: { canManage: boolean; onAdd: AddVenueHandler }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (!name.trim() || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { if (await onAdd(name)) setName(""); }
    finally {
      busyRef.current = false; setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };
  if (!canManage) return <div className="empty">Danh mục chưa có rạp nào.</div>;
  return (
    <div className="vn-first">
      <h2>Bắt đầu: thêm rạp đầu tiên</h2>
      <ol className="vn-steps">
        <li>Thêm <b>tên rạp</b> (vd: CGV Aeon Tân Phú).</li>
        <li>Thêm các <b>hạng mục</b> thường dùng của rạp đó (vd: Quầy vé lớn).</li>
        <li>Xong. Lúc làm báo giá, gõ “quầy vé” là app hiện đúng hạng mục để chèn nhanh.</li>
      </ol>
      <div className="vn-firstform">
        <input ref={inputRef} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên rạp…" disabled={busy}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} />
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !name.trim()}>{busy ? "Đang thêm…" : "Thêm rạp"}</button>
      </div>
    </div>
  );
}

// ── Ô thêm rạp nằm SẴN đầu danh sách (không phải bấm nút mở form) ────────────
function AddVenueRow({ onAdd }: { onAdd: AddVenueHandler }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (!name.trim() || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { if (await onAdd(name)) setName(""); }
    finally {
      busyRef.current = false; setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };
  return (
    <div className="vn-addv">
      <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="+ Thêm rạp mới…" disabled={busy}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} />
      {name.trim() && <button type="button" className="btn btn-sm btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? "…" : "Thêm"}</button>}
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
  const renameBusyRef = useRef(false);
  const renameCancelledRef = useRef(false);
  const items = venue.items ?? [];
  const hl = norm(highlight).split(/\s+/).filter(Boolean);
  const isHit = (it: VenueItemRow) =>
    hl.length > 0 && hl.every((t) => norm(`${it.name} ${it.dim || ""}`).includes(t));

  const rename = async () => {
    if (renameCancelledRef.current) { renameCancelledRef.current = false; return; }
    const n = name.trim();
    if (!n || n === venue.name) { setRenaming(false); setName(venue.name); return; }
    if (renameBusyRef.current) return;
    renameBusyRef.current = true;
    try { await api.updateVenue(venue.id, { name: n }); toast("Đã đổi tên rạp", "success"); setRenaming(false); onChanged(); }
    catch (ex) { toast(errMsg(ex, "Đổi tên thất bại"), "error"); }
    finally { renameBusyRef.current = false; }
  };
  const setTags = async (next: string[]) => {
    try { await api.updateVenue(venue.id, { tags: next }); onChanged(); return true; }
    catch (ex) { toast(errMsg(ex, "Lưu từ khóa thất bại"), "error"); return false; }
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
        <button type="button" className="btn btn-sm vn-back" onClick={onBack}>‹ Danh sách</button>
        {renaming ? (
          <input className="vn-rename" autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => void rename()} onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
              if (e.key === "Escape") { e.preventDefault(); renameCancelledRef.current = true; setRenaming(false); setName(venue.name); }
            }} />
        ) : (
          <h2 className="vn-rtitle" onDoubleClick={() => { if (canManage) { renameCancelledRef.current = false; setRenaming(true); } }} title={canManage ? "Bấm đúp để đổi tên" : undefined}>{venue.name}</h2>
        )}
        {canManage && !renaming && (
          <span className="vn-racts">
            <button type="button" className="btn btn-sm" onClick={() => { renameCancelledRef.current = false; setRenaming(true); }}>Đổi tên</button>
            {venues.length > 1 && <button type="button" className="btn btn-sm" onClick={() => setMerging(true)} title="Dồn hạng mục sang rạp khác rồi xoá rạp này">Gộp</button>}
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void delVenue()}>Xoá rạp</button>
          </span>
        )}
      </div>

      <TagRow tags={venue.tags ?? []} all={venues.flatMap((v) => v.tags ?? [])} canManage={canManage} onChange={setTags} />

      {items.length === 0 ? (
        <p className="muted vn-hint">Rạp này chưa có hạng mục. Nhập dòng đầu tiên ở dưới — ví dụ “Quầy vé lớn”.</p>
      ) : (
        <table className="vn-items">
          <thead>
            <tr>
              <th scope="col">Hạng mục</th>
              <th scope="col">Đơn vị</th>
              {canManage && <th scope="col" aria-label="Thao tác" />}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className={`${isHit(it) ? "hit" : ""}${it.active ? "" : " off"}`}>
                <td><b className="vn-item-name">{it.name}</b>{!it.active && <span className="muted"> (tắt)</span>}
                  {it.note && <div className="vn-note">{it.note}</div>}</td>
                <td>{it.unit || <span className="muted">—</span>}</td>
                {canManage && (
                  <td className="vn-iacts">
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(it)}>Sửa</button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void delItem(it)}>Xoá</button>
                  </td>
                )}
              </tr>
            ))}
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
  tags: string[]; all: string[]; canManage: boolean; onChange: (t: string[]) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [shownTags, setShownTags] = useState(tags);
  const [saving, setSaving] = useState(false);
  const commitBusyRef = useRef(false);
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setShownTags(tags); }, [tags]);
  const others = [...new Set(all)].filter((t) => !shownTags.includes(t)).slice(0, 8);
  const apply = async (next: string[]) => {
    if (commitBusyRef.current) return false;
    commitBusyRef.current = true; setSaving(true);
    try {
      const ok = await onChange(next);
      if (ok) setShownTags(next);
      return ok;
    } finally {
      commitBusyRef.current = false; setSaving(false);
    }
  };
  const add = async (t: string) => {
    if (cancelledRef.current) { cancelledRef.current = false; return; }
    const v = t.trim();
    if (!v || shownTags.includes(v)) { setDraft(""); setAdding(false); return; }
    if (await apply([...shownTags, v])) { setDraft(""); setAdding(false); }
    else requestAnimationFrame(() => inputRef.current?.focus());
  };
  const remove = async (t: string) => { await apply(shownTags.filter((x) => x !== t)); };
  if (!canManage && !shownTags.length) return null;
  return (
    <div className="vn-tagrow">
      <span className="muted">Từ khóa:</span>
      {shownTags.map((t) => (
        <span className="vn-tag on" key={t}>{t}
          {canManage && <button type="button" onClick={() => void remove(t)} disabled={saving} aria-label={`Bỏ ${t}`}>✕</button>}
        </span>
      ))}
      {canManage && (adding ? (
        <input ref={inputRef} className="vn-taginput" autoFocus value={draft} list="vn-tag-sug" placeholder="tên nhóm…" disabled={saving}
          onChange={(e) => setDraft(e.target.value)} onBlur={() => void add(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === "Escape") { e.preventDefault(); cancelledRef.current = true; setDraft(""); setAdding(false); }
          }} />
      ) : (
        <button type="button" className="vn-tag add" onClick={() => { cancelledRef.current = false; setAdding(true); }}>+ từ khóa</button>
      ))}
      <datalist id="vn-tag-sug">{others.map((t) => <option key={t} value={t} />)}</datalist>
      {!shownTags.length && canManage && <span className="muted vn-taghint">— đặt tên nhóm (vd “hcm”) để lọc nhanh ở cột trái</span>}
    </div>
  );
}

// ── Hàng thêm hạng mục nằm SẴN cuối bảng. Dán nhiều dòng = thêm nhiều hạng mục ──
function AddItemRow({ venueId, onAdded }: { venueId: number; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("m2");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const nameRef = useRef<HTMLTextAreaElement>(null);

  const add = async () => {
    if (busyRef.current) return;
    if (!name.trim()) { nameRef.current?.focus(); return; }
    busyRef.current = true; setBusy(true);
    try {
      await api.createVenueItem(venueId, { name: name.trim(), unit: unit.trim() || null });
      setName("");                         // giữ Đơn vị để nhập dòng tiếp như Excel
      onAdded();
    } catch (ex) { toast(errMsg(ex, "Thêm thất bại"), "error"); }
    finally {
      busyRef.current = false; setBusy(false);
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  };

  // Dán nhiều dòng từ Excel/sheet → lấy ô đầu tiên của mỗi hàng làm tên hạng mục.
  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const structured = text.includes("\t") || /Dimension\s*:/i.test(text) || /\((?=[^)]*\d[^)]*[x×][^)]*\d)/i.test(text);
    if (lines.length === 1 && structured) {
      e.preventDefault();
      const row = parseQuickItemLine(lines[0], unit);
      setName(row.name); setUnit(row.unit);
      return;
    }
    if (lines.length < 2) return;                   // văn bản thường 1 dòng → dán vào ô như cũ
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    let ok = 0;
    let valid = 0;
    let stoppedError = "";
    const seen = new Set<string>();
    try {
      for (const line of lines) {
        const row = parseQuickItemLine(line, unit);
        if (!row.name) continue;
        const key = `${normItemText(row.name)} ${normItemUnit(row.unit)}`;
        if (seen.has(key)) continue;
        seen.add(key); valid++;
        try {
          await api.createVenueItem(venueId, { name: row.name, unit: row.unit || null });
          ok++;
        } catch (ex) {
          if (ex instanceof ApiError && ex.status === 409) continue;
          stoppedError = errMsg(ex, "Lỗi không xác định");
          break;
        }
      }
    } finally {
      busyRef.current = false; setBusy(false); setName("");
      requestAnimationFrame(() => nameRef.current?.focus());
    }
    if (stoppedError) {
      toast(`Đã thêm ${ok}/${valid} hạng mục. Dừng vì: ${stoppedError}`, "error");
      if (ok) onAdded();
    } else if (ok) {
      toast(ok === valid ? `Đã thêm ${ok} hạng mục` : `Đã thêm ${ok}/${valid} hạng mục, các dòng còn lại đã tồn tại`, "success");
      onAdded();
    } else if (valid) toast("Các hạng mục này đã tồn tại hoặc không thể thêm", "error");
  };

  return (
    <div className="vn-additem">
      <textarea ref={nameRef} rows={2} value={name} onChange={(e) => setName(e.target.value)} onPaste={(e) => void onPaste(e)} disabled={busy}
        placeholder="Tên hạng mục (vd: Quầy vé lớn)" className="vn-ai-name" aria-label="Tên hạng mục"
        aria-keyshortcuts="Enter Shift+Enter Alt+Enter" onKeyDown={(e) => {
          if (dangGoIME(e)) return;   // nhịp của bộ gõ — xem web/src/lib/gridShared.ts
          if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          if (e.altKey || e.shiftKey) {
            const el = e.currentTarget;
            const start = el.selectionStart;
            const end = el.selectionEnd;
            setName(el.value.slice(0, start) + "\n" + el.value.slice(end));
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 1; });
          } else void add();
        }} />
      <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Đơn vị" className="vn-ai-unit" aria-label="Đơn vị" list="vn-units" disabled={busy} />
      <datalist id="vn-units"><option value="m2" /><option value="bộ" /><option value="cái" /><option value="ghế" /><option value="tấm" /></datalist>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => void add()} disabled={busy}>{busy ? "…" : "Thêm"}</button>
      <div className="vn-ai-hint muted"><b>Shift + Enter</b> hoặc <b>Alt/Option + Enter</b> = xuống dòng · <b>Enter</b> = lưu hàng.</div>
    </div>
  );
}

// ── Sửa 1 hạng mục (chỉ mở khi bấm Sửa) ─────────────────────────────────────
function ItemModal({ rec, onClose, onSaved }: { rec: VenueItemRow; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(rec.name);
  const [note, setNote] = useState(rec.note ?? "");
  const [active, setActive] = useState(rec.active);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const backdropDownRef = useRef(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (savingRef.current) return;
    if (!name.trim()) { setErr("Chưa có tên hạng mục"); return; }
    savingRef.current = true; setErr(""); setSaving(true);
    try {
      await api.updateVenueItem(rec.id, { name: name.trim(), note: note.trim() || null, active });
      toast("Đã lưu", "success"); onSaved();
    } catch (ex) { setErr(errMsg(ex, "Lưu thất bại")); savingRef.current = false; setSaving(false); }
  };

  return (
    <div className="modal-backdrop"
      onPointerDown={(e) => { backdropDownRef.current = e.target === e.currentTarget; }}
      onPointerUp={(e) => {
        const close = backdropDownRef.current && e.target === e.currentTarget;
        backdropDownRef.current = false;
        if (close) onClose();
      }}
      onPointerCancel={() => { backdropDownRef.current = false; }}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Sửa hạng mục">
        <div className="modal-head"><h3>Sửa hạng mục</h3><button type="button" className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          {err && <div className="err">⚠ {err}</div>}
          <div className="grid">
            <label className="full"><span>Tên hạng mục</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="full"><span>Ghi chú <em className="unit">(điền sẵn vào cột Ghi chú của báo giá)</em></span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="vd: PP in KTS" /></label>
            <label className="full" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: "auto" }} />
              <span>Đang dùng <em className="unit">(bỏ tick = ẩn khỏi gợi ý)</em></span></label>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>Huỷ</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</button>
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
  const busyRef = useRef(false);
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
    if (intoId == null || busyRef.current) return;
    busyRef.current = true;
    const into = venues.find((v) => v.id === intoId);
    if (!(await confirmModal("Gộp rạp", `Dồn ${n} hạng mục của "${venue.name}" sang "${into?.name}" rồi xoá "${venue.name}"?`, { danger: true, confirmText: "Gộp" }))) { busyRef.current = false; return; }
    setBusy(true);
    try {
      const r = await api.mergeVenue(venue.id, intoId);
      const merged = r.removedDuplicates ? `, hợp nhất ${r.removedDuplicates} dòng trùng` : "";
      toast(`Đã chuyển ${r.movedItems} hạng mục sang "${r.into.name}"${merged}`, "success"); onDone();
    }
    catch (ex) { toast(errMsg(ex, "Gộp thất bại"), "error"); busyRef.current = false; setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-label="Gộp rạp" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Gộp “{venue.name}” vào rạp khác</h3><button type="button" className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
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
          <button type="button" className="btn" onClick={onClose}>Huỷ</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || intoId == null}>{busy ? "Đang gộp…" : "Gộp"}</button>
        </div>
      </div>
    </div>
  );
}
