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
 *     (ô đang tắt nên `khoaBatNhom` = false; tự bật đổi tổng của báo giá cũ = đụng tiền). Sửa ô KHÔNG liên
 *     quan của nó (đổi tên nhóm, đi ngang ô SL rồi Enter, Ctrl+Z một sửa đổi khác) cũng không được bật:
 *     chỉ khi người dùng ĐƯA nhóm SL > 1 vào (gõ / dán / điền vào ô SL nhóm, Ctrl+Z–Y trả về, công thức
 *     tham chiếu đẩy lên) thì mới bật.
 */

/** Hàng nhóm / nhóm con có Số Lượng nhân THẬT vào tổng (`groupMult` > 1 — theo SỐ ĐANG HIỆN, đã làm
 *  tròn 1 số lẻ như ô hiển thị; 1,04 hiện "1" nên không tính là > 1). */
export const coNhomNhanHeSo = (items: readonly M.Item[]): boolean =>
  items.some((it) => (it.kind === "section" || it.kind === "subsection") && M.groupMult(it) > 1);

/** Ô tích phải bị KHOÁ Ở TRẠNG THÁI BẬT: đang bật VÀ còn ít nhất một nhóm SL > 1. */
export const khoaBatNhom = (groupSubtotal: boolean, items: readonly M.Item[]): boolean =>
  groupSubtotal && coNhomNhanHeSo(items);

export const LY_DO_KHOA_NHOM = "Đang khoá bật vì nhóm có Số Lượng > 1 — đặt Số Lượng nhóm về 1 để tắt được";

/** Lời báo khi ô tự bật mà người dùng KHÔNG trực tiếp gõ/dán Số Lượng nhóm (Ctrl+Z / Ctrl+Y trả nhóm SL > 1
 *  về, hoặc SL nhóm là công thức và ô tham chiếu vừa đổi): ô tích tự đổi + khoá mà không có dấu hiệu nào là
 *  lạ, tổng lại nhảy ×N — nên nói rõ vì sao. Gõ / dán thẳng vào ô SL nhóm thì không báo (người dùng đang nhìn). */
export const TB_TU_BAT_NHOM = "Đã tự bật Thành Tiền nhóm — nhóm có Số Lượng > 1 nên hệ số ×N phải được nhân vào tổng";
