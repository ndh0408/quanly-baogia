import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";

const router = Router();
router.use(requireAuth);

router.get("/companies", asyncHandler(async (req, res) => {
  const companies = await prisma.company.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    include: {
      templates: { where: { active: true }, orderBy: { name: "asc" } },
    },
  });
  res.json(companies);
}));

router.get("/templates", asyncHandler(async (req, res) => {
  const where = { active: true };
  if (req.query.companyId) where.companyId = parseInt(req.query.companyId, 10);
  const templates = await prisma.quoteTemplate.findMany({
    where,
    orderBy: { name: "asc" },
    include: { company: true },
  });
  res.json(templates);
}));

export default router;
