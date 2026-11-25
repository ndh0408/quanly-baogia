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
export type CodeQuote = { projectCode?: string | null; quoteNumber?: string | null; projectVersion?: number | null; status?: string | null };

/**
 * Chữ đứng thay MÃ DỰ ÁN khi báo giá CHƯA CHỐT. Chủ repo 2026-11-25: "tạo mới chưa duyệt thì không có mã nào, duyệt
 * khách chốt thì mới tạo mã dự án" — mã chỉ được cấp lúc chốt (src/maDuAn.ts), nên báo giá chưa chốt mang
 * projectCode = null và hiện "NHÁP <số báo giá>": số báo giá đi kèm để hai file nháp vẫn phân biệt được.
 */
export const NHAN_NHAP = "NHÁP";

/**
 * Báo giá hiện dạng NHÁP: KHÔNG có mã dự án VÀ biết chắc là CHƯA CHỐT.
 *
 * VÌ SAO PHẢI BIẾT `status`: báo giá ĐÃ CHỐT mà không có mã vẫn tồn tại — người tạo không có tiền tố mã
 * (`User.projectCode` trống) thì chốt xong vẫn null, và mã của nó từ trước tới nay CHÍNH LÀ số báo giá: trang
 * Nhân sự lưu cứng chuỗi đó (`PersonnelRecord.projectCode`) và buildProjectRef khớp BẰNG-ĐÚNG. Hiện "NHÁP" cho
 * báo giá đó là đứt tra cứu hợp đồng của mọi hồ sơ nhân sự trỏ vào nó. Nên vắng `status` (chỗ gọi chỉ đọc báo
 * giá đã chốt, không chọn cột này) = hành vi cũ: lùi về số báo giá.
 */
export const laNhap = (q: CodeQuote): boolean => !q.projectCode && !!q.status && q.status !== "converted";

/** Mã dự án hiển thị: projectCode (+ "_v2…" khi có phiên bản); chưa chốt → "NHÁP <số BG>"; đã chốt mà không mã → số BG. */
export function codeLabel(q: CodeQuote): string {
  if (laNhap(q)) return q.quoteNumber ? `${NHAN_NHAP} ${q.quoteNumber}` : NHAN_NHAP;
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
