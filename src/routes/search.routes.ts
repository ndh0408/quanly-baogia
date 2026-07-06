import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import * as svc from "../services/searchService.js";

const router = Router();
router.use(requireAuth);

const Query = z.object({
  q: z.string().min(1, "Vui lòng nhập từ khóa tìm kiếm").max(200, "Từ khóa tối đa 200 ký tự"),
  types: z.string().max(120).optional(),     // csv: quote,customer,product
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// Route MỎNG: validate → gọi tầng service (phân quyền phạm vi + truy vấn ở searchService.ts).
router.get("/", validate({ query: Query }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.globalSearch(req))));

export default router;
