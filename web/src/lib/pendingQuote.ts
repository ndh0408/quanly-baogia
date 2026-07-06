// Bàn giao draft từ Wizard Tạo-mới sang QuoteEditor (in-memory, KHÔNG lưu tới khi editor bấm Lưu —
// giống SPA: state.currentQuote = {…, _new:true} rồi mở editor).
import type { QuoteFull } from "./api";
let pending: QuoteFull | null = null;
export const setPendingNewQuote = (q: QuoteFull) => { pending = q; };
export const takePendingNewQuote = (): QuoteFull | null => { const q = pending; pending = null; return q; };
