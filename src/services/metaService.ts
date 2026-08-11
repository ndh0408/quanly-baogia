// Tầng SERVICE cho catalog công ty + mẫu báo giá — bê NGUYÊN logic từ meta.routes.ts, hành vi y hệt.
import type { Request } from "express";

import { prisma } from "../db.js";
import { getConfig } from "../templateConfigs.js";

// Expose each template's item-table shape so the on-screen editor renders the
// SAME columns as the Excel form (e.g. CLF has "Chi Tiết", GN-có-ngày has "Số Ngày").
function templateLayout(code: string) {
  try {
    const items = getConfig(code).items || {};
    const cols = items.columns || {};
    return {
      // hasDetail = CÓ HIỆN cột Chi Tiết (mẫu có cột đó VÀ chưa ngừng dùng).
      hasDetail: !!cols.detail && !items.hideDetail,
      // reserveDetail = sơ đồ ĐỊA CHỈ Ô (A1) của editor VẪN chừa 1 cột cho Chi Tiết dù không hiện
      // → công thức đã lưu của báo giá cũ (=F3*E3…) giữ nguyên ý nghĩa. ĐỪNG bỏ khi ẩn cột.
      reserveDetail: !!cols.detail,
      hasDays: !!cols.days,
      numberSubsections: !!items.numberSubsections,
    };
  } catch {
    return { hasDetail: false, reserveDetail: false, hasDays: false, numberSubsections: false };
  }
}
// Nhận BẤT KỲ hình dạng nào có `code` — vì projection đã thu hẹp, không còn là QuoteTemplate đầy đủ.
const withLayout = <T extends { code: string }>(t: T) => ({ ...t, layout: templateLayout(t.code) });

// TỐI THIỂU HOÁ DỮ LIỆU TRẢ VỀ. Trước đây hai endpoint này trả NGUYÊN model Company/QuoteTemplate
// (`include` không kèm `select`), nên mọi tài khoản đăng nhập đọc được cả các cột giao diện không hề
// dùng — trong đó có `filePath` (đường dẫn tệp mẫu trên máy chủ, gợi ý bố cục thư mục) và các cột nội
// bộ khác. Chỉ trả đúng những gì trình soạn báo giá cần để vẽ.
// Các cột CỐ Ý bỏ ra: `logoPath` (đường dẫn tệp trên máy chủ), `active` (đã lọc sẵn), `createdAt`/
// `updatedAt`/`deletedAt` (siêu dữ liệu nội bộ) — trình soạn báo giá không dùng cái nào.
const COMPANY_FIELDS = {
  id: true, code: true, name: true, shortName: true, address: true, phone: true,
  email: true, taxCode: true, city: true, quotePrefix: true,
} as const;
// `filePath` (đường dẫn tệp mẫu .xlsx trên máy chủ) BỎ RA — nó để lộ bố cục thư mục máy chủ và
// không có giá trị nào với client.
const TEMPLATE_FIELDS = { id: true, code: true, name: true, companyId: true } as const;

export async function listCompanies() {
  const companies = await prisma.company.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      ...COMPANY_FIELDS,
      templates: { where: { active: true }, orderBy: { name: "asc" }, select: TEMPLATE_FIELDS },
    },
  });
  return companies.map((c) => ({ ...c, templates: c.templates.map(withLayout) }));
}

export async function listTemplates(req: Request) {
  const where: any = { active: true };
  if (req.query.companyId) where.companyId = parseInt(req.query.companyId as string, 10);
  const templates = await prisma.quoteTemplate.findMany({
    where,
    orderBy: { name: "asc" },
    select: { ...TEMPLATE_FIELDS, company: { select: COMPANY_FIELDS } },
  });
  return templates.map(withLayout);
}
