import { useEffect, useMemo, useState } from "react";
import { loadCatalog, norm, dimLabel, type VenueCatalog, type VenueEntry } from "../lib/venueCatalog";
import { toast, useEscClose } from "../lib/ui";

// Modal "📐 Chèn từ rạp": chọn rạp → tick hạng mục → chèn hàng loạt vào lưới kèm kích thước.
// Dùng chung class .modal-* của app (không tự chế khung modal).

const REGION_ORDER = ["HCM", "Hà Nội"];   // 2 vùng chính lên đầu, còn lại theo alphabet

type Group = { venue: string; region: string; cats: string[]; items: VenueEntry[] };

function groupByVenue(cat: VenueCatalog): Group[] {
  const map = new Map<string, Group>();
  for (const e of cat.entries) {
    const key = `${e.venue}||${e.region || ""}`;
    let g = map.get(key);
    if (!g) { g = { venue: e.venue, region: e.region || "", cats: [], items: [] }; map.set(key, g); }
    if (e.cat && !g.cats.includes(e.cat)) g.cats.push(e.cat);
    g.items.push(e);
  }
  return [...map.values()].sort((a, b) => {
    const ka = REGION_ORDER.indexOf(a.region), kb = REGION_ORDER.indexOf(b.region);
    const ra = ka < 0 ? 99 : ka, rb = kb < 0 ? 99 : kb;
    if (ra !== rb) return ra - rb;
    if (a.region !== b.region) return a.region.localeCompare(b.region, "vi");
    return a.venue.localeCompare(b.venue, "vi");
  });
}

export function VenuePicker({ onInsert, onClose }: { onInsert: (list: VenueEntry[]) => void; onClose: () => void }) {
  const [cat, setCat] = useState<VenueCatalog | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  useEscClose(onClose);

  useEffect(() => {
    let alive = true;
    loadCatalog().then((c) => { if (alive) setCat(c); }).catch(() => { if (alive) setErr("Chưa tải được danh mục kích thước (/data/venue-catalog.json)"); });
    return () => { alive = false; };
  }, []);

  const groups = useMemo(() => (cat ? groupByVenue(cat) : []), [cat]);
  const rows = useMemo(() => {
    const nq = norm(q);
    return nq ? groups.filter((g) => norm(`${g.venue} ${g.region}`).includes(nq)) : groups;
  }, [groups, q]);

  const openGroup = (g: Group) => { setGroup(g); setPicked(new Set(g.items.map((_, i) => i))); };   // mặc định tick hết
  const toggle = (i: number) => setPicked((prev) => { const s = new Set(prev); if (s.has(i)) s.delete(i); else s.add(i); return s; });
  const toggleAll = () => setPicked((prev) => (prev.size ? new Set<number>() : new Set((group?.items || []).map((_, i) => i))));

  const submit = () => {
    if (!group) { toast("Chọn một rạp trước đã nhé", "info"); return; }
    const list = group.items.filter((_, i) => picked.has(i));
    if (!list.length) { toast("Chưa tick hạng mục nào", "info"); return; }
    onInsert(list);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Chèn hạng mục theo rạp" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>📐 Chèn hạng mục theo rạp</h3>
          <button className="x" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          {err && <div className="muted">{err}</div>}
          {!cat && !err && <div className="muted">Đang tải danh mục…</div>}
          {cat && !group && (
            <>
              <input className="vs-pick-search" autoFocus placeholder="Gõ tên rạp để tìm… (vd: aeon tan phu, lotte 7, landmark)"
                value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && rows.length === 1) { e.preventDefault(); openGroup(rows[0]); } }} />
              <div className="vs-pick-body">
                {rows.length === 0 && <div className="vs-empty muted">Không thấy rạp nào khớp “{q}”</div>}
                {rows.map((g) => (
                  <div className="vs-venue-row" key={`${g.venue}||${g.region}`} onClick={() => openGroup(g)}>
                    <div><b>{g.venue}</b>{g.region && <span className="muted"> — {g.region}</span>}</div>
                    <div className="vs-venue-meta">{g.items.length} hạng mục · {g.cats.join(", ")}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {cat && group && (
            <div className="vs-pick-body">
              <div className="vs-pick-head">
                <button type="button" className="btn-link" onClick={() => setGroup(null)}>‹ Chọn rạp khác</button>
                <b>{group.venue}</b>
                <button type="button" className="btn-link" onClick={toggleAll}>{picked.size ? "Bỏ chọn tất cả" : "Chọn tất cả"}</button>
              </div>
              {group.items.map((e, i) => (
                <label className="vs-item-row" key={i}>
                  <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                  <span>
                    <b>{e.name}</b>{e.cat && <span className="muted"> ({e.cat})</span>}<br />
                    <span className="vs-line2">{dimLabel(e) || "— chưa có kích thước —"}{e.note ? ` · ${e.note}` : ""}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="muted vs-pick-note">
            Chọn rạp → tick hạng mục cần báo giá → bấm <b>Chèn vào báo giá</b>. Kích thước + ĐVT + SL (m²) tự điền, bạn chỉ cần gõ đơn giá.
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={submit} disabled={!group}>Chèn vào báo giá</button>
        </div>
      </div>
    </div>
  );
}
