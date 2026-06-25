import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import { requirePermission, PERMISSIONS as P } from "../permissions.js";
import * as svc from "../services/analyticsService.js";

const router = Router();
router.use(requireAuth);
// 🔒 Chỉ người tạo/quản lý báo giá xem được số liệu kinh doanh. account_hn (chỉ điền giá HN)
// KHÔNG được — quoteScopeWhere gồm cả báo giá account là member nên nếu mở sẽ lộ TỔNG TIỀN
// (tiền khách) của các báo giá được giao. Chặn ở router cho mọi endpoint analytics.
router.use(requirePermission(P.QUOTE_CREATE));

const PeriodQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// Route MỎNG: validate + gọi tầng service (logic/quyền/tính toán ở analyticsService.ts).
router.get("/overview", validate({ query: PeriodQuery }), asyncHandler(async (req, res) => res.json(await svc.overview(req))));
router.get("/revenue-by-day", validate({ query: PeriodQuery }), asyncHandler(async (req, res) => res.json(await svc.revenueByDay(req))));
router.get(
  "/top-sales",
  validate({ query: PeriodQuery.extend({ limit: z.coerce.number().int().min(1).max(50).default(10) }) }),
  asyncHandler(async (req, res) => res.json(await svc.topSales(req)))
);
router.get("/funnel", asyncHandler(async (req, res) => res.json(await svc.funnel(req))));

export default router;
