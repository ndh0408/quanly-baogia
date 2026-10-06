import type { EditorTemplate } from "./api";

/**
 * THỨ TỰ HIỂN THỊ mẫu báo giá ở mọi ô chọn mẫu (chủ repo chốt 2026-10-06): mỗi công ty
 * **Không ngày → Banner → Có ngày** — cả GN lẫn Colorfull/CLF.
 *
 * CHỈ dùng để VẼ danh sách chọn. KHÔNG thay thứ tự `/api/meta/templates` trả về: "mẫu đầu" của danh
 * sách đó (theo tên, collation CSDL) là mẫu MẶC ĐỊNH của bảng nội bộ / Hà Nội thiếu `templateId`
 * (HnTables.mauBangHn, ExtraTables.tplOf, máy chủ bangNoiBoCoNgay) — đổi nó là đổi bảng đó có nhân
 * Số Ngày hay không, tức đổi TIỀN của báo giá cũ.
 *
 * Phân nhóm theo cấu trúc mẫu, không theo id: mã/tên có "banner" → Banner; mẫu có cột Số Ngày
 * (`layout.hasDays`) → Có ngày; còn lại → Không ngày. Trong một nhóm: theo tên (tiếng Việt), rồi mã.
 */
export function nhomMau(t: Pick<EditorTemplate, "code" | "name" | "layout">): 0 | 1 | 2 {
  if (/banner/i.test(t.code || "") || /banner/i.test(t.name || "")) return 1;
  return t.layout?.hasDays ? 2 : 0;
}

export function sapMauHienThi<T extends Pick<EditorTemplate, "code" | "name" | "layout">>(ds: readonly T[]): T[] {
  return [...ds].sort((a, b) =>
    nhomMau(a) - nhomMau(b)
    || (a.name || "").localeCompare(b.name || "", "vi")
    || (a.code || "").localeCompare(b.code || ""));
}
