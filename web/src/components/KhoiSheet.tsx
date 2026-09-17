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

/** Từ bao nhiêu sheet trở lên thì mới dựng bảng tổng — xem `BangTongLuong`. */
const NGUONG_BANG_TONG = 2;

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
  cacSheet,
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
  /** Tên + tổng của TỪNG sheet trong luồng, để dựng bảng tổng giống hệt "Tổng báo giá (N sheet)"
   *  của báo giá chính. Xem `BangTongLuong` bên dưới về lý do chỉ hiện khi có từ 2 sheet. */
  cacSheet?: { ten: string; tong: number }[];
  children?: ReactNode;
}) {
  const coBangTong = !!cacSheet && cacSheet.length >= NGUONG_BANG_TONG;
  return (
    <div className={`extra-cat-group khoi-sheet${dangSua && mo ? " is-active" : ""}${mo ? " dang-mo" : ""}`}>
      <div className="extra-cat-grouphead">
        <button type="button" className="khoi-sheet-nut" aria-expanded={mo} onClick={onDoiMo}>
          <span className="khoi-sheet-mui" aria-hidden="true">▸</span>
          <span className={`extra-cat-badge cat-${loai}`}>{nhan}</span>
          <span className="extra-cat-total" data-cat={loai}>
            {soSheet} sheet
            {/* TIỀN CHỈ HIỆN Ở MỘT CHỖ, và chỗ đó đổi theo trạng thái:
                 · ĐÓNG → ở đây, vì đó là cả mục đích của việc gập (không mở vẫn biết bao nhiêu);
                 · MỞ + có bảng tổng → trong bảng, ngay dưới những con số mà nó cộng.
                Mở mà in cả hai là lặp đúng kiểu người dùng đã kêu rườm rà. */}
            {soSheet > 0 && !(mo && coBangTong) && <> · <strong>{M.fmtMoney(tong)}</strong> {duoiTong}</>}
          </span>
        </button>
        {nutThem}
      </div>
      {mo && (
        <>
          {giaiThich && <div className="khoi-sheet-note muted">{giaiThich}</div>}
          {children}
          {coBangTong && cacSheet && <BangTongLuong nhan={nhan} cacSheet={cacSheet} tong={tong} />}
        </>
      )}
    </div>
  );
}

/* ── BẢNG TỔNG CỦA MỘT LUỒNG ──────────────────────────────────────────────────────────────────
   Dựng theo đúng khuôn "Tổng báo giá (N sheet)" của báo giá chính (`.summary-table`): liệt kê
   từng sheet kèm số tiền, rồi một dòng Tổng cộng. Người dùng xin đúng cái này — "chưa có cái tổng
   như cái của báo giá chính cho từng cái".

   KHÔNG có VAT: đây là chi phí nội bộ, con số đổ sang Quản lý dự án là số trần (xem extraTableSum).

   CHỈ hiện khi có TỪ 2 SHEET. Một sheet thì bảng này là một dòng cộng với một dòng tổng bằng đúng
   dòng đó — và bằng luôn con số đã ghi ở tiêu đề khối. In lại lần thứ ba là quay về đúng chỗ người
   dùng đã kêu rườm rà (số 4.204.000 từng hiện 3 lần trên một màn). */
function BangTongLuong({ nhan, cacSheet, tong }: { nhan: string; cacSheet: { ten: string; tong: number }[]; tong: number }) {
  return (
    <div className="khoi-sheet-tong">
      <h4>Tổng {nhan} ({cacSheet.length} sheet)</h4>
      <table className="summary-table">
        <thead><tr><th scope="col">STT</th><th scope="col">Sheet</th><th scope="col" style={{ textAlign: "right" }}>Tổng (VNĐ)</th></tr></thead>
        <tbody>
          {cacSheet.map((s, i) => (
            <tr key={i}>
              <td style={{ textAlign: "center" }}>{i + 1}</td>
              <td>{s.ten}</td>
              <td style={{ textAlign: "right" }}>{M.fmtMoney(s.tong)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}><strong>Tổng cộng</strong></td><td style={{ textAlign: "right" }}><strong>{M.fmtMoney(tong)}</strong></td></tr>
        </tfoot>
      </table>
    </div>
  );
}
