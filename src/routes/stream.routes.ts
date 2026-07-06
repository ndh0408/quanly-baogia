import { Router } from "express";
import { requireAuth } from "../middleware.js";
import { attach, setPresence } from "../sse.js";
import { prisma } from "../db.js";
import { canOnQuote } from "../permissions.js";

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
  // PHÂN QUYỀN: chỉ cho ghi/đọc presence của báo giá mà người dùng ĐƯỢC PHÉP đọc (chủ/thành viên/quyền
  // read:all). Không có check này thì bất kỳ ai đăng nhập cũng dò được quoteId bất kỳ để biết "ai đang
  // sửa" + displayName của họ (rò metadata) — mọi route đọc nội dung quote khác đều đã dùng canOnQuote.
  const quote = await prisma.quote.findFirst({ where: { id: quoteId }, select: { id: true, createdById: true, members: { select: { id: true } } } });
  if (!quote || !canOnQuote(req.session, "read", quote)) {
    return res.status(403).json({ error: "Không có quyền với báo giá này" });
  }
  let name = "Người dùng";
  if (action !== "close") {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    name = u?.displayName || name;
  }
  res.json({ editing: setPresence(quoteId, userId, name, action) });
});

export default router;
