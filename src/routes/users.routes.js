import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { asyncHandler, requireRole } from "../middleware.js";
import { validate, UserCreateSchema, UserUpdateSchema } from "../validators.js";
import { audit, diff } from "../audit.js";

const router = Router();
router.use(requireRole("admin"));

const idParam = z.object({ id: z.coerce.number().int().positive() });
const USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  phone: true,
  title: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
};

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({ orderBy: { id: "asc" }, select: USER_SELECT });
    res.json(users);
  })
);

router.post(
  "/",
  validate({ body: UserCreateSchema }),
  asyncHandler(async (req, res) => {
    const { username, password, displayName, role, phone, title } = req.body;
    const exists = await prisma.user.findUnique({ where: { username } });
    if (exists) return res.status(409).json({ error: "Username đã tồn tại" });

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(password, config.BCRYPT_COST),
        displayName,
        role,
        phone: phone || null,
        title: title || null,
      },
      select: USER_SELECT,
    });
    await audit(req, "user.create", { resource: "user", resourceId: user.id, after: user });
    res.status(201).json(user);
  })
);

router.put(
  "/:id",
  validate({ params: idParam, body: UserUpdateSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const before = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!before) return res.status(404).json({ error: "Không tìm thấy user" });

    const { password, ...rest } = req.body;
    const data = { ...rest };
    if (password) data.passwordHash = await bcrypt.hash(password, config.BCRYPT_COST);

    const user = await prisma.user.update({ where: { id }, data, select: USER_SELECT });
    await audit(req, "user.update", {
      resource: "user",
      resourceId: id,
      before,
      after: user,
      // log diff explicitly for searchability
    });
    if (password) {
      await audit(req, "password.reset.by_admin", { resource: "user", resourceId: id });
    }
    res.json(user);
  })
);

router.delete(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (id === req.session.userId) {
      return res.status(400).json({ error: "Không thể xóa chính bạn" });
    }
    const count = await prisma.quote.count({
      where: { OR: [{ createdById: id }, { approvedById: id }] },
    });
    if (count > 0) {
      // Soft-delete still allowed via active=false, but block to preserve audit trail.
      return res.status(409).json({
        error: `User đang gắn với ${count} báo giá. Hãy khóa (active=false) thay vì xóa.`,
      });
    }
    const before = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    await prisma.user.delete({ where: { id } }); // soft-delete via middleware
    await audit(req, "user.delete", { resource: "user", resourceId: id, before });
    res.json({ ok: true });
  })
);

export default router;
