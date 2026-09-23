// NGĂN XẾP UNDO/REDO của lưới — phần THUẦN, tách khỏi GridTable.tsx để kiểm được.
//
// ── VÌ SAO TÁCH ─────────────────────────────────────────────────────────────
// Ctrl+Z/Ctrl+Y nằm trong danh sách nghiệp vụ "tuyệt đối không phá", nhưng toàn bộ logic ngăn xếp
// trước đây nằm trong thân `GridTableInner` (useRef + closure), tức KHÔNG cách nào gọi tới mà
// không dựng cả React + DOM. Kết quả: xoá nhầm một dòng của phép lùi cũng không cổng nào đỏ.
// Tách y nguyên phần THUẦN ra đây — giống cách `dangGoIME()` đã được tách sang `gridShared.ts`.
// Component vẫn giữ nguyên phần KHÔNG thuần (chụp `JSON.stringify(items)`, `restore()`, vẽ lại ô
// đang focus): đó mới là chỗ đụng DOM.
//
// ── BA HÀNH VI TINH TẾ, GIỮ ĐÚNG NHƯ CŨ (đừng "dọn dẹp" chúng) ──────────────
//  1. Ghi mốc mới thì nhánh REDO mất hiệu lực — lùi rồi làm việc khác là không tiến lại được nữa
//     (đúng nếp Excel/mọi trình soạn thảo).
//  2. Ngăn xếp undo có TRẦN (mặc định 100 mốc) và cắt ở ĐẦU — tức mốc CŨ NHẤT rụng trước, mốc mới
//     luôn giữ. Trần này chống phình bộ nhớ: mỗi mốc là một bản JSON của CẢ bảng (~560 ô).
//  3. Phép TIẾN (redo) đẩy trạng thái hiện tại trở lại ngăn xếp undo mà KHÔNG cắt theo trần và
//     KHÔNG xoá nhánh redo. Đây là hành vi có sẵn của mã cũ, và nó ĐÚNG: tiến/lùi qua lại là đi
//     trên cùng một dòng lịch sử, không phải "làm việc mới", nên không được cắt cụt dòng đó.
//     Hệ quả: đi tiếp sau khi đã đầy trần có thể vượt trần trong chốc lát — chấp nhận, vì cắt ở
//     đây sẽ làm mất đúng cái mốc người dùng vừa định lùi về.

/** Số mốc undo tối đa. Mỗi mốc là một bản JSON của cả lưới nên trần này là chống phình bộ nhớ. */
export const UNDO_LIMIT = 100;

export type UndoStack = {
  /** Ngăn xếp mốc CŨ (đáy = cũ nhất). Phơi ra để nơi gọi/bài kiểm soi được, đừng sửa trực tiếp. */
  readonly undo: string[];
  /** Ngăn xếp trạng thái đã lùi qua, chờ tiến lại. */
  readonly redo: string[];
  mark(snapshot: string): void;
  dropMark(): string | undefined;
  stepBack(now: () => string): string | null;
  stepForward(now: () => string): string | null;
};

/**
 * Mỗi lưới (lưới chính + từng bảng nội bộ) có MỘT ngăn xếp riêng — Ctrl+Z chỉ lùi trong lưới đang
 * focus, không kéo theo lưới bên cạnh.
 *
 * `snapshot` ở đây là một chuỗi mờ (component dùng `JSON.stringify(items)`); module này không đọc
 * vào trong nó, nên phép lùi không phụ thuộc hình dạng dữ liệu lưới.
 */
export function createUndoStack(limit: number = UNDO_LIMIT): UndoStack {
  const undo: string[] = [];
  const redo: string[] = [];
  return {
    undo,
    redo,

    /** Ghi một mốc trước khi thay đổi dữ liệu. Xem hành vi (1) và (2) ở đầu file. */
    mark(snapshot: string) {
      undo.push(snapshot);
      if (undo.length > limit) undo.shift();
      redo.length = 0;
    },

    /**
     * Bỏ mốc VỪA ghi mà không lùi gì cả — dùng khi một phiên gõ bị Esc huỷ: mốc của nó đã ghi
     * nhưng thay đổi thì đã được trả lại rồi, để nguyên thì Ctrl+Z kế tiếp chỉ "nuốt" một nhịp
     * rỗng thay vì lùi thao tác thật trước đó. KHÔNG đụng nhánh redo (chưa hề lùi qua nó).
     */
    dropMark() {
      return undo.pop();
    },

    /**
     * Ctrl+Z. Trả về snapshot cần khôi phục, hoặc `null` khi hết mốc để lùi.
     *
     * `now` là HÀM, không phải giá trị: nó chỉ được gọi khi thật sự lùi được. Chụp trạng thái là
     * `JSON.stringify` cả bảng — bấm Ctrl+Z lúc ngăn xếp rỗng (rất hay xảy ra) không được trả giá
     * cho một lần chụp vô ích.
     */
    stepBack(now: () => string): string | null {
      if (!undo.length) return null;
      redo.push(now());
      return undo.pop() as string;
    },

    /** Ctrl+Y (hoặc Ctrl+Shift+Z). Xem hành vi (3) ở đầu file về việc KHÔNG cắt trần ở đây. */
    stepForward(now: () => string): string | null {
      if (!redo.length) return null;
      undo.push(now());
      return redo.pop() as string;
    },
  };
}

/**
 * KHO ẢNH DÙNG CHUNG CHO MỐC UNDO (GRID-09).
 *
 * Mốc undo là `JSON.stringify(items)`, mà `items[].images` là data-URL base64 (~150–400KB/ảnh, tới
 * 10 ảnh/ô). Đo được: 10 ảnh × 250KB → mỗi mốc 2,56MB, 100 mốc ≈ 500MB; 30 ảnh → ≈ 1,5GB — tab sập
 * ('Aw, Snap') sau khoảng 100 lần sửa ô trên sheet bật cột Hình ảnh. Ảnh gần như không đổi giữa các
 * mốc mà bị chép nguyên 100 lần.
 *
 * Giữ nguyên dạng CHUỖI của mốc (ngăn xếp ở trên và mọi ngữ nghĩa lùi/tiến không đổi), chỉ thay mỗi
 * chuỗi ảnh bằng một mã ngắn trỏ vào kho dùng chung; khôi phục thì đổi mã về đúng chuỗi cũ. Mảng
 * `images` luôn được THAY cả mảng khi sửa (thêm/xoá ảnh), không sửa tại chỗ, nên mã hoá theo nội dung
 * từng chuỗi là đủ. Kho chỉ lớn theo số ảnh KHÁC NHAU từng xuất hiện trong phiên lưới.
 */
export function createImagePool() {
  const maCua = new Map<string, string>();
  const anhCua = new Map<string, string>();
  const TIEN_TO = "\u0001anh#";
  const sangMa = (s: unknown) => {
    if (typeof s !== "string") return s;
    let m = maCua.get(s);
    if (m === undefined) { m = TIEN_TO + maCua.size; maCua.set(s, m); anhCua.set(m, s); }
    return m;
  };
  const sangAnh = (m: unknown) => (typeof m === "string" && m.startsWith(TIEN_TO) ? anhCua.get(m) ?? m : m);
  return {
    /** JSON của `items`, ảnh thay bằng mã. */
    snap: (items: unknown) => JSON.stringify(items, (k, v) => (k === "images" && Array.isArray(v) ? v.map(sangMa) : v)),
    /** Đọc lại một mốc, mã ảnh đổi về đúng chuỗi ảnh ban đầu. */
    parse: <T>(json: string): T => JSON.parse(json, (k, v) => (k === "images" && Array.isArray(v) ? v.map(sangAnh) : v)) as T,
    /** Số ảnh khác nhau đang giữ — cho bài kiểm. */
    get size() { return anhCua.size; },
  };
}

/**
 * Tổ hợp phím này có phải lệnh LÙI/TIẾN không? — `null` nếu không phải.
 *
 * `ctrl` là Ctrl HOẶC ⌘ (nơi gọi đã gộp `ctrlKey || metaKey`), nên cùng một bảng phím chạy đúng
 * trên cả Windows/Linux lẫn macOS. Nhận CẢ HAI lối tiến vì mỗi hệ quen một kiểu:
 *   · Ctrl+Z         → lùi
 *   · Ctrl+Y         → tiến (nếp Windows/Excel)
 *   · Ctrl+Shift+Z   → tiến (nếp macOS)
 * Chữ hoa được nhận riêng: giữ Shift làm `key` thành "Z", nên nếu chỉ so với "z" thì Ctrl+Shift+Z
 * rơi tọt qua và người dùng macOS mất hẳn phép tiến.
 */
export function undoRedoKey(ctrl: boolean, shift: boolean, key: string): "undo" | "redo" | null {
  if (!ctrl) return null;
  const z = key === "z" || key === "Z";
  const y = key === "y" || key === "Y";
  if (z && !shift) return "undo";
  if (y || (z && shift)) return "redo";
  return null;
}
