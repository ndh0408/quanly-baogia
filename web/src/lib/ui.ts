// Toast + confirm modal (DOM-based) — thay confirm()/alert() trình duyệt cho đồng bộ + đẹp.
import { useEffect, useState } from "react";
import { ApiError } from "./api";

/* Hook đóng modal bằng ESC — trước đây mỗi modal tự copy addEventListener (Profile/Users/Customers…). */
export function useEscClose(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, enabled]);
}

/* Hook mobile (breakpoint 820 khớp CSS) — trước đây copy-paste ở 4 trang (Audit/QuoteList/Personnel/Employees). */
export function useIsMobile(bp = 820) {
  const [mobile, setMobile] = useState(() => window.matchMedia(`(max-width: ${bp}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const on = () => setMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [bp]);
  return mobile;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// Ngày → 'YYYY-MM-DD' THEO GIỜ ĐỊA PHƯƠNG. Trước đây dùng toISOString() (UTC) làm lệch -1
// ngày cho người dùng giờ VN (UTC+7) với mốc gần nửa đêm — đây là sửa bug timezone.
export function toLocalInputDate(v: unknown): string {
  if (!v) return "";
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Lỗi validation từ server ({ error, details:[{path,message}] }) → map field→message để
// gắn lỗi INLINE vào từng ô thay vì chỉ 1 dòng lỗi tổng.
export function fieldErrorsFrom(ex: unknown): Record<string, string> {
  const body = ex instanceof ApiError ? ex.body : null;
  const out: Record<string, string> = {};
  const details = body && typeof body === "object" && "details" in body
    ? (body as { details?: Array<{ path?: string; message?: string }> }).details : null;
  if (Array.isArray(details)) for (const d of details) {
    const top = String(d.path || "").split(".")[0];
    if (top && d.message) out[top] = d.message;
  }
  return out;
}

export function toast(message: string, type: "success" | "error" | "info" = "info") {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.setAttribute("aria-atomic", "false");
    document.body.appendChild(host);
  }
  // aria-live so screen readers announce toasts (errors = assertive). Trước đây React
  // hoàn toàn câm với screen reader — đây là sửa a11y.
  host.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  // GỘP thông báo TRÙNG: bấm liên tục cùng một nút (vd "Khách duyệt" khi chưa đủ điều kiện) trước
  // đây xếp chồng 5-6 hộp giống hệt che kín màn hình. Đã có hộp y hệt đang hiện → chỉ gia hạn nó.
  for (const old of Array.from(host.children) as HTMLElement[]) {
    if (old.classList.contains("out")) continue;
    if (old.querySelector(".toast-msg")?.textContent === message) {
      // Đặt lại đồng hồ tự tắt: mouseenter HUỶ hẹn cũ rồi mouseleave hẹn lại. Chỉ bắn mouseleave
      // là đẻ thêm hẹn giờ thứ hai mà hẹn cũ vẫn chạy → hộp biến mất sớm.
      old.dispatchEvent(new Event("mouseenter"));
      old.dispatchEvent(new Event("mouseleave"));
      return;
    }
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  const span = document.createElement("span");
  span.className = "toast-msg";
  span.textContent = message;
  const x = document.createElement("button");
  x.type = "button";
  x.className = "toast-x";
  x.setAttribute("aria-label", "Đóng thông báo");
  x.textContent = "×";
  el.append(span, x);
  host.appendChild(el);
  // Lỗi giữ lâu hơn (cần đọc/hành động); hover tạm dừng; × đóng ngay.
  const ttl = type === "error" ? 6000 : 3200;
  let timer = 0;
  const dismiss = () => { el.classList.add("out"); window.setTimeout(() => el.remove(), 250); };
  const arm = () => { timer = window.setTimeout(dismiss, ttl); };
  const disarm = () => { if (timer) { window.clearTimeout(timer); timer = 0; } };
  x.addEventListener("click", () => { disarm(); dismiss(); });
  el.addEventListener("mouseenter", disarm);
  el.addEventListener("mouseleave", arm);
  arm();
}

/**
 * Giam bàn phím trong hộp thoại + trả tiêu điểm về chỗ cũ khi đóng.
 *
 * `role="dialog" aria-modal="true"` chỉ NÓI với trình đọc màn hình rằng đây là hộp thoại; nó KHÔNG
 * giữ tiêu điểm lại. Trước đây nhấn Tab vài lần là con trỏ chui ra sau lớp phủ, người dùng bàn phím
 * (và trình đọc màn hình) lạc vào phần trang bị che mà không biết đường quay lại. Đóng xong tiêu
 * điểm cũng rơi về <body> thay vì nút vừa bấm.
 */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const DIALOG_SEL = '[role="dialog"][aria-modal="true"]';

/**
 * GIAM TIÊU ĐIỂM TOÀN CỤC cho MỌI hộp thoại `role="dialog" aria-modal="true"` — 19 modal React + bất kỳ
 * modal nào thêm sau này — mà không phải sửa từng file. Gọi MỘT lần ở main.tsx.
 *
 * `trapFocus` bên dưới chỉ được nối vào 2 modal dựng bằng DOM (confirmModal/promptModal); 19 modal
 * JSX không có lớp này: Tab quá nút cuối là tiêu điểm chui ra sidebar/bảng phía sau lớp phủ, và đóng
 * xong tiêu điểm rơi về <body>. Nặng nhất là SessionLostOverlay (cố ý không có nút đóng — Tab từ ô
 * mật khẩu đi thẳng vào app phía sau, nơi mọi thao tác 401), ThietLapMfa (đang hiện mã dự phòng) và
 * RecordForm nhân sự (CCCD/STK). Phát hiện qua ultracode audit 2026-09-07.
 *
 * Cách làm: một listener Tab (capture) trên document, luôn nhắm vào hộp thoại MỞ SAU CÙNG trong DOM;
 * cộng một MutationObserver ghi nhớ phần tử đang có tiêu điểm lúc hộp thoại xuất hiện và trả lại khi
 * hộp thoại bị gỡ. Hộp thoại DOM tự giam (data-focus-trap="own") thì bỏ qua để không xử lý hai lần.
 */
export function installGlobalFocusTrap() {
  const hopTrenCung = (): HTMLElement | null => {
    const all = document.querySelectorAll<HTMLElement>(DIALOG_SEL);
    return all.length ? all[all.length - 1] : null;
  };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const box = hopTrenCung();
    if (!box || box.dataset.focusTrap === "own") return;
    const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || !box.contains(cur))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (cur === last || !box.contains(cur))) { e.preventDefault(); first.focus(); }
  }, true);

  const truocKhiMo = new WeakMap<Element, HTMLElement>();
  const timHop = (n: Node): HTMLElement | null =>
    n instanceof HTMLElement ? (n.matches(DIALOG_SEL) ? n : n.querySelector<HTMLElement>(DIALOG_SEL)) : null;
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        const d = timHop(n);
        if (!d || d.dataset.focusTrap === "own" || truocKhiMo.has(d)) continue;
        const a = document.activeElement as HTMLElement | null;
        // Chỉ nhớ phần tử NGOÀI hộp: React có thể đã autoFocus vào ô nhập bên trong trước khi observer chạy.
        if (a && a !== document.body && !d.contains(a)) truocKhiMo.set(d, a);
      }
      for (const n of m.removedNodes) {
        const d = timHop(n);
        const a = d ? truocKhiMo.get(d) : undefined;
        if (d && a) { truocKhiMo.delete(d); if (document.contains(a)) a.focus(); }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function trapFocus(box: HTMLElement) {
  const previous = document.activeElement as HTMLElement | null;
  const onTab = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    // Ra khỏi hộp (kể cả khi tiêu điểm đang ở ngoài) → kéo về đầu/cuối danh sách trong hộp.
    if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) {
      e.preventDefault(); first.focus();
    }
  };
  document.addEventListener("keydown", onTab, true);
  return () => {
    document.removeEventListener("keydown", onTab, true);
    // Nút gọi hộp thoại có thể đã biến mất (vd xoá dòng) → chỉ trả tiêu điểm nếu còn trong tài liệu.
    if (previous && document.contains(previous)) previous.focus();
  };
}

export function confirmModal(
  title: string,
  message: string,
  opts: { danger?: boolean; confirmText?: string } = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = `<div class="modal modal-sm" role="dialog" aria-modal="true" data-focus-trap="own" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3></div>
      <div class="modal-body"><p style="margin:0">${esc(message)}</p></div>
      <div class="modal-foot">
        <button class="btn" data-no>Hủy</button>
        <button class="btn ${opts.danger ? "btn-danger" : "btn-primary"}" data-yes>${esc(opts.confirmText ?? "Đồng ý")}</button>
      </div></div>`;
    let releaseFocus = () => {};
    const cleanup = () => { releaseFocus(); back.remove(); document.removeEventListener("keydown", onKey); };
    const done = (v: boolean) => { cleanup(); resolve(v); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter") done(true);
    };
    back.addEventListener("click", (e) => { if (e.target === back) done(false); });
    back.querySelector("[data-no]")?.addEventListener("click", () => done(false));
    back.querySelector("[data-yes]")?.addEventListener("click", () => done(true));
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    releaseFocus = trapFocus(back);
    (back.querySelector("[data-yes]") as HTMLElement | null)?.focus();
  });
}

// Hỏi 1 dòng văn bản (vd lý do "không chốt"). resolve(null) khi hủy.
export function promptModal(
  title: string,
  message: string,
  opts: { placeholder?: string; confirmText?: string } = {}
): Promise<string | null> {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = `<div class="modal modal-sm" role="dialog" aria-modal="true" data-focus-trap="own" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3></div>
      <div class="modal-body"><p style="margin:0 0 8px">${esc(message)}</p>
        <textarea class="pm-input" rows="2" placeholder="${esc(opts.placeholder ?? "")}" style="width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border,#ccc);border-radius:6px;font:inherit;resize:vertical"></textarea></div>
      <div class="modal-foot"><button class="btn" data-no>Hủy</button><button class="btn btn-primary" data-yes>${esc(opts.confirmText ?? "Xác nhận")}</button></div></div>`;
    const input = back.querySelector(".pm-input") as HTMLTextAreaElement;
    let releaseFocus = () => {};
    const cleanup = () => { releaseFocus(); back.remove(); document.removeEventListener("keydown", onKey); };
    const done = (v: string | null) => { cleanup(); resolve(v); };
    // Ctrl/⌘+Enter gửi (Enter trần phải để xuống dòng vì ô là textarea) — khớp thói quen soạn thảo.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(null);
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(input.value.trim()); }
    };
    back.addEventListener("click", (e) => { if (e.target === back) done(null); });
    back.querySelector("[data-no]")?.addEventListener("click", () => done(null));
    back.querySelector("[data-yes]")?.addEventListener("click", () => done(input.value.trim()));
    document.addEventListener("keydown", onKey);
    document.body.appendChild(back);
    releaseFocus = trapFocus(back);
    input.focus();
  });
}

// ============================================================================
// HỘP CHỐT BÁO GIÁ — hiện TỪNG TRANG theo ý kiến khách, cho sửa ngay tại chỗ.
//
// ── VÌ SAO CẦN MỘT HỘP RIÊNG, KHÔNG DÙNG confirmModal ─────────────────────
// "Khách chốt" là thao tác TERMINAL (server trả 400 nếu bấm lại) và áp cho CẢ báo giá. Ngay phía
// trên lưới lại có cặp nút gần giống hệt — "✓ Khách duyệt / ✗ Không duyệt" — nhưng chỉ áp cho MỘT
// trang. Hai cặp cùng bắt đầu bằng "Khách", cùng ✓ xanh / ✗ đỏ, cách nhau một màn hình cuộn.
//
// Và cho tới 2026-09-17, bấm "Khách chốt" khi có trang khách đã TỪ CHỐI thì hệ thống vẫn chốt
// bình thường, ghi nhận doanh thu bằng TỔNG CẢ MỌI TRANG — kể cả phần khách không duyệt.
//
// Hộp này làm ba việc mà một hộp xác nhận một dòng không làm được:
//   1. bày ra TỪNG trang theo ba nhóm (đã duyệt · chưa có ý kiến · khách KHÔNG duyệt);
//   2. cho duyệt hết nhóm "chưa có ý kiến", và cho ĐỒNG Ý LẠI từng trang đang bị từ chối;
//   3. hiện SỐ TIỀN sẽ ghi nhận, cập nhật ngay theo từng lựa chọn — để người bấm thấy hậu quả
//      bằng con số TRƯỚC khi bấm, chứ không phải đọc lại sau.
// ============================================================================

export type TrangChot = {
  id: number;
  ten: string;
  /** Net của trang, ĐÃ trừ giảm giá riêng (khớp `QuoteSheet.subtotal` ở máy chủ). */
  net: number;
  /** null = chưa có ý kiến · "approved" · "rejected" */
  custStatus: string | null;
};

const tienVN = (n: number) => Math.round(n).toLocaleString("vi-VN") + " đ";

/**
 * Trả về danh sách trang cần ĐỔI trạng thái (chỉ những trang người dùng vừa sửa trong hộp), hoặc
 * `null` nếu huỷ. Người gọi chịu trách nhiệm gửi từng thay đổi lên máy chủ TRƯỚC khi chốt.
 *
 * Số tiền hiển thị ở đây chỉ để NGƯỜI ĐỌC quyết định — máy chủ tự tính lại từ `custStatus` thật
 * (xem `markConverted`). Không bao giờ gửi con số này lên.
 */
export function modalChotBaoGia(
  soBaoGia: string,
  trangs: TrangChot[],
  vatPct: number,
): Promise<Array<{ id: number; status: string | null }> | null> {
  return new Promise((resolve) => {
    // Bản nháp trạng thái trong hộp — chỉ áp ra ngoài khi bấm Chốt.
    const nhap = new Map<number, string | null>(trangs.map((t) => [t.id, t.custStatus]));

    const back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" data-focus-trap="own" aria-label="Chốt báo giá">
      <div class="modal-head"><h3>Chốt cả báo giá ${esc(soBaoGia)}</h3></div>
      <div class="modal-body" data-than></div>
      <div class="modal-foot">
        <button class="btn" data-no>Hủy</button>
        <button class="btn btn-success" data-yes></button>
      </div></div>`;

    const than = back.querySelector("[data-than]") as HTMLElement;
    const nutChot = back.querySelector("[data-yes]") as HTMLButtonElement;

    const ve = () => {
      const nhom = (st: string | null) => trangs.filter((t) => (nhap.get(t.id) ?? null) === st);
      const duyet = nhom("approved"), chua = nhom(null), tuChoi = nhom("rejected");
      const net = (ds: TrangChot[]) => ds.reduce((a, t) => a + t.net, 0);
      // VAT tính LẠI trên phần giữ lại — đúng thứ tự Cộng → Discount → VAT của quote-math.
      const giuLai = net(duyet) + net(chua);
      const ghiNhan = giuLai + (giuLai * (Number(vatPct) || 0)) / 100;
      const bo = net(tuChoi);

      const dong = (t: TrangChot, nut: string) =>
        `<li style="display:flex;align-items:center;gap:8px;padding:2px 0">
           <span style="flex:1">${esc(t.ten)}</span>
           <span class="muted" style="font-variant-numeric:tabular-nums">${esc(tienVN(t.net))}</span>
           ${nut}</li>`;

      than.innerHTML = `
        ${duyet.length ? `<p style="margin:0 0 4px"><b>✓ Khách đã duyệt</b> — ${duyet.length} trang</p>
          <ul style="margin:0 0 10px;padding-left:14px;list-style:none">${duyet.map((t) => dong(t, "")).join("")}</ul>` : ""}

        ${chua.length ? `<p style="margin:0 0 4px"><b>○ Chưa có ý kiến</b> — ${chua.length} trang
            <button type="button" class="btn btn-sm" data-duyet-het style="margin-left:6px">✓ Duyệt hết</button></p>
          <ul style="margin:0 0 10px;padding-left:14px;list-style:none">${chua
            .map((t) => dong(t, `<button type="button" class="btn btn-sm" data-dat="${t.id}|approved">✓ Duyệt</button>`))
            .join("")}</ul>
          <p class="muted" style="margin:-6px 0 10px;font-size:12.5px">Trang chưa có ý kiến VẪN được tính — khách chưa từ chối nó.</p>` : ""}

        ${tuChoi.length ? `<p style="margin:0 0 4px"><b style="color:var(--danger,#c00)">✗ Khách KHÔNG duyệt</b> — ${tuChoi.length} trang · ${esc(tienVN(bo))} sẽ KHÔNG được tính</p>
          <ul style="margin:0 0 10px;padding-left:14px;list-style:none">${tuChoi
            .map((t) => dong(t, `<button type="button" class="btn btn-sm" data-dat="${t.id}|approved">✓ Đồng ý lại</button>`))
            .join("")}</ul>` : ""}

        <hr style="margin:10px 0">
        <p style="margin:0"><b>Doanh thu ghi nhận: ${esc(tienVN(ghiNhan))}</b>
          <span class="muted" style="font-size:12.5px"> (đã gồm VAT ${esc(String(vatPct || 0))}%)</span></p>
        ${bo > 0 ? `<p class="muted" style="margin:2px 0 0;font-size:12.5px">Đã trừ ${esc(tienVN(bo))} của ${tuChoi.length} trang khách không duyệt.</p>` : ""}
        <p class="muted" style="margin:8px 0 0;font-size:12.5px">Thao tác này áp cho <b>CẢ báo giá</b> và <b>KHÔNG đảo lại được</b>.</p>`;

      nutChot.textContent = `✓ Chốt — ghi nhận ${tienVN(ghiNhan)}`;

      than.querySelector("[data-duyet-het]")?.addEventListener("click", () => {
        for (const t of chua) nhap.set(t.id, "approved");
        ve();
      });
      for (const b of than.querySelectorAll<HTMLElement>("[data-dat]")) {
        b.addEventListener("click", () => {
          const [id, st] = (b.dataset.dat || "").split("|");
          nhap.set(Number(id), st || null);
          ve();
        });
      }
    };

    let releaseFocus = () => {};
    const cleanup = () => { releaseFocus(); back.remove(); document.removeEventListener("keydown", onKey); };
    const huy = () => { cleanup(); resolve(null); };
    const chot = () => {
      // CHỈ trả về trang THẬT SỰ đổi — gửi lại trạng thái cũ là đẻ ra bản ghi audit rỗng.
      const doi = trangs
        .filter((t) => (nhap.get(t.id) ?? null) !== t.custStatus)
        .map((t) => ({ id: t.id, status: nhap.get(t.id) ?? null }));
      cleanup();
      resolve(doi);
    };
    const onKey = (e: KeyboardEvent) => {
      // KHÔNG chốt bằng Enter: đây là thao tác không đảo lại được, phải bấm đúng nút.
      if (e.key === "Escape") huy();
    };
    back.addEventListener("click", (e) => { if (e.target === back) huy(); });
    back.querySelector("[data-no]")?.addEventListener("click", huy);
    nutChot.addEventListener("click", chot);
    document.addEventListener("keydown", onKey);
    ve();
    document.body.appendChild(back);
    releaseFocus = trapFocus(back);
    (back.querySelector("[data-no]") as HTMLElement | null)?.focus();
  });
}
