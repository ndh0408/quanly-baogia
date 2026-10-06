import { useEffect, useState } from "react";
import { api, type DaChiHang, type DaChiBaoGiaResp, type PhiaKhoanChi } from "./api";

/**
 * CỘT "THANH TOÁN" CHỈ XEM của bảng nội bộ (chủ repo 2026-10-06: "cái thanh toán hiện đã thanh toán ở đây ngày như nào
 * chứ, và bên hóa đơn đầu vào là chỗ đó cho kế toán up hình thanh toán lên"). Việc tích ĐÃ CHI + ảnh vẫn chỉ ở trang Hóa
 * đơn đầu vào; ở màn soạn / Account HN / màn chỉ-xem nội bộ chỉ HIỆN: đã chi chưa, ngày nào, ai tích.
 *
 * Nguồn: GET /api/quotes/:id/khoan-chi (trạng thái HIỆU LỰC — khoản kế toán thắng cờ JSON cũ). Nạp lại khi có sự kiện
 * realtime `inputInvoice` (kế toán vừa tích) / `quote`, hoặc khi SSE nối lại (sự kiện không rõ thực thể) — KHÔNG nạp lại
 * cả báo giá: người soạn đang sửa dở. Hook thường (không react-query) vì màn soạn không nằm dưới QueryClientProvider ở
 * mọi nơi gọi (bài kiểm mức trang dựng QuoteEditor trần).
 */
/**
 * `nguon` (báo giá + phía) đi kèm map để cột Thanh toán mở được chứng từ (📎 ảnh ủy nhiệm chi, 🧾 hóa đơn VAT) qua
 * GET /quotes/:id/khoan-chi/:side/:rid/anh mà không phải luồn thêm prop qua ExtraTables / HnTables. Vắng = chỉ hiện chữ.
 * Phần tử có `paid === false` là hàng CHƯA chi mà đã có HĐ VAT ("Có HĐ VAT · chưa TT").
 */
export type DaChiTheoRid = ReadonlyMap<string, DaChiHang> & { readonly nguon?: { quoteId: number; side: PhiaKhoanChi } };
export type DaChiBaoGia = { sheet: DaChiTheoRid; hn: DaChiTheoRid };

/** Nhịp gom: nhiều sự kiện liền nhau (kế toán tích một loạt) → một lần gọi. */
const NHIP_GOM_MS = 300;

/** Hàng đã chi (`sheet`/`hn`, paid) + hàng chưa chi có HĐ VAT (`vatChuaChi`, paid=false) → một map theo rid, gắn `nguon`. */
export function dungMap(quoteId: number, side: PhiaKhoanChi, r: Pick<DaChiBaoGiaResp, "sheet" | "hn" | "vatChuaChi">): DaChiTheoRid {
  const m = new Map<string, DaChiHang>();
  for (const h of r.vatChuaChi?.[side] || []) m.set(h.rid, { ...h, paid: false });
  for (const h of r[side] || []) m.set(h.rid, { ...h, paid: true });
  return Object.assign(m, { nguon: { quoteId, side } });
}

export function useDaChiBaoGia(quoteId: number | null | undefined): DaChiBaoGia | null {
  const [ds, setDs] = useState<{ id: number; v: DaChiBaoGia } | null>(null);
  useEffect(() => {
    if (!quoteId) return;
    let song = true, luot = 0;
    let hen: ReturnType<typeof setTimeout> | undefined;
    const nap = () => {
      const toi = ++luot;
      let p: Promise<DaChiBaoGiaResp>;
      try { p = api.quoteDaChi(quoteId); } catch { return; }
      Promise.resolve(p).then((r) => {
        if (!song || toi !== luot || !r) return;   // lượt cũ về muộn không được đè lượt mới
        setDs({ id: quoteId, v: { sheet: dungMap(quoteId, "sheet", r), hn: dungMap(quoteId, "hn", r) } });
      }).catch(() => { /* không đọc được → giữ bản đang có (hoặc cờ của báo giá đã nạp) */ });
    };
    const on = (ev: Event) => {
      const entity = (ev as CustomEvent<{ entity?: string } | null>).detail?.entity;
      if (entity && entity !== "inputInvoice" && entity !== "quote") return;
      if (hen) clearTimeout(hen);
      hen = setTimeout(nap, NHIP_GOM_MS);
    };
    nap();
    window.addEventListener("realtime:changed", on);
    return () => { song = false; if (hen) clearTimeout(hen); window.removeEventListener("realtime:changed", on); };
  }, [quoteId]);
  return ds && ds.id === quoteId ? ds.v : null;
}
