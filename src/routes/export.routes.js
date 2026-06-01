import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { canOnQuote } from "../permissions.js";
import { validate } from "../validators.js";
import { buildQuoteBuffer } from "../excel.js";
import { renderQuotePdf } from "../pdf.js";
import { audit } from "../audit.js";

const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

router.get(
  "/:id.xlsx",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const quote = await prisma.quote.findFirst({
      where: { id },
      include: {
        company: true,
        members: { select: { id: true } },
        sheets: {
          orderBy: { order: "asc" },
          include: {
            template: true,
            items: { orderBy: { order: "asc" } },
          },
        },
      },
    });
    if (!quote) return res.status(404).json({ error: "Không tìm thấy báo giá" });
    if (!canOnQuote(req.session, "read", quote)) {
      return res.status(403).json({ error: "Không có quyền" });
    }

    const buf = await buildQuoteBuffer(quote);
    const safeName = (quote.quoteNumber || `quote-${id}`).replace(/[^A-Za-z0-9_-]/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="BaoGia_${safeName}.xlsx"`);
    res.setHeader("Content-Length", buf.length);
    res.end(buf);

    await audit(req, "quote.export", { resource: "quote", resourceId: id });
  })
);

router.get(
  "/:id.pdf",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const quote = await prisma.quote.findFirst({
      where: { id },
      include: {
        company: true,
        members: { select: { id: true } },
        sheets: {
          orderBy: { order: "asc" },
          include: { template: true, items: { orderBy: { order: "asc" } } },
        },
      },
    });
    if (!quote) return res.status(404).json({ error: "Không tìm thấy báo giá" });
    if (!canOnQuote(req.session, "read", quote)) {
      return res.status(403).json({ error: "Không có quyền" });
    }

    const buf = await renderQuotePdf({
      ...quote,
      subtotal: Number(quote.subtotal),
      vat: Number(quote.vat),
      total: Number(quote.total),
      vatPercent: Number(quote.vatPercent),
    });
    const safeName = (quote.quoteNumber || `quote-${id}`).replace(/[^A-Za-z0-9_-]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="BaoGia_${safeName}.pdf"`);
    res.setHeader("Content-Length", buf.length);
    res.end(buf);
    await audit(req, "quote.export.pdf", { resource: "quote", resourceId: id });
  })
);

export default router;
