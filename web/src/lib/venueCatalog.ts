// venueCatalog.ts — DANH MỤC KÍCH THƯỚC THEO RẠP (bóc từ Google Sheet của công ty).
// Dữ liệu tĩnh /data/venue-catalog.json: quầy vé/quầy bắp, cover màn hình, bục soát vé,
// bọc ghế, standee/banner, wall/khu chờ… Dùng cho gợi ý khi gõ ô Hạng Mục + modal
// "Chèn từ rạp" trong lưới báo giá. Tải ĐÚNG 1 LẦN mỗi phiên (cache module-level).
import * as M from "./quoteMath";

export type VenueEntry = {
  cat: string;
  region: string;
  venue: string;
  name: string;
  dim: string | null;
  w: number | null;
  h: number | null;
  unit: string | null;
  qty: number | null;
  note: string | null;
  _hay?: string;   // chuỗi đã bỏ dấu để so khớp nhanh
};
export type VenueCatalog = {
  entries: VenueEntry[];
  venues: { cluster: string | null; place: string | null; code: string | null; name: string }[];
};

// So khớp KHÔNG DẤU: gõ "quay bap aeon" vẫn ra "Quầy bắp — CGV Aeon Tân Phú".
export const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

let CAT: VenueCatalog | null = null;
let catPromise: Promise<VenueCatalog> | null = null;

export function loadCatalog(): Promise<VenueCatalog> {
  if (CAT) return Promise.resolve(CAT);
  if (!catPromise) {
    catPromise = fetch("/data/venue-catalog.json")
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json() as Promise<VenueCatalog>; })
      .then((j) => {
        j.entries.forEach((e) => { e._hay = norm(`${e.venue} ${e.name} ${e.region || ""} ${e.cat || ""}`); });
        CAT = j;
        return j;
      })
      .catch((err) => { catPromise = null; throw err; });
  }
  return catPromise;
}

// Mọi token phải xuất hiện (AND). Xếp hạng: khớp tên RẠP > khớp tên hạng mục > khớp rải rác,
// cộng điểm nếu khớp từ đầu chuỗi — để gõ "aeon tan phu" thì rạp đó nổi lên trước.
export function searchEntries(cat: VenueCatalog, q: string, limit = 8): VenueEntry[] {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const scored: [number, VenueEntry][] = [];
  for (const e of cat.entries) {
    const hay = e._hay || "";
    let ok = true;
    for (const t of toks) if (!hay.includes(t)) { ok = false; break; }
    if (!ok) continue;
    const nv = norm(e.venue), nn = norm(e.name);
    let score = 0;
    for (const t of toks) { if (nv.includes(t)) score += 3; if (nn.includes(t)) score += 2; }
    if (nv.startsWith(toks[0]) || nn.startsWith(toks[0])) score += 2;
    scored.push([score, e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map((x) => x[1]);
}

// Dòng mô tả phụ dưới tên: kích thước · ĐVT · diện tích (hoặc số lượng).
export function dimLabel(e: VenueEntry): string {
  const bits: string[] = [];
  if (e.dim) bits.push(e.dim);
  if (e.unit) bits.push(e.unit);
  if (e.unit === "m2" && e.w && e.h) bits.push(`≈ ${String(Math.round(e.w * e.h * 100) / 100).replace(".", ",")} m²`);
  else if (e.qty) bits.push(`SL ${e.qty}`);
  return bits.join(" · ");
}

// Điền 1 hạng mục từ danh mục vào 1 dòng lưới (mutate tại chỗ — như mọi thao tác lưới).
// SL tự tính = W×H khi ĐVT là m2 → người dùng chỉ còn gõ Đơn giá.
export function fillItemFromEntry(it: Record<string, unknown>, e: VenueEntry) {
  it.name = e.name + " — " + e.venue + (e.dim ? "\nKT: " + e.dim : "");
  if (e.unit) it.unit = e.unit;
  if (e.unit === "m2" && e.w && e.h) it.quantity = M.qtyRound(e.w * e.h);
  else if (e.qty) it.quantity = e.qty;
  if (e.note && !it.notes) it.notes = e.note;
}
