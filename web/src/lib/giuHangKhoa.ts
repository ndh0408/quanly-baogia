// GIỮ HÀNG KHOÁ — MỘT cơ chế cho mọi bảng nội bộ có hàng bị khoá: bảng Hà Nội (hàng đã duyệt / đã gửi —
// components/HnTables.tsx) và Chi phí HCM / Phí khách hàng (hàng đã duyệt — components/ExtraTables.tsx).
//
// Ô của hàng khoá đã TẮT trong lưới (GridTable `khoaHang`), nhưng dán nhiều ô / kéo điền / cắt / Ctrl+Z vẫn chạm được
// model. Hook này chụp nội dung các hàng khoá (theo rid) ở mỗi mốc đồng bộ với máy chủ (mảng bảng mới, hoặc `dongBo`
// đổi), rồi sau MỖI lần lưới báo đổi (`giu()`) trả hàng khoá về đúng bản chụp — kể cả hàng bị xoá (chèn lại đúng chỗ) —
// tăng `phien` để nơi gọi vẽ lại lưới từ model (đưa vào `key` của GridTable) và toast. Máy chủ vẫn là chốt cuối (409).
//
// Hàng trong bản chụp mà lúc kiểm KHÔNG còn khoá (người có quyền duyệt vừa bỏ tích Duyệt — Chi phí HCM duyệt ngay trên
// lưới) thì rời bản chụp: từ đó sửa / xoá nó là hợp lệ.
import { useRef, useState } from "react";
import { nextK } from "./gridShared";
import { toast } from "./ui";

/** Trường của hàng mà khoá giữ nguyên (nội dung + trạng thái duyệt). */
export const TRUONG_KHOA_HANG = ["kind", "label", "name", "detail", "unit", "quantity", "quantityExact", "unitPrice", "days", "notes", "formulas",
  "trangThaiDuyet", "approved", "approvedAt", "approvedBy", "lyDoTra"];
/** Ba cột theo dõi sau duyệt — mở khi `moCotNoiBo` (khớp máy chủ). */
export const TRUONG_NOI_BO_HANG = ["ns", "luuKho", "chungTu"];

type Hang = Record<string, unknown>;
type Bang = { items?: unknown[] };
type Chup = { rid: string; t: Bang; idx: number; goc: Hang; bo?: boolean };

export function useGiuHangKhoa<T extends Bang>(o: {
  bangs: T[];
  khoa: (it: Hang) => boolean;
  moCotNoiBo?: boolean;
  dongBo?: unknown;
  thongBao: string;
}): { phien: number; giu: () => boolean } {
  const [phien, setPhien] = useState(0);
  const ref = useRef<{ nguon: unknown; dongBo: unknown; ds: Chup[] } | null>(null);
  if (!ref.current || ref.current.nguon !== o.bangs || ref.current.dongBo !== o.dongBo) {
    const ds: Chup[] = [];
    for (const t of o.bangs) (t.items || []).forEach((x, idx) => {
      const it = x as Hang;
      if (typeof it.rid === "string" && o.khoa(it)) ds.push({ rid: it.rid, t, idx, goc: JSON.parse(JSON.stringify(it)) });
    });
    ref.current = { nguon: o.bangs, dongBo: o.dongBo, ds };
  }
  const truong = o.moCotNoiBo ? TRUONG_KHOA_HANG : [...TRUONG_KHOA_HANG, ...TRUONG_NOI_BO_HANG];
  const giu = (): boolean => {
    let vi = false;
    for (const k of ref.current?.ds ?? []) {
      if (k.bo || !(o.bangs as Bang[]).includes(k.t)) continue;
      const items = (k.t.items || []) as Hang[];
      const it = items.find((x) => x && x.rid === k.rid);
      if (it && !o.khoa(it)) { k.bo = true; continue; }   // vừa bỏ duyệt hợp lệ → thôi giữ
      if (!it) {
        const ban = JSON.parse(JSON.stringify(k.goc)) as Hang; ban._k = nextK();
        items.splice(Math.min(k.idx, items.length), 0, ban); vi = true; continue;
      }
      for (const f of truong) {
        if (JSON.stringify(it[f] ?? null) !== JSON.stringify(k.goc[f] ?? null)) {
          if (k.goc[f] === undefined) delete it[f]; else it[f] = JSON.parse(JSON.stringify(k.goc[f]));
          vi = true;
        }
      }
    }
    if (vi) { setPhien((v) => v + 1); toast(o.thongBao, "error"); }
    return vi;
  };
  return { phien, giu };
}
