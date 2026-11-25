// SỐ CA (mẫu CINETOUR, chủ repo 2026-11-25) — phần dùng chung của web không thuộc toán tiền (toán tiền ở
// shared/quote-math.ts `lineAmount`).
import type { Item } from "./quoteMath";
import { confirmModal } from "./ui";

/**
 * Số hạng mục đang mang Số Ca KHÁC 1 (bỏ qua hàng nhóm / dòng thông tin). Trống / 0 / 1 đều là ×1, nên chỉ những hàng
 * này đổi Thành tiền khi sheet / bảng đổi sang mẫu KHÔNG có cột Số Ca — đó là lúc màn soạn phải hỏi lại thay vì đổi
 * tiền im lặng (Lưu với mẫu không có cột thì máy chủ ép shifts = null, như Số Ngày).
 */
export function demHangCoSoCa(items: readonly Item[] | null | undefined): number {
  let n = 0;
  for (const it of items || []) {
    if (!it || it.kind === "section" || it.kind === "subsection" || it.kind === "info") continue;
    const s = Number(it.shifts);
    if (Number.isFinite(s) && s > 0 && s !== 1) n++;
  }
  return n;
}

/**
 * Bảng nội bộ / Hà Nội đổi mẫu: mẫu cũ có cột Số Ca mà mẫu mới không, và còn hàng mang Số Ca khác 1 → HỎI trước
 * (cùng luật với ô chọn mẫu của sheet ở màn soạn). Không có gì để mất → `null` và nơi gọi đổi NGAY, đồng bộ (ô chọn mẫu
 * là ô có kiểm soát: đổi trễ một nhịp là React trả ô về giá trị cũ). Có → Promise, `true` = được đổi.
 */
export function hoiDoiMauBoSoCa(items: readonly Item[] | null | undefined, coCaCu: boolean, coCaMoi: boolean, tenMauMoi: string): Promise<boolean> | null {
  if (!coCaCu || coCaMoi) return null;
  const n = demHangCoSoCa(items);
  if (!n) return null;
  return confirmModal("Đổi sang mẫu không có cột Số Ca?",
    `Mẫu "${tenMauMoi}" không có cột SỐ CA: ${n} hàng đang có Số Ca khác 1 sẽ KHÔNG còn được nhân Số Ca — tổng bảng đổi theo. ` +
    "Số Ca vẫn giữ trong phiên này (chọn lại mẫu CINETOUR trước khi Lưu là lấy lại); Lưu với mẫu mới thì Số Ca bị bỏ.",
    { danger: true, confirmText: "Đổi mẫu" });
}
