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
// ── CHỌN SỐ: PHẢI TÍNH CẢ ĐƯỜNG TỰ-TẢI-LẠI, KHÔNG CHỈ THAO TÁC TAY ──────────────────────────
// Bản đầu đặt 60/phút với lý lẽ "Dashboard bắn 4 request mỗi lần đổi khoảng thời gian; 60/phút cho
// phép đổi ~15 lần mỗi phút — rộng hơn thao tác người thật". Phép tính đó BỎ SÓT nguồn sinh request
// áp đảo, và bỏ sót nó thì trần 60 chặn đúng người dùng bình thường:
//
//   1. src/db.ts — sau MỌI thao tác ghi Quote/Customer/User: `emitChange(...)`.
//   2. src/sse.ts — `emitChange` → `broadcast("changed", …)`, bắn cho MỌI client đang mở, không
//      riêng người vừa ghi.
//   3. web/src/components/Shell.tsx — nhận sự kiện đó, phát `realtime:changed`.
//   4. web/src/lib/query.tsx — `qc.invalidateQueries()` KHÔNG THAM SỐ ⇒ làm cũ MỌI query; cửa sổ
//      gộp `WINDOW = 800`ms ⇒ tối đa 60_000/800 = 75 lượt invalidate mỗi phút.
//   5. web/src/pages/Dashboard.tsx — một query `["dashboard", period]`, nhưng queryFn của nó bắn
//      `Promise.all` 4 request analytics (3 nếu không phải admin).
//
// TRẦN TRÊN THẬT: 75 × 4 = 300 request/phút, và người dùng KHÔNG làm gì cả — chỉ cần đồng nghiệp
// lưu báo giá đủ dày. Chỉ 15 lần ghi mỗi phút (một lần mỗi 4 giây) là chạm đúng 60. Sau đó Dashboard
// nhận 429 và vào trạng thái lỗi, dù không ai làm gì sai.
//
// Nên mốc phải là 300 CỘNG biên cho thao tác tay đồng thời → 400. Nó vẫn là một cái trần thật:
// 400/phút cho MỘT tài khoản chặn được vòng lặp gọi tự động, chỉ không chặn nhịp mà chính ứng dụng
// sinh ra. Muốn hạ số này thì phải hạ NGUỒN trước — cho `invalidateQueries` lọc theo queryKey để
// "dashboard" không bị làm cũ theo mọi sự kiện. Xem tests/b9-analytics-limit-vs-sse.test.js: bài đó
// đọc thẳng WINDOW và số request từ mã nguồn web/, nên đổi một trong hai mà quên nới trần là ĐỎ.
//
// Khoá theo TÀI KHOẢN (requireAuth đã đứng trước): khoá theo IP sẽ gộp cả văn phòng sau NAT.
router.use(
  createLimiter("analytics", {
    windowMs: 60_000,
    max: 400,
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
