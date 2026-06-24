import { Router } from "express";
import { requireAuth } from "../middleware.js";
import { attach } from "../sse.js";

const router = Router();

router.get("/events", requireAuth, (req, res) => {
  attach(req, res, req.session.userId);
});

export default router;
