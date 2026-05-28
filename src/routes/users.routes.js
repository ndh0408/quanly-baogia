import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { asyncHandler, requireRole } from "../middleware.js";

const router = Router();

router.use(requireRole("admin"));

router.get("/", asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true, username: true, displayName: true, role: true,
      phone: true, title: true, active: true, createdAt: true,
    },
  });
  res.json(users);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { username, password, displayName, role, phone, title } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: "Thiếu username/password/họ tên" });
  }
  if (!["admin", "manager", "employee"].includes(role)) {
    return res.status(400).json({ error: "Role không hợp lệ" });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "Mật khẩu tối thiểu 4 ký tự" });
  }

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return res.status(400).json({ error: "Username đã tồn tại" });

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      displayName,
      role,
      phone: phone || null,
      title: title || null,
    },
    select: { id: true, username: true, displayName: true, role: true, phone: true, title: true, active: true },
  });
  res.status(201).json(user);
}));

router.put("/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { displayName, role, phone, title, active, password } = req.body;

  const data = {};
  if (displayName !== undefined) data.displayName = displayName;
  if (role !== undefined) {
    if (!["admin", "manager", "employee"].includes(role)) {
      return res.status(400).json({ error: "Role không hợp lệ" });
    }
    data.role = role;
  }
  if (phone !== undefined) data.phone = phone || null;
  if (title !== undefined) data.title = title || null;
  if (active !== undefined) data.active = !!active;
  if (password) {
    if (password.length < 4) return res.status(400).json({ error: "Mật khẩu tối thiểu 4 ký tự" });
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, username: true, displayName: true, role: true, phone: true, title: true, active: true },
  });
  res.json(user);
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.session.userId) {
    return res.status(400).json({ error: "Không thể xóa chính bạn" });
  }
  const count = await prisma.quote.count({ where: { OR: [{ createdById: id }, { approvedById: id }] } });
  if (count > 0) {
    return res.status(400).json({ error: `User đang gắn với ${count} báo giá. Hãy khóa thay vì xóa.` });
  }
  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
}));

export default router;
