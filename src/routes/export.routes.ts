import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { canOnQuote, requirePermission, PERMISSIONS as P } from "../permissions.js";
import { validate } from "../validators.js";
import { buildQuoteBuffer } from "../excel.js";
import { renderQuotePdf } from "../pdf.js";
import { runExportJob } from "../exportQueue.js";
import { createLimiter } from "../rateLimit.js";
import { audit } from "../audit.js";

// JSON-safe copy of the quote for the worker thread (normalizes Prisma Decimals →
// strings and Dates → ISO; buildQuoteBuffer/renderQuotePdf read these via Number()
// and new Date(), proven by tests/excel.test.js). Used for the worker payload; the
// inline fallback uses the original quote object.
const plain = (q: any) => JSON.parse(JSON.stringify(q));

const router = Router();
router.use(requireAuth);
// Export is a distinct capability (quote:export), NOT implied by read access.
// account_hn holds quote:read:own (as an assigned member) and would otherwise pass
// the per-handler canOnQuote("read") check and download full pricing it must never
// see ("KHÔNG export"). Gate both .xlsx and .pdf on the export permission; the
// per-quote ownership check stays inside each handler to also stop IDOR.
router.use(requirePermission(P.QUOTE_EXPORT));
// Dedicated limiter + size guard: synchronous export generation is CPU/memory heavy
// and is otherwise only covered by the generic api limiter. Oversized quotes must go
// through the async BullMQ queue, not pin the event loop here.
router.use(createLimiter("export", { windowMs: 60_000, max: 30 }));

const idParam = z.object({ id: z.coerce.number().int().positive() });

const MAX_EXPORT_SHEETS = 100;
const MAX_EXPORT_ITEMS = 20_000;
function exportTooBig(quote: any) {
  const sheets = quote.sheets?.length || 0;
  const items = (quote.sheets || []).reduce((n: number, s: any) => n + (s.items?.length || 0), 0);
  return sheets > MAX_EXPORT_SHEETS || items > MAX_EXPORT_ITEMS;
}

router.get(
  "/:id.xlsx",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const quote = await prisma.quote.findFirst({
      where: { id: id as unknown as number },
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
      return res.status(403).json({ error: "Bạn không có quyền tải báo giá này" });
    }
    if (exportTooBig(quote)) {
      return res.status(413).json({ error: "Báo giá quá lớn để xuất trực tiếp — vui lòng dùng xuất nền (async)" });
    }

    const buf = await runExportJob("xlsx", plain(quote), () => buildQuoteBuffer(quote));
    const safeName = (quote.quoteNumber || `quote-${id}`).replace(/[^A-Za-z0-9_-]/g, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="BaoGia_${safeName}.xlsx"`);
    res.setHeader("Content-Length", buf.length);
    // Per-user, auth-gated download — must NOT be cached by the CDN (Cloudflare caches
    // .xlsx by extension) or the browser, else stale/other-user files get served.
    res.setHeader("Cache-Control", "no-store, private, max-age=0");
    res.end(buf);

    await audit(req, "quote.export", { resource: "quote", resourceId: id });
  })
);

router.get(
  "/:id.pdf",
  validate({ params: idParam }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const quote = await prisma.quote.findFirst({
      where: { id: id as unknown as number },
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
      return res.status(403).json({ error: "Bạn không có quyền tải báo giá này" });
    }
    if (exportTooBig(quote)) {
      return res.status(413).json({ error: "Báo giá quá lớn để xuất trực tiếp — vui lòng dùng xuất nền (async)" });
    }

    const pdfQuote = {
      ...quote,
      subtotal: Number(quote.subtotal),
      vat: Number(quote.vat),
      total: Number(quote.total),
      vatPercent: Number(quote.vatPercent),
    };
    const buf = await runExportJob("pdf", plain(pdfQuote), () => renderQuotePdf(pdfQuote));
    const safeName = (quote.quoteNumber || `quote-${id}`).replace(/[^A-Za-z0-9_-]/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="BaoGia_${safeName}.pdf"`);
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Cache-Control", "no-store, private, max-age=0");   // per-user — never cache at CDN/browser
    res.end(buf);
    await audit(req, "quote.export.pdf", { resource: "quote", resourceId: id });
  })
);

export default router;
