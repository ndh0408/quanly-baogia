// Chốt hạ tầng cho script bench (audit 2026-09-22, DEP-11) — xem chú thích ở quote-save-bench.mjs.
// Cùng luật với chốt đầu scripts/verify-local.sh: máy chủ CỤC BỘ và tên CSDL có chữ test/bench.
// Trả về lý do từ chối, hoặc null khi được phép.
export function kiemHaTangBench(url) {
  let u;
  try { u = new URL(url || ""); } catch { return "DATABASE_URL trống hoặc không phải URL"; }
  const may = u.hostname.replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(may)) return `DATABASE_URL trỏ máy ${may}, không phải máy cục bộ`;
  const csdl = decodeURIComponent(u.pathname.slice(1));
  if (!/(test|bench)/i.test(csdl)) return `CSDL "${csdl}" không có chữ test/bench — bench sẽ GHI và XOÁ CỨNG trên đó`;
  return null;
}
