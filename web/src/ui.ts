// Toast + confirm modal (DOM-based) — thay confirm()/alert() trình duyệt cho đồng bộ + đẹp.
import { ApiError } from "./api";

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

export function confirmModal(
  title: string,
  message: string,
  opts: { danger?: boolean; confirmText?: string } = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = `<div class="modal modal-sm" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3></div>
      <div class="modal-body"><p style="margin:0">${esc(message)}</p></div>
      <div class="modal-foot">
        <button class="btn" data-no>Hủy</button>
        <button class="btn ${opts.danger ? "btn-danger" : "btn-primary"}" data-yes>${esc(opts.confirmText ?? "Đồng ý")}</button>
      </div></div>`;
    const cleanup = () => { back.remove(); document.removeEventListener("keydown", onKey); };
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
    (back.querySelector("[data-yes]") as HTMLElement | null)?.focus();
  });
}
