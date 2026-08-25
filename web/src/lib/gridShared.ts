// Dùng chung giữa QuoteEditor (form/summary) và GridTable (lưới): khoá React cho item + auto-grow.
import * as M from "./quoteMath";

export type ItemK = M.Item & { _k?: number };

// Bộ đếm khoá React duy nhất cho mọi item (lưới chính + bảng nội bộ) → key ổn định, không trùng.
let _kSeq = 1;
export const nextK = () => _kSeq++;

export const autoGrow = (el: HTMLTextAreaElement | null) => { if (!el) return; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };

// Chỉ số ký tự nằm ngay dưới con trỏ chuột trong <input>/<textarea>.
// Chrome trả null cho caretPositionFromPoint/caretRangeFromPoint khi điểm rơi vào form control
// (nội dung nằm trong shadow DOM), nên dựng một <div> "gương" cùng font/bề ngang/padding/ngắt dòng
// rồi đo từng ký tự bằng Range.getClientRects() — đúng dòng trước, rồi mới tới cột.
// Trả null nếu không đo được → nơi gọi tự lùi về cách cũ.
const MIRROR_PROPS = [
  "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "line-height",
  "text-transform", "word-spacing", "text-indent", "padding-top", "padding-right", "padding-bottom",
  "padding-left", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "box-sizing", "overflow-wrap", "word-break",
];
export function caretIndexAtPoint(el: HTMLInputElement | HTMLTextAreaElement, x: number, y: number): number | null {
  const v = el.value ?? "";
  if (!v) return 0;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const d = document.createElement("div");
  for (const k of MIRROR_PROPS) d.style.setProperty(k, cs.getPropertyValue(k));
  d.style.position = "fixed";
  d.style.left = `${r.left - (el.scrollLeft || 0)}px`;   // input 1 dòng có thể đang cuộn ngang
  d.style.top = `${r.top - (el.scrollTop || 0)}px`;
  d.style.width = `${r.width}px`;
  d.style.height = "auto";
  d.style.whiteSpace = el.tagName === "TEXTAREA" ? "pre-wrap" : "pre";
  d.style.visibility = "hidden";
  d.style.pointerEvents = "none";
  d.style.zIndex = "-1";
  d.textContent = v;
  document.body.appendChild(d);
  try {
    const node = d.firstChild as Text | null;
    if (!node) return null;
    const rg = document.createRange();
    let best: number | null = null, bestDist = Infinity;
    for (let i = 0; i < v.length; i++) {
      rg.setStart(node, i); rg.setEnd(node, i + 1);
      const rects = rg.getClientRects();
      for (let k = 0; k < rects.length; k++) {
        const rect = rects[k];
        if (!rect.width && !rect.height) continue;
        const inLine = y >= rect.top && y <= rect.bottom;
        const dy = inLine ? 0 : Math.min(Math.abs(y - rect.top), Math.abs(y - rect.bottom));
        const mid = rect.left + rect.width / 2;
        const dist = dy * 10_000 + Math.abs(x - mid);   // ưu tiên ĐÚNG DÒNG, rồi mới tới cột
        if (dist < bestDist) { bestDist = dist; best = x > mid ? i + 1 : i; }
      }
    }
    return best;
  } catch { return null; } finally { d.remove(); }
}
