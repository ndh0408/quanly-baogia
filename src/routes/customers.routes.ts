import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import * as svc from "../services/customerService.js";

const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });

const CustomerCreate = z.object({
  code: z.string().max(40, "Mã khách hàng tối đa 40 ký tự").optional(),
  name: z.string().min(1, "Vui lòng nhập tên khách hàng").max(200, "Tên khách hàng tối đa 200 ký tự"),
  taxCode: z.string().max(40).optional().nullable(),
  email: z.string().email("Email không hợp lệ").max(120, "Email tối đa 120 ký tự").optional().nullable().or(z.literal("").transform(() => null)),
  phone: z.string().max(40).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  contactName: z.string().max(120).optional().nullable(),
  contactTitle: z.string().max(120).optional().nullable(),
  status: z.enum(["lead", "prospect", "active", "inactive"]).default("lead"),
  tags: z.array(z.string().max(40)).max(20).default([]),
  ownerId: z.coerce.number().int().positive().optional().nullable(),
});

const CustomerUpdate = CustomerCreate.partial();

const ListQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["lead", "prospect", "active", "inactive"]).optional()),
  tag: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(40).optional()),
  ownerId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(config.MAX_PAGE_SIZE).default(20),
  sort: z.enum(["createdAt", "name", "updatedAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const NoteCreate = z.object({ body: z.string().min(1, "Vui lòng nhập nội dung ghi chú").max(4000, "Ghi chú tối đa 4000 ký tự") });
const FollowUpCreate = z.object({
  dueAt: z.coerce.date({ error: "Vui lòng chọn ngày nhắc" }),
  note: z.string().min(1, "Vui lòng nhập nội dung nhắc").max(1000, "Nội dung tối đa 1000 ký tự"),
  assigneeId: z.coerce.number().int().positive().optional().nullable(),
});

// Route MỎNG: chỉ validate + gọi tầng service (logic/quyền/audit ở customerService.ts).
router.get("/", validate({ query: ListQuery }), asyncHandler(async (req, res) => res.json(await svc.listCustomers(req))));
router.post("/", validate({ body: CustomerCreate }), asyncHandler(async (req, res) => res.status(201).json(await svc.createCustomer(req))));
router.get("/:id", validate({ params: idParam }), asyncHandler(async (req, res) => res.json(await svc.getCustomer(req))));
router.put("/:id", validate({ params: idParam, body: CustomerUpdate }), asyncHandler(async (req, res) => res.json(await svc.updateCustomer(req))));
router.delete("/:id", validate({ params: idParam }), asyncHandler(async (req, res) => res.json(await svc.deleteCustomer(req))));
router.post("/:id/notes", validate({ params: idParam, body: NoteCreate }), asyncHandler(async (req, res) => res.status(201).json(await svc.addNote(req))));
router.post("/:id/follow-ups", validate({ params: idParam, body: FollowUpCreate }), asyncHandler(async (req, res) => res.status(201).json(await svc.addFollowUp(req))));
router.post("/follow-ups/:fid/done", validate({ params: z.object({ fid: z.coerce.number().int().positive() }) }), asyncHandler(async (req, res) => res.json(await svc.markFollowUpDone(req))));

export default router;
