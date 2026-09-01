// Bàn giao draft từ Wizard Tạo-mới sang QuoteEditor (in-memory, KHÔNG lưu tới khi editor bấm Lưu —
// giống SPA: state.currentQuote = {…, _new:true} rồi mở editor).
import type { QuoteFull } from "./api";
let pending: QuoteFull | null = null;
export const setPendingNewQuote = (q: QuoteFull) => { pending = q; };
export const takePendingNewQuote = (): QuoteFull | null => { const q = pending; pending = null; return q; };

/**
 * Lấy bản nháp MỘT LẦN rồi GIỮ trong `hop` — gọi lại trả đúng bản đã lấy.
 *
 * ── VÌ SAO TỒN TẠI ─────────────────────────────────────────────────────────
 * `takePendingNewQuote()` là hàm LẤY-RỒI-XOÁ: gọi lần hai trả null. Nơi gọi nó là useEffect nạp
 * dữ liệu của QuoteEditor, mà một useEffect KHÔNG được phép giả định chỉ chạy đúng một lần —
 * <StrictMode> (web/src/main.tsx) gọi lại mọi effect ở bản dev, tức mỗi lần `npm run dev`. Lần
 * chạy thứ hai nhận null, editor rơi vào nhánh "dựng mặc định", và MỌI thứ người dùng vừa điền
 * qua 3 bước wizard biến mất — trình soạn mở ra trắng trơn. Đã tái hiện được, không phải lo xa.
 *
 * `hop` là một ref của React (sống theo đúng lần mount đó): rời trình soạn là bản nháp mất theo,
 * đúng như ý đồ ban đầu — chỉ khác ở chỗ nó không mất giữa hai lượt chạy của CÙNG một effect.
 */
export function giuBanNhap(hop: { current: QuoteFull | null }): QuoteFull | null {
  if (!hop.current) hop.current = takePendingNewQuote();
  return hop.current;
}
