// Tầng SERVICE cho domain Cấu hình hệ thống (settings). Bê NGUYÊN logic từ settings.routes.ts
// (giữ hành vi y hệt): allowlist key công khai cho non-admin (còn lại 403), đọc/ghi/xoá + audit.
// Route giữ requireRole("admin") cho dump/ghi/xoá + giữ validator; service chỉ trả dữ liệu / throw httpError.
import type { Request } from "express";
import { prisma } from "../db.js";
import { audit } from "../audit.js";
import { httpError } from "../httpError.js";
import { can, PERMISSIONS as P } from "../permissions.js";

// Settings can hold sensitive integration config (tokens, channels). Only a small
// allowlist of UI-tunable keys is readable by non-admins; the full dump + any other
// key is admin-only — prevents leaking config to every logged-in user.
const PUBLIC_SETTING_KEYS = new Set(["notif.channels"]);

export async function getAllSettings(_req: Request) {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSetting(req: Request) {
  if (!PUBLIC_SETTING_KEYS.has(req.params.key) && !can(req.session, P.SETTINGS_MANAGE)) {
    throw httpError(403, "Không có quyền đọc cấu hình này");
  }
  const row = await prisma.setting.findUnique({ where: { key: req.params.key } });
  if (!row) throw httpError(404, "Không tìm thấy cấu hình");
  return row.value;
}

export async function upsertSetting(req: Request) {
  const value = req.body;
  const row = await prisma.setting.upsert({
    where: { key: req.params.key },
    create: { key: req.params.key, value },
    update: { value },
  });
  await audit(req, "settings.update", { resource: "setting", resourceId: req.params.key, after: { value } });
  return row.value;
}

export async function deleteSetting(req: Request) {
  await prisma.setting.delete({ where: { key: req.params.key } }).catch(() => {});
  await audit(req, "settings.delete", { resource: "setting", resourceId: req.params.key });
  return { ok: true };
}
