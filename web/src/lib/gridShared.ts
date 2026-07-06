// Dùng chung giữa QuoteEditor (form/summary) và GridTable (lưới): khoá React cho item + auto-grow.
import * as M from "./quoteMath";

export type ItemK = M.Item & { _k?: number };

// Bộ đếm khoá React duy nhất cho mọi item (lưới chính + bảng nội bộ) → key ổn định, không trùng.
let _kSeq = 1;
export const nextK = () => _kSeq++;

export const autoGrow = (el: HTMLTextAreaElement | null) => { if (!el) return; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
