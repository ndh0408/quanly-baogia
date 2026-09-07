// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ src/quoteCode.ts — MÃ DỰ ÁN hiển thị, phía MÁY CHỦ. Thuần: không Prisma,     │
// │ không DOM, không import gì — nên đường XUẤT FILE (chạy trong worker_threads) │
// │ dùng được mà không kéo theo cả tầng CSDL.                                    │
// │                                                                              │
// │ ⚠️ MIRROR của `codeLabel` + `sheetCode` trong shared/quote-math.ts. Phải khai │
// │ hai bản vì tsconfig.build.json đặt rootDir="src" → shared/ KHÔNG vào dist/,  │
// │ nên `src/` không import được `shared/`. Hai bản KHÔNG ĐƯỢC LỆCH:            │
// │ tests/projectcode-parity.test.js chạy cả hai trên cùng dữ liệu và bắt lệch.  │
// └─────────────────────────────────────────────────────────────────────────────┘
export type CodeQuote = { projectCode?: string | null; quoteNumber?: string | null; projectVersion?: number | null };

/** Mã dự án hiển thị: projectCode (không có thì lùi về quoteNumber) + "_v2…" khi có phiên bản. */
export function codeLabel(q: CodeQuote): string {
  const c = q.projectCode || q.quoteNumber || "";
  return q.projectVersion && q.projectVersion > 1 ? `${c}_v${q.projectVersion}` : c;
}

/**
 * MÃ SẢN XUẤT CỦA MỘT SHEET = mã báo giá + hậu tố HAI CHỮ SỐ ("_01", "_02").
 *
 * `codeNo` là SỐ ĐÃ ĐÓNG BĂNG trong CSDL (`QuoteSheet.codeNo`), KHÔNG phải vị trí trong mảng.
 * Nhờ vậy xoá sheet 02 thì 03 vẫn là 03 — mã đã đi vào hoá đơn không bao giờ bị gán lại cho
 * sheet khác. Dữ liệu cũ chưa cấp số thì truyền `i + 1` (vị trí) để không vỡ màn hình.
 *
 * Báo giá chỉ có MỘT sheet thì KHÔNG có hậu tố — chốt với chủ dự án 2026-09-07. Thêm vào là đổi
 * mã của mọi báo giá một-sheet đang chạy (kể cả mã đã in ra giấy) mà chẳng được gì.
 *
 * Hậu tố là thứ trang Nhân sự dùng để TRA NGƯỢC (`PersonnelRecord.projectCode` lưu cứng chuỗi
 * này và `buildProjectRef` khớp BẰNG-ĐÚNG), nên quy tắc phải sống ở đúng MỘT chỗ mỗi phía.
 */
export function sheetCode(q: CodeQuote, codeNo: number, total: number): string {
  const base = codeLabel(q);
  return total > 1 ? `${base}_${String(codeNo).padStart(2, "0")}` : base;
}

/** `codeNo` đã cấp, hoặc vị trí + 1 cho dữ liệu cũ chưa backfill. Một chỗ quyết định, mọi nơi dùng. */
export const soMa = (sh: { codeNo?: number | null } | null | undefined, i: number) =>
  sh && sh.codeNo != null && sh.codeNo > 0 ? sh.codeNo : i + 1;
