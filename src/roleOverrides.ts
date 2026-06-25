// Nạp/lưu quyền GHI ĐÈ theo vai trò (phân quyền ĐỘNG) giữa DB ↔ cache trong permissions.ts.
// Tách riêng để permissions.ts thuần (không phụ thuộc prisma → tránh chu trình import).
import { prisma } from "./db.js";
import { loadRoleOverrides, setRoleOverrideCache } from "./permissions.js";
import { logger } from "./logger.js";

/** Nạp TOÀN BỘ override từ DB vào cache. Gọi lúc khởi động. An toàn nếu bảng chưa tồn tại → dùng mặc định. */
export async function reloadRoleOverrides() {
  try {
    const rows = await prisma.rolePermission.findMany({ select: { role: true, permissions: true } });
    loadRoleOverrides(rows);
    logger.info({ roles: rows.map((r) => r.role) }, "role permission overrides loaded");
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "không nạp được role overrides — dùng quyền mặc định");
  }
}

/** Lưu override cho 1 role (upsert) + cập nhật cache ngay. */
export async function saveRoleOverride(role: string, permissions: string[], byId?: number) {
  await prisma.rolePermission.upsert({
    where: { role },
    create: { role, permissions, updatedById: byId ?? null },
    update: { permissions, updatedById: byId ?? null },
  });
  setRoleOverrideCache(role, permissions);
}

/** Đặt lại 1 role về MẶC ĐỊNH (xóa override) + cập nhật cache. */
export async function resetRoleOverride(role: string) {
  await prisma.rolePermission.deleteMany({ where: { role } });
  setRoleOverrideCache(role, null);
}
