import * as M from "./quoteMath";

/**
 * Ô tích "Hiện Thành Tiền nhóm" của lưới báo giá: KHI NÀO PHẢI KHOÁ.
 *
 * `sheetSubtotalGrouped` chỉ nhân Số Lượng nhóm vào tiền các mục con khi ô này BẬT; tắt thì ép hệ số
 * về 1. Nên một bảng có nhóm SL > 1 mà ô bị bỏ tích là tổng SAI IM LẶNG (không ai báo, tổng nhỏ hơn
 * thật đúng bằng hệ số nhóm). Người dùng đã yêu cầu (2026-09-30): "nếu có số lượng thì Thành Tiền nhóm
 * tự động bật và lock nút đó lại". Tự bật đã có từ trước (GridTable.autoEnableGroupSub…); đây là nửa
 * còn lại — KHOÁ, để bật xong không ai bỏ tích được nữa.
 *
 * Luật khoá cố ý CHỈ là hàm của dữ liệu đang hiện, không nhớ trạng thái riêng:
 *   · nhả ngay khi không còn nhóm nào SL > 1 (đưa SL nhóm về 1 vẫn làm được — khoá không chặn ô SL);
 *   · nhả rồi thì GIỮ trạng thái đang có (không tự tắt), người dùng muốn tắt thì tự bỏ tích;
 *   · báo giá cũ đã lưu ở trạng thái "tắt + có nhóm SL > 1" KHÔNG bị khoá và KHÔNG bị tự bật lúc mở
 *     (ô đang tắt nên `khoaBatNhom` = false; tự bật đổi tổng của báo giá cũ = đụng tiền).
 */

/** Hàng nhóm / nhóm con có Số Lượng nhân THẬT vào tổng (`groupMult` > 1 — theo SỐ ĐANG HIỆN, đã làm
 *  tròn 1 số lẻ như ô hiển thị; 1,04 hiện "1" nên không tính là > 1). */
export const coNhomNhanHeSo = (items: readonly M.Item[]): boolean =>
  items.some((it) => (it.kind === "section" || it.kind === "subsection") && M.groupMult(it) > 1);

/** Ô tích phải bị KHOÁ Ở TRẠNG THÁI BẬT: đang bật VÀ còn ít nhất một nhóm SL > 1. */
export const khoaBatNhom = (groupSubtotal: boolean, items: readonly M.Item[]): boolean =>
  groupSubtotal && coNhomNhanHeSo(items);

export const LY_DO_KHOA_NHOM = "Đang khoá bật vì nhóm có Số Lượng > 1 — đặt Số Lượng nhóm về 1 để tắt được";
