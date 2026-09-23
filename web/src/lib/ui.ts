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

/** Esc đã được hộp thoại xử lý → không để listener Esc nào khác (form/modal bên dưới) nhận nữa. */
const chanEsc = (e: KeyboardEvent) => { e.preventDefault(); e.stopImmediatePropagation(); };
/**
 * Chỉ hộp thoại TRÊN CÙNG được xử lý phím. Listener của mọi hộp cùng nằm ở pha capture của window,
 * chạy theo thứ tự ĐĂNG KÝ — tức hộp mở TRƯỚC (nằm dưới) chạy trước. Không có cổng này thì với hai hộp
 * chồng nhau, Esc đóng hộp DƯỚI rồi chanEsc chặn luôn hộp trên. Hộp đã bị gỡ khỏi DOM mà chưa kịp
 * dọn listener cũng không được ăn phím.
 */
const laHopTrenCung = (back: HTMLElement) => {
  if (!back.isConnected) return false;
  const tren = [...document.querySelectorAll('[data-focus-trap="own"]')].pop();
  return !tren || back.contains(tren);
};

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
    const cleanup = () => { releaseFocus(); back.remove(); window.removeEventListener("keydown", onKey, true); };
    const done = (v: boolean) => { cleanup(); resolve(v); };
    // FE-02: Enter trước đây LUÔN = "Đồng ý" bất kể tiêu điểm đang ở đâu — Tab sang "Hủy" rồi Enter
    // vẫn Xoá / Khoá / Đặt lại MFA / "Rời, bỏ thay đổi". Nay Enter kích hoạt ĐÚNG nút đang có tiêu
    // điểm (như mọi nút HTML), tiêu điểm ở chỗ khác thì Enter không làm gì.
    // Esc: nghe ở pha CAPTURE của WINDOW (chạy trước mọi listener ở document) và chặn lan truyền —
    // không thì listener Esc của form bên dưới (đăng ký
    // trước, pha bubble) chạy tiếp và mở lại hộp "Bỏ thay đổi?" mỗi lần Esc, người dùng kẹt vô hạn.
    const onKey = (e: KeyboardEvent) => {
      if (!laHopTrenCung(back)) return;
      if (e.key === "Escape") { chanEsc(e); done(false); }
      else if (e.key === "Enter") {
        const a = document.activeElement as HTMLElement | null;
        if (a?.hasAttribute("data-no")) { e.preventDefault(); done(false); }
        else if (a?.hasAttribute("data-yes")) { e.preventDefault(); done(true); }
      }
    };
    back.addEventListener("click", (e) => { if (e.target === back) done(false); });
    back.querySelector("[data-no]")?.addEventListener("click", () => done(false));
    back.querySelector("[data-yes]")?.addEventListener("click", () => done(true));
    window.addEventListener("keydown", onKey, true);
    document.body.appendChild(back);
    releaseFocus = trapFocus(back);
    // Hành động phá huỷ: tiêu điểm mặc định ở "Hủy" — Enter theo phản xạ không được xoá gì.
    (back.querySelector(opts.danger ? "[data-no]" : "[data-yes]") as HTMLElement | null)?.focus();
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
    const cleanup = () => { releaseFocus(); back.remove(); window.removeEventListener("keydown", onKey, true); };
    const done = (v: string | null) => { cleanup(); resolve(v); };
    // Ctrl/⌘+Enter gửi (Enter trần phải để xuống dòng vì ô là textarea) — khớp thói quen soạn thảo.
    const onKey = (e: KeyboardEvent) => {
      if (!laHopTrenCung(back)) return;
      if (e.key === "Escape") { chanEsc(e); done(null); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(input.value.trim()); }
    };
    back.addEventListener("click", (e) => { if (e.target === back) done(null); });
    back.querySelector("[data-no]")?.addEventListener("click", () => done(null));
    back.querySelector("[data-yes]")?.addEventListener("click", () => done(input.value.trim()));
    window.addEventListener("keydown", onKey, true);
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
      <div class="modal-head"><h3>Chốt cả báo giá ${esc(soBaoGia)} — ${trangs.length} trang</h3></div>
      <div class="modal-body" data-than style="max-height:60vh;overflow:auto"></div>
      <div class="modal-foot">
        <button class="btn" data-no>Hủy</button>
        <button class="btn btn-success" data-yes></button>
      </div></div>`;

    const than = back.querySelector("[data-than]") as HTMLElement;
    const nutChot = back.querySelector("[data-yes]") as HTMLButtonElement;

    const NHAN: Record<string, string> = {
      approved: "✓ đã duyệt",
      rejected: "✗ không duyệt",
      "": "○ chưa có ý kiến",
    };

    const ve = () => {
      // LIỆT KÊ MỌI TRANG theo đúng thứ tự tab, mỗi dòng TỰ NÓI trạng thái của nó. Gom theo nhóm
      // thì trang nào đang ở nhóm nào phải suy ra từ vị trí — mà đây là màn hình quyết định tiền,
      // không nên bắt ai suy luận.
      const chuaYKien = trangs.filter((t) => !(nhap.get(t.id) ?? null));
      const giuLai = trangs
        .filter((t) => (nhap.get(t.id) ?? null) !== "rejected")
        .reduce((a, t) => a + t.net, 0);
      const bo = trangs
        .filter((t) => (nhap.get(t.id) ?? null) === "rejected")
        .reduce((a, t) => a + t.net, 0);
      // VAT tính LẠI trên phần giữ lại — đúng thứ tự Cộng → Discount → VAT của quote-math.
      const ghiNhan = giuLai + (giuLai * (Number(vatPct) || 0)) / 100;

      const dong = (t: TrangChot) => {
        const st = (nhap.get(t.id) ?? null) || "";
        const nut =
          st === "approved"
            ? `<button type="button" class="btn btn-sm" data-dat="${t.id}|rejected">✗ Không duyệt</button>`
            : st === "rejected"
              ? `<button type="button" class="btn btn-sm" data-dat="${t.id}|approved">✓ Đồng ý lại</button>`
              : `<button type="button" class="btn btn-sm" data-dat="${t.id}|approved">✓ Duyệt</button>
                 <button type="button" class="btn btn-sm" data-dat="${t.id}|rejected">✗ Không duyệt</button>`;
        const mau = st === "approved" ? "" : st === "rejected" ? "color:var(--danger,#c00)" : "font-weight:600";
        return `<li style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid var(--line,#eee)">
            <span style="flex:1;${st === "rejected" ? "text-decoration:line-through;opacity:.65" : ""}">${esc(t.ten)}</span>
            <span class="muted" style="font-variant-numeric:tabular-nums;min-width:110px;text-align:right">${esc(tienVN(t.net))}</span>
            <span style="min-width:126px;${mau}">${NHAN[st]}</span>
            <span style="display:flex;gap:4px">${nut}</span>
          </li>`;
      };

      than.innerHTML = `
        <ul style="margin:0 0 10px;padding:0;list-style:none">${trangs.map(dong).join("")}</ul>
        ${chuaYKien.length
          ? `<div style="margin:0 0 10px;padding:8px;border:1px solid var(--warn,#e0a800);border-radius:6px">
               <b>Còn ${chuaYKien.length} trang chưa có ý kiến khách.</b>
               Phải chọn <i>duyệt</i> hay <i>không duyệt</i> cho từng trang thì mới chốt được —
               chốt khi còn trang chưa quyết là ghi nhận một con số chưa ai xác nhận.
               <div style="margin-top:6px">
                 <button type="button" class="btn btn-sm" data-duyet-het>✓ Duyệt hết ${chuaYKien.length} trang còn lại</button>
                 <button type="button" class="btn btn-sm" data-tuchoi-het>✗ Không duyệt hết ${chuaYKien.length} trang còn lại</button>
               </div>
             </div>`
          : ""}
        <hr style="margin:10px 0">
        <p style="margin:0"><b>Doanh thu ghi nhận: ${esc(tienVN(ghiNhan))}</b>
          <span class="muted" style="font-size:12.5px"> (đã gồm VAT ${esc(String(vatPct || 0))}%)</span></p>
        ${bo > 0 ? `<p class="muted" style="margin:2px 0 0;font-size:12.5px">Đã trừ ${esc(tienVN(bo))} của các trang khách không duyệt.</p>` : ""}
        <p class="muted" style="margin:8px 0 0;font-size:12.5px">Thao tác này áp cho <b>CẢ báo giá</b> và <b>KHÔNG đảo lại được</b>.</p>`;

      // CHẶN CHỐT khi còn trang chưa quyết — không chỉ nhắc. Một lời nhắc bỏ qua được thì đúng
      // bằng không có, và hậu quả ở đây là một con số doanh thu chưa ai xác nhận.
      nutChot.disabled = chuaYKien.length > 0;
      nutChot.textContent = chuaYKien.length
        ? `Còn ${chuaYKien.length} trang chưa quyết`
        : `✓ Chốt — ghi nhận ${tienVN(ghiNhan)}`;
      nutChot.title = chuaYKien.length
        ? `Chọn duyệt hoặc không duyệt cho ${chuaYKien.length} trang còn lại rồi mới chốt được.`
        : "";

      than.querySelector("[data-duyet-het]")?.addEventListener("click", () => {
        for (const t of chuaYKien) nhap.set(t.id, "approved");
        ve();
      });
      than.querySelector("[data-tuchoi-het]")?.addEventListener("click", () => {
        for (const t of chuaYKien) nhap.set(t.id, "rejected");
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
    const cleanup = () => { releaseFocus(); back.remove(); window.removeEventListener("keydown", onKey, true); };
    const huy = () => { cleanup(); resolve(null); };
    const chot = () => {
      if (nutChot.disabled) return;
      // CHỈ trả về trang THẬT SỰ đổi — gửi lại trạng thái cũ là đẻ ra bản ghi audit rỗng.
      const doi = trangs
        .filter((t) => (nhap.get(t.id) ?? null) !== t.custStatus)
        .map((t) => ({ id: t.id, status: nhap.get(t.id) ?? null }));
      cleanup();
      resolve(doi);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!laHopTrenCung(back)) return;
      // KHÔNG chốt bằng Enter: đây là thao tác không đảo lại được, phải bấm đúng nút.
      if (e.key === "Escape") { chanEsc(e); huy(); }
    };
    back.addEventListener("click", (e) => { if (e.target === back) huy(); });
    back.querySelector("[data-no]")?.addEventListener("click", huy);
    nutChot.addEventListener("click", chot);
    window.addEventListener("keydown", onKey, true);
    ve();
    document.body.appendChild(back);
    releaseFocus = trapFocus(back);
    (back.querySelector("[data-no]") as HTMLElement | null)?.focus();
  });
}
