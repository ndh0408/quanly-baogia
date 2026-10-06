import type { MouseEvent } from "react";
import type { DaChiHang } from "../lib/api";
import { fmtDate } from "../lib/format";
import { trangThaiVat, NHAN_TRANG_THAI_VAT } from "../lib/khoanChi";

// Ô "THANH TOÁN" CHỈ XEM của bảng nội bộ — dùng chung cho lưới (GridTable: màn soạn, Account HN) và màn chỉ-xem nội bộ
// (InternalQuoteView), để hai nơi nói CÙNG một câu về cùng một khoản tiền.
//
// Hàng chứng từ VAT (chủ repo 2026-10-06: "nếu có VAT mà chỉ mới thanh toán thôi thì bên nội bộ báo là đã thanh toán chưa
// VAT"): đã chi + chưa có HĐ VAT → "✓ Đã TT · chưa VAT" (màu cảnh báo); đã chi + có HĐ → "✓ Đã TT · đã có VAT"; chưa chi mà
// có HĐ → "Có HĐ VAT · chưa TT". Hàng HĐNS / TM / chưa chọn: như trước. Trạng thái theo chứng từ HIỆN TẠI (`chungTu` của
// hàng đang hiện), không theo lúc kế toán đưa HĐ.
//
// 📎 (ảnh ủy nhiệm chi) và 🧾 (hóa đơn VAT) là NÚT khi có `onBam` — mở hộp XemChungTu. Nút mang `data-xl="xem-ct"` +
// `data-loai`: lưới vẽ dòng bằng memo nên phải đi qua bộ phát sự kiện chung của nó (xuLyBam), không gắn closure riêng.

export function OThanhToan({ h, chungTu, onBam }: {
  /** Trạng thái hàng (lib/daChiHang) — null = chưa chi, chưa có HĐ VAT. */
  h: DaChiHang | null;
  chungTu: unknown;
  /** Có = 📎 / 🧾 bấm được (người đang xem hàng có đường đọc chứng từ). */
  onBam?: (e: MouseEvent<HTMLElement>) => void;
}) {
  const paid = !!h && h.paid !== false;
  const vat = trangThaiVat(chungTu, paid, !!h?.coHdVat);
  if (!h || (!paid && !vat)) return <span className="pay-chua" title="Chưa thanh toán — kế toán đánh dấu ở trang Hóa đơn đầu vào">—</span>;
  const ngay = paid && h.paidAt ? fmtDate(h.paidAt) : "";
  const coAnh = paid && h.coAnh;
  const coHd = !!vat && !!h.coHdVat;
  const tieuDe = [
    paid ? `Kế toán đã đánh dấu ĐÃ CHI${ngay ? ` ngày ${ngay}` : ""}${h.paidByName ? ` — ${h.paidByName}` : ""}` : "Chưa thanh toán",
    vat === "chua-vat" ? "chưa có hóa đơn VAT" : coHd ? `đã có hóa đơn VAT${h.hdVatLuc ? ` (${fmtDate(h.hdVatLuc)})` : ""}` : "",
    coAnh ? "có ảnh ủy nhiệm chi" : "",
  ].filter(Boolean).join(" · ") + ". Kế toán cập nhật ở trang Hóa đơn đầu vào.";
  const nut = (loai: "chi" | "vat", bieuTuong: string, nhan: string) => (onBam
    ? <>{" "}<button type="button" className="pay-xem" data-xl="xem-ct" data-loai={loai} onClick={onBam} title={`Xem ${nhan.toLowerCase()}`} aria-label={`Xem ${nhan.toLowerCase()}`}>{bieuTuong}</button></>
    : <span role="img" aria-label={`Có ${nhan.toLowerCase()}`}> {bieuTuong}</span>);
  return (
    <span className={`pay-da${vat === "chua-vat" ? " pay-chua-vat" : ""}`} title={tieuDe} data-vat={vat ?? undefined}>
      {paid
        ? <span className="ap-date">✓ Đã TT{ngay ? ` ${ngay}` : ""}{vat && vat !== "vat-chua-tt" ? ` · ${NHAN_TRANG_THAI_VAT[vat]}` : ""}</span>
        : <span className="pay-vat-chua-tt">{NHAN_TRANG_THAI_VAT["vat-chua-tt"]}</span>}
      {coAnh ? nut("chi", "📎", "Ảnh ủy nhiệm chi") : null}
      {coHd ? nut("vat", "🧾", "Hóa đơn VAT") : null}
      {paid && h.paidByName ? <span className="pay-nguoi">{h.paidByName}</span> : null}
    </span>
  );
}
