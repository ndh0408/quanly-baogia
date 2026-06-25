import { Router } from "express";
import { requireAuth } from "../middleware.js";
import { attach, setPresence } from "../sse.js";
import { prisma } from "../db.js";

const router = Router();

router.get("/events", requireAuth, (req, res) => {
  // Sau requireAuth nên userId chắc chắn có; guard khớp đúng 401 của requireAuth.
  const userId = req.session.userId;
  if (userId === undefined) return res.status(401).json({ error: "Chưa đăng nhập" });
  attach(req, res, userId);
});

// PRESENCE: editor báo "tôi đang MỞ / heartbeat / ĐÓNG báo giá Z" (tạm thời, không lưu DB).
// Trả về danh sách người đang sửa báo giá đó (gồm cả mình) → FE lọc bỏ mình rồi hiện "X đang sửa".
router.post("/presence", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  if (userId === undefined) return res.status(401).json({ error: "Chưa đăng nhập" });
  const quoteId = Number(req.body?.quoteId);
  const action = req.body?.action;
  if (!Number.isInteger(quoteId) || quoteId <= 0 || !["open", "heartbeat", "close"].includes(action)) {
    return res.status(400).json({ error: "Tham số presence không hợp lệ" });
  }
  let name = "Người dùng";
  if (action !== "close") {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    name = u?.displayName || name;
  }
  res.json({ editing: setPresence(quoteId, userId, name, action) });
});

export default router;
