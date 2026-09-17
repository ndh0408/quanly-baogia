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

// Ô nhiều dòng tự cao theo nội dung. Đọc `scrollHeight` BUỘC trình duyệt tính lại bố cục NGAY lúc
// đó, nếu trước đó có thao tác GHI làm bố cục hết hiệu lực. Gộp về cuối khung hình bằng rAF để gõ
// 20 ký tự trong một frame chỉ đo một lần. Ô đang chờ giữ trong Set nên không xếp trùng.
//
// ── PHẢI TÁCH LÀM BA LƯỢT, KHÔNG ĐƯỢC GHI–ĐỌC XEN KẼ ──────────────────────
// Bản trước gọi `measureNow` trong vòng lặp, mà `measureNow` làm GHI (`height="auto"`) rồi ĐỌC
// (`scrollHeight`) cho TỪNG ô. Gom vào một rAF KHÔNG gộp được các lượt tính bố cục: mỗi vòng lặp
// lại vô hiệu hoá bố cục rồi lại ép tính lại. Chú thích cũ khai "chỉ gây một lượt tính bố cục" —
// SAI, và sai theo hướng làm người đọc yên tâm mà không kiểm lại.
//
// ĐO TRÊN TRANG THẬT (báo giá #264 trên dev: 9 trang, 366 dòng, 403 ô textarea, CPU chậm 4× để
// giả lập máy i5 đời 6000 của công ty):
//     ghi–đọc xen kẽ (bản cũ)              1.627 ms
//     tách ba lượt (bản này)                   81 ms      ← nhanh hơn 20 lần
// Chrome DevTools báo tổng "forced reflow" của cả lần tải là 1.860 ms trên LCP 3.381 ms — tức
// riêng chỗ này chiếm gần trọn phần đó, và gần một nửa thời gian trang hiện ra.
//
// Ba lượt: GHI hết → ĐỌC hết → GHI hết. Lượt đọc đầu tiên vẫn ép một lần tính bố cục, nhưng
// những lần đọc sau KHÔNG có thao tác ghi xen vào nên trình duyệt trả lời từ bố cục đã tính.
const pendingGrow = new Set<HTMLTextAreaElement>();
let growRaf = 0;
/** Đo một ô lẻ. CHỈ dùng khi không có rAF — trong lô thì phải đi theo ba lượt bên dưới. */
const measureNow = (el: HTMLTextAreaElement) => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
export const autoGrow = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  if (typeof requestAnimationFrame !== "function") { measureNow(el); return; }
  pendingGrow.add(el);
  if (growRaf) return;
  growRaf = requestAnimationFrame(() => {
    growRaf = 0;
    const els: HTMLTextAreaElement[] = [];
    for (const t of pendingGrow) if (t.isConnected) els.push(t);
    pendingGrow.clear();
    if (!els.length) return;
    for (const t of els) t.style.height = "auto";               // 1. GHI hết
    const hs = els.map((t) => t.scrollHeight);                   // 2. ĐỌC hết — một lượt bố cục
    for (let i = 0; i < els.length; i++) els[i].style.height = hs[i] + "px";   // 3. GHI hết
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

/* ── MỘT THANH "+ THÊM HÀNG…" DÙNG CHUNG CHO NHIỀU LƯỚI ───────────────────────────────────────
   Trang soạn báo giá có tới ba lưới cùng lúc: báo giá chính, sheet nội bộ (HCM / Phí KH) và sheet
   Hà Nội. Trước đây mỗi lưới tự vẽ thanh nút của nó, nên màn hình có HAI hàng nút giống hệt nhau
   cách nhau 40px mà tác động lên HAI bảng khác nhau — người dùng báo đúng chỗ này, và thêm nhầm
   bảng là lỗi im lặng (số liệu vào sai chỗ, không ai biết).

   Nay chỉ còn MỘT thanh, ở đáy trang cạnh nút Lưu, và nó phục vụ ĐÚNG cái bảng vừa được chạm vào:
   bấm/Tab vào lưới nào thì lưới đó chiếm thanh, tên bảng hiện ngay trên thanh. "Bấm vào đâu thì
   thêm hàng vào đó."

   Vắng mặt (`undefined`) = mỗi lưới tự vẽ thanh tại chỗ, y như cũ — đường của AccountHnView (cả
   trang chỉ có một lưới, không có thanh đáy), bench và bài kiểm mức component. */
export type ThanhChung = {
  /** Ô ở đáy trang để portal thanh nút vào. `null` = chưa gắn vào DOM. */
  dock: HTMLElement | null;
  /** id của lưới ĐANG chiếm thanh. */
  dangLam: string;
  /** Lưới báo "tôi vừa được chạm" — kèm tên để thanh nút ghi ra. */
  datDangLam: (id: string, nhan: string) => void;
};
