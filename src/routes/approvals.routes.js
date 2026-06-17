import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";

const router = Router();
router.use(requireAuth);

// === Queue: pending approvals visible to the current user ===
router.get(
  "/queue",
  asyncHandler(async (req, res) => {
    // Admin (Director) thấy MỌI báo giá chờ duyệt; manager chỉ thấy báo giá chờ duyệt
    // DO CHÍNH MÌNH tạo (họ được tự duyệt). Nhân viên không thấy hàng chờ duyệt.
    const role = req.session.role;
    let where;
    if (role === "admin") where = { decision: "pending" };
    else if (role === "manager") where = { decision: "pending", quote: { createdById: req.session.userId } };
    else return res.json({ data: [], meta: { total: 0 } });
    const rows = await prisma.approval.findMany({
      where,
      orderBy: [{ quoteId: "asc" }, { level: "asc" }],
      take: 100,
      include: { quote: { include: { company: true, createdBy: { select: { displayName: true } } } } },
    });
    res.json({
      data: rows.map((r) => ({
        ...r,
        quote: r.quote ? {
          ...r.quote,
          subtotal: Number(r.quote.subtotal),
          vat: Number(r.quote.vat),
          total: Number(r.quote.total),
          vatPercent: Number(r.quote.vatPercent),
        } : null,
      })),
      meta: { total: rows.length },
    });
  })
);

export default router;
