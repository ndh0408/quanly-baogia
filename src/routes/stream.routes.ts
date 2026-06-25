import { Router } from "express";
import { requireAuth } from "../middleware.js";
import { attach } from "../sse.js";

const router = Router();

router.get("/events", requireAuth, (req, res) => {
  // Sau requireAuth nên userId chắc chắn có; guard khớp đúng 401 của requireAuth.
  const userId = req.session.userId;
  if (userId === undefined) return res.status(401).json({ error: "Chưa đăng nhập" });
  attach(req, res, userId);
});

export default router;
