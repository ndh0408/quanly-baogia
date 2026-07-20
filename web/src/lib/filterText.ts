// Chuẩn hóa tìm kiếm phía client: bỏ dấu tiếng Việt, dấu câu và khoảng trắng thừa.
// Dùng cho các bảng đã tải dữ liệu về client (không đi qua searchText của backend).
export function normalizeFilterText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Từng từ khóa có thể nằm ở field khác nhau và không cần đúng thứ tự.
// Ví dụ "sao mai 26001" vẫn khớp Khách hàng="Sao Mai", MSX="GN26001".
export function smartTextMatch(query: string, parts: unknown[]): boolean {
  const tokens = normalizeFilterText(query).split(" ").filter(Boolean);
  if (!tokens.length) return true;
  const haystack = normalizeFilterText(parts.map((part) => String(part ?? "")).join(" "));
  return tokens.every((token) => haystack.includes(token));
}
