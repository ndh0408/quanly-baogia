// Apply saved/OS theme before first paint to avoid a flash.
// Kept as an EXTERNAL script (not inline) so the CSP script-src can drop
// 'unsafe-inline' — which then blocks any injected inline script/handler.
(function () {
  try {
    var t = localStorage.getItem("theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) { /* ignore */ }
})();
