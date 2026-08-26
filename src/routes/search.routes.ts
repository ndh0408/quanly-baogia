import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import { createLimiter } from "../rateLimit.js";
import { validate } from "../validators.js";
import * as svc from "../services/searchService.js";

const router = Router();
router.use(requireAuth);

// TRẦN RIÊNG cho tìm kiếm toàn cục. Trước đây trần DUY NHẤT là apiLimiter chung 120 req/phút
// (src/app.ts), dùng chung với mọi endpoint /api/ khác.
//
// VÌ SAO endpoint này cần trần riêng chặt hơn: một GET /api/search bắn tối đa BA truy vấn SONG SONG
// (src/services/searchService.ts gom bằng `await Promise.all(tasks)`), và nhánh product là ILIKE
// `contains` trên sku/name/category KHÔNG có index trigram — chú thích đầu searchService.ts tự ghi
// "Product vẫn ILIKE (chưa có cột searchText)". Ở trần chung, một phiên đăng nhập đổi được 120
// request/phút thành tới 360 lượt quét bảng/phút. Đối chiếu: export, import, backup, file-sign,
// export-async đều đã có limiter riêng từ trước.
//
// KHÔNG NÓI QUÁ: đây không phải vá một lỗ hổng — endpoint đã đòi đăng nhập và đã phân quyền theo
// từng domain trong service. Cái limiter này mua về (a) trần chi phí CSDL cho một tài khoản, và
// (b) tín hiệu 429 để người vận hành THẤY có ai đang quét.
//
// CHỌN SỐ: CHƯA ĐO trên production. 60/phút là cận trên thô của nhịp người thật — bảng lệnh ở
// web/src/components/Shell.tsx debounce 200ms và chỉ gọi khi từ khoá ≥ 2 ký tự, nên một lượt tìm
// thường tốn vài request; 60 request/phút nghĩa là gõ tìm liên tục MỘT LẦN MỖI GIÂY suốt một phút.
// Vẫn thấp hơn hẳn trần chung 120.
//
// KHOÁ THEO TÀI KHOẢN, không theo IP: requireAuth đứng trước nên userId luôn có. Khoá theo IP sẽ
// gộp cả văn phòng sau một NAT vào chung một bộ đếm — một người gõ nhiều làm cả phòng bị chặn.
const searchLimiter = createLimiter("search", {
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req: Request) => `search:${req.session.userId}`,
  message: { error: "Bạn đang tìm kiếm quá nhanh, vui lòng chậm lại một chút" },
});
router.use(searchLimiter);

const Query = z.object({
  q: z.string().min(1, "Vui lòng nhập từ khóa tìm kiếm").max(200, "Từ khóa tối đa 200 ký tự"),
  types: z.string().max(120).optional(),     // csv: quote,customer,product
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// Route MỎNG: validate → gọi tầng service (phân quyền phạm vi + truy vấn ở searchService.ts).
router.get("/", validate({ query: Query }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.globalSearch(req))));

export default router;
