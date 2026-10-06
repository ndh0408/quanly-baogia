import { useEffect, useState } from "react";
import { api, type DaChiHang } from "./api";

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
export type DaChiTheoRid = ReadonlyMap<string, DaChiHang>;
export type DaChiBaoGia = { sheet: DaChiTheoRid; hn: DaChiTheoRid };

/** Nhịp gom: nhiều sự kiện liền nhau (kế toán tích một loạt) → một lần gọi. */
const NHIP_GOM_MS = 300;

export function useDaChiBaoGia(quoteId: number | null | undefined): DaChiBaoGia | null {
  const [ds, setDs] = useState<{ id: number; v: DaChiBaoGia } | null>(null);
  useEffect(() => {
    if (!quoteId) return;
    let song = true, luot = 0;
    let hen: ReturnType<typeof setTimeout> | undefined;
    const nap = () => {
      const toi = ++luot;
      let p: Promise<{ sheet: DaChiHang[]; hn: DaChiHang[] }>;
      try { p = api.quoteDaChi(quoteId); } catch { return; }
      Promise.resolve(p).then((r) => {
        if (!song || toi !== luot || !r) return;   // lượt cũ về muộn không được đè lượt mới
        setDs({ id: quoteId, v: { sheet: new Map((r.sheet || []).map((h) => [h.rid, h])), hn: new Map((r.hn || []).map((h) => [h.rid, h])) } });
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
