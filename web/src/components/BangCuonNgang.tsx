import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * BẢNG RỘNG + THANH CUỘN NGANG NỔI ở đáy màn hình.
 *
 * Vì sao (2026-11-26, chủ repo chuyển lời từ trang Quản lý dự án: "chiều ngang em cho có thanh cuộn nha … nó ko show hết
 * thông tin nên dễ bị miss"): bảng cũ nằm trong `.tbl-scroll` (overflow-x:auto) KHÔNG giới hạn chiều cao, nên thanh cuộn
 * ngang của nó nằm DƯỚI DÒNG CUỐI — sau hàng trăm dòng. Người xem thấy bảng cụt ở cột "Mã sản xuất" mà không có dấu hiệu
 * nào cho biết còn cột bên phải.
 *
 * Cách làm: một thanh cuộn "đại diện" (`.thanh-cuon-noi`) đặt ngay sau bảng, `position: sticky; bottom: 0` — khi bảng
 * đang trong tầm nhìn, nó dính ở đáy màn hình; cuộn tới cuối bảng thì nó về đúng chỗ dưới dòng cuối. Hai bên đồng bộ
 * `scrollLeft` theo cả hai chiều. Thanh cuộn gốc của khung bị ẩn (CSS) để không thành HAI thanh chồng nhau; khung vẫn
 * cuộn được bằng touchpad / Shift+lăn chuột / vuốt. Chỉ hiện khi bảng thật sự tràn.
 *
 * Không chọn cách giới hạn chiều cao khung (cuộn dọc lồng trong trang): lăn chuột trên bảng thì bảng cuộn chứ trang không
 * cuộn, và trên điện thoại cuộn lồng hay "kẹt" ngón tay.
 */
export function BangCuonNgang({ children, className }: { children: ReactNode; className?: string }) {
  const khung = useRef<HTMLDivElement>(null);
  const thanh = useRef<HTMLDivElement>(null);
  const [rong, setRong] = useState(0);
  const [tran, setTran] = useState(false);

  // Đo lại khi khung đổi cỡ (cửa sổ, menu đóng/mở) và khi BẢNG đổi cỡ (lọc, nạp xong dữ liệu).
  useEffect(() => {
    const k = khung.current;
    if (!k) return;
    const doLai = () => {
      setRong(k.scrollWidth);
      setTran(k.scrollWidth > k.clientWidth + 1);
    };
    doLai();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(doLai) : null;
    ro?.observe(k);
    if (k.firstElementChild) ro?.observe(k.firstElementChild);
    window.addEventListener("resize", doLai);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", doLai);
    };
  }, []);   // khung + bảng là cùng một phần tử suốt đời component; ResizeObserver lo mọi lần đổi cỡ

  // Đồng bộ hai chiều. Gán cùng một giá trị thì trình duyệt không bắn sự kiện scroll nữa → không lặp vô tận;
  // ngưỡng 1px nuốt chênh lệch làm tròn (màn phóng to 125%/150% cho scrollLeft lẻ).
  useEffect(() => {
    const k = khung.current;
    const t = thanh.current;
    if (!k || !t) return;
    t.scrollLeft = k.scrollLeft;
    const tuKhung = () => { if (Math.abs(t.scrollLeft - k.scrollLeft) > 1) t.scrollLeft = k.scrollLeft; };
    const tuThanh = () => { if (Math.abs(k.scrollLeft - t.scrollLeft) > 1) k.scrollLeft = t.scrollLeft; };
    k.addEventListener("scroll", tuKhung, { passive: true });
    t.addEventListener("scroll", tuThanh, { passive: true });
    return () => {
      k.removeEventListener("scroll", tuKhung);
      t.removeEventListener("scroll", tuThanh);
    };
  }, [tran]);

  return (
    <div className="bang-cuon-ngang">
      <div ref={khung} className={`tbl-scroll${tran ? " co-thanh-noi" : ""}${className ? ` ${className}` : ""}`}>{children}</div>
      {tran && (
        <div ref={thanh} className="thanh-cuon-noi" data-testid="thanh-cuon-noi" aria-hidden="true">
          <div style={{ width: rong, height: 1 }} />
        </div>
      )}
    </div>
  );
}
