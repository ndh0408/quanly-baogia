// Dùng chung giữa QuoteEditor (form/summary) và GridTable (lưới): khoá React cho item + auto-grow.
import * as M from "./quoteMath";

export type ItemK = M.Item & { _k?: number };

/**
 * Phím này có phải một nhịp của BỘ GÕ (IME) không?
 *
 * ── VÌ SAO PHẢI HỎI ────────────────────────────────────────────────────────
 * Gõ tiếng Việt (Telex/VNI trên macOS, và mọi bộ gõ Trung/Nhật/Hàn) đi qua một lớp SOẠN THẢO:
 * trình duyệt gom nhiều phím thành một cụm rồi mới nhả ra ký tự cuối. Trong lúc đó nó vẫn bắn
 * `keydown`, nhưng `key` không phải ký tự người ta gõ. Xử lý những nhịp ấy như phím thường thì:
 *   · ở LƯỚI — phím đầu tiên rơi vào ô đang KHÓA nên bị nuốt, chữ đầu của mỗi ô mất;
 *   · ở "thêm hạng mục" của trang Rạp — Enter XÁC NHẬN cụm chữ của bộ gõ lại bị hiểu là "gửi",
 *     tức mỗi lần bỏ dấu là một lần gửi nhầm.
 * Cả hai đều là lỗi CHỈ người gõ tiếng Việt gặp, và không lộ ra ở bàn phím tiếng Anh.
 *
 * ── BA DẤU HIỆU, VÌ KHÔNG TRÌNH DUYỆT NÀO ĐỦ MỘT MÌNH ──────────────────────
 *   · `isComposing` — chuẩn, nhưng Safari cũ để `false` ở nhịp ĐẦU TIÊN của cụm;
 *   · `keyCode === 229` — quy ước cũ mọi trình duyệt còn giữ cho "phím thuộc về IME";
 *   · `key === "Process"` — Firefox dùng thay cho 229.
 * Đọc `keyCode` ở CẢ sự kiện tổng hợp của React lẫn `nativeEvent`: React chép trường này sang nên
 * hai chỗ luôn bằng nhau, khai cả hai chỉ để nơi gọi truyền kiểu nào cũng đúng.
 *
 * Hàm THUẦN và KHÔNG xét Ctrl/Cmd — phím tắt là việc của nơi gọi, và hai nơi gọi trong repo này
 * xử lý phím tắt khác nhau (lưới loại Ctrl trước, trang Rạp loại sau).
 */
export function dangGoIME(e: {
  key?: string;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number } | null;
}): boolean {
  return !!e.nativeEvent?.isComposing || e.keyCode === 229 || e.nativeEvent?.keyCode === 229 || e.key === "Process";
}

// Bộ đếm khoá React duy nhất cho mọi item (lưới chính + bảng nội bộ) → key ổn định, không trùng.
let _kSeq = 1;
export const nextK = () => _kSeq++;

// Ô nhiều dòng tự cao theo nội dung. Đọc scrollHeight BUỘC trình duyệt tính lại bố cục ngay lúc
// đó — với lưới ~600 ô thì mỗi lần tốn hàng chục ms, gõ nhanh là khựng thấy rõ. Gộp về CUỐI KHUNG
// HÌNH: gõ 20 ký tự trong một frame chỉ đo một lần. Ô đang chờ giữ trong Set nên không xếp trùng.
const pendingGrow = new Set<HTMLTextAreaElement>();
let growRaf = 0;
const measureNow = (el: HTMLTextAreaElement) => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
export const autoGrow = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  if (typeof requestAnimationFrame !== "function") { measureNow(el); return; }
  pendingGrow.add(el);
  if (growRaf) return;
  growRaf = requestAnimationFrame(() => {
    growRaf = 0;
    // Đo hết trong một nhịp: các lần đọc scrollHeight dồn lại chỉ gây một lượt tính bố cục.
    for (const t of pendingGrow) if (t.isConnected) measureNow(t);
    pendingGrow.clear();
  });
};

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
