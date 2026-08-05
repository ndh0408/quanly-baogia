// venueCatalog.ts — DANH MỤC KÍCH THƯỚC THEO RẠP (quản lý ở trang "Danh mục rạp").
// Nguồn: GET /api/venues/catalog (có phân quyền venue:read) — quầy vé/quầy bắp, cover màn hình,
// bục soát vé, bọc ghế, standee/banner, wall/khu chờ… Dùng cho gợi ý khi gõ ô Hạng Mục + modal
// "Chèn từ rạp" trong lưới báo giá. Tải ĐÚNG 1 LẦN mỗi phiên (cache module-level; sửa danh mục
// xong gọi invalidateCatalog() để lần gợi ý sau lấy bản mới).
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
  tags?: string[];
  _hay?: string;   // chuỗi đã bỏ dấu để so khớp nhanh
};
export type VenueCatalog = {
  entries: VenueEntry[];
  venues: { id: number; name: string; region: string; cluster: string | null; code: string | null; tags?: string[] }[];
};

// Bóc Rộng × Cao (ra MÉT) từ chuỗi kích thước NGUYÊN VĂN của sổ tay, để khỏi gõ lại 2 ô:
//   "(2.675W x 1H)m" → 2.675 × 1     · "(1m6W x 1H)m" → 1.6 × 1   (kiểu ghi "1m6" quen tay)
//   "44cmW x 55cmH"  → 0.44 × 0.55   · "(3,79W x 0.91)m" → 3.79 × 0.91  (phẩy = thập phân)
//   "(4.0 x 0.96H)m" thiếu chữ W → lấy nốt nhờ mẫu "số x số".
export function parseDim(dim: string | null | undefined): { w: number | null; h: number | null } {
  if (!dim) return { w: null, h: null };
  const s = String(dim).toLowerCase();
  const toNum = (raw: string, unit?: string): number | null => {
    const t = raw.trim().replace(/,/g, ".");
    const mm = t.match(/^(\d+)m(\d+)$/);          // "1m6" = 1,6 mét
    const n = mm ? Number(`${mm[1]}.${mm[2]}`) : Number(t);
    if (!Number.isFinite(n) || n <= 0) return null;
    // cm → m; làm tròn 4 số lẻ CHỈ để khử nhiễu dấu phẩy động (50.5/100 = 0.505, không phải 0,51).
    return unit === "cm" ? Math.round(n * 100) / 10000 : n;
  };
  const NUM = "\\d+(?:[.,]\\d+)?(?:m\\d+)?";
  const UNIT = "\\s*(cm|m)?\\s*";
  const w = s.match(new RegExp(`(${NUM})${UNIT}w`));
  const h = s.match(new RegExp(`(${NUM})${UNIT}h`));
  let W = w ? toNum(w[1], w[2]) : null;
  let H = h ? toNum(h[1], h[2]) : null;
  // Thiếu chữ W hoặc H thì lấy theo VỊ TRÍ trong cặp "số x số" (số đầu = rộng, số sau = cao).
  if (W == null || H == null) {
    const pair = s.match(new RegExp(`(${NUM})${UNIT}[whd]?\\s*[x×]\\s*(${NUM})${UNIT}[whd]?`));
    if (pair) {
      if (W == null) W = toNum(pair[1], pair[2]);
      if (H == null) H = toNum(pair[3], pair[4]);
    }
  }
  return { w: W, h: H };
}

// So khớp KHÔNG DẤU: gõ "quay bap aeon" vẫn ra "Quầy bắp — CGV Aeon Tân Phú".
export const norm = (s: string) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

let CAT: VenueCatalog | null = null;
let catPromise: Promise<VenueCatalog> | null = null;

export function loadCatalog(): Promise<VenueCatalog> {
  if (CAT) return Promise.resolve(CAT);
  if (!catPromise) {
    catPromise = fetch("/api/venues/catalog", { credentials: "same-origin" })
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json() as Promise<VenueCatalog>; })
      .then((j) => {
        // Gộp cả TỪ KHÓA vào chuỗi so khớp → gõ "hcm quay bap" trong ô Hạng Mục ra đúng nhóm.
        j.entries.forEach((e) => { e._hay = norm(`${e.venue} ${e.name} ${e.region || ""} ${e.cat || ""} ${(e.tags || []).join(" ")}`); });
        CAT = j;
        return j;
      })
      .catch((err) => { catPromise = null; throw err; });
  }
  return catPromise;
}

/** Sau khi sửa danh mục ở trang quản lý → bỏ cache để lần gợi ý kế tiếp lấy bản mới. */
export function invalidateCatalog() { CAT = null; catPromise = null; }

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
// Diện tích hiển thị qua qtyRound (1 chữ số thập phân) — ĐÚNG con số sẽ được điền vào ô Số Lượng,
// không phải giá trị thô 2 chữ số (trước đây gợi ý ghi "≈ 2,68 m²" mà điền 2,7 → nhìn như sai).
export function dimLabel(e: VenueEntry): string {
  const bits: string[] = [];
  if (e.dim) bits.push(e.dim);
  if (e.unit) bits.push(e.unit);
  if (e.unit === "m2" && e.w && e.h) bits.push(`≈ ${String(M.qtyRound(e.w * e.h)).replace(".", ",")} m²`);
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
