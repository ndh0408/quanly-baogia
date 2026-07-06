// Tầng SERVICE cho catalog công ty + mẫu báo giá — bê NGUYÊN logic từ meta.routes.ts, hành vi y hệt.
import type { Request } from "express";
import type { QuoteTemplate } from "@prisma/client";
import { prisma } from "../db.js";
import { getConfig } from "../templateConfigs.js";

// Expose each template's item-table shape so the on-screen editor renders the
// SAME columns as the Excel form (e.g. CLF has "Chi Tiết", GN-có-ngày has "Số Ngày").
function templateLayout(code: string) {
  try {
    const items = getConfig(code).items || {};
    const cols = items.columns || {};
    return { hasDetail: !!cols.detail, hasDays: !!cols.days, numberSubsections: !!items.numberSubsections };
  } catch {
    return { hasDetail: false, hasDays: false, numberSubsections: false };
  }
}
const withLayout = (t: QuoteTemplate) => ({ ...t, layout: templateLayout(t.code) });

export async function listCompanies() {
  const companies = await prisma.company.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      templates: { where: { active: true }, orderBy: { name: "asc" } },
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
    include: { company: true },
  });
  return templates.map(withLayout);
}
