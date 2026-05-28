import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { buildQuoteBuffer } from "../excel.js";

const router = Router();
router.use(requireAuth);

router.get("/:id.xlsx", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      company: true,
      sheets: {
        orderBy: { order: "asc" },
        include: {
          template: true,
          items: { orderBy: { order: "asc" } },
        },
      },
    },
  });
  if (!quote) return res.status(404).send("Không tìm thấy báo giá");
  if (req.session.role === "employee" && quote.createdById !== req.session.userId) {
    return res.status(403).send("Không có quyền");
  }

  const buf = await buildQuoteBuffer(quote);
  const safeName = (quote.quoteNumber || `quote-${id}`).replace(/[^A-Za-z0-9_-]/g, "_");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="BaoGia_${safeName}.xlsx"`);
  res.setHeader("Content-Length", buf.length);
  res.end(buf);
}));

export default router;
