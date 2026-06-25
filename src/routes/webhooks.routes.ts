import { Router } from "express";
import { z } from "zod";
import { asyncHandler, requireRole } from "../middleware.js";
import { validate } from "../validators.js";
import { EVENTS } from "../webhooks.js";
import * as svc from "../services/webhookService.js";

const router = Router();
router.use(requireRole("admin"));

const idParam = z.object({ id: z.coerce.number().int().positive() });

// The HMAC signing secret must not be echoed back on reads. Show only a masked
// hint (last 4 chars); the full secret is returned exactly once on create.
function maskSecret(s) {
  if (!s) return null;
  return s.length <= 4 ? "••••" : "••••" + s.slice(-4);
}
const present = (w) => ({ ...w, secret: maskSecret(w.secret), secretSet: !!w.secret });

const Create = z.object({
  url: z.string().url("Địa chỉ URL không hợp lệ"),
  events: z.array(z.enum(EVENTS)).min(1, "Vui lòng chọn ít nhất 1 sự kiện"),
  secret: z.string().min(16, "Khóa bí mật phải có ít nhất 16 ký tự").optional(),
  active: z.boolean().default(true),
});

router.get("/events", (_req, res) => res.json({ events: EVENTS }));

// Route MỎNG: validate + gọi service; GIỮ lại ở đây phần che/đính secret (tạo hình response).
router.get("/", asyncHandler(async (req, res) => {
  const rows = await svc.listWebhooks(req);
  res.json(rows.map(present));
}));

router.post(
  "/",
  validate({ body: Create }),
  asyncHandler(async (req, res) => {
    const { row, plaintextSecret } = await svc.createWebhook(req);
    // Return the plaintext secret exactly once here.
    res.status(201).json({ ...present(row), secret: plaintextSecret, secretSet: true });
  })
);

router.put(
  "/:id",
  validate({ params: idParam, body: Create.partial() }),
  asyncHandler(async (req, res) => {
    const row = await svc.updateWebhook(req);
    res.json(present(row));
  })
);

router.delete(
  "/:id",
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await svc.deleteWebhook(req)))
);

router.get(
  "/:id/deliveries",
  validate({ params: idParam, query: z.object({ size: z.coerce.number().int().min(1).max(200).default(50) }) }),
  asyncHandler(async (req, res) => res.json(await svc.listDeliveries(req)))
);

export default router;
