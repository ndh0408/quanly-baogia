// Tầng SERVICE cho domain Webhooks (admin). Bê NGUYÊN logic từ webhooks.routes.ts ra đây:
// prisma CRUD + audit + chặn URL nội bộ (assertPublicHttpUrl) + mã hoá secret khi lưu (encryptValue).
// GIỮ Ở ROUTE phần TẠO RA HTTP RESPONSE: maskSecret/present (che secret) và trả plaintext secret
// ĐÚNG MỘT LẦN lúc tạo — đó là tạo hình response, không phải logic thuần. Mẫu theo quoteService.ts.
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { assertPublicHttpUrl } from "../webhooks.js";
import { encryptValue } from "../secretbox.js";

export async function listWebhooks(_req) {
  return prisma.webhook.findMany({ orderBy: { id: "asc" } });
}

// Trả về { row, plaintextSecret } để route tạo response (đính plaintext secret đúng một lần).
export async function createWebhook(req) {
  await assertPublicHttpUrl(req.body.url); // reject internal/private targets up front
  const plaintextSecret = req.body.secret || randomBytes(24).toString("hex");
  // Store the secret ENCRYPTED at rest; return the plaintext exactly once here.
  const row = await prisma.webhook.create({ data: { ...req.body, secret: encryptValue(plaintextSecret) } });
  await audit(req, "webhook.create", { resource: "webhook", resourceId: row.id });
  return { row, plaintextSecret };
}

export async function updateWebhook(req) {
  if (req.body.url) await assertPublicHttpUrl(req.body.url);
  // Encrypt a rotated secret before storing.
  const data = { ...req.body };
  if (data.secret) data.secret = encryptValue(data.secret);
  const row = await prisma.webhook.update({ where: { id: req.params.id }, data });
  await audit(req, "webhook.update", { resource: "webhook", resourceId: row.id });
  return row;
}

export async function deleteWebhook(req) {
  await prisma.webhook.delete({ where: { id: req.params.id } });
  await audit(req, "webhook.delete", { resource: "webhook", resourceId: req.params.id });
  return { ok: true };
}

export async function listDeliveries(req) {
  const rows = await prisma.webhookDelivery.findMany({
    where: { webhookId: req.params.id },
    orderBy: { createdAt: "desc" },
    take: req.query.size,
  });
  return { data: rows.map((r) => ({ ...r, id: r.id.toString() })) };
}
