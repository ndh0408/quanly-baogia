import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { asyncHandler } from "../middleware.js";
import { validate } from "../validators.js";
import { requirePermission, PERMISSIONS } from "../permissions.js";
import * as svc from "../services/auditService.js";

const router = Router();
// Honour the permission map (manager holds audit:view) instead of admin-only,
// so the nav gate (can('audit:view')) and the route agree.
router.use(requirePermission(PERMISSIONS.AUDIT_VIEW));

const Query = z.object({
  actorId: z.coerce.number().int().positive().optional(),
  action: z.string().max(80).optional(),
  resource: z.string().max(40).optional(),
  resourceId: z.string().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(config.MAX_PAGE_SIZE).default(50),
});

// Route MỎNG: validate → gọi tầng service (lọc/PII/resolve tên đối tượng ở auditService.ts).
router.get("/", validate({ query: Query }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.listAuditEvents(req))));

export default router;
