import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth, requireRole } from "../middleware.js";

const router = Router();
router.use(requireAuth);

function canEdit(quote, session) {
  if (session.role === "admin" || session.role === "manager") return true;
  return quote.createdById === session.userId && (quote.status === "draft" || quote.status === "rejected");
}

function computeQuoteTotals(quote) {
  const vatPct = Number(quote.vatPercent) || 0;
  const sheetTotals = (quote.sheets || []).map(sh => {
    const subtotal = (sh.items || []).reduce((s, it) => {
      const qty = Number(it.quantity) || 0;
      const days = Number(it.days) || 1;
      const price = Number(it.unitPrice) || 0;
      // detect days-based multiplication if days is set
      return s + (it.days != null ? price * qty * days : price * qty);
    }, 0);
    return { sheetId: sh.id, subtotal };
  });
  const subtotal = sheetTotals.reduce((s, x) => s + x.subtotal, 0);
  const vat = subtotal * vatPct / 100;
  return { subtotal, vat, total: subtotal + vat, sheetTotals };
}

const QUOTE_INCLUDE = {
  company: true,
  sheets: {
    orderBy: { order: "asc" },
    include: {
      template: true,
      items: { orderBy: { order: "asc" } },
    },
  },
  createdBy: { select: { id: true, username: true, displayName: true } },
  approvedBy: { select: { id: true, username: true, displayName: true } },
};

router.get("/", asyncHandler(async (req, res) => {
  const where = {};
  if (req.session.role === "employee") where.createdById = req.session.userId;
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.companyId) where.companyId = parseInt(req.query.companyId, 10);
  if (req.query.q) {
    where.OR = [
      { quoteNumber: { contains: String(req.query.q), mode: "insensitive" } },
      { title: { contains: String(req.query.q), mode: "insensitive" } },
      { toCompany: { contains: String(req.query.q), mode: "insensitive" } },
    ];
  }
  const quotes = await prisma.quote.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: QUOTE_INCLUDE,
  });
  res.json(quotes.map(q => ({ ...q, ...computeQuoteTotals(q) })));
}));

router.get("/next-number", asyncHandler(async (req, res) => {
  const last = await prisma.quote.findFirst({
    where: { quoteNumber: { startsWith: "GN" } },
    orderBy: { id: "desc" },
  });
  let n = 1;
  if (last) {
    const m = last.quoteNumber.match(/GN(\d+)/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  res.json({ quoteNumber: `GN${String(n).padStart(2, "0")}` });
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: QUOTE_INCLUDE,
  });
  if (!quote) return res.status(404).json({ error: "Không tìm thấy báo giá" });
  if (req.session.role === "employee" && quote.createdById !== req.session.userId) {
    return res.status(403).json({ error: "Bạn không có quyền xem báo giá này" });
  }
  res.json({ ...quote, ...computeQuoteTotals(quote) });
}));

function stripNewlines(s) {
  if (s == null) return s;
  return String(s).replace(/[\r\n]+/g, " ").trim();
}

// For multi-line fields: keep \n but normalize \r\n → \n and trim
function multiline(s) {
  if (s == null) return s;
  return String(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function buildSheetsCreate(sheets) {
  return (sheets || []).map((s, sIdx) => ({
    templateId: Number(s.templateId),
    name: stripNewlines(s.name) || null,
    order: s.order != null ? Number(s.order) : sIdx + 1,
    items: {
      create: (s.items || []).map((it, iIdx) => ({
        order: it.order != null ? Number(it.order) : iIdx + 1,
        name: multiline(it.name) || "",             // ALLOW newlines in Hạng Mục
        detail: multiline(it.detail) || null,        // ALLOW newlines in Chi Tiết
        unit: stripNewlines(it.unit) || null,
        quantity: Number(it.quantity) || 0,
        unitPrice: Number(it.unitPrice) || 0,
        days: it.days != null && it.days !== "" ? Number(it.days) : null,
        notes: multiline(it.notes) || null,          // ALLOW newlines in Notes
      })),
    },
  }));
}

router.post("/", asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.quoteNumber || !b.title || !b.toCompany || !b.companyId) {
    return res.status(400).json({ error: "Thiếu số BG / tiêu đề / khách hàng / công ty" });
  }
  if (!Array.isArray(b.sheets) || b.sheets.length === 0) {
    return res.status(400).json({ error: "Báo giá phải có ít nhất 1 sheet" });
  }
  const exists = await prisma.quote.findUnique({ where: { quoteNumber: b.quoteNumber } });
  if (exists) return res.status(400).json({ error: "Số báo giá đã tồn tại" });

  // Look up company to inherit default From info if not provided
  const company = await prisma.company.findUnique({ where: { id: Number(b.companyId) } });
  if (!company) return res.status(400).json({ error: "Không tìm thấy công ty" });

  const quote = await prisma.quote.create({
    data: {
      quoteNumber: b.quoteNumber,
      title: b.title,
      toCompany: b.toCompany,
      toContact: b.toContact || null,
      companyId: company.id,
      fromContact: b.fromContact || "",
      fromPhone: b.fromPhone || company.phone || null,
      fromTitle: b.fromTitle || null,
      fromAddress: b.fromAddress || company.address,
      city: b.city || company.city || "TP. Hồ Chí Minh",
      quoteDate: b.quoteDate ? new Date(b.quoteDate) : new Date(),
      greeting: b.greeting || undefined,
      vatPercent: b.vatPercent == null ? 8 : Number(b.vatPercent),
      notes: b.notes || null,
      status: "draft",
      createdById: req.session.userId,
      sheets: { create: buildSheetsCreate(b.sheets) },
    },
    include: QUOTE_INCLUDE,
  });
  res.status(201).json({ ...quote, ...computeQuoteTotals(quote) });
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.quote.findUnique({ where: { id }, include: { sheets: true } });
  if (!existing) return res.status(404).json({ error: "Không tìm thấy báo giá" });
  if (!canEdit(existing, req.session)) {
    return res.status(403).json({ error: "Bạn không thể sửa báo giá này" });
  }

  const b = req.body;
  const data = {};
  const fields = ["title", "toCompany", "toContact", "fromContact",
    "fromPhone", "fromTitle", "fromAddress", "city", "greeting", "notes"];
  for (const f of fields) if (b[f] !== undefined) data[f] = b[f] || null;
  if (b.quoteDate) data.quoteDate = new Date(b.quoteDate);
  if (b.vatPercent !== undefined) data.vatPercent = Number(b.vatPercent);
  if (b.companyId !== undefined) data.companyId = Number(b.companyId);
  if (b.quoteNumber !== undefined && b.quoteNumber !== existing.quoteNumber) {
    const dup = await prisma.quote.findUnique({ where: { quoteNumber: b.quoteNumber } });
    if (dup) return res.status(400).json({ error: "Số báo giá đã tồn tại" });
    data.quoteNumber = b.quoteNumber;
  }

  // Sheets full replace if provided
  if (Array.isArray(b.sheets)) {
    // Delete all existing sheets (cascade deletes items)
    await prisma.quoteSheet.deleteMany({ where: { quoteId: id } });
    data.sheets = { create: buildSheetsCreate(b.sheets) };
  }

  const quote = await prisma.quote.update({
    where: { id },
    data,
    include: QUOTE_INCLUDE,
  });
  res.json({ ...quote, ...computeQuoteTotals(quote) });
}));

router.post("/:id/submit", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.quote.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
  if (req.session.role === "employee" && existing.createdById !== req.session.userId) {
    return res.status(403).json({ error: "Không có quyền" });
  }
  if (!["draft", "rejected"].includes(existing.status)) {
    return res.status(400).json({ error: "Chỉ trình duyệt được báo giá ở trạng thái Nháp hoặc Bị từ chối" });
  }
  const quote = await prisma.quote.update({
    where: { id },
    data: { status: "pending", approvedById: null },
    include: QUOTE_INCLUDE,
  });
  res.json({ ...quote, ...computeQuoteTotals(quote) });
}));

router.post("/:id/approve", requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.quote.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
  if (existing.status !== "pending") return res.status(400).json({ error: "Báo giá chưa được trình duyệt" });
  const quote = await prisma.quote.update({
    where: { id },
    data: { status: "approved", approvedById: req.session.userId },
    include: QUOTE_INCLUDE,
  });
  res.json({ ...quote, ...computeQuoteTotals(quote) });
}));

router.post("/:id/reject", requireRole("admin", "manager"), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.quote.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
  if (existing.status !== "pending") return res.status(400).json({ error: "Báo giá chưa được trình duyệt" });
  const quote = await prisma.quote.update({
    where: { id },
    data: { status: "rejected", approvedById: req.session.userId },
    include: QUOTE_INCLUDE,
  });
  res.json({ ...quote, ...computeQuoteTotals(quote) });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = await prisma.quote.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Không tìm thấy" });
  const isOwnerDraft = existing.createdById === req.session.userId &&
                       (existing.status === "draft" || existing.status === "rejected");
  if (!isOwnerDraft && req.session.role !== "admin") {
    return res.status(403).json({ error: "Chỉ admin hoặc người tạo (nháp/từ chối) mới được xóa" });
  }
  await prisma.quote.delete({ where: { id } });
  res.json({ ok: true });
}));

router.post("/:id/duplicate", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const src = await prisma.quote.findUnique({ where: { id }, include: QUOTE_INCLUDE });
  if (!src) return res.status(404).json({ error: "Không tìm thấy" });

  const last = await prisma.quote.findFirst({
    where: { quoteNumber: { startsWith: "GN" } },
    orderBy: { id: "desc" },
  });
  let n = 1;
  if (last) {
    const m = last.quoteNumber.match(/GN(\d+)/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  const newNumber = `GN${String(n).padStart(2, "0")}`;

  const created = await prisma.quote.create({
    data: {
      quoteNumber: newNumber,
      title: src.title + " (copy)",
      toCompany: src.toCompany,
      toContact: src.toContact,
      companyId: src.companyId,
      fromContact: src.fromContact,
      fromPhone: src.fromPhone,
      fromTitle: src.fromTitle,
      fromAddress: src.fromAddress,
      city: src.city,
      quoteDate: new Date(),
      greeting: src.greeting,
      vatPercent: src.vatPercent,
      notes: src.notes,
      status: "draft",
      createdById: req.session.userId,
      sheets: {
        create: src.sheets.map((s, sIdx) => ({
          templateId: s.templateId,
          name: s.name,
          order: s.order != null ? s.order : sIdx + 1,
          items: {
            create: s.items.map((it, iIdx) => ({
              order: it.order != null ? it.order : iIdx + 1,
              name: it.name, detail: it.detail, unit: it.unit,
              quantity: it.quantity, unitPrice: it.unitPrice,
              days: it.days, notes: it.notes,
            })),
          },
        })),
      },
    },
    include: QUOTE_INCLUDE,
  });
  res.status(201).json({ ...created, ...computeQuoteTotals(created) });
}));

export default router;
