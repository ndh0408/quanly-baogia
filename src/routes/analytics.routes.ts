import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import { createLimiter } from "../rateLimit.js";
import { validate } from "../validators.js";
import { requirePermission, PERMISSIONS as P } from "../permissions.js";
import * as svc from "../services/analyticsService.js";

const router = Router();
router.use(requireAuth);
// 🔒 Chỉ người tạo/quản lý báo giá xem được số liệu kinh doanh. account_hn (chỉ điền giá HN)
// KHÔNG được — quoteScopeWhere gồm cả báo giá account là member nên nếu mở sẽ lộ TỔNG TIỀN
// (tiền khách) của các báo giá được giao. Chặn ở router cho mọi endpoint analytics.
router.use(requirePermission(P.QUOTE_CREATE));

// TRẦN RIÊNG cho nhóm analytics — trước đây chỉ có apiLimiter chung 120 req/phút (src/app.ts).
// Bốn route ở đây là truy vấn TỔNG HỢP trên toàn bảng Quote (đếm/gộp theo kỳ), tức đắt hơn hẳn một
// lần đọc theo id, và tham số `from`/`to` do client tự đặt nên một kỳ rộng quét gần hết bảng.
//
// CHỌN SỐ: CHƯA ĐO trên production. Màn hình Dashboard (web/src/pages/Dashboard.tsx) bắn 4 request
// mỗi lần đổi khoảng thời gian; 60/phút cho phép đổi khoảng ~15 lần mỗi phút — rộng hơn nhiều so
// với thao tác người thật, mà vẫn là một nửa trần chung.
//
// Khoá theo TÀI KHOẢN (requireAuth đã đứng trước): khoá theo IP sẽ gộp cả văn phòng sau NAT.
router.use(
  createLimiter("analytics", {
    windowMs: 60_000,
    max: 60,
    keyGenerator: (req: Request) => `analytics:${req.session.userId}`,
    message: { error: "Quá nhiều yêu cầu thống kê, vui lòng thử lại sau ít phút" },
  })
);

const PeriodQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// Route MỎNG: validate + gọi tầng service (logic/quyền/tính toán ở analyticsService.ts).
router.get("/overview", validate({ query: PeriodQuery }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.overview(req))));
router.get("/revenue-by-day", validate({ query: PeriodQuery }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.revenueByDay(req))));
router.get(
  "/top-sales",
  validate({ query: PeriodQuery.extend({ limit: z.coerce.number().int().min(1).max(50).default(10) }) }),
  asyncHandler(async (req: Request, res: Response) => res.json(await svc.topSales(req)))
);
router.get("/funnel", asyncHandler(async (req: Request, res: Response) => res.json(await svc.funnel(req))));

export default router;
