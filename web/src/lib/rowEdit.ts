// CHÈN / XOÁ HÀNG trong lưới báo giá — kèm DỊCH THAM CHIẾU CÔNG THỨC.
//
// ── VÌ SAO GOM VÀO ĐÂY ──────────────────────────────────────────────────────
// Công thức người dùng gõ ("=E5*2") đánh số hàng TUYỆT ĐỐI. Chèn một hàng phía trên thì "E5" phải
// thành "E6", nếu không nó lặng lẽ trỏ sang hạng mục KHÁC — và đây là ô tiền, nên sai là sai tiền,
// không có thông báo nào.
//
// `GridTable.tsx` có BỐN đường chèn/xoá. Ba đường (`pushItem`, `addSubAfter`, `removeRow`) gọi hàm
// dịch; đường thứ tư — `insertCatalogRows` ("Chèn từ rạp", chèn hàng LOẠT) — thì KHÔNG, và cũng
// không gọi `recomputeAll()`. Đó là lỗi P1 "catalog-insert-breaks-formulas": chèn 5 hạng mục từ
// danh mục rạp là mọi công thức bên dưới trỏ lệch đúng 5 hàng.
//
// Vá bằng cách gom "dịch + splice" thành MỘT thao tác không tách rời được. Gọi splice mà quên dịch
// giờ không còn là một lỗi có thể mắc — muốn chèn thì phải qua đây.
//
// Hàm THUẦN, không đụng React/DOM, nên test được trực tiếp (rowEdit.test.ts).

/** Hàng lưới — chỉ quan tâm tới `formulas` và cờ cảnh báo; phần còn lại để nguyên. */
export type RowLike = Record<string, unknown> & {
  formulas?: Record<string, string>;
  _fxWarn?: Record<string, boolean>;
};

/**
 * Dịch mọi tham chiếu hàng trong công thức của `items` khi lưới thay đổi tại `at` (0-based).
 * `delta > 0` = chèn, `delta < 0` = xoá.
 *
 * `adjust` được TIÊM VÀO thay vì import thẳng để module này không kéo theo `clipboard.ts` — nó
 * đúng là `adjustRefsForRowEdit` của clipboard.ts, đã có 76 bài test riêng.
 *
 * Công thức trỏ vào hàng vừa bị XOÁ không thể dịch được (tương đương `#REF!` của Excel). Khi đó
 * `adjust` trả `null`; ta GIỮ NGUYÊN công thức và bật cờ `_fxWarn[field]` để lưới tô đỏ ô đó cho
 * người dùng sửa tay — thay vì âm thầm thay bằng số 0.
 */
export function shiftFormulasForRowEdit(
  items: RowLike[],
  at: number,
  delta: number,
  adjust: (fx: string, at1: number, delta: number) => string | null,
) {
  if (!delta) return;
  for (const it of items) {
    const fx = it?.formulas;
    if (!fx) continue;
    for (const f in fx) {
      const moved = adjust(fx[f], at + 1, delta);   // công thức đánh số hàng từ 1
      if (moved === null) {
        const w = it._fxWarn || (it._fxWarn = {});
        w[f] = true;
      } else fx[f] = moved;
    }
  }
}

/**
 * Chèn `rows` vào `items` tại vị trí `at`, ĐỒNG THỜI dịch tham chiếu công thức.
 *
 * Thứ tự bắt buộc: dịch TRƯỚC rồi mới splice. Dịch sau thì vòng lặp sẽ quét cả các hàng vừa chèn
 * (vô hại vì chúng chưa có công thức) nhưng vị trí `at` khi đó đã không còn ứng với lưới cũ.
 */
export function insertRows(
  items: RowLike[],
  at: number,
  rows: RowLike[],
  adjust: (fx: string, at1: number, delta: number) => string | null,
) {
  if (!rows.length) return;
  shiftFormulasForRowEdit(items, at, rows.length, adjust);
  // Chèn từng hàng thay vì `splice(at, 0, ...rows)`: spread một mảng lớn đẩy hết phần tử lên
  // ngăn xếp lời gọi, và danh sách chèn ở đây do người dùng chọn nên không có trần cứng.
  let i = at;
  for (const r of rows) items.splice(i++, 0, r);
}

/** Xoá `count` hàng từ `at`, đồng thời dịch tham chiếu (hoặc đánh dấu #REF!). */
export function removeRows(
  items: RowLike[],
  at: number,
  count: number,
  adjust: (fx: string, at1: number, delta: number) => string | null,
) {
  if (count <= 0) return;
  shiftFormulasForRowEdit(items, at, -count, adjust);
  items.splice(at, count);
}
