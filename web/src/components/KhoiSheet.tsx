import { type ReactNode } from "react";
import * as M from "../lib/quoteMath";

/* ── MỘT LUỒNG = MỘT KHỐI GẬP ─────────────────────────────────────────────────────────────────
   Ba luồng nội bộ — Chi Phí HCM · Phí Khách Hàng · Báo Giá Hà Nội — trước đây vẽ MỞ SẴN hết, mỗi
   luồng kéo theo dải tab + nguyên một lưới Excel. Trang soạn báo giá dài ra mấy màn hình trong khi
   phần lớn thời gian người ta chỉ động vào MỘT luồng. Người dùng báo: "chổ thiết kế đang bị ngu
   trông không hiểu như nào và làm dài cái báo giá".

   Nay mỗi luồng là một khối GẬP, mặc định ĐÓNG, và tiêu đề tự nói đủ thứ cần biết:

       ▸ [Chi Phí HCM]   2 sheet · 12.500.000 → Quản lý dự án        [+ Thêm sheet]

   Đóng mà vẫn đọc được số tiền thì không phải mở ra mới biết — đó mới là chỗ tiết kiệm thật. Mở
   một khối không đóng khối khác: người ta có lúc cần đối chiếu hai luồng cạnh nhau.

   DÙNG CHUNG cho cả `ExtraTables` (HCM · Phí KH) lẫn `HnTables` (Hà Nội) là CỐ Ý — ba luồng phải
   trông và cư xử y hệt nhau, và trước đây chúng đã trôi khỏi nhau đúng theo cách này: khối HN tự
   vẽ thêm một dòng tổng mà hai khối kia không có.

   TÊN LỚP GIỮ NGUYÊN (`extra-cat-group` / `extra-cat-grouphead` / `extra-cat-badge` /
   `extra-cat-total`) — CSS nền ở public/style.css đang ĐÓNG BĂNG, và
   `AccountHnView.tongdongbo.test.tsx` đọc `.extra-cat-grouphead` để so số sheet. */

export function KhoiSheet({
  loai,
  nhan,
  soSheet,
  tong,
  duoiTong,
  dangSua,
  mo,
  onDoiMo,
  giaiThich,
  nutThem,
  children,
}: {
  /** hcm | khach | hanoi — quyết định màu badge (CSS nền đã có sẵn ba màu). */
  loai: string;
  nhan: string;
  soSheet: number;
  tong: number;
  /** Chữ nhạt sau số tiền, vd "→ Quản lý dự án". */
  duoiTong?: ReactNode;
  /** Khối đang chứa sheet được sửa → viền vàng (luật cũ của `.is-active`, giữ nguyên). */
  dangSua?: boolean;
  mo: boolean;
  onDoiMo: () => void;
  /** Câu giải thích ngắn, chỉ hiện khi MỞ — đóng thì nó chỉ làm dày tiêu đề. */
  giaiThich?: ReactNode;
  /** Nút "+ Thêm sheet" — nằm NGOÀI nút gập, vì <button> không lồng <button> được. */
  nutThem?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`extra-cat-group khoi-sheet${dangSua && mo ? " is-active" : ""}${mo ? " dang-mo" : ""}`}>
      <div className="extra-cat-grouphead">
        <button type="button" className="khoi-sheet-nut" aria-expanded={mo} onClick={onDoiMo}>
          <span className="khoi-sheet-mui" aria-hidden="true">▸</span>
          <span className={`extra-cat-badge cat-${loai}`}>{nhan}</span>
          <span className="extra-cat-total" data-cat={loai}>
            {soSheet} sheet
            {soSheet > 0 && <> · <strong>{M.fmtMoney(tong)}</strong> {duoiTong}</>}
          </span>
        </button>
        {nutThem}
      </div>
      {mo && (
        <>
          {giaiThich && <div className="khoi-sheet-note muted">{giaiThich}</div>}
          {children}
        </>
      )}
    </div>
  );
}
