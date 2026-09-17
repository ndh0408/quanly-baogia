/**
 * ============================================================================
 * ĐỌC TÊN RÀNG BUỘC DUY NHẤT TỪ MỘT LỖI P2002 — QUA CẢ HAI HÌNH DẠNG.
 *
 * ── VÌ SAO FILE NÀY TỒN TẠI ────────────────────────────────────────────────
 * Với engine Rust cũ, Prisma điền `err.meta.target` (mảng cột, hoặc tên index). Từ khi repo chuyển
 * sang driver adapter `@prisma/adapter-pg` (Prisma 7), trường đó KHÔNG CÒN ĐƯỢC ĐIỀN NỮA — ĐÃ ĐO
 * bằng cách cố ý gây trùng trên `@@unique([projectCode, projectVersion])`:
 *
 *     code   = "P2002"
 *     target = undefined
 *     meta   = { driverAdapterError: { cause: {
 *                 originalCode: "23505",
 *                 constraint: { index: "Quote_projectCode_projectVersion_key" },
 *                 table: "Quote" } } }
 *
 * Hệ quả: MỌI phép so `String(err.meta?.target ?? "").includes("…")` trong repo đều trả về false
 * vĩnh viễn. Hai chỗ đang dựa vào nó, và cả hai đều IM LẶNG hỏng:
 *
 *   · src/services/quoteService.ts — nhánh "đụng MÃ DỰ ÁN, không phải số báo giá" không bao giờ
 *     chạy, nên vòng thử lại không đẩy bộ đếm mã dự án. Bốn lượt thử y hệt nhau rồi 409 "Số báo
 *     giá bị trùng" — sai hẳn nguyên nhân, và mỗi lượt chèn rồi rollback TOÀN BỘ hạng mục.
 *   · src/services/customerService.ts — 409 "Mã số thuế đã thuộc khách hàng X" tụt xuống thành
 *     `throw e` → 500 "Lỗi server", đúng cái mà hàm đó sinh ra để tránh.
 *
 * ── CÙNG LỚP LỖI ĐÃ GẶP Ở ĐÂY ──────────────────────────────────────────────
 * Driver adapter đổi hình dạng lỗi là chuyện đã cắn repo này một lần: nhánh `P2024` cho cạn pool
 * cũng từng là mã chết vì node-pg ném một `Error` TRẦN không có `.code`
 * (xem tests/pl-can-pool-503.test.js). Cả hai lần đều hỏng theo kiểu KHÔNG cổng nào đỏ — chỉ có
 * người dùng nhận một thông điệp sai.
 *
 * ── ĐỌC CẢ HAI, ĐỪNG CHỌN MỘT ─────────────────────────────────────────────
 * Vẫn đọc `meta.target` trước: bản Prisma không dùng adapter, và mọi bài test tự chế lỗi
 * `{ code: "P2002", meta: { target: [...] } }`, đều đi qua đường đó. Rồi mới tới đường của adapter.
 * Chọn một trong hai là để lại đúng một nửa số ca hỏng im lặng.
 * ============================================================================
 */

/** Hình dạng tối thiểu của một lỗi Prisma mà hàm dưới cần đọc. */
type LoiPrisma = {
  code?: unknown;
  meta?: {
    target?: unknown;
    driverAdapterError?: {
      cause?: {
        constraint?: { index?: unknown; fields?: unknown } | unknown;
      };
    };
  };
};

/**
 * Chuỗi mô tả ràng buộc duy nhất bị vi phạm — dùng để `.includes("<tên cột>")`.
 *
 * Trả về chuỗi RỖNG khi không đọc được, để nơi gọi không phải phòng `undefined`. Chuỗi rỗng không
 * `.includes` bất cứ tên cột nào, nên một lỗi lạ sẽ rơi xuống nhánh mặc định thay vì bị đoán nhầm
 * thành một ràng buộc cụ thể.
 */
export function tenRangBuocTrung(e: unknown): string {
  const err = e as LoiPrisma | null | undefined;
  const t = err?.meta?.target;
  // Engine Rust / lỗi tự chế trong test: mảng cột hoặc tên index.
  if (Array.isArray(t)) return t.join(",");
  if (typeof t === "string" && t) return t;

  // Driver adapter (@prisma/adapter-pg): tên index nằm sâu trong `cause.constraint`.
  const rb = (err?.meta?.driverAdapterError?.cause as { constraint?: unknown } | undefined)?.constraint;
  if (typeof rb === "string") return rb;
  if (rb && typeof rb === "object") {
    const o = rb as { index?: unknown; fields?: unknown };
    if (typeof o.index === "string") return o.index;
    // Một số bản adapter trả danh sách CỘT thay vì tên index.
    if (Array.isArray(o.fields)) return o.fields.join(",");
  }
  return "";
}

/** `true` khi lỗi là vi phạm ràng buộc duy nhất VÀ ràng buộc đó dính tới `cot`. */
export function trungTren(e: unknown, cot: string): boolean {
  const err = e as LoiPrisma | null | undefined;
  if (err?.code !== "P2002") return false;
  return tenRangBuocTrung(e).includes(cot);
}
