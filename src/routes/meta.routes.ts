import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { getConfig } from "../templateConfigs.js";

const router = Router();
router.use(requireAuth);

// Expose each template's item-table shape so the on-screen editor renders the
// SAME columns as the Excel form (e.g. CLF has "Chi Tiết", GN-có-ngày has "Số Ngày").
function templateLayout(code) {
  try {
    const items = getConfig(code).items || {};
    const cols = items.columns || {};
    return { hasDetail: !!cols.detail, hasDays: !!cols.days, numberSubsections: !!items.numberSubsections };
  } catch {
    return { hasDetail: false, hasDays: false, numberSubsections: false };
  }
}
const withLayout = (t) => ({ ...t, layout: templateLayout(t.code) });

router.get("/companies", asyncHandler(async (req, res) => {
  const companies = await prisma.company.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      templates: { where: { active: true }, orderBy: { name: "asc" } },
    },
  });
  res.json(companies.map((c) => ({ ...c, templates: c.templates.map(withLayout) })));
}));

router.get("/templates", asyncHandler(async (req, res) => {
  const where: any = { active: true };
  if (req.query.companyId) where.companyId = parseInt(req.query.companyId, 10);
  const templates = await prisma.quoteTemplate.findMany({
    where,
    orderBy: { name: "asc" },
    include: { company: true },
  });
  res.json(templates.map(withLayout));
}));

export default router;
