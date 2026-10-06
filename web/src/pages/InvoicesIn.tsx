import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Me, type InputInvoiceRow, type InputInvoicesResp, type KhoanChiDto } from "../lib/api";
import { fmtMoney, fmtDate, toInputDate, statusLabel, dash, Stat } from "../lib/format";
import { smartTextMatch } from "../lib/filterText";
import { CHUNG_TU } from "../lib/gridShared";
import { useTrangAnToan } from "../lib/phienBan";
import { LOAI_BANG, canhBaoKhoan, fmtNgayThuan, fmtSoLuong, tenBangRieng, trangThaiVat } from "../lib/khoanChi";
import { HopKhoanChi } from "../components/HopKhoanChi";

// Trang HÓA ĐƠN ĐẦU VÀO (kế toán) — chủ repo 2026-09-30: "trang của những cái nào đã duyệt ở phần nội bộ".
// Mỗi HÀNG bảng nội bộ của báo giá (Chi phí HCM · Phí khách hàng · Báo giá Hà Nội) mà người có quyền duyệt đã
// DUYỆT là một khoản chi — và là một hoá đơn đầu vào kế toán phải đòi/đối chiếu. Đối xứng với trang Hóa đơn ĐẦU RA
// (Invoices.tsx: hoá đơn xuất cho khách). Luật chọn hàng + tính tiền nằm ở máy chủ (src/inputInvoices.ts) — trang này
// không tự cộng lại tiền của dòng.
//
// CỘT "KẾ TOÁN" (chủ repo 2026-10-06: "cái thanh toán bên đó là cho kế toán, không nằm trong kia nữa"): kế toán tích
// ĐÃ CHI + ảnh chứng từ (invoice:input:pay) và ghi Ngày hóa đơn + Ghi chú kế toán (invoice:edit) qua hộp "Khoản chi"
// (components/HopKhoanChi.tsx). Duyệt / bỏ duyệt và đổi chứng từ vẫn là việc của màn soạn báo giá.
//
// DANH SÁCH LÀ HỢP BA NHÓM (máy chủ): ngoài hàng đã duyệt còn các khoản đã có dữ liệu kế toán mà hàng bị bỏ duyệt, bị
// xoá khỏi báo giá, hay báo giá bị xoá — để kế toán (không mở được báo giá) không bao giờ gặp ngõ cụt. Các dòng đó KHÔNG
// lẫn vào danh sách chính và KHÔNG cộng vào thẻ tiền; chúng nằm riêng sau thẻ "Cần chú ý".

const NHAN_CHUNG_TU: Record<string, string> = Object.fromEntries(CHUNG_TU);
const TRANG_THAI_BAO_GIA: Record<string, string> = { converted: "Đã chốt", draft: "Nháp", lost: "Không chốt" };
const CO_TRANG = 100;   // số dòng mỗi trang (phân trang phía trình duyệt — máy chủ trả hết một lượt, như trang Hóa đơn đầu ra)

export type BoLoc = {
  q: string; loai: string; chungTu: string; thanhToan: string; trangThai: string; tu: string; den: string;
  /** "" | "co" | "chua" — Ngày hóa đơn đã ghi chưa. */
  ngayHd: string;
  /** "" | "chua-vat" | "da-vat" | "vat-chua-tt" — trạng thái hóa đơn VAT (chỉ hàng chứng từ VAT; lib/khoanChi.ts trangThaiVat). */
  vat: string;
  /** Chỉ xem các dòng CẦN CHÚ Ý (trangThaiHang ≠ 'binh-thuong'); tắt = danh sách chính, không lẫn các dòng đó. */
  chuY: boolean;
};
export const BO_LOC_RONG: BoLoc = { q: "", loai: "", chungTu: "", thanhToan: "", trangThai: "", tu: "", den: "", ngayHd: "", vat: "", chuY: false };
const KHONG_GHIM: ReadonlySet<string> = new Set();
const TU_TIM_VAT: Record<string, string> = { "chua-vat": "thiếu hóa đơn vat", "da-vat": "đã có hóa đơn vat", "vat-chua-tt": "có hóa đơn vat" };

/**
 * Lọc phía trình duyệt. Thuần (xuất ra để test): mỗi nhóm độc lập nên kết hợp tự do, vd HCM + VAT + Chưa thanh toán.
 * `giu` = khoá các dòng vừa sửa ở hộp Khoản chi: chúng ĐỨNG YÊN dù không còn khớp bộ lọc (tích "Đã chi" khi đang lọc
 * "Chưa thanh toán" mà dòng biến mất ngay dưới tay là rất khó chịu) — tới khi người dùng đổi bộ lọc.
 */
export function locHang(rows: InputInvoiceRow[], b: BoLoc, giu: ReadonlySet<string> = KHONG_GHIM): InputInvoiceRow[] {
  return rows.filter((r) => {
    if (giu.has(r.key)) return true;
    if (b.chuY ? r.trangThaiHang === "binh-thuong" : r.trangThaiHang !== "binh-thuong") return false;
    if (b.loai && r.category !== b.loai) return false;
    if (b.chungTu === "none" ? r.chungTu != null : b.chungTu && r.chungTu !== b.chungTu) return false;
    if (b.thanhToan === "paid" && !r.paid) return false;
    if (b.thanhToan === "unpaid" && r.paid) return false;
    if (b.ngayHd === "co" && !r.invoiceDate) return false;
    if (b.ngayHd === "chua" && r.invoiceDate) return false;
    if (b.vat && trangThaiVat(r.chungTu, r.paid, !!r.hasVatProof) !== b.vat) return false;
    if (b.trangThai === "other" ? r.status in TRANG_THAI_BAO_GIA : b.trangThai && r.status !== b.trangThai) return false;
    // Khoảng NGÀY DUYỆT: hàng không có ngày duyệt (dữ liệu cũ) không thể nằm trong một khoảng ngày đã chọn.
    if (b.tu || b.den) {
      const ngay = toInputDate(r.approvedAt);
      if (!ngay || (b.tu && ngay < b.tu) || (b.den && ngay > b.den)) return false;
    }
    return smartTextMatch(b.q, [
      r.quoteCode, r.title, r.customerName, r.customerCode, r.sheetCode, r.sheetName, r.tableName, LOAI_BANG[r.category],
      r.name, r.detail, r.ns, r.chungTu ? NHAN_CHUNG_TU[r.chungTu] : "", r.approvedByName, r.createdByName, r.companyName,
      r.amount, fmtMoney(r.amount), fmtDate(r.approvedAt), TRANG_THAI_BAO_GIA[r.status] ?? statusLabel(r.status),
      r.paid ? "đã thanh toán đã chi" : "chưa thanh toán chưa chi",
      // Phần kế toán: ghi chú, Ngày HĐ (dd/mm/yyyy như ô hiển thị) và người đánh dấu đã chi.
      r.accountingNote, fmtNgayThuan(r.invoiceDate), r.paidByName,
      // Trạng thái HĐ VAT — KHÔNG dùng chữ "chưa" cho hàng đã chi (tìm "chưa thanh toán" sẽ khớp nhầm hàng đã trả).
      TU_TIM_VAT[trangThaiVat(r.chungTu, r.paid, !!r.hasVatProof) ?? ""] ?? "",
    ]);
  });
}

type SortKey = "approvedAt" | "amount";
const SORT_COLS: Record<string, SortKey> = { "Duyệt": "approvedAt", "Thành tiền": "amount" };
// 10 cột vừa khung nội dung 972px ở laptop 1280×720 (lab scratchpad wf-vua-laptop-hoa-don-vao, biến thể C2/C4w): loại
// bảng vào dòng phụ của Hạng mục, Lưu kho vào dòng phụ của Chứng từ, ngày + người duyệt chung một cột.
const HEADERS = ["Mã dự án", "Khách hàng", "Hạng mục", "NS", "SL", "Đơn giá", "Thành tiền", "Chứng từ", "Duyệt", "Kế toán"];
const LOP_TIEU_DE: Record<string, string> = { "SL": "num", "Đơn giá": "num", "Thành tiền": "num", "Kế toán": "inv-in-kt" };
const KHONG_HANG: InputInvoiceRow[] = [];
// Cú bấm từ các phần tử này KHÔNG mở báo giá — kể cả cú bấm trong hộp thoại (sự kiện React nổi theo cây thành phần), và cả
// khoảng trống của ô "Kế toán" quanh nút (hụt nút một chút mà nhảy sang màn soạn là mất chỗ đang làm).
const BO_QUA_BAM = "button,a,input,select,textarea,[data-ke-toan],[role=dialog],td.inv-in-kt";

/** Ba dòng của ô "Kế toán": đã chi + ảnh · Ngày HĐ (+ ⚠) · ghi chú cắt một dòng (đủ chữ ở title). */
function NoiDungKeToan({ r }: { r: InputInvoiceRow }) {
  const canh = canhBaoKhoan(r);
  // Hàng chứng từ VAT: cùng trạng thái với cột Thanh toán ở bảng nội bộ (components/OThanhToan.tsx).
  const vat = trangThaiVat(r.chungTu, r.paid, !!r.hasVatProof);
  return (
    <>
      <span className="inv-in-kt-d1">
        {r.paid ? (
          <>
            <span className="inv-in-kt-tt txt-ok">✓ Đã chi{r.paidAt ? ` · ${fmtDate(r.paidAt)}` : ""}</span>{" "}
            {r.hasPaidProof
              ? <span role="img" aria-label="Có ảnh chứng từ" title="Có ảnh chứng từ">📎</span>
              : <span className="inv-in-kt-thieu">⚠ chưa có ảnh</span>}
          </>
        ) : <span className="muted">Chưa chi</span>}
        {vat && (
          <span className={`inv-in-kt-vat${vat === "chua-vat" ? " inv-in-kt-thieu" : ""}`} data-vat={vat}>
            {" "}{vat === "vat-chua-tt" ? "🧾 Có HĐ VAT" : vat === "da-vat" ? "· 🧾 đã có VAT" : "· ⚠ chưa VAT"}
          </span>
        )}
      </span>
      <span className="inv-in-sub inv-in-kt-d2">
        {canh.length > 0 && <span className="inv-in-kt-canh" data-canh role="img" aria-label={canh.join(" · ")} title={canh.join("\n")}>⚠</span>}
        HĐ {fmtNgayThuan(r.invoiceDate) || "—"}
      </span>
      {r.accountingNote && <span className="inv-in-sub inv-in-kt-ghichu" title={r.accountingNote}>{r.accountingNote}</span>}
    </>
  );
}

export function InvoicesInPage({ me }: { me: Me }) {
  // Tải lại trang không mất gì — TRỪ khi hộp Khoản chi còn thay đổi chưa lưu (dải "Có bản mới", lib/phienBan.ts).
  const hopThayDoi = useRef(false);
  useTrangAnToan(() => !hopThayDoi.current);
  const datHopThayDoi = useCallback((co: boolean) => { hopThayDoi.current = co; }, []);
  const qc = useQueryClient();
  // Mở được báo giá chỉ khi có quyền đọc báo giá: kế toán thường KHÔNG có (server 403) — đừng mời họ bấm vào ngõ cụt.
  const moDuoc = me.permissions.includes("quote:read:own") || me.permissions.includes("quote:read:all");
  // Theo QUYỀN, không theo vai (máy chủ kiểm y hệt, theo từng trường của lệnh ghi).
  const canPay = me.permissions.includes("invoice:input:pay");
  const canEdit = me.permissions.includes("invoice:edit");
  const { data, isPending, error } = useQuery({ queryKey: ["inputInvoices"], queryFn: api.inputInvoices });
  const [b, setB] = useState<BoLoc>(BO_LOC_RONG);
  const dat = (p: Partial<BoLoc>) => setB((x) => ({ ...x, ...p }));
  // Bản sao MỚI (không đặt lại đúng đối tượng hằng): ghim dòng vừa sửa nhận bộ lọc theo danh tính đối tượng.
  const xoaLoc = () => setB({ ...BO_LOC_RONG });
  const rows = data?.data ?? KHONG_HANG;   // mảng cố định: `?? []` đẻ mảng MỚI mỗi lượt vẽ → useMemo bên dưới tính lại mỗi lần
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";

  // Dòng vừa sửa đứng yên tới khi ĐỔI BỘ LỌC: ghim gắn với đúng bộ lọc lúc ghim, đổi lọc là tự rơi (không cần effect).
  const [ghim, setGhim] = useState<{ b: BoLoc; keys: ReadonlySet<string> }>({ b: BO_LOC_RONG, keys: KHONG_GHIM });
  const giu = ghim.b === b ? ghim.keys : KHONG_GHIM;
  const shown = useMemo(() => locHang(rows, b, giu), [rows, b, giu]);
  const soBoLoc = Object.values(b).filter(Boolean).length;
  const soChuY = useMemo(() => locHang(rows, { ...b, chuY: true }).length, [rows, b]);
  const coHangDuyet = useMemo(() => rows.some((r) => r.trangThaiHang === "binh-thuong"), [rows]);

  const [sortKey, setSortKey] = useState<SortKey | "">("");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const toggleSort = (k: SortKey) => { if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(1); } };
  const sorted = useMemo(() => {
    if (!sortKey) return shown;
    const val = (r: InputInvoiceRow) => (sortKey === "amount" ? r.amount : r.approvedAt ? Date.parse(r.approvedAt) : null);
    return [...shown].sort((x, y) => {
      const a = val(x), c = val(y);
      if (a == null && c == null) return 0;
      if (a == null) return 1;        // ô trống luôn xuống cuối
      if (c == null) return -1;
      return (a - c) * sortDir;
    });
  }, [shown, sortKey, sortDir]);

  // Phân trang: đổi bộ lọc / sắp xếp thì về trang 1 — giữ số trang cũ là nhìn vào một trang trống.
  const [trang, setTrang] = useState(1);
  const soTrang = Math.max(1, Math.ceil(sorted.length / CO_TRANG));
  useEffect(() => { setTrang(1); }, [b, sortKey, sortDir]);
  const trangNay = Math.min(trang, soTrang);
  const hien = sorted.slice((trangNay - 1) * CO_TRANG, trangNay * CO_TRANG);

  // THẺ TIỀN chỉ cộng dòng 'binh-thuong' (quy tắc tiền không đổi: hàng chưa duyệt / không còn / báo giá đã xoá không phải
  // khoản chi đang hiệu lực). "Số khoản" là số dòng đang hiện.
  const binhThuong = shown.filter((r) => r.trangThaiHang === "binh-thuong");
  const tong = binhThuong.reduce((s, r) => s + r.amount, 0);
  const daTT = binhThuong.reduce((s, r) => s + (r.paid ? r.amount : 0), 0);
  const coVat = binhThuong.reduce((s, r) => s + (r.chungTu === "VAT" ? r.amount : 0), 0);
  const moQuote = (id: number) => { location.hash = "#/quotes/" + id; };

  // ── HỘP KHOẢN CHI (vẽ ở MỨC TRANG, ngoài <tr>) ──────────────────────────────────────────────────────────────────
  const [hop, setHop] = useState<{ key: string; row: InputInvoiceRow } | null>(null);
  const nutMo = useRef<HTMLElement | null>(null);
  const hopRow = useMemo(() => (hop ? rows.find((r) => r.key === hop.key) ?? null : null), [hop, rows]);
  // Ghi được → hộp ghi; không ghi được mà có mã (báo giá đã xoá…) → hộp CHỈ XEM: xem ảnh chứng từ, ngày HĐ, ghi chú, lịch sử
  // ảnh — tiền đã chi vẫn phải đối chiếu được. Hàng thiếu mã không định vị được khoản nên không có gì để mở.
  const coTheMoHop = (r: InputInvoiceRow) => (canPay || canEdit) && (r.coTheGhi || !!r.rid);
  // Báo giá đã xoá thì không mở được nữa (máy chủ 404) — dòng của nó không mời bấm.
  const moDuocDong = (r: InputInvoiceRow) => moDuoc && r.trangThaiHang !== "bao-gia-da-xoa";
  const moHop = (r: InputInvoiceRow, nut: HTMLElement) => { nutMo.current = nut; setHop({ key: r.key, row: r }); };
  const dongHop = useCallback(() => {
    setHop(null);
    // Trả tiêu điểm về đúng ô vừa bấm (bộ giam tiêu điểm toàn cục bỏ qua nếu hộp tự đặt tiêu điểm vào ô bên trong trước).
    const nut = nutMo.current;
    setTimeout(() => { if (nut && nut.isConnected) nut.focus(); }, 0);
  }, []);
  const napLai = useCallback(() => { void qc.invalidateQueries({ queryKey: ["inputInvoices"] }); }, [qc]);
  // 200 → vá cache bằng dòng máy chủ trả về (khớp khoá) + ghim dòng đó cho tới khi đổi bộ lọc.
  const daLuu = useCallback((d: KhoanChiDto) => {
    const { key, quoteId: _q, side: _s, rid: _r, ...keToan } = d;
    qc.setQueryData<InputInvoicesResp>(["inputInvoices"], (cu) => cu && { ...cu, data: cu.data.map((r) => (r.key === key ? { ...r, ...keToan } : r)) });
    setGhim((g) => {
      const keys = new Set(g.b === b ? g.keys : KHONG_GHIM);
      keys.add(key);
      return { b, keys };
    });
  }, [qc, b]);

  return (
    <div>
      <h1>Hóa đơn đầu vào</h1>
      <p className="muted">Các <b>hàng đã duyệt</b> ở bảng nội bộ của báo giá (Chi phí HCM · Phí khách hàng · Báo giá Hà Nội) — mỗi hàng là một khoản chi cần <b>hóa đơn đầu vào</b>. Cột <b>Kế toán</b>: tích <b>Đã chi</b> + ảnh chứng từ, ghi <b>Ngày hóa đơn</b> và <b>Ghi chú kế toán</b>. Duyệt / bỏ duyệt và đổi chứng từ làm ở màn soạn báo giá.{moDuoc && " Bấm dòng để mở báo giá."}</p>
      {!canPay && <p className="muted inv-in-goi-y">Bạn chưa có quyền tích ĐÃ CHI — nhờ quản trị cấp quyền <b>Hóa đơn đầu vào: tích ĐÃ CHI + ảnh chứng từ</b>.</p>}

      <div className="inv-filters">
        <div className="toolbar inv-filter-row inv-filter-main">
          <input className="grow" type="search" name="q" placeholder="Tìm không dấu: dự án, khách, hạng mục, NS, số tiền, người duyệt, ghi chú KT, ngày HĐ…" value={b.q} onChange={(e) => dat({ q: e.target.value })} aria-label="Tìm hóa đơn đầu vào" />
          <select name="loai" value={b.loai} onChange={(e) => dat({ loai: e.target.value })} aria-label="Lọc theo loại bảng">
            <option value="">Loại bảng: Tất cả</option>
            {Object.entries(LOAI_BANG).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select name="chungTu" value={b.chungTu} onChange={(e) => dat({ chungTu: e.target.value })} aria-label="Lọc theo chứng từ">
            <option value="">Chứng từ: Tất cả</option>
            {CHUNG_TU.map(([ma, nhan]) => <option key={ma} value={ma}>{nhan}</option>)}
            <option value="none">Chưa chọn chứng từ</option>
          </select>
          <select name="thanhToan" value={b.thanhToan} onChange={(e) => dat({ thanhToan: e.target.value })} aria-label="Lọc theo thanh toán">
            <option value="">Thanh toán: Tất cả</option><option value="paid">Đã thanh toán</option><option value="unpaid">Chưa thanh toán</option>
          </select>
        </div>
        {/* "Ngày HĐ" ở hàng HAI: ô tìm (sàn 260px) + bốn ô chọn ở hàng một tràn 30px ở laptop 1280px — khung lọc cắt mất
            nửa phải của ô thứ tư (đo headless 2026-10-06, scratchpad do-kt-cot.mjs). */}
        <div className="toolbar inv-filter-row inv-filter-extra">
          <select name="trangThai" value={b.trangThai} onChange={(e) => dat({ trangThai: e.target.value })} aria-label="Lọc theo trạng thái báo giá">
            <option value="">Báo giá: Tất cả</option><option value="converted">Đã chốt</option><option value="draft">Nháp</option><option value="lost">Không chốt</option><option value="other">Khác</option>
          </select>
          <select name="vat" value={b.vat} onChange={(e) => dat({ vat: e.target.value })} aria-label="Lọc theo hóa đơn VAT">
            <option value="">Hóa đơn VAT: Tất cả</option>
            <option value="chua-vat">Đã TT · chưa VAT</option>
            <option value="da-vat">Đã TT · đã có VAT</option>
            <option value="vat-chua-tt">Có HĐ VAT · chưa TT</option>
          </select>
          <select name="ngayHd" value={b.ngayHd} onChange={(e) => dat({ ngayHd: e.target.value })} aria-label="Lọc theo ngày hóa đơn">
            <option value="">Ngày HĐ: Tất cả</option><option value="co">Đã có ngày HĐ</option><option value="chua">Chưa có ngày HĐ</option>
          </select>
          <label className="inv-date-filter"><span>Duyệt từ ngày</span><input type="date" name="tu" value={b.tu} max={b.den || undefined} onChange={(e) => dat({ tu: e.target.value })} /></label>
          <label className="inv-date-filter"><span>Đến ngày</span><input type="date" name="den" value={b.den} min={b.tu || undefined} onChange={(e) => dat({ den: e.target.value })} /></label>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" type="button" disabled={!soBoLoc} onClick={xoaLoc}>Xóa tất cả{soBoLoc ? <span className="inv-filter-count">{soBoLoc}</span> : null}</button>
        </div>
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => qc.invalidateQueries({ queryKey: ["inputInvoices"] })}>Thử lại</button></div>}
      {data?.meta.truncated && <div className="inv-in-warn" role="status">⚠ Chỉ hiện các khoản của báo giá mới nhất (đã chạm trần số báo giá một lượt) — còn khoản của báo giá cũ hơn chưa hiển thị.</div>}

      {isPending ? (
        <div className="skeleton-wrap">{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : err && !data ? null : (   /* lỗi tải mà CHƯA có dữ liệu → chỉ hiện banner lỗi, không hiện stat 0 gây hiểu nhầm */
        <>
          <div className="stat-row">
            <Stat label="Tổng tiền đã duyệt" value={fmtMoney(tong)} />
            <Stat label="Đã thanh toán" value={fmtMoney(daTT)} tone="ok" active={b.thanhToan === "paid"} onClick={() => dat({ thanhToan: b.thanhToan === "paid" ? "" : "paid" })} title="Bấm để lọc khoản đã thanh toán" />
            <Stat label="Chưa thanh toán" value={fmtMoney(tong - daTT)} active={b.thanhToan === "unpaid"} onClick={() => dat({ thanhToan: b.thanhToan === "unpaid" ? "" : "unpaid" })} title="Bấm để lọc khoản chưa thanh toán" />
            <Stat label="Có chứng từ VAT" value={fmtMoney(coVat)} active={b.chungTu === "VAT"} onClick={() => dat({ chungTu: b.chungTu === "VAT" ? "" : "VAT" })} title="Bấm để lọc khoản có chứng từ VAT" />
            <Stat label="Số khoản" value={String(shown.length)} />
            {(soChuY > 0 || b.chuY) && (
              <Stat label="Cần chú ý" value={String(soChuY)} tone="danger" active={b.chuY} onClick={() => dat({ chuY: !b.chuY })}
                    title="Khoản đã có dữ liệu kế toán mà hàng bị bỏ duyệt, không còn trong báo giá, hoặc báo giá đã xoá — không cộng vào các thẻ tiền. Bấm để xem riêng." />
            )}
          </div>
          {b.chuY && <div className="inv-in-warn" role="status">Đang xem các khoản <b>CẦN CHÚ Ý</b> (hàng bị bỏ duyệt / không còn trong báo giá / báo giá đã xoá) — không cộng vào các thẻ tiền. Bấm thẻ “Cần chú ý” lần nữa để về danh sách chính.</div>}

          {shown.length === 0 ? (
            <div className="empty">
              {!coHangDuyet && !b.chuY && !soBoLoc
                ? <>Chưa có hàng nào được duyệt ở bảng nội bộ.{soChuY > 0 && <> Có {soChuY} khoản cần chú ý — bấm thẻ “Cần chú ý” để xem.</>}</>
                : <>Không có khoản nào khớp bộ lọc.{soBoLoc > 0 && <div style={{ marginTop: 10 }}><button className="btn btn-sm" onClick={xoaLoc}>Xóa tất cả bộ lọc</button></div>}</>}
            </div>
          ) : (
            <>
              <div className="list-wrap">
                <table className="list-table inv-in-table">
                  <thead><tr>{HEADERS.map((h) => {
                    const sk = SORT_COLS[h];
                    const cls = [LOP_TIEU_DE[h] ?? "", sk ? "sortable" : ""].filter(Boolean).join(" ") || undefined;
                    if (!sk) return <th key={h} scope="col" className={cls}>{h}</th>;
                    const active = sortKey === sk;
                    return (
                      <th key={h} scope="col" className={cls} tabIndex={0} title="Bấm để sắp xếp"
                          aria-sort={active ? (sortDir === 1 ? "ascending" : "descending") : "none"}
                          onClick={() => toggleSort(sk)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(sk); } }}>
                        {h}{active ? (sortDir === 1 ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}</tr></thead>
                  <tbody>
                    {hien.map((r) => {
                      const phu = [tenBangRieng(r.category, r.tableName), r.detail].filter(Boolean).join(" · ");
                      return (
                        <tr key={r.key} className={moDuocDong(r) ? "qrow" : undefined} title={moDuocDong(r) ? "Bấm để mở báo giá" : undefined}
                            onClick={moDuocDong(r) ? (e) => { if ((e.target as HTMLElement).closest(BO_QUA_BAM)) return; moQuote(r.quoteId); } : undefined}>
                          <td title={r.title}><strong>{r.sheetCode || r.quoteCode}</strong><div className="inv-in-sub">{r.sheetName || dash}</div></td>
                          <td className="inv-in-kh">{r.customerName || r.customerCode || dash}{r.customerName && r.customerCode ? <div className="inv-in-sub">{r.customerCode}</div> : null}</td>
                          <td className="inv-in-hm" title={r.detail ?? undefined}>
                            <div>{r.name || dash}</div>
                            <div className="inv-in-sub"><span className={`extra-cat-badge cat-${r.category}`}>{LOAI_BANG[r.category] ?? r.category}</span>{phu && <span>{phu}</span>}</div>
                          </td>
                          <td className="inv-in-ns">{r.ns || dash}</td>
                          <td className="num nowrap">{fmtSoLuong(r.quantity)}{r.days != null && r.days > 0 ? <div className="inv-in-sub">× {fmtSoLuong(r.days)} ngày</div> : null}</td>
                          <td className="num nowrap">{fmtMoney(r.unitPrice)}</td>
                          <td className="num nowrap"><strong>{fmtMoney(r.amount)}</strong></td>
                          <td className="inv-in-ct">
                            {r.chungTu ? <span className={`status ${r.chungTu === "VAT" ? "approved" : "pending"}`}>{NHAN_CHUNG_TU[r.chungTu]}</span> : dash}
                            {r.luuKho ? <div className="inv-in-sub"><span aria-hidden="true">📦</span> Lưu kho</div> : null}
                          </td>
                          <td className="inv-in-duyet nowrap">{fmtDate(r.approvedAt) || dash}{r.approvedByName ? <div className="inv-in-sub">{r.approvedByName}</div> : null}</td>
                          <td className="inv-in-kt">
                            {coTheMoHop(r) ? (
                              <button type="button" className="inv-in-kt-nut" data-ke-toan aria-haspopup="dialog"
                                      title={r.coTheGhi ? "Ghi khoản chi: Đã chi + ảnh chứng từ, Ngày hóa đơn, Ghi chú kế toán" : `Xem khoản chi (chỉ xem)${r.lyDoKhoa ? ` — ${r.lyDoKhoa}` : ""}`}
                                      onClick={(e) => moHop(r, e.currentTarget)}>
                                <NoiDungKeToan r={r} />
                              </button>
                            ) : (
                              <span className="inv-in-kt-chu" title={r.lyDoKhoa ?? (canPay || canEdit ? undefined : "Chỉ xem — bạn không có quyền ghi khoản chi")}>
                                <NoiDungKeToan r={r} />
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="list-foot">
                <span className="muted">Hiển thị {(trangNay - 1) * CO_TRANG + 1}–{(trangNay - 1) * CO_TRANG + hien.length} / {shown.length} khoản{shown.length !== rows.length ? ` (lọc từ ${rows.length})` : ""}</span>
                {soTrang > 1 && (
                  <div className="pager">
                    <button className="btn btn-sm" disabled={trangNay <= 1} onClick={() => setTrang(trangNay - 1)}>← Trước</button>
                    <span className="muted">Trang {trangNay}/{soTrang}</span>
                    <button className="btn btn-sm" disabled={trangNay >= soTrang} onClick={() => setTrang(trangNay + 1)}>Sau →</button>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {hop && (
        <HopKhoanChi key={hop.key} row={hopRow ?? hop.row} mat={!hopRow} canPay={canPay} canEdit={canEdit}
                     onDong={dongHop} onDaLuu={daLuu} onNapLai={napLai} onThayDoi={datHopThayDoi} />
      )}
    </div>
  );
}
