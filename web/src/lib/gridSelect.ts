// VÙNG CHỌN của lưới — phần THUẦN (neo/đích/hình chữ nhật), tách khỏi GridTable.tsx để kiểm được.
//
// ── VÌ SAO TÁCH ─────────────────────────────────────────────────────────────
// Mở rộng vùng chọn bằng Shift+mũi tên là thao tác Excel người dùng làm liên tục (chọn một cột
// tiền rồi copy, rồi Ctrl+D fill…). Trước đây phép này nằm gọn trong `moveTo()` của
// `GridTableInner`, cùng ổ với `el.focus()`/`paintSel()` — muốn kiểm phải dựng cả React + DOM,
// nên trên thực tế KHÔNG có bài nào kiểm. Chỉ có bài cho hàm TÔ vùng chọn (`paintRect`), tức là
// kiểm phần VẼ chứ không kiểm phần TÍNH RA vùng.
// Ở đây chỉ tách, KHÔNG đổi hành vi: `moveTo()` vẫn giữ phần đụng DOM (dò ô thay thế khi cột đích
// không có ô nhập, focus, khoá ô, tô lại).
//
// ── MÔ HÌNH: NEO + ĐÍCH, KHÔNG PHẢI r0/r1 ───────────────────────────────────
// Vùng chọn được lưu bằng HAI Ô — `anchor` (ô neo, nơi bắt đầu chọn) và `focus` (ô đang đứng) —
// chứ không lưu sẵn hình chữ nhật. Đây là mô hình của Excel và nó BẮT BUỘC phải như vậy:
//   · Shift+↓ rồi Shift+↑ phải THU vùng lại, không phải nới thêm — chỉ giữ được nếu biết đầu nào
//     là neo cố định;
//   · kéo ngược lên/sang trái vẫn ra vùng hợp lệ (neo nằm ở góc dưới-phải);
//   · nút kéo-fill và phép dán khối cần biết ô neo để tính hướng.
// Hình chữ nhật đã chuẩn hoá chỉ sinh ra khi cần, bằng `rectOfSel()`.

export type Cell = { row: number; field: string };

/** Vùng chọn: ô NEO (cố định khi giữ Shift) + ô ĐÍCH (chạy theo mũi tên/chuột). */
export type Sel = { anchor: Cell; focus: Cell };

/** Hình chữ nhật đã chuẩn hoá: r0≤r1, c0≤c1 — luôn theo thứ tự tăng dù kéo theo hướng nào. */
export type SelRect = { r0: number; r1: number; c0: number; c1: number };

/** Kẹp chỉ số hàng vào trong bảng. Shift+↓ ở hàng cuối phải ĐỨNG YÊN, không chọn ra ngoài bảng. */
export const clampRow = (row: number, rowCount: number): number => Math.max(0, Math.min(rowCount - 1, row));

/** Kẹp chỉ số cột. Cột không tồn tại (fieldIdx trả -1) rơi về 0 — giữ đúng hành vi cũ của moveTo. */
export const clampCol = (ci: number, colCount: number): number => Math.max(0, Math.min(colCount - 1, ci));

/**
 * Vùng chọn SAU khi dời tới ô (row, field).
 *
 *   · `extend` = true  (giữ Shift): NEO đứng yên, chỉ ô đích chạy → vùng nới ra hoặc thu lại.
 *   · `extend` = false (mũi tên trơn / bấm chuột): vùng co về ĐÚNG MỘT Ô, neo và đích trùng nhau.
 *
 * Giữ Shift khi CHƯA có vùng nào (`sel` = null) thì cũng chỉ ra một ô — không có neo thì không có
 * gì để nới. Dùng chung cho Shift+mũi tên, Ctrl+Shift+mũi tên (nhảy tới biên) và Shift+bấm chuột,
 * nên ba lối vào ấy không thể trôi khỏi nhau.
 *
 * Trả về đối tượng MỚI, không sửa `sel` truyền vào; nhưng ô `anchor` cũ được DÙNG LẠI nguyên tham
 * chiếu, đúng như mã cũ.
 */
export function nextSel(sel: Sel | null, row: number, field: string, extend: boolean): Sel {
  if (extend && sel) return { anchor: sel.anchor, focus: { row, field } };
  return { anchor: { row, field }, focus: { row, field } };
}

/**
 * Hình chữ nhật phủ vùng chọn, đã chuẩn hoá theo cả hai chiều.
 *
 * `fieldIdx` là ánh xạ tên cột → chỉ số cột ĐIỀU HƯỚNG (danh sách FIELDS của lưới, thay đổi theo
 * mẫu báo giá: có/không cột Chi Tiết, Số Ngày, Ghi Chú nội bộ). Cột không nằm trong danh sách đó
 * → trả `null` để nơi gọi bỏ qua, thay vì tô nhầm ra một vùng bịa.
 */
export function rectOfSel(sel: Sel | null, fieldIdx: (f: string) => number): SelRect | null {
  if (!sel) return null;
  const a = fieldIdx(sel.anchor.field), b = fieldIdx(sel.focus.field);
  if (a < 0 || b < 0) return null;
  return {
    r0: Math.min(sel.anchor.row, sel.focus.row),
    r1: Math.max(sel.anchor.row, sel.focus.row),
    c0: Math.min(a, b),
    c1: Math.max(a, b),
  };
}

/** Một nhịp mũi tên: dịch mấy hàng / mấy cột, và ưu tiên dò cột thay thế về phía nào. */
export type ArrowStep = { dRow: number; dCol: number; prefer: -1 | 0 | 1 };

/**
 * Hướng của một phím mũi tên.
 *
 * `prefer` chỉ có nghĩa khi cột đích KHÔNG có ô nhập ở hàng đó (hàng NHÓM, cột tính): lưới phải dò
 * sang cột khác, và phải dò TIẾP THEO HƯỚNG ĐANG ĐI — bấm → mãi mà cứ bị đẩy ngược về trái thì
 * con trỏ kẹt tại chỗ. Đi dọc (↑↓) không có hướng ngang nên `prefer` = 0.
 *
 * Phím "Arrow…" lạ (không phải bốn phím chuẩn) trả nhịp RỖNG {0,0,0} — nơi gọi lọc bằng tiền tố
 * "Arrow", nên nhịp rỗng giữ đúng hành vi cũ là ĐỨNG YÊN chứ không nhảy bậy.
 */
export function arrowStep(key: string): ArrowStep {
  const up = key === "ArrowUp", down = key === "ArrowDown";
  const left = key === "ArrowLeft", right = key === "ArrowRight";
  return {
    dRow: (down ? 1 : 0) - (up ? 1 : 0),
    dCol: (right ? 1 : 0) - (left ? 1 : 0),
    prefer: right ? 1 : left ? -1 : 0,
  };
}
