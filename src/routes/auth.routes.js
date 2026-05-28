import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { asyncHandler, requireAuth } from "../middleware.js";

const router = Router();

router.post("/login", asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Thiếu tên đăng nhập hoặc mật khẩu" });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active) {
    return res.status(401).json({ error: "Tài khoản không tồn tại hoặc đã bị khóa" });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Sai mật khẩu" });
  }

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.displayName = user.displayName;
  req.session.username = user.username;

  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    phone: user.phone,
    title: user.title,
  });
}));

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.session.userId },
    select: { id: true, username: true, displayName: true, role: true, phone: true, title: true },
  });
  res.json(user);
}));

router.post("/change-password", requireAuth, asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "Mật khẩu mới tối thiểu 4 ký tự" });
  }
  const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
  const ok = await bcrypt.compare(oldPassword || "", user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Mật khẩu cũ không đúng" });

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });
  res.json({ ok: true });
}));

export default router;
