import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// BẢNG NỔI dùng chung: portal + position:fixed để không bị `.list-table` / khung cuộn của bảng cắt, bám theo nút mở khi
// cuộn trang hoặc cuộn ngang bảng, kẹp vào khung nhìn, không đủ chỗ phía dưới thì mở LÊN TRÊN. Đóng khi bấm ra ngoài
// (không tính nút mở — để nút tự bật/tắt) và khi Esc (trả tiêu điểm về nút mở).
//
// Bản thứ ba của cùng một mẫu (menu "⋯" của danh sách, bảng màu + khung ghi chú ở QuoteNote) — hai bản kia giữ nguyên
// vì đã có test riêng; bộ lọc Danh sách báo giá dựa vào bản chung này để khỏi chép lần nữa.

export function BangNoi({ neo, onDong, nhan, rong = 280, children }: {
  neo: RefObject<HTMLElement | null>;
  /** `traTieuDiem`: true khi đóng bằng Esc (tiêu điểm phải về nút mở). */
  onDong: (traTieuDiem: boolean) => void;
  nhan: string;
  rong?: number;
  children: ReactNode;
}) {
  const hop = useRef<HTMLDivElement>(null);
  const [vt, setVt] = useState<{ top: number; left: number; toiDa: number }>({ top: 0, left: 0, toiDa: 360 });
  const tinh = useCallback(() => {
    const rc = neo.current?.getBoundingClientRect();
    if (!rc) return;
    const w = Math.min(rong, window.innerWidth - 16);
    const duoi = window.innerHeight - rc.bottom - 12, tren = rc.top - 12;
    const xuong = duoi >= 240 || duoi >= tren;
    const moi = {
      left: Math.max(8, Math.min(rc.left, window.innerWidth - w - 8)),
      // Mở lên trên: đáy bảng cách nút 6px — chiều cao thật đo từ lần vẽ trước (lần đầu chưa có thì tạm 240).
      top: xuong ? rc.bottom + 6 : Math.max(8, rc.top - 6 - (hop.current?.offsetHeight ?? 240)),
      toiDa: Math.max(160, xuong ? duoi : tren),
    };
    // Trả lại CHÍNH đối tượng cũ khi không đổi: `tinh` chạy sau MỖI lần vẽ (layout effect bên dưới), setState với đối tượng
    // mới mỗi lần là vòng lặp vô hạn.
    setVt((cu) => (cu.top === moi.top && cu.left === moi.left && cu.toiDa === moi.toiDa ? cu : moi));
  }, [neo, rong]);
  useLayoutEffect(() => { tinh(); });   // mỗi lần vẽ lại (nội dung đổi cao) tính lại chỗ mở-lên-trên
  // Mở ra thì ĐƯA TIÊU ĐIỂM VÀO bảng. Bảng là portal ở cuối <body>, nên không có dòng này thì người dùng bàn phím bấm Enter ở nút
  // mở rồi Tab sẽ đi tiếp sang ô SAU nút (ngoài bảng) — bảng mở mà không với tới được. Nếu bên trong đã có gì giữ tiêu điểm (hộp tìm
  // có `autoFocus`) thì để nguyên, không giành của nó.
  useEffect(() => {
    if (hop.current && !hop.current.contains(document.activeElement)) hop.current.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const ngoai = (e: Event) => { const t = e.target as Node; if (!hop.current?.contains(t) && !neo.current?.contains(t)) onDong(false); };
    const cuon = (e: Event) => { if (!hop.current?.contains(e.target as Node)) tinh(); };   // cuộn BÊN TRONG bảng (danh sách dài) không được kéo bảng đi
    const phim = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onDong(true); } };
    document.addEventListener("mousedown", ngoai);
    document.addEventListener("scroll", cuon, true);
    window.addEventListener("resize", tinh);
    document.addEventListener("keydown", phim, true);
    return () => {
      document.removeEventListener("mousedown", ngoai);
      document.removeEventListener("scroll", cuon, true);
      window.removeEventListener("resize", tinh);
      document.removeEventListener("keydown", phim, true);
    };
  }, [onDong, neo, tinh]);
  return createPortal(
    <div ref={hop} className="bang-noi" role="dialog" aria-label={nhan} tabIndex={-1} style={{ top: vt.top, left: vt.left, width: Math.min(rong, window.innerWidth - 16), maxHeight: vt.toiDa }}
      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}
