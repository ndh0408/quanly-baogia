import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import { validate } from "../validators.js";
import * as svc from "../services/venueService.js";

// Danh mục kích thước theo RẠP — nguồn cho gợi ý hạng mục khi tạo báo giá + trang quản lý.
const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const itemParam = z.object({ itemId: z.coerce.number().int().positive() });

// "" → null cho ô để trống; text trim sẵn để không lưu khoảng trắng thừa.
const optText = (max: number) => z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v),
  z.string().max(max).nullable().optional(),
);
// Số đo: chấp nhận "" (xoá), số, hoặc chuỗi số. Âm là vô nghĩa với kích thước → chặn.
const optNum = (max: number, label: string) => z.preprocess(
  (v) => (v === "" || v == null ? null : v),
  z.coerce.number({ error: `${label} phải là số` }).min(0, { error: `${label} không được âm` }).max(max, { error: `${label} tối đa ${max}` }).nullable().optional(),
);

// Từ khóa: trim, bỏ rỗng, bỏ trùng — tránh đẻ ra "HCM " và "HCM" thành 2 chip khác nhau.
const tagList = z.preprocess(
  (v) => (Array.isArray(v) ? [...new Set(v.map((t) => String(t).trim()).filter(Boolean))] : v),
  z.array(z.string().max(40, { error: "Mỗi từ khóa tối đa 40 ký tự" })).max(20, { error: "Tối đa 20 từ khóa mỗi rạp" }),
);

const VenueCreate = z.object({
  name: z.string({ error: "Vui lòng nhập tên rạp" }).trim().min(1, { error: "Vui lòng nhập tên rạp" }).max(200, { error: "Tên rạp tối đa 200 ký tự" }),
  // region/cluster/code: cột cũ sinh ra từ file Excel, KHÔNG còn hiện trên giao diện. Giữ lại để
  // dữ liệu cũ không vỡ + unique [name, region] với region="" thành ra "không trùng tên rạp".
  region: z.preprocess((v) => (v == null ? "" : typeof v === "string" ? v.trim() : v), z.string().max(80, { error: "Khu vực tối đa 80 ký tự" }).default("")),
  cluster: optText(80),
  code: optText(40),
  tags: tagList.default([]),
  note: optText(1000),
  active: z.boolean().default(true),
});
const VenueUpdate = VenueCreate.partial();

const ItemCreate = z.object({
  // "Nhóm" là TÙY CHỌN: nó vốn là di sản của mấy tab trong file Excel cũ, không phải thứ người
  // dùng cần khai khi thêm hạng mục. Để trống cũng lưu được.
  cat: z.preprocess((v) => (v == null ? "" : typeof v === "string" ? v.trim() : v), z.string().max(120, { error: "Tên nhóm tối đa 120 ký tự" }).default("")),
  name: z.string({ error: "Vui lòng nhập tên hạng mục" }).trim().min(1, { error: "Vui lòng nhập tên hạng mục" }).max(300, { error: "Tên hạng mục tối đa 300 ký tự" }),
  dim: optText(300),
  w: optNum(1000, "Chiều rộng"),
  h: optNum(1000, "Chiều cao"),
  unit: optText(40),
  qty: optNum(1_000_000, "Số lượng"),
  note: optText(1000),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional(),
  active: z.boolean().default(true),
});
const ItemUpdate = ItemCreate.partial();

const ListQuery = z.object({
  q: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(200).optional()),
  region: z.preprocess((v) => (v === "" ? undefined : v), z.string().max(80).optional()),
  full: z.enum(["0", "1"]).optional(),   // 1 = kèm hạng mục (trang quản lý tải 1 lần)
});
const MergeBody = z.object({ intoId: z.coerce.number({ error: "Chọn rạp đích để gộp" }).int().positive() });
const BulkTagBody = z.object({
  venueIds: z.array(z.coerce.number().int().positive()).min(1, { error: "Chọn ít nhất 1 rạp" }).max(1000),
  add: tagList.default([]),
  remove: tagList.default([]),
});

// Route MỎNG: validate + gọi service (quyền/audit/logic nằm ở venueService.ts).
router.get("/catalog", asyncHandler(async (req: Request, res: Response) => res.json(await svc.getCatalog(req))));
router.get("/tags", asyncHandler(async (req: Request, res: Response) => res.json(await svc.listTags(req))));
router.post("/tags/bulk", validate({ body: BulkTagBody }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.bulkTags(req))));
router.get("/", validate({ query: ListQuery }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.listVenues(req))));
router.post("/", validate({ body: VenueCreate }), asyncHandler(async (req: Request, res: Response) => res.status(201).json(await svc.createVenue(req))));
router.get("/:id", validate({ params: idParam }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.getVenue(req))));
router.put("/:id", validate({ params: idParam, body: VenueUpdate }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.updateVenue(req))));
router.delete("/:id", validate({ params: idParam }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.deleteVenue(req))));
router.post("/:id/merge", validate({ params: idParam, body: MergeBody }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.mergeVenue(req))));
router.post("/:id/items", validate({ params: idParam, body: ItemCreate }), asyncHandler(async (req: Request, res: Response) => res.status(201).json(await svc.createItem(req))));
router.put("/items/:itemId", validate({ params: itemParam, body: ItemUpdate }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.updateItem(req))));
router.delete("/items/:itemId", validate({ params: itemParam }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.deleteItem(req))));

export default router;
