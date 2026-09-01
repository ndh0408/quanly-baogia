// ============================================================================
// PHONG BÌ PHÂN TRANG — MỘT chỗ dựng, cho endpoint MỚI.
//
// ── VÌ SAO CÓ FILE NÀY ─────────────────────────────────────────────────────
// §9 đòi chuẩn hoá phân trang. Repo đang có HAI hình dạng:
//
//     GET /api/quotes     → { rows, total, page, size }
//     GET /api/customers  → { data, meta: { total, page, size, pageCount } }
//
// Cả hai đều có client thật (`web/src/lib/api.ts`), nên ĐỔI hình dạng cũ là một thay đổi PHÁ VỠ
// trên một API chưa có phiên bản — đúng thứ mà docs/architecture/API_VERSIONING.md tồn tại để ngăn.
// Nên file này KHÔNG sửa gì đang chạy; nó chỉ làm cho endpoint TIẾP THEO không đẻ ra hình dạng thứ ba.
//
// ── VÀ VÌ SAO KHÔNG PHẢI "CHỈ LÀ MỘT DÒNG OBJECT LITERAL" ──────────────────
// Năm service đang tự tính `pageCount: Math.ceil(total / size)`. Với `size = 0` thì đó là
// `Infinity`, và `JSON.stringify(Infinity)` ra `null` — client nhận `pageCount: null` mà không có
// một dòng lỗi nào ở đâu cả. Một chỗ tính thì sai một lần rồi vá một lần; năm chỗ tính thì phải nhớ
// vá năm chỗ. (Năm chỗ hiện tại KHÔNG đổi ở đợt này — chúng nhận `size` đã qua zod với
// `.min(1)`, nên chưa chạm vào ca đó. Ghi ra để lần dọn sau biết vì sao nên gộp về đây.)
import { config } from "./config.js";

export type MetaPhanTrang = {
  total: number;
  page: number;
  size: number;
  pageCount: number;
};

export type TrangDuLieu<T> = {
  data: T[];
  meta: MetaPhanTrang;
};

/**
 * Dựng phong bì phân trang CHUẨN.
 *
 * `size <= 0` → `pageCount = 0` chứ KHÔNG phải `Infinity`: một API không được trả về `null` (thứ
 * `Infinity` biến thành sau `JSON.stringify`) cho một trường số.
 */
export function phanTrang<T>(data: T[], total: number, page: number, size: number): TrangDuLieu<T> {
  const t = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const s = Number.isFinite(size) && size > 0 ? Math.floor(size) : 0;
  const p = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  return {
    data,
    meta: { total: t, page: p, size: s, pageCount: s > 0 ? Math.ceil(t / s) : 0 },
  };
}

/**
 * `skip`/`take` cho Prisma từ (page, size), kèm TRẦN.
 *
 * ── VÌ SAO CÓ TRẦN, VÀ VÌ SAO NÓ Ở ĐÂY ────────────────────────────────────
 * `?size=1000000` trên một bảng lớn là một câu truy vấn kéo cả bảng vào RAM của tiến trình API —
 * không cần quyền gì đặc biệt, chỉ cần sửa URL. Trần phải nằm CÙNG CHỖ với phép tính `skip`, nếu
 * không sẽ có endpoint nhớ đặt và có endpoint quên.
 *
 * Trần lấy từ `config.MAX_PAGE_SIZE` — CÙNG con số mà `ListQuerySchema` (src/validators.ts) ép, và
 * lấy từ cùng một nguồn chứ không chép lại. Hai lớp cùng một giá trị là cố ý: zod chặn ở biên,
 * hàm này chặn cho cả những đường không đi qua zod.
 */
export function skipTake(page: unknown, size: unknown, macDinh = config.DEFAULT_PAGE_SIZE): { skip: number; take: number } {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const s = Math.min(config.MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(size) || macDinh)));
  return { skip: (p - 1) * s, take: s };
}
