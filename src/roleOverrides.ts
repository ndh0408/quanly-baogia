// Nạp/lưu quyền GHI ĐÈ theo vai trò (phân quyền ĐỘNG) giữa DB ↔ cache trong permissions.ts.
// Tách riêng để permissions.ts thuần (không phụ thuộc prisma → tránh chu trình import).
import { prisma } from "./db.js";
import { loadRoleOverrides, setRoleOverrideCache } from "./permissions.js";
import { logger } from "./logger.js";

/**
 * Nạp TOÀN BỘ override từ DB vào cache.
 *
 * LỖI THÌ NÉM, KHÔNG NUỐT (RBAC-09, audit 2026-09-23). Bản trước bắt lỗi rồi chỉ ghi một dòng warn —
 * cache rỗng, tức mọi vai trò rơi về quyền MẶC ĐỊNH CỨNG. Nếu admin đã dùng override để THU HẸP một
 * vai trò (vd bỏ customer:read:all khỏi manager), một lần khởi động gặp CSDL chậm là âm thầm MỞ LẠI
 * quyền đó cho tới lần restart sau. Chốt phân quyền phải fail-closed: người gọi quyết định làm gì.
 * Lỗi giữa chừng KHÔNG đụng cache (loadRoleOverrides chỉ chạy khi đọc thành công), nên lượt nạp lại
 * định kỳ thất bại vẫn giữ bản tốt gần nhất.
 */
export async function reloadRoleOverrides() {
  const rows = await prisma.rolePermission.findMany({ select: { role: true, permissions: true } });
  loadRoleOverrides(rows);
  logger.info({ roles: rows.map((r) => r.role) }, "role permission overrides loaded");
}

/**
 * Nạp lúc KHỞI ĐỘNG, có thử lại (CSDL có thể lên chậm hơn app vài giây). Hết lượt thử thì NÉM —
 * server.ts thoát tiến trình thay vì phục vụ với quyền mặc định (Docker/Coolify tự khởi động lại).
 */
export async function napRoleOverridesKhiKhoiDong({ soLan = 10, choMs = 3000 }: { soLan?: number; choMs?: number } = {}) {
  let loiCuoi: unknown;
  for (let i = 1; i <= soLan; i++) {
    try {
      await reloadRoleOverrides();
      return;
    } catch (e) {
      loiCuoi = e;
      logger.warn({ err: e instanceof Error ? e.message : String(e), lan: i, soLan }, "chưa nạp được quyền ghi đè vai trò — thử lại");
      if (i < soLan) await new Promise((r) => setTimeout(r, choMs));
    }
  }
  throw loiCuoi;
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
