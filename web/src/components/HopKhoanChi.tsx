import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { api, ApiError, isPreviewMode, type InputInvoiceRow, type KhoanChiDto } from "../lib/api";
import { toast, confirmModal, useEscClose } from "../lib/ui";
import { compressImage, docTepPdf, LOI_DOC_ANH } from "../lib/anhChungTu";
import { TaiPdf } from "./XemChungTu";
import { CHUNG_TU, dangGoIME } from "../lib/gridShared";
import { fmtMoney, fmtDate, fmtDateTime } from "../lib/format";
import {
  LOAI_BANG, NHAN_LY_DO_RUT, anhHienDuoc, laPdfDataUrl, fmtSoLuong, giaTriTruong, laNgayHoaDon, lyDoKhongTich, moTaXungDot, nhanTrangThaiHang,
  tenBangRieng, thanKhoanChi, xungDotKhoanChi, type GocKhoanChi, type NhapKhoanChi, type TruongKhoanChi,
} from "../lib/khoanChi";

// HỘP "KHOẢN CHI" — trang Hóa đơn đầu vào (chủ repo 2026-10-06: "cái thanh toán bên đó là cho kế toán"). Kế toán tích
// ĐÃ CHI + ảnh ủy nhiệm chi (quyền invoice:input:pay) và ghi Ngày hóa đơn + Ghi chú kế toán (quyền invoice:edit) của MỘT
// hàng bảng nội bộ. Máy chủ: PUT /api/quotes/input-invoices/:quoteId/:side/:rid (src/services/inputInvoiceService.ts).
//
// · Trang vẽ hộp ở MỨC TRANG, ngoài <tr>: sự kiện React đi qua cây thành phần chứ không theo DOM, hộp nằm trong dòng thì
//   mọi cú bấm trong hộp nổi lên onClick của dòng — với người mở được báo giá là nhảy sang màn soạn giữa lúc đang ghi.
// · Lưu gửi CHỈ trường đã đổi + `baseVersion` (lib/khoanChi.ts thanKhoanChi). Hai kế toán cùng sửa một khoản: người lưu
//   sau nhận 409, trang nạp lại, phần đang nhập GIỮ NGUYÊN — ô chưa đụng tự lấy giá trị mới (xem NhapKhoanChi).
// · Ảnh chỉ tải khi người dùng bấm xem: mỗi lần xem là một dòng nhật ký truy cập dữ liệu cá nhân (quote.internal.proof-view).
// · Realtime nạp lại dòng giữa chừng KHÔNG gây 409 (baseVersion theo dòng mới): ô mình đang sửa mà người khác vừa đổi →
//   hỏi trước khi ghi đè (lib/khoanChi.ts xungDotKhoanChi).
// · Còn thay đổi chưa lưu: F5 / đóng tab hỏi (beforeunload); Back / menu hỏi qua cờ dùng chung `__editorDirty` (Shell).

const GHI_CHU_TOI_DA = 1000;   // = GHI_CHU_KE_TOAN_TOI_DA ở src/validators.ts
const NHAN_CHUNG_TU: Record<string, string> = Object.fromEntries(CHUNG_TU);
type WinDirty = Window & { __editorDirty?: boolean };

/** Mã lỗi của máy chủ (`{ error, code }`) — "" khi không có. */
const maLoi = (ex: unknown): string => {
  const b = ex instanceof ApiError ? ex.body : null;
  return b && typeof b === "object" && typeof (b as { code?: unknown }).code === "string" ? (b as { code: string }).code : "";
};

type XemAnh = { proofId: number | null; loai: "chi" | "vat"; trangThai: "dang-tai" | "loi" | "xong"; src: string; pdf: boolean; loi: string; retiredAt: string | null };

export function HopKhoanChi({ row, mat = false, canPay, canEdit, onDong, onDaLuu, onNapLai, onThayDoi }: {
  /** Dòng HIỆN TẠI trong cache (nạp lại → đổi theo; `version` mới là `baseVersion` của lần Lưu sau). */
  row: InputInvoiceRow;
  /** Dòng không còn trong danh sách vừa nạp lại (bị xoá / đổi ở báo giá) — còn xem được, không lưu được. */
  mat?: boolean;
  canPay: boolean;
  canEdit: boolean;
  onDong: () => void;
  /** Máy chủ trả 200 → trang vá cache bằng dòng này (KHÔNG gọi ở chế độ xem thử). */
  onDaLuu: (dong: KhoanChiDto) => void;
  /** Nạp lại danh sách (409 / 404: dữ liệu trong tay đã cũ). */
  onNapLai: () => void;
  /** Hộp còn thay đổi chưa lưu không — để dải "Có bản mới" không tự tải lại trang lúc đó (useTrangAnToan). */
  onThayDoi?: (co: boolean) => void;
}) {
  const [nhap, setNhap] = useState<NhapKhoanChi>({});
  const [dangLuu, setDangLuu] = useState(false);
  const [dangNen, setDangNen] = useState(false);
  // Ô ngày lỗi: "do" = gõ dở ("dd/10/2026" — trình duyệt báo value "", lưu lúc đó là XOÁ ngày đang có); "khoang" = ngoài
  // 2000–2100 (min/max của ô không chặn gõ tay; máy chủ 400). Cả hai chặn Lưu tới khi sửa.
  const [ngayLoi, setNgayLoi] = useState<"" | "do" | "khoang">("");
  const [xem, setXem] = useState<XemAnh | null>(null);
  const hopRef = useRef<HTMLDivElement>(null);
  const tepRef = useRef<HTMLInputElement>(null);
  const tepVatRef = useRef<HTMLInputElement>(null);
  const nenBam = useRef(false);
  const conSong = useRef(true);
  const luotXem = useRef(0);
  const banLucMo = useRef(row.version);
  // Giá trị mỗi ô lúc BẮT ĐẦU sửa ô đó — so lúc Lưu để biết người khác có vừa đổi đúng ô này không (xungDotKhoanChi).
  const goc = useRef<GocKhoanChi>({});
  const batDauSua = (t: TruongKhoanChi) => { if (goc.current[t] === undefined) goc.current[t] = giaTriTruong(row, t); };

  const quyen = { canPay, canEdit };
  const than = thanKhoanChi(row, nhap, quyen);
  const coThayDoi = than !== null || !!ngayLoi;
  const paid = canPay ? nhap.paid ?? row.paid : row.paid;
  const lyDoTich = lyDoKhongTich(row);
  const ghiDuoc = row.coTheGhi && !!row.rid && !mat;
  const khoaTich = !canPay || !!lyDoTich || !ghiDuoc;
  // Ảnh MỚI chỉ cho khoản đang / sẽ là ĐÃ CHI, và hàng còn trong báo giá (máy chủ: 400 chua-danh-dau / 409 hang-khong-con).
  const dinhAnhDuoc = canPay && paid && ghiDuoc && row.trangThaiHang !== "khong-con-hang";
  // Đang nén ảnh thì CHƯA Lưu: bấm lúc đó là ghi khoản thiếu đúng tấm ảnh người dùng vừa chọn.
  const luuDuoc = !!than && !dangLuu && !dangNen && !ngayLoi && ghiDuoc;
  const ngay = nhap.invoiceDate ?? row.invoiceDate ?? "";
  const ghiChu = nhap.accountingNote ?? row.accountingNote ?? "";
  const anhTruoc = row.proofs.filter((p) => !p.hienTai && p.loai !== "vat");
  // HÓA ĐƠN VAT (chủ repo 2026-10-06: "nếu có VAT thì cho thêm ô bỏ VAT vào") — ĐỘC LẬP với đã chi: đưa trước hay sau khi
  // tích đều được. Phần này hiện khi chứng từ hàng là VAT, hoặc khoản đã từng có HĐ VAT (chứng từ đổi khỏi VAT sau đó: tệp
  // vẫn giữ, xem / gỡ được, nhưng không đưa HĐ mới — máy chủ 409 khong-phai-vat).
  const laVat = row.chungTu === "VAT";
  const coVat = !!row.hasVatProof;
  const vatTruoc = row.proofs.filter((p) => !p.hienTai && p.loai === "vat");
  const hienPhanVat = laVat || coVat || vatTruoc.length > 0;
  const dinhVatDuoc = canPay && ghiDuoc && laVat && row.trangThaiHang !== "khong-con-hang";
  const tenRieng = tenBangRieng(row.category, row.tableName);

  // Đặt lại `true` mỗi lần gắn: <StrictMode> (bản dev, main.tsx) chạy giả một lượt gỡ → gắn lại; chỉ hạ cờ ở lượt gỡ là
  // cờ kẹt `false` và mọi kết quả về sau (lưu hỏng, nén ảnh, xem ảnh) bị bỏ qua, nút kẹt ở "Đang lưu…".
  useEffect(() => { conSong.current = true; return () => { conSong.current = false; }; }, []);
  useEffect(() => { onThayDoi?.(coThayDoi); }, [coThayDoi, onThayDoi]);
  useEffect(() => () => onThayDoi?.(false), [onThayDoi]);
  // F5 / đóng tab → trình duyệt hỏi; Back / bấm menu → Shell hỏi (guardLeave đọc cờ dùng chung). Gỡ hộp là hạ cờ.
  useEffect(() => {
    if (!coThayDoi) return;
    const w = window as WinDirty;
    const chan = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    w.__editorDirty = true;
    window.addEventListener("beforeunload", chan);
    return () => { w.__editorDirty = false; window.removeEventListener("beforeunload", chan); };
  }, [coThayDoi]);
  // Tiêu điểm vào ô đầu tiên sửa được (thường là "Đã chi"); không ô nào sửa được thì vào nút Đóng.
  useEffect(() => {
    const o = hopRef.current?.querySelector<HTMLElement>('input:not([disabled]):not([type="file"]), textarea:not([disabled])');
    (o ?? hopRef.current?.querySelector<HTMLElement>(".modal-head .x"))?.focus();
  }, []);

  const dong = useCallback(async () => {
    if (dangLuu) return;
    if (coThayDoi && !(await confirmModal("Bỏ thay đổi?", "Phần vừa sửa trong hộp Khoản chi chưa được lưu sẽ mất.", { danger: true, confirmText: "Bỏ thay đổi" }))) return;
    onDong();
  }, [dangLuu, coThayDoi, onDong]);
  useEscClose(dong);

  const luu = async () => {
    if (!than || !luuDuoc || !row.rid) return;
    const xd = xungDotKhoanChi(goc.current, row, than);
    if (xd.length) {
      const ai = row.keToanCapNhatBoi ? `${row.keToanCapNhatBoi} đã` : "Người khác đã";
      const ok = await confirmModal(
        "Khoản vừa được người khác sửa",
        `Trong lúc bạn sửa, ${ai} đổi: ${xd.map((t) => moTaXungDot(row, t)).join(" · ")}. Lưu sẽ GHI ĐÈ bằng giá trị bạn vừa nhập.`,
        { danger: true, confirmText: "Ghi đè" },
      );
      if (!ok || !conSong.current) return;
      for (const t of xd) goc.current[t] = giaTriTruong(row, t);   // đã quyết ghi đè — không hỏi lại cùng thay đổi đó
    }
    setDangLuu(true);
    try {
      const kq = await api.ghiKhoanChi(row.quoteId, row.side, row.rid, than);
      // XEM THỬ quyền (lib/api.ts): lệnh ghi không tới máy chủ, phản hồi là "thành công giả" KHÔNG có `row` — không vá
      // cache bằng nó, kẻo dòng nằm lì trên trang như đã lưu thật.
      if (isPreviewMode()) {
        toast("Đang xem thử quyền — thay đổi KHÔNG được ghi vào dữ liệu thật.", "info");
        onDong();
        return;
      }
      if (kq && kq.row) onDaLuu(kq.row);
      toast("Đã lưu khoản chi", "success");
      onDong();
    } catch (ex) {
      const ma = maLoi(ex);
      const st = ex instanceof ApiError ? ex.status : 0;
      if (st === 409 && ma === "khoan-chi-da-doi") {
        toast("Kế toán khác vừa sửa khoản này — đã nạp lại, phần bạn đang nhập vẫn giữ", "error");
        onNapLai();
      } else if (st === 404 || (st === 409 && (ma.startsWith("hang-") || ma === "bao-gia-da-xoa"))) {
        // Dòng vừa bị xoá / bỏ duyệt / báo giá vừa bị xoá: dữ liệu trong tay đã cũ — báo đúng lời máy chủ rồi nạp lại.
        toast(ex instanceof ApiError ? ex.message : "Dòng này vừa thay đổi — đã nạp lại", "error");
        onNapLai();
      } else {
        // 403 thiếu quyền; 415 / 413 / 400 (ảnh hỏng, quá lớn, chưa tích…): đúng lời máy chủ, GIỮ ảnh vừa chọn để sửa rồi lưu lại.
        toast(ex instanceof ApiError ? ex.message : "Không lưu được — kiểm tra mạng rồi thử lại.", "error");
      }
    } finally {
      if (conSong.current) setDangLuu(false);
    }
  };

  // Enter trong ô ghi chú là XUỐNG DÒNG; Ctrl/⌘+Enter lưu — nhưng KHÔNG khi bộ gõ đang soạn cụm chữ (gõ tiếng Việt trên
  // macOS, IME Trung/Nhật/Hàn): Enter lúc đó là để XÁC NHẬN cụm chữ, không phải lệnh gửi (lib/gridShared.ts dangGoIME).
  const phim = (e: ReactKeyboardEvent) => {
    if (dangGoIME(e)) {
      if (e.key === "Escape") e.stopPropagation();   // Esc lúc đang soạn chỉ huỷ cụm chữ — đừng để useEscClose đóng cả hộp
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void luu(); }
  };

  const doiDaChi = async (v: boolean) => {
    if (!v && row.paid) {
      // Bỏ tích một khoản ĐÃ LƯU là đã chi: hỏi trước — máy chủ rút ảnh hiện tại khỏi khoản (ảnh không bị xoá).
      const ok = await confirmModal(
        "Bỏ đánh dấu ĐÃ CHI",
        `Bỏ đánh dấu ĐÃ CHI cho "${row.name}"?${row.hasPaidProof ? " Ảnh hiện tại sẽ được RÚT khỏi khoản — vẫn giữ trong lịch sử." : ""} Chỉ ghi khi bấm Lưu.`,
        { danger: true, confirmText: "Bỏ đánh dấu" },
      );
      if (!ok) return;
    }
    batDauSua("paid");
    setNhap((x) => (v ? { ...x, paid: true } : { ...x, paid: false, anhMoi: undefined, goAnh: undefined, xacNhanTien: undefined }));
  };

  const chonAnh = async (e: ChangeEvent<HTMLInputElement>) => {
    const tep = e.target.files?.[0];
    e.target.value = "";   // chọn lại đúng tệp đó vẫn bắn change
    if (!tep) return;
    if (!tep.type.startsWith("image/")) { toast("Chỉ chọn ảnh (PNG / JPG / WEBP)", "error"); return; }
    batDauSua("anh");
    setDangNen(true);
    try {
      const anh = await compressImage(tep);
      if (conSong.current) setNhap((x) => ({ ...x, anhMoi: anh, goAnh: undefined }));
    } catch (ex) {
      toast(ex instanceof Error && ex.message ? ex.message : LOI_DOC_ANH, "error");
    } finally {
      if (conSong.current) setDangNen(false);
    }
  };

  // Xem ảnh theo yêu cầu, ba trạng thái tách bạch: đang tải / lỗi (+ Thử lại) / thật sự không có (khuôn PaymentDialog ở
  // pages/Personnel.tsx). Tải hỏng mà rơi vào "không có ảnh" là nói ngược với 📎 ở bảng — về một chứng từ TIỀN.
  const xemAnh = async (proofId: number | null, loai: "chi" | "vat" = "chi") => {
    if (!row.rid) return;
    const lan = ++luotXem.current;
    setXem({ proofId, loai, trangThai: "dang-tai", src: "", pdf: false, loi: "", retiredAt: null });
    try {
      const r = await api.anhKhoanChi(row.quoteId, row.side, row.rid, proofId ?? undefined, loai);
      const pdf = laPdfDataUrl(r.paidProof);
      if (conSong.current && lan === luotXem.current) setXem({ proofId, loai, trangThai: "xong", src: pdf ? (r.paidProof as string) : anhHienDuoc(r.paidProof), pdf, loi: "", retiredAt: r.retiredAt });
    } catch (ex) {
      if (conSong.current && lan === luotXem.current) {
        setXem({ proofId, loai, trangThai: "loi", src: "", pdf: false, loi: ex instanceof ApiError ? ex.message : "Không tải được ảnh chứng từ", retiredAt: null });
      }
    }
  };

  // HĐ VAT: ảnh → nén như ảnh chứng từ; PDF → đọc nguyên (không nén được), quá trần thì báo rõ, KHÔNG gửi.
  const chonVat = async (e: ChangeEvent<HTMLInputElement>) => {
    const tep = e.target.files?.[0];
    e.target.value = "";
    if (!tep) return;
    const pdf = tep.type === "application/pdf";
    if (!pdf && !tep.type.startsWith("image/")) { toast("Chỉ chọn ảnh (PNG / JPG / WEBP) hoặc PDF", "error"); return; }
    batDauSua("vat");
    setDangNen(true);
    try {
      const tepUrl = pdf ? await docTepPdf(tep) : await compressImage(tep);
      if (conSong.current) setNhap((x) => ({ ...x, vatMoi: tepUrl, goVat: undefined }));
    } catch (ex) {
      toast(ex instanceof Error && ex.message ? ex.message : LOI_DOC_ANH, "error");
    } finally {
      if (conSong.current) setDangNen(false);
    }
  };

  const chonTep = () => tepRef.current?.click();
  const nutChonAnh = (nhan: string) => (
    <button type="button" className="btn btn-sm" onClick={chonTep} disabled={dangNen}>{dangNen ? "Đang nén ảnh…" : nhan}</button>
  );

  return (
    <div className="modal-backdrop inv-in-hop-nen"
         onMouseDown={(e) => { nenBam.current = e.target === e.currentTarget; }}
         onClick={(e) => { if (e.target === e.currentTarget && nenBam.current) void dong(); }}>
      <div ref={hopRef} className="modal modal-sm inv-in-hop" role="dialog" aria-modal="true" aria-label={`Khoản chi — ${row.name}`} onKeyDown={phim}>
        <div className="modal-head">
          <h3>Khoản chi</h3>
          <button type="button" className="x" onClick={() => void dong()} aria-label="Đóng">✕</button>
        </div>
        <div className="modal-body">
          {mat && <div className="inv-in-warn" role="status">⚠ Dòng này không còn trong danh sách vừa nạp lại (bị xoá / đổi ở báo giá) — không lưu được nữa.</div>}
          {!mat && !row.coTheGhi && row.lyDoKhoa && <div className="inv-in-warn" role="status">⚠ {row.lyDoKhoa}</div>}
          {!mat && row.version !== banLucMo.current && (
            <p className="inv-in-hop-lydo" role="status">Khoản vừa được cập nhật ở nơi khác — các ô bạn chưa sửa đã lấy giá trị mới.</p>
          )}

          <dl className="inv-in-hop-dau">
            <dt>Mã / trang</dt>
            <dd><strong>{row.sheetCode || row.quoteCode}</strong>{row.sheetName ? ` · ${row.sheetName}` : ""}</dd>
            <dt>Khách hàng</dt>
            <dd>{row.customerName || row.customerCode || "—"}</dd>
            <dt>Loại bảng</dt>
            <dd><span className={`extra-cat-badge cat-${row.category}`}>{LOAI_BANG[row.category] ?? row.category}</span>{tenRieng ? ` · ${tenRieng}` : ""}</dd>
            <dt>Hạng mục</dt>
            <dd>{row.name || "—"}{row.detail ? <span className="muted"> — {row.detail}</span> : null}</dd>
            <dt>Thành tiền</dt>
            <dd>
              <strong>{fmtMoney(row.amount)}</strong>
              <span className="muted"> ({fmtSoLuong(row.quantity)}{row.unit ? ` ${row.unit}` : ""} × {fmtMoney(row.unitPrice)}{row.days != null && row.days > 0 ? ` × ${fmtSoLuong(row.days)} ngày` : ""}){row.chungTu ? ` · ${NHAN_CHUNG_TU[row.chungTu] ?? row.chungTu}` : ""}</span>
            </dd>
            <dt>Duyệt</dt>
            <dd>{row.approvedByName || "—"}{row.approvedAt ? ` · ${fmtDate(row.approvedAt)}` : ""}</dd>
            <dt>Trạng thái hàng</dt>
            <dd className={row.trangThaiHang === "binh-thuong" ? undefined : "inv-in-hop-canh"}>{row.trangThaiHang === "binh-thuong" ? nhanTrangThaiHang(row.trangThaiHang) : `⚠ ${nhanTrangThaiHang(row.trangThaiHang)}`}</dd>
          </dl>

          <div className="inv-in-hop-o">
            <label className="inv-in-hop-tick">
              <input type="checkbox" name="paid" checked={paid} disabled={khoaTich} onChange={(e) => void doiDaChi(e.currentTarget.checked)} />
              <span><b>Đã chi</b>{row.paid && row.paidAt ? ` · ${fmtDate(row.paidAt)}` : ""}</span>
            </label>
            {!canPay
              ? <p className="inv-in-hop-lydo">Bạn chưa có quyền tích ĐÃ CHI — nhờ quản trị cấp quyền Hóa đơn đầu vào: tích ĐÃ CHI + ảnh chứng từ.</p>
              : lyDoTich ? <p className="inv-in-hop-lydo">{lyDoTich}</p> : null}
            {row.paid && (row.paidByName || row.paidAt) && (
              <p className="inv-in-hop-meta">Đánh dấu bởi {row.paidByName || "—"} lúc {fmtDateTime(row.paidAt) || "—"}{row.nguon === "json-cu" ? " (đánh dấu từ màn soạn — bản cũ)" : ""}</p>
            )}
          </div>

          {row.paid && row.tienDoi && (
            <div className="inv-in-warn" role="status">
              ⚠ Số tiền đã đổi sau khi chi: đã chi {fmtMoney(row.paidAmount)} — hiện {fmtMoney(row.amount)}.
              {canPay && paid && ghiDuoc && (
                <label className="inv-in-hop-tick">
                  <input type="checkbox" name="xacNhanTien" checked={!!nhap.xacNhanTien}
                         onChange={(e) => { const v = e.currentTarget.checked; batDauSua("paid"); setNhap((x) => ({ ...x, xacNhanTien: v || undefined })); }} />
                  <span>Xác nhận số tiền hiện tại</span>
                </label>
              )}
            </div>
          )}

          <div className="inv-in-hop-o">
            <span className="inv-in-hop-nhan">Ảnh chứng từ (ủy nhiệm chi)</span>
            {canPay ? (
              <>
                {nhap.anhMoi ? (
                  <div className="inv-in-hop-anh">
                    <img src={anhHienDuoc(nhap.anhMoi)} alt="Ảnh chứng từ vừa chọn (chưa lưu)" />
                    <div className="inv-in-hop-hang">
                      <span className="muted">Ảnh vừa chọn — bấm Lưu mới ghi.</span>
                      <button type="button" className="btn btn-sm" onClick={() => setNhap((x) => ({ ...x, anhMoi: undefined }))}>Bỏ ảnh vừa chọn</button>
                    </div>
                  </div>
                ) : row.hasPaidProof && !nhap.goAnh ? (
                  <div className="inv-in-hop-hang">
                    <span>📎 Đã có ảnh</span>
                    <button type="button" className="btn btn-sm" onClick={() => void xemAnh(null)}>Xem ảnh</button>
                    {dinhAnhDuoc && nutChonAnh("Thay ảnh")}
                    {paid && ghiDuoc && <button type="button" className="btn btn-sm" onClick={() => { batDauSua("anh"); setNhap((x) => ({ ...x, goAnh: true })); }}>Gỡ ảnh</button>}
                  </div>
                ) : (
                  <div className="inv-in-hop-hang">
                    {nhap.goAnh
                      ? <span className="inv-in-hop-canh">Ảnh hiện tại sẽ được gỡ khi Lưu (vẫn giữ trong lịch sử).</span>
                      : <span className="muted">{paid ? "Chưa có ảnh chứng từ." : "Tích “Đã chi” rồi mới đính ảnh."}</span>}
                    {nhap.goAnh && <button type="button" className="btn btn-sm" onClick={() => setNhap((x) => ({ ...x, goAnh: undefined }))}>Giữ ảnh</button>}
                    {dinhAnhDuoc && nutChonAnh("Chọn ảnh…")}
                  </div>
                )}
                {row.paid && !paid && row.hasPaidProof && <p className="inv-in-hop-lydo">Bỏ tích: ảnh hiện tại sẽ được RÚT khỏi khoản khi Lưu — vẫn giữ trong lịch sử.</p>}
                {paid && row.trangThaiHang === "khong-con-hang" && <p className="inv-in-hop-lydo">Dòng không còn trong báo giá — không đính ảnh mới được.</p>}
                <input name="anhChungTu" ref={tepRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void chonAnh(e)} />

                {xem && xem.loai === "chi" && (
                  <div className="inv-in-hop-xem" aria-live="polite">
                    <div className="inv-in-hop-hang">
                      <b>{xem.proofId == null ? "Ảnh hiện tại" : `Ảnh #${xem.proofId}`}</b>
                      {xem.retiredAt && <span className="muted">· đã rút {fmtDateTime(xem.retiredAt)}</span>}
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setXem(null)}>Ẩn ảnh</button>
                    </div>
                    {xem.trangThai === "dang-tai" && <div className="skeleton-wrap" aria-busy="true"><div className="skeleton-row" /><div className="skeleton-row" /></div>}
                    {xem.trangThai === "loi" && (
                      <p className="err" role="alert">{xem.loi} <button type="button" className="btn btn-sm" onClick={() => void xemAnh(xem.proofId)}>Thử lại</button></p>
                    )}
                    {xem.trangThai === "xong" && (xem.pdf
                      ? <TaiPdf dataUrl={xem.src} tenTep={`chung-tu-${row.rid}.pdf`} />
                      : xem.src
                        ? <div className="pay-proof"><img src={anhHienDuoc(xem.src)} alt="Ảnh chứng từ" /></div>
                        : <p className="muted">Không có ảnh (hoặc ảnh cũ không đọc được).</p>)}
                  </div>
                )}
                {anhTruoc.length > 0 && (
                  <details className="inv-in-hop-truoc">
                    <summary>Ảnh trước ({anhTruoc.length})</summary>
                    <ul>
                      {anhTruoc.map((p) => (
                        <li key={p.id}>
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void xemAnh(p.id)}>
                            #{p.id} · {fmtDateTime(p.uploadedAt) || "—"}{p.uploadedByName ? ` · ${p.uploadedByName}` : ""}{p.retiredReason ? ` · ${NHAN_LY_DO_RUT[p.retiredReason] ?? p.retiredReason}` : ""}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <span className="muted">{row.hasPaidProof ? "📎 Đã có ảnh — chỉ người có quyền tích ĐÃ CHI xem được." : "Chưa có ảnh chứng từ."}</span>
            )}
          </div>

          {hienPhanVat && (
            <div className="inv-in-hop-o inv-in-hop-vat" data-phan-vat>
              <span className="inv-in-hop-nhan">Hóa đơn VAT</span>
              {!laVat && <p className="inv-in-hop-lydo">Chứng từ của dòng này không còn là VAT — hóa đơn đã đưa vẫn giữ, nhưng không đưa hóa đơn mới.</p>}
              {canPay ? (
                <>
                  {nhap.vatMoi ? (
                    <div className="inv-in-hop-anh">
                      {laPdfDataUrl(nhap.vatMoi)
                        ? <p>📄 Hóa đơn PDF vừa chọn</p>
                        : <img src={anhHienDuoc(nhap.vatMoi)} alt="Hóa đơn VAT vừa chọn (chưa lưu)" />}
                      <div className="inv-in-hop-hang">
                        <span className="muted">Hóa đơn vừa chọn — bấm Lưu mới ghi.</span>
                        <button type="button" className="btn btn-sm" onClick={() => setNhap((x) => ({ ...x, vatMoi: undefined }))}>Bỏ hóa đơn vừa chọn</button>
                      </div>
                    </div>
                  ) : coVat && !nhap.goVat ? (
                    <div className="inv-in-hop-hang">
                      <span>🧾 Đã có hóa đơn VAT{row.vatProofAt ? ` · ${fmtDateTime(row.vatProofAt)}` : ""}{row.vatProofByName ? ` · ${row.vatProofByName}` : ""}</span>
                      <button type="button" className="btn btn-sm" onClick={() => void xemAnh(null, "vat")}>Xem hóa đơn</button>
                      {dinhVatDuoc && <button type="button" className="btn btn-sm" onClick={() => tepVatRef.current?.click()} disabled={dangNen}>{dangNen ? "Đang đọc tệp…" : "Thay hóa đơn"}</button>}
                      {ghiDuoc && <button type="button" className="btn btn-sm" onClick={() => { batDauSua("vat"); setNhap((x) => ({ ...x, goVat: true })); }}>Gỡ hóa đơn</button>}
                    </div>
                  ) : (
                    <div className="inv-in-hop-hang">
                      {nhap.goVat
                        ? <span className="inv-in-hop-canh">Hóa đơn hiện tại sẽ được gỡ khi Lưu (vẫn giữ trong lịch sử).</span>
                        : <span className={paid ? "inv-in-hop-canh" : "muted"}>{paid ? "Đã chi nhưng chưa có hóa đơn VAT." : "Chưa có hóa đơn VAT."}</span>}
                      {nhap.goVat && <button type="button" className="btn btn-sm" onClick={() => setNhap((x) => ({ ...x, goVat: undefined }))}>Giữ hóa đơn</button>}
                      {dinhVatDuoc && <button type="button" className="btn btn-sm" onClick={() => tepVatRef.current?.click()} disabled={dangNen}>{dangNen ? "Đang đọc tệp…" : "Chọn ảnh / PDF…"}</button>}
                    </div>
                  )}
                  <input name="hoaDonVat" ref={tepVatRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden onChange={(e) => void chonVat(e)} />
                  {xem && xem.loai === "vat" && (
                    <div className="inv-in-hop-xem" aria-live="polite">
                      <div className="inv-in-hop-hang">
                        <b>{xem.proofId == null ? "Hóa đơn hiện tại" : `Hóa đơn #${xem.proofId}`}</b>
                        {xem.retiredAt && <span className="muted">· đã rút {fmtDateTime(xem.retiredAt)}</span>}
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setXem(null)}>Ẩn</button>
                      </div>
                      {xem.trangThai === "dang-tai" && <div className="skeleton-wrap" aria-busy="true"><div className="skeleton-row" /><div className="skeleton-row" /></div>}
                      {xem.trangThai === "loi" && (
                        <p className="err" role="alert">{xem.loi} <button type="button" className="btn btn-sm" onClick={() => void xemAnh(xem.proofId, "vat")}>Thử lại</button></p>
                      )}
                      {xem.trangThai === "xong" && (xem.pdf
                        ? <TaiPdf dataUrl={xem.src} tenTep={`hoa-don-vat-${row.rid}.pdf`} />
                        : xem.src
                          ? <div className="pay-proof"><img src={anhHienDuoc(xem.src)} alt="Hóa đơn VAT" /></div>
                          : <p className="muted">Không đọc được tệp này.</p>)}
                    </div>
                  )}
                  {vatTruoc.length > 0 && (
                    <details className="inv-in-hop-truoc">
                      <summary>Hóa đơn trước ({vatTruoc.length})</summary>
                      <ul>
                        {vatTruoc.map((p) => (
                          <li key={p.id}>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void xemAnh(p.id, "vat")}>
                              #{p.id} · {fmtDateTime(p.uploadedAt) || "—"}{p.uploadedByName ? ` · ${p.uploadedByName}` : ""}{p.retiredReason ? ` · ${NHAN_LY_DO_RUT[p.retiredReason] ?? p.retiredReason}` : ""}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <span className="muted">{coVat ? "🧾 Đã có hóa đơn VAT — chỉ người có quyền tích ĐÃ CHI xem được." : "Chưa có hóa đơn VAT."}</span>
              )}
            </div>
          )}

          <label className="inv-in-hop-o">
            <span className="inv-in-hop-nhan">Ngày hóa đơn</span>
            <input type="date" name="invoiceDate" value={ngay} min="2000-01-01" max="2100-12-31" disabled={!canEdit || !ghiDuoc}
                   onChange={(e) => {
                     const v = e.currentTarget.value, gioDo = !!e.currentTarget.validity?.badInput;
                     batDauSua("invoiceDate");
                     setNgayLoi(gioDo ? "do" : v && !laNgayHoaDon(v) ? "khoang" : "");
                     setNhap((x) => ({ ...x, invoiceDate: v }));
                   }} />
            {ngayLoi === "do" && <span className="field-err">Ngày chưa đủ ngày / tháng / năm.</span>}
            {ngayLoi === "khoang" && <span className="field-err">Ngày hóa đơn phải trong khoảng 01/01/2000 – 31/12/2100.</span>}
          </label>
          <label className="inv-in-hop-o">
            <span className="inv-in-hop-nhan">Ghi chú kế toán</span>
            <textarea name="accountingNote" rows={3} maxLength={GHI_CHU_TOI_DA} value={ghiChu} disabled={!canEdit || !ghiDuoc}
                      onChange={(e) => { const v = e.currentTarget.value; batDauSua("accountingNote"); setNhap((x) => ({ ...x, accountingNote: v })); }} />
            <span className="inv-in-hop-dem">{ghiChu.length}/{GHI_CHU_TOI_DA} · Enter xuống dòng · Ctrl+Enter lưu</span>
          </label>
          {!canEdit && <p className="inv-in-hop-lydo">Bạn chưa có quyền sửa Ngày hóa đơn / Ghi chú kế toán — cần quyền “Sửa hóa đơn”.</p>}

          {row.keToanCapNhatLuc && (
            <p className="inv-in-hop-meta">Cập nhật lần cuối {fmtDateTime(row.keToanCapNhatLuc)}{row.keToanCapNhatBoi ? ` · ${row.keToanCapNhatBoi}` : ""}</p>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={() => void dong()} disabled={dangLuu}>Hủy</button>
          <button type="button" className="btn btn-primary" onClick={() => void luu()} disabled={!luuDuoc}>{dangLuu ? "Đang lưu…" : "Lưu"}</button>
        </div>
      </div>
    </div>
  );
}
