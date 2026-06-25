// Chuẩn hóa chuỗi tìm kiếm: bỏ dấu tiếng Việt + thường hóa → tìm "gõ sai dấu/không dấu vẫn ra".
// DÙNG CHUNG cho cả LƯU (cột searchText) lẫn TRUY VẤN (normalize từ khóa) → luôn khớp 100%.
// Vd: "Nguyễn Đức" → "nguyen duc"; tìm "nguyen duc" hoặc "Nguyễn Đức" đều khớp.

export function normalizeSearch(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join(" ")
    .toLowerCase()
    .normalize("NFD") // tách dấu thành ký tự tổ hợp
    .replace(/[̀-ͯ]/g, "") // bỏ dấu tổ hợp (à→a, ê→e, ố→o, ...)
    .replace(/đ/g, "d") // đ KHÔNG phải dấu tổ hợp → thay riêng
    .replace(/[^a-z0-9\s]/g, " ") // ký tự khác → khoảng trắng (gộp số/chữ, bỏ ký tự lạ)
    .replace(/\s+/g, " ")
    .trim();
}

// Token KHÔNG BAO GIỜ có trong searchText (cột chỉ chứa [a-z0-9 ]) — dùng khi q chuẩn-hóa ra RỖNG.
const NO_MATCH = "~no~match~";

/**
 * Prisma StringFilter cho cột searchText từ từ khóa q. Nếu q chuẩn-hóa ra rỗng (q chỉ gồm ký tự đặc
 * biệt/khoảng trắng) → trả token-không-khớp để ra 0 kết quả (NHƯ CŨ), tránh `contains:""` = LIKE '%%'
 * nuốt CẢ danh sách trong phạm vi quyền.
 */
export function searchTextFilter(q: string | null | undefined): { contains: string } {
  return { contains: normalizeSearch(q ?? "") || NO_MATCH };
}
