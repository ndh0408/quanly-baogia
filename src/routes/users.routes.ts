import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware.js";
import { requirePermission, PERMISSIONS } from "../permissions.js";
import { validate, UserCreateSchema, UserUpdateSchema, UserInviteSchema } from "../validators.js";
import * as svc from "../services/userService.js";

const router = Router();
// Quản lý tài khoản = quyền user:manage (per-user; admin luôn có). Không còn cứng theo role admin.
router.use(requirePermission(PERMISSIONS.USER_MANAGE));

const idParam = z.object({ id: z.coerce.number().int().positive() });

// Route MỎNG: chỉ requireRole + validate + gọi tầng service (logic/quyền/audit ở userService.ts).
router.get("/", asyncHandler(async (req: Request, res: Response) => res.json(await svc.listUsers(req))));
// Invite an employee by email — they self-onboard (set password + fill details).
router.post("/invite", validate({ body: UserInviteSchema }), asyncHandler(async (req: Request, res: Response) => res.status(201).json(await svc.inviteUser(req))));
// Re-send an invite (new token) for a still-pending user.
router.post("/:id/resend-invite", validate({ params: idParam }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.resendInvite(req))));
router.post("/", validate({ body: UserCreateSchema }), asyncHandler(async (req: Request, res: Response) => res.status(201).json(await svc.createUser(req))));
router.put("/:id", validate({ params: idParam, body: UserUpdateSchema }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.updateUser(req))));
router.delete("/:id", validate({ params: idParam }), asyncHandler(async (req: Request, res: Response) => res.json(await svc.deleteUser(req))));

export default router;
