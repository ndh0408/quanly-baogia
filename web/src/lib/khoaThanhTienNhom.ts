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
 *     chỉ khi người dùng ĐƯA nhóm SL > 1 vào — gõ / dán / điền vào ô SL nhóm, cắt-dán hàng nhóm, chọn gợi ý
 *     danh mục điền SL cho hàng nhóm, Ctrl+Z–Y trả về, công thức tham chiếu đẩy lên, và NHẬP EXCEL
 *     (`coSauNhapExcel` bên dưới) — thì mới bật.
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

/** Lời báo khi Ctrl+Z / Ctrl+Y / Esc TRẢ LẠI ô về TẮT: mốc hoàn tác là báo giá cũ đã lưu "tắt + nhóm SL > 1" mà người
 *  dùng đã bật ô giữa chừng (tự tích tay, hoặc tự bật khi gõ). Ô tích tự bỏ tích và mở khoá, tổng rớt về số không nhân
 *  hệ số nhóm — không nói ra thì đó là một cú đổi tổng im lặng ngay sau khi người dùng vừa tích. */
export const TB_TU_TAT_NHOM = "Đã tắt lại Thành Tiền nhóm — hoàn tác trả báo giá về trạng thái trước đó (ô đang tắt, tổng KHÔNG nhân hệ số nhóm). Muốn nhân thì tích lại ô “Hiện Thành Tiền nhóm”";

/** Ba đường nhập Excel vào MỘT bảng: bảng MỚI (thêm sheet / thêm bảng), THAY toàn bộ, hoặc NỐI vào cuối. */
export type CheDoNhapExcel = "moi" | "thay" | "noi";

/**
 * Cờ "Hiện Thành Tiền nhóm" của một bảng SAU KHI nhập Excel — MỘT nguồn cho hộp nhập (xem trước, cảnh báo, đối chiếu tiền)
 * và hai màn nạp (trình soạn báo giá, Account Hà Nội), để bảng đối chiếu nói đúng thứ sẽ xảy ra.
 *
 * Vì sao nhập Excel PHẢI tự bật (chủ repo chốt 2026-09-30, đảo quyết định cũ "chỉ cảnh báo"): bộ đọc file (src/excelImport.ts)
 * chỉ coi cờ là BẬT khi dòng nhóm trong file có ghi Thành Tiền. File mang Số Lượng nhóm > 1 mà không ghi Thành Tiền nhóm
 * ra cờ TẮT, và tổng sheet khi tắt KHÔNG nhân hệ số nhóm (`sheetSubtotalGrouped`) — nhập Số Lượng nhóm vào mà tổng không
 * nhân, xuất Excel ra SAI TIỀN. Nên nhập xong mà bảng kết quả còn nhóm SL > 1 thì cờ = BẬT (và vì thế bị khoá theo
 * `khoaBatNhom`, y như gõ / dán). Chỉ nhìn bảng KẾT QUẢ: nhóm SL ≤ 1 (hiện "1") không đổi tổng nên không bật.
 *
 * Cờ CƠ BẢN (trước khi tự bật) theo từng đường — khớp đúng cách hai màn gán cờ từ trước tới nay:
 *   · bảng MỚI: theo FILE;
 *   · NỐI: cờ của bảng ĐÍCH (không đụng);
 *   · THAY ở trình soạn báo giá: theo FILE, nhưng KHÔNG làm mất cờ BẬT của sheet đang bật (file tắt thì sheet giữ bật);
 *   · THAY ở bảng Hà Nội (`thayGiuCoCuaDich`): cờ của bảng ĐÍCH đứng nguyên (màn đó không gán cờ lúc Thay).
 * Tự bật CHỈ xảy ra khi người dùng nhập — MỞ báo giá cũ đã lưu "tắt + nhóm SL > 1" vẫn không bao giờ tự bật.
 *
 * `hangSauNap`: TOÀN BỘ hàng của bảng sau khi nạp (NỐI: cả hàng cũ + hàng mới). `tuBat`: cờ vừa được bật vì nhập (cơ bản
 * đang tắt) — chỗ gọi dùng nó để NÓI RA (cảnh báo tổng khác tổng trong file, toast sau nạp).
 */
export function coSauNhapExcel(
  o: { cheDo: CheDoNhapExcel; coCuaDich?: boolean; coTheoFile?: boolean; thayGiuCoCuaDich?: boolean },
  hangSauNap: readonly M.Item[],
): { co: boolean; tuBat: boolean } {
  const dich = !!o.coCuaDich, file = !!o.coTheoFile;
  const coBan = o.cheDo === "moi" ? file : o.cheDo === "noi" ? dich : o.thayGiuCoCuaDich ? dich : file || dich;
  const tuBat = !coBan && coNhomNhanHeSo(hangSauNap);
  return { co: coBan || tuBat, tuBat };
}

/** Lời nói sau khi nạp Excel đã tự bật ô ở `n` bảng (toast của hai màn nạp). `tongKhongNhanNhom`: bảng mà tổng KHÔNG BAO GIỜ
 *  nhân Số Lượng nhóm (bảng Hà Nội — `extraTableSum`): bật cờ chỉ làm ô Thành Tiền của dòng nhóm hiện số đã nhân, nên không
 *  được nói "tổng đã nhân hệ số nhóm". */
export const tbNhapTuBatNhom = (n: number, tongKhongNhanNhom = false) => tongKhongNhanNhom
  ? `đã tự bật Thành Tiền nhóm ở ${n} sheet (có nhóm Số Lượng > 1 — ô Thành Tiền của dòng nhóm hiện số đã nhân hệ số; tổng bảng vẫn chỉ cộng hạng mục)`
  : `đã tự bật Thành Tiền nhóm ở ${n} sheet (có nhóm Số Lượng > 1 nên tổng đã nhân hệ số nhóm, có thể khác tổng ghi trong file)`;
