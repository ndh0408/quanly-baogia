import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate, zbool } from "../validators.js";
import * as svc from "../services/notificationService.js";

const router = Router();
router.use(requireAuth);

// Route MỎNG: chỉ validate + gọi tầng service (logic truy vấn/cô lập theo user ở notificationService.ts).
router.get(
  "/",
  validate({ query: z.object({
    unread: zbool.optional(),
    page: z.coerce.number().int().min(1).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
  })}),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.listNotifications(req)))
);

router.get(
  "/unread-count",
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.unreadCount(req)))
);

router.post(
  "/:id/read",
  validate({ params: z.object({ id: z.coerce.bigint() }) }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.markRead(req)))
);

router.post(
  "/read-all",
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.markAllRead(req)))
);

export default router;
