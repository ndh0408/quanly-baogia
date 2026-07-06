import { Router } from "express";
import type { Request, Response } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";
import * as svc from "../services/metaService.js";

const router = Router();
router.use(requireAuth);

// Route MỎNG: gọi tầng service (catalog công ty/mẫu + layout cột ở metaService.ts).
router.get("/companies", asyncHandler(async (_req: Request, res: Response) => res.json(await svc.listCompanies())));
router.get("/templates", asyncHandler(async (req: Request, res: Response) => res.json(await svc.listTemplates(req))));

export default router;
