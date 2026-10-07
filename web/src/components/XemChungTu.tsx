import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type HinhThucChi, type PhiaKhoanChi } from "../lib/api";
import { useEscClose } from "../lib/ui";
import { fmtDateTime } from "../lib/format";
import { anhHienDuoc, laPdfDataUrl } from "../lib/khoanChi";

// HỘP XEM CHỨNG TỪ TỪ BẢNG NỘI BỘ (chủ repo 2026-10-06: "có để kế toán cho hình và hiển thị bên nội bộ chứ"). Bấm 📎 / 🧾 ở
// cột Thanh toán (màn soạn, Account HN, màn chỉ-xem nội bộ) → tải ĐÚNG MỘT tệp hiện tại của hàng qua
// GET /api/quotes/:id/khoan-chi/:side/:rid/anh (máy chủ kiểm quyền xem hàng + ghi nhật ký mỗi lần xem). CHỈ XEM: không sửa,
// không gỡ, không lịch sử — việc đó ở trang Hóa đơn đầu vào của kế toán.
//
// Ba trạng thái tách bạch (khuôn HopKhoanChi): đang tải / lỗi (+ Thử lại) / xong. Ảnh vẽ bằng <img> sau khi lọc lại đúng regex
// data-URL ảnh; PDF (hóa đơn điện tử) không vẽ được trong trang (CSP chặn khung / object) nên đưa nút TẢI VỀ bằng blob.

export type LoaiChungTu = "chi" | "vat";
export const NHAN_LOAI_CHUNG_TU: Record<LoaiChungTu, string> = { chi: "Ảnh ủy nhiệm chi", vat: "Hóa đơn VAT" };
/**
 * Tên tờ chứng từ theo LOẠI + HÌNH THỨC (chủ repo 2026-10-07): ảnh của khoản TIỀN MẶT là "Ảnh phiếu chi" — không có ủy nhiệm
 * chi nào cả. Chuyển khoản / vắng (khoản cũ, máy chủ cũ) → "Ảnh ủy nhiệm chi" như trước.
 */
export const nhanChungTu = (loai: LoaiChungTu, hinhThuc?: HinhThucChi | null): string =>
  loai === "chi" && hinhThuc === "tien-mat" ? "Ảnh phiếu chi" : NHAN_LOAI_CHUNG_TU[loai];

type TrangThai = { k: "dang-tai" } | { k: "loi"; loi: string } | { k: "xong"; src: string; pdf: boolean; luc: string | null; boi: string | null; hinhThuc?: HinhThucChi | null };

/** data-URL PDF → blob URL (để tải về). Không có URL.createObjectURL (jsdom) → "" (nút tải ẩn). */
function blobTuPdf(dataUrl: string): string {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return "";
  try {
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([u8], { type: "application/pdf" }));
  } catch {
    return "";
  }
}

/** Nút "Tải PDF" cho một data-URL PDF — blob tạo khi vẽ, thu hồi khi gỡ. Dùng chung với hộp Khoản chi của kế toán. */
export function TaiPdf({ dataUrl, tenTep }: { dataUrl: string; tenTep: string }) {
  const [blob, setBlob] = useState("");
  useEffect(() => {
    const u = blobTuPdf(dataUrl);
    setBlob(u);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [dataUrl]);
  return <p className="xem-ct-pdf">📄 Hóa đơn dạng PDF.{" "}{blob ? <a className="btn btn-sm" href={blob} download={tenTep}>Tải PDF</a> : null}</p>;
}

export function XemChungTu({ quoteId, side, rid, loai, tenHang, hinhThuc, onDong }: {
  quoteId: number; side: PhiaKhoanChi; rid: string; loai: LoaiChungTu;
  /** Tên hàng — cho tiêu đề hộp. */
  tenHang?: string;
  /** Hình thức của khoản theo cột Thanh toán lúc bấm — đặt tên ngay từ lúc đang tải; máy chủ trả lại bản chắc chắn. */
  hinhThuc?: HinhThucChi | null;
  onDong: () => void;
}) {
  const [tt, setTt] = useState<TrangThai>({ k: "dang-tai" });
  const luot = useRef(0);
  const conSong = useRef(true);
  const dongRef = useRef<HTMLButtonElement>(null);
  const dong = useCallback(() => onDong(), [onDong]);
  useEscClose(dong);

  const tai = useCallback(() => {
    const lan = ++luot.current;
    setTt({ k: "dang-tai" });
    api.chungTuNoiBo(quoteId, side, rid, loai).then((r) => {
      if (!conSong.current || lan !== luot.current) return;
      const pdf = laPdfDataUrl(r?.dataUrl);
      const src = pdf ? (r.dataUrl as string) : anhHienDuoc(r?.dataUrl);
      setTt({ k: "xong", src, pdf, luc: r?.uploadedAt ?? null, boi: r?.uploadedByName ?? null, hinhThuc: r?.paidMethod });
    }).catch((ex) => {
      if (!conSong.current || lan !== luot.current) return;
      setTt({ k: "loi", loi: ex instanceof ApiError ? ex.message : "Không tải được chứng từ — kiểm tra mạng rồi thử lại." });
    });
  }, [quoteId, side, rid, loai]);

  // Đặt lại `true` mỗi lần gắn (StrictMode gỡ → gắn giả một lượt) — như HopKhoanChi.
  useEffect(() => { conSong.current = true; return () => { conSong.current = false; }; }, []);
  useEffect(() => { tai(); }, [tai]);
  useEffect(() => { dongRef.current?.focus(); }, []);

  // Máy chủ (đọc đúng lúc mở) thắng cột Thanh toán đã nạp từ trước — kế toán có thể vừa đổi hình thức.
  const nhan = nhanChungTu(loai, tt.k === "xong" && tt.hinhThuc !== undefined ? tt.hinhThuc : hinhThuc);
  return (
    <div className="modal-backdrop xem-ct-nen" onClick={(e) => { if (e.target === e.currentTarget) dong(); }}
         onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="modal modal-sm xem-ct" role="dialog" aria-modal="true" aria-label={`${nhan}${tenHang ? ` — ${tenHang}` : ""}`}>
        <div className="modal-head">
          <h3>{nhan}{tenHang ? <span className="muted"> · {tenHang}</span> : null}</h3>
          <button ref={dongRef} type="button" className="x" onClick={dong} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body" aria-live="polite">
          {tt.k === "dang-tai" && <div className="skeleton-wrap" aria-busy="true"><div className="skeleton-row" /><div className="skeleton-row" /></div>}
          {tt.k === "loi" && <p className="err" role="alert">{tt.loi} <button type="button" className="btn btn-sm" onClick={tai}>Thử lại</button></p>}
          {tt.k === "xong" && (
            <>
              {(tt.luc || tt.boi) && <p className="muted xem-ct-meta">Kế toán đưa lên{tt.boi ? ` · ${tt.boi}` : ""}{tt.luc ? ` · ${fmtDateTime(tt.luc)}` : ""}</p>}
              {tt.pdf
                ? <TaiPdf dataUrl={tt.src} tenTep={`hoa-don-vat-${rid}.pdf`} />
                : tt.src
                  ? <div className="pay-proof xem-ct-anh"><img src={tt.src} alt={nhan} /></div>
                  : <p className="muted">Không đọc được tệp này.</p>}
            </>
          )}
          <p className="muted xem-ct-chu">Chỉ xem — kế toán đưa / thay chứng từ ở trang Hóa đơn đầu vào.</p>
        </div>
      </div>
    </div>
  );
}
