// venueSuggest.js — GỢI Ý KÍCH THƯỚC THEO RẠP cho editor báo giá.
// Nguồn GET /api/venues/catalog — quản lý ở trang "Danh mục rạp" (quầy vé/quầy bắp,
// cover màn hình, bục soát vé, bọc ghế…). Editor gọi 4 hook: vsUpdate (đang gõ ô Hạng Mục),
// vsSteer (phím điều hướng khi dropdown mở), vsClose (rời ô), openVenuePicker (nút
// "📐 Chèn từ rạp"). Mọi ghi vào items do editor làm qua callback — module này KHÔNG
// import editor (giữ đồ thị phụ thuộc một chiều quanh app.js).
import { escapeHtml, qtyRound } from "./util.js?v=20260630l";
import { toast, openModal } from "./ui.js?v=20260624b";

let CAT = null;          // catalog sau khi fetch: {entries:[...], venues:[...]}
let catPromise = null;   // fetch đúng 1 lần / phiên
// So khớp KHÔNG DẤU: "quay bap aeon" khớp "Quầy bắp — CGV Aeon Tân Phú".
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");

function loadCatalog() {
  if (CAT) return Promise.resolve(CAT);
  if (!catPromise) {
    catPromise = fetch("/api/venues/catalog", { credentials: "same-origin" })
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((j) => {
        // Gộp cả TỪ KHÓA vào chuỗi so khớp → gõ "hcm quay bap" ra đúng nhóm, không chỉ tên rạp.
        (j.entries || []).forEach((e) => { e._hay = norm(`${e.venue} ${e.name} ${e.region || ""} ${e.cat || ""} ${(e.tags || []).join(" ")}`); });
        CAT = j;
        return CAT;
      })
      .catch((err) => { catPromise = null; throw err; });
  }
  return catPromise;
}

// Mọi token của query đều phải xuất hiện (không dấu). Xếp hạng: khớp tên rạp > khớp tên
// hạng mục > khớp rải rác — để gõ "aeon tan phu" là rạp đó nổi lên đầu.
function search(cat, q, limit) {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const scored = [];
  for (const e of cat.entries) {
    let ok = true;
    for (const t of toks) if (!e._hay.includes(t)) { ok = false; break; }
    if (!ok) continue;
    const nv = norm(e.venue), nn = norm(e.name);
    let score = 0;
    for (const t of toks) { if (nv.includes(t)) score += 3; if (nn.includes(t)) score += 2; }
    if (nv.startsWith(toks[0]) || nn.startsWith(toks[0])) score += 2;
    scored.push([score, e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit || 8).map((x) => x[1]);
}

// ---------- Dropdown gợi ý dưới ô Hạng Mục ----------
let VS = null;    // {input, items, idx, onPick} — idx -1 = chưa chọn dòng nào (Enter không bị "ăn")
let vsEl = null;

function ensureVsEl() {
  if (vsEl && document.body.contains(vsEl)) return vsEl;
  let d = document.querySelector(".vs-auto");   // tái dùng qua các lần mở editor (không leak)
  if (!d) { d = document.createElement("div"); d.className = "vs-auto hidden"; document.body.appendChild(d); }
  vsEl = d;
  return d;
}

export function vsClose() {
  VS = null;
  if (vsEl) vsEl.classList.add("hidden");
}

function dimLabel(e) {
  const bits = [];
  if (e.dim) bits.push(e.dim);
  if (e.unit) bits.push(e.unit);
  // qtyRound = ĐÚNG con số sẽ điền vào ô Số Lượng (1 chữ số thập phân) — khỏi lệch với gợi ý.
  if (e.unit === "m2" && e.w > 0 && e.h > 0) bits.push(`≈ ${String(qtyRound(e.w * e.h)).replace(".", ",")} m²`);
  else if (e.qty > 0) bits.push(`SL ${e.qty}`);
  return bits.join(" · ");
}

function renderVs() {
  if (!VS) return;
  const el = ensureVsEl();
  el.innerHTML = VS.items.map((e, k) => `
    <div class="vs-item${k === VS.idx ? " active" : ""}" data-k="${k}">
      <div class="vs-line1">${escapeHtml(e.name)} <span class="vs-venue">· ${escapeHtml(e.venue)}</span></div>
      <div class="vs-line2">${escapeHtml(dimLabel(e))}${e.cat ? ` <span class="vs-cat">— ${escapeHtml(e.cat)}</span>` : ""}</div>
    </div>`).join("") +
    `<div class="vs-hint">↑↓ chọn · Tab điền · Esc đóng — hoặc bấm chuột</div>`;
  el.querySelectorAll(".vs-item").forEach((node) => {
    // mousedown (không phải click) để thắng blur của ô đang gõ — giống fx-auto.
    node.addEventListener("mousedown", (ev) => { ev.preventDefault(); vsPick(parseInt(node.dataset.k, 10)); });
  });
  const r = VS.input.getBoundingClientRect();
  el.style.left = Math.min(r.left, Math.max(8, window.innerWidth - 500)) + "px";
  el.style.top = (r.bottom + 2) + "px";
  el.style.minWidth = Math.max(280, r.width) + "px";
  el.classList.remove("hidden");
}

function vsPick(k) {
  if (!VS || !VS.items[k]) return;
  const { onPick } = VS;
  const entry = VS.items[k];
  vsClose();
  onPick(entry);
}

// Gọi mỗi lần gõ vào ô Hạng Mục (không phải công thức "=").
export function vsUpdate(input, onPick) {
  const q = (input.value || "").trim();
  if (q.length < 2) { vsClose(); return; }
  loadCatalog().then((cat) => {
    if (document.activeElement !== input) return;   // đã rời ô trong lúc chờ tải data
    const cur = (input.value || "").trim();
    if (cur.length < 2) { vsClose(); return; }
    const items = search(cat, cur, 8);
    if (!items.length) { vsClose(); return; }
    VS = { input, items, idx: -1, onPick };
    renderVs();
  }).catch(() => vsClose());   // chưa có file data → im lặng, editor chạy bình thường
}

// Trả true nếu phím đã được dropdown xử lý (editor return luôn). Enter CHỈ bị "ăn" khi
// người dùng đã bấm ↑↓ chọn dòng — gõ tên tự do rồi Enter vẫn xuống hàng như cũ.
export function vsSteer(e) {
  if (!VS) return false;
  if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); VS.idx = (VS.idx + 1) % VS.items.length; renderVs(); return true; }
  if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); VS.idx = (VS.idx - 1 + VS.items.length) % VS.items.length; renderVs(); return true; }
  if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); vsPick(VS.idx < 0 ? 0 : VS.idx); return true; }
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); vsClose(); return true; }
  if (e.key === "Enter") {
    if (VS.idx >= 0) { e.preventDefault(); e.stopPropagation(); vsPick(VS.idx); return true; }
    vsClose();   // không chọn gì → Enter đi tiếp cho lưới (commit + xuống hàng)
    return false;
  }
  return false;
}

// ---------- Modal "📐 Chèn từ rạp": chọn rạp → tick hạng mục → chèn hàng loạt ----------
const REGION_ORDER = ["HCM", "Hà Nội"];   // HCM + HN lên đầu, còn lại theo alphabet

export function openVenuePicker(onInsert) {
  loadCatalog().then((cat) => {
    // Gom entries theo rạp (cùng tên + region là một nhóm).
    const groups = new Map();
    for (const e of cat.entries) {
      const key = `${e.venue}||${e.region || ""}`;
      if (!groups.has(key)) groups.set(key, { venue: e.venue, region: e.region || "", cats: new Set(), items: [] });
      const g = groups.get(key);
      g.cats.add(e.cat || "");
      g.items.push(e);
    }
    const venueList = [...groups.values()].sort((a, b) => {
      const ra = REGION_ORDER.indexOf(a.region), rb = REGION_ORDER.indexOf(b.region);
      const ka = ra < 0 ? 99 : ra, kb = rb < 0 ? 99 : rb;
      if (ka !== kb) return ka - kb;
      if (a.region !== b.region) return a.region.localeCompare(b.region, "vi");
      return a.venue.localeCompare(b.venue, "vi");
    });

    const m = openModal("📐 Chèn hạng mục theo rạp", `
      <div class="vs-pick">
        <input type="text" class="vs-pick-search" placeholder="Gõ tên rạp để tìm… (vd: aeon tan phu, lotte 7, landmark)" autocomplete="off" />
        <div class="vs-pick-body"></div>
        <div class="muted vs-pick-note">Chọn rạp → tick hạng mục cần báo giá → bấm <b>Chèn vào báo giá</b>. Kích thước + ĐVT + SL (m²) tự điền, bạn chỉ cần gõ đơn giá.</div>
      </div>`);
    const saveBtn = m.find("[data-save]");
    saveBtn.textContent = "Chèn vào báo giá";
    const body = m.find(".vs-pick-body");
    const searchInp = m.find(".vs-pick-search");
    let curGroup = null;   // null = đang ở danh sách rạp

    const showVenues = () => {
      curGroup = null;
      searchInp.style.display = "";
      const q = norm(searchInp.value || "");
      const rows = venueList.filter((g) => !q || norm(`${g.venue} ${g.region}`).includes(q));
      body.innerHTML = rows.length ? rows.map((g, k) => `
        <div class="vs-venue-row" data-k="${k}">
          <div><b>${escapeHtml(g.venue)}</b>${g.region ? ` <span class="muted">— ${escapeHtml(g.region)}</span>` : ""}</div>
          <div class="vs-venue-meta">${g.items.length} hạng mục · ${escapeHtml([...g.cats].filter(Boolean).join(", "))}</div>
        </div>`).join("")
        : `<div class="vs-empty muted">Không thấy rạp nào khớp "${escapeHtml(searchInp.value)}"</div>`;
      body.querySelectorAll(".vs-venue-row").forEach((node) => {
        node.addEventListener("click", () => showItems(rows[parseInt(node.dataset.k, 10)]));
      });
    };

    const showItems = (g) => {
      curGroup = g;
      searchInp.style.display = "none";
      body.innerHTML = `
        <div class="vs-pick-head">
          <button type="button" class="btn-link vs-back">‹ Chọn rạp khác</button>
          <b>${escapeHtml(g.venue)}</b>
          <button type="button" class="btn-link vs-toggle-all">Bỏ chọn tất cả</button>
        </div>` +
        g.items.map((e, k) => `
        <label class="vs-item-row">
          <input type="checkbox" data-k="${k}" checked />
          <span><b>${escapeHtml(e.name)}</b>${e.cat ? ` <span class="muted">(${escapeHtml(e.cat)})</span>` : ""}<br />
          <span class="vs-line2">${escapeHtml(dimLabel(e) || "— chưa có kích thước —")}${e.note ? ` · ${escapeHtml(e.note)}` : ""}</span></span>
        </label>`).join("");
      body.querySelector(".vs-back").addEventListener("click", showVenues);
      const toggleBtn = body.querySelector(".vs-toggle-all");
      toggleBtn.addEventListener("click", () => {
        const boxes = [...body.querySelectorAll("input[type=checkbox]")];
        const anyChecked = boxes.some((b) => b.checked);
        boxes.forEach((b) => { b.checked = !anyChecked; });
        toggleBtn.textContent = anyChecked ? "Chọn tất cả" : "Bỏ chọn tất cả";
      });
    };

    searchInp.addEventListener("input", () => { if (!curGroup) showVenues(); });
    searchInp.addEventListener("keydown", (e) => {
      // Enter trong ô tìm: đúng 1 rạp khớp → mở luôn rạp đó (đường nhanh cho người gõ phím)
      if (e.key === "Enter" && !curGroup) {
        e.preventDefault();
        const q = norm(searchInp.value || "");
        const rows = venueList.filter((g) => !q || norm(`${g.venue} ${g.region}`).includes(q));
        if (rows.length === 1) showItems(rows[0]);
      }
    });
    m.onSave(() => {
      if (!curGroup) { toast("Chọn một rạp trước đã nhé", "info"); return; }
      const picked = [...body.querySelectorAll("input[type=checkbox]")]
        .filter((b) => b.checked)
        .map((b) => curGroup.items[parseInt(b.dataset.k, 10)]);
      if (!picked.length) { toast("Chưa tick hạng mục nào", "info"); return; }
      m.close();
      onInsert(picked);
    });
    showVenues();
  }).catch(() => toast("Chưa tải được danh mục kích thước — kiểm tra quyền “Xem danh mục rạp”", "error"));
}
