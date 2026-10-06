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

/** Mẫu chọn sẵn cho sheet / bảng MỚI tạo: mẫu đầu theo thứ tự hiển thị (Không ngày → Banner → Có ngày) trong
 *  các mẫu của công ty, không có thì trong mọi mẫu. KHÁC "mẫu dự phòng" của bảng CŨ thiếu templateId (mẫu đầu
 *  theo thứ tự API — giữ nguyên vì nó quyết định có nhân Số Ngày, đổi là đổi tiền báo giá cũ). */
export function mauMacDinhMoi<T extends Pick<EditorTemplate, "code" | "name" | "layout"> & { id: number; companyId?: number | null }>(
  ds: readonly T[], companyId?: number | null,
): T | undefined {
  const cuaCty = ds.filter((t) => t.companyId === companyId);
  return sapMauHienThi(cuaCty.length ? cuaCty : ds)[0];
}

/** Thứ tự sheet khi tạo báo giá từ các mẫu đã tích: theo thứ tự hiển thị, không theo thứ tự bấm. */
export function sapIdMauDaChon(daChon: readonly number[], hienThi: readonly { id: number }[]): number[] {
  const trongDs = hienThi.map((t) => t.id).filter((id) => daChon.includes(id));
  return trongDs.concat(daChon.filter((id) => !trongDs.includes(id)));
}
