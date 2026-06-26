import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, requireAuth } from "../middleware.js";
import { requirePermission, PERMISSIONS } from "../permissions.js";
import { validate } from "../validators.js";
import * as svc from "../services/settingService.js";

const adminCfg = requirePermission(PERMISSIONS.SETTINGS_MANAGE); // quyền cài đặt (per-user; admin luôn có)

const router = Router();
router.use(requireAuth);

const keyParam = z.object({ key: z.string().min(1).max(80) });

// Bound the stored value: any JSON shape, but reject blobs > 64KB (defence beyond the
// 2MB body cap) so an admin can't stuff unbounded JSON into a settings row.
const settingValue = z.unknown().refine(
  (v) => { try { return JSON.stringify(v ?? null).length <= 65_536; } catch { return false; } },
  { message: "Giá trị cấu hình quá lớn hoặc không hợp lệ (tối đa 64KB)" }
);

// Route MỎNG: requireRole/validate ở route (hợp đồng API + quyền HTTP) → gọi service → res.
// Full dump = admin only.
router.get("/", adminCfg, asyncHandler(async (req: Request, res: Response) => res.json(await svc.getAllSettings(req))));
router.get("/:key", validate({ params: keyParam }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.getSetting(req))));
// Write: cần quyền cài đặt
router.put("/:key", adminCfg, validate({ params: keyParam, body: settingValue }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.upsertSetting(req))));
router.delete("/:key", adminCfg, validate({ params: keyParam }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.deleteSetting(req))));

export default router;
