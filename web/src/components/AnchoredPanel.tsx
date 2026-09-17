import { useLayoutEffect, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/* ── HỘP BUNG NEO THEO NÚT, RENDER Ở `document.body` ───────────────────────────────────────
   VÌ SAO PHẢI PORTAL, không dùng `position: absolute` trong chính cụm nút:

   Thanh nút đáy của editor (`.editor .actions`) dưới `@media (max-height: 700px), (max-width: 860px)`
   bật `overflow-x: auto` để cuộn ngang thay vì xuống hai hàng. Chuẩn CSS Overflow quy định: một
   trục là `visible` còn trục kia KHÔNG phải `visible` thì `visible` bị ép thành `auto`. Nên
   `overflow-y: visible` viết ở đó KHÔNG có tác dụng — trình duyệt chạy `overflow-y: auto`, thanh
   trở thành khung cuộn và CẮT sạch mọi thứ bung ra ngoài nó. Menu "⋯" và bảng phím tắt đều bung
   LÊN TRÊN thanh → nằm trọn ngoài khung → biến mất. `z-index` không cứu được: overflow cắt trước.

   Triệu chứng đúng như người dùng báo: cùng một bản web, máy màn cao thì menu hiện, laptop FullHD
   để tỉ lệ hiển thị 125%/150% (hoặc zoom trình duyệt) khiến chiều cao CSS tụt xuống ≤ 700px thì
   bấm "⋯" không thấy gì. Render ở `body` thì không thanh/bảng/khung cuộn nào cắt được nữa.

   Hộp tự chọn hướng bung và tự kẹp trong màn hình, nên đúng ở MỌI cỡ màn: ưu tiên lên trên (chỗ
   quen thuộc cho thanh đáy), hết chỗ thì lật xuống, và luôn bị giới hạn `max-height` bằng đúng
   khoảng trống còn lại + `overflow: auto` để nội dung dài vẫn cuộn xem được thay vì tràn ra rìa. */

const GAP = 6; // cách nút bao nhiêu px
const EDGE = 8; // chừa mép màn hình bấy nhiêu px

export function AnchoredPanel({
  anchorRef,
  open,
  onClose,
  align = "right",
  className,
  role,
  label,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Mép nào của hộp thẳng hàng với mép cùng tên của nút. */
  align?: "left" | "right";
  className?: string;
  role?: string;
  label?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  // Đo rồi đặt chỗ. Lượt render đầu (pos === null) hộp nằm ở góc, `visibility: hidden` và KHÔNG bị
  // ràng buộc chiều cao → đo được kích thước thật. useLayoutEffect chạy trước khi trình duyệt vẽ
  // nên người dùng không thấy cú nhảy.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const a = anchorRef.current, p = panelRef.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = p.offsetWidth, h = p.offsetHeight;
    const roomUp = r.top - GAP - EDGE;
    const roomDown = vh - r.bottom - GAP - EDGE;
    // Ưu tiên bung lên; chỉ lật xuống khi trên không đủ MÀ dưới rộng hơn.
    const up = roomUp >= h || roomUp >= roomDown;
    const maxHeight = Math.max(120, up ? roomUp : roomDown);
    const top = up ? Math.max(EDGE, r.top - GAP - Math.min(h, maxHeight)) : r.bottom + GAP;
    const want = align === "right" ? r.right - w : r.left;
    const left = Math.max(EDGE, Math.min(want, vw - EDGE - w));
    setPos({ top, left, maxHeight });
    // `open` đổi là đo lại; toạ độ tính từ viewport nên không phụ thuộc cuộn trang lúc đo.
  }, [open, align, anchorRef]);

  // Bấm ra ngoài / Esc / cuộn / đổi cỡ cửa sổ → đóng. Hộp `position: fixed` không tự đi theo nút
  // khi trang cuộn, nên đóng là cách trung thực nhất (giống RowMenu ở QuoteList).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onClose();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // ── CUỘN BÊN TRONG HỘP KHÔNG ĐƯỢC LÀM ĐÓNG HỘP ─────────────────────────
    // Bản đầu gắn thẳng `onClose` cho sự kiện `scroll` ở chế độ CAPTURE, tức bắt mọi lượt cuộn của
    // MỌI phần tử — kể cả của chính hộp này, vốn có `maxHeight` + `overflow: auto` nên là một vùng
    // cuộn thật sự. Hậu quả: menu dài, người dùng lăn chuột để đọc mục cuối → menu tự đóng.
    //
    // ĐÃ ĐỎ THẬT ở cổng [12] ui-smoke: Playwright tự cuộn mục vào tầm nhìn trước khi bấm, lượt cuộn
    // đó xảy ra BÊN TRONG hộp → hộp đóng → `page.click` hết giờ 30s. Tức bài kiểm giao diện bắt
    // đúng một lỗi dùng thật, không phải chuyện riêng của test.
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;   // cuộn TRONG hộp → kệ
      onClose();                                                  // cuộn trang/khung ngoài → đóng
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panelRef}
      className={className ? `anchored-pop ${className}` : "anchored-pop"}
      role={role}
      aria-label={label}
      style={pos
        // `bottom`/`right` phải ép về auto: class gốc (.kebab-menu) đặt sẵn hai giá trị đó, để
        // nguyên thì hộp bị neo cả bốn phía và kéo giãn méo mó.
        ? { top: pos.top, left: pos.left, right: "auto", bottom: "auto", maxHeight: pos.maxHeight }
        : { top: 0, left: 0, right: "auto", bottom: "auto", visibility: "hidden", maxHeight: "none" }}
    >
      {children}
    </div>,
    document.body,
  );
}
