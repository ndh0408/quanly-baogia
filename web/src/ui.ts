// Toast + confirm modal (DOM-based) — thay confirm()/alert() trình duyệt cho đồng bộ + đẹp.
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export function toast(message: string, type: "success" | "error" | "info" = "info") {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  window.setTimeout(() => {
    el.classList.add("out");
    window.setTimeout(() => el.remove(), 250);
  }, 3200);
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
