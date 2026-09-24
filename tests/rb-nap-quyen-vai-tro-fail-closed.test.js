/**
 * RBAC-09 — NẠP QUYỀN GHI ĐÈ VAI TRÒ PHẢI FAIL-CLOSED.
 *
 * Bản trước: server.ts `void reloadRoleOverrides()` (không chờ) và hàm đó nuốt lỗi → cache rỗng →
 * mọi vai trò dùng quyền MẶC ĐỊNH CỨNG. Admin đã THU HẸP một vai trò bằng override thì một lần khởi
 * động gặp CSDL chậm là âm thầm MỞ LẠI quyền đó, chỉ để lại một dòng warn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const findMany = vi.fn();
vi.mock("../src/db.js", () => ({ prisma: { rolePermission: { findMany } } }));

const { reloadRoleOverrides, napRoleOverridesKhiKhoiDong } = await import("../src/roleOverrides.js");
const { roleCan, loadRoleOverrides } = await import("../src/permissions.js");

describe("RBAC-09 — nạp quyền vai trò không nuốt lỗi", () => {
  beforeEach(() => { findMany.mockReset(); loadRoleOverrides([]); });

  it("CSDL ném lỗi → reloadRoleOverrides REJECT (không nuốt)", async () => {
    findMany.mockRejectedValueOnce(new Error("CSDL chậm"));
    await expect(reloadRoleOverrides()).rejects.toThrow("CSDL chậm");
  });

  it("lỗi ở lượt nạp lại GIỮ bản override tốt gần nhất, không rơi về mặc định", async () => {
    findMany.mockResolvedValueOnce([{ role: "manager", permissions: ["quote:read:own"] }]);
    await reloadRoleOverrides();
    expect(roleCan("manager", "customer:read:all"), "tiền đề: override đã thu hẹp manager").toBe(false);
    findMany.mockRejectedValueOnce(new Error("mất kết nối"));
    await expect(reloadRoleOverrides()).rejects.toThrow();
    expect(roleCan("manager", "customer:read:all"), "lỗi nạp lại đã mở lại quyền bị thu hẹp").toBe(false);
  });

  it("khởi động: thử lại tới khi được; hết lượt thì ném", async () => {
    findMany.mockRejectedValueOnce(new Error("1")).mockRejectedValueOnce(new Error("2")).mockResolvedValueOnce([]);
    await expect(napRoleOverridesKhiKhoiDong({ soLan: 3, choMs: 1 })).resolves.toBeUndefined();
    expect(findMany).toHaveBeenCalledTimes(3);

    findMany.mockReset();
    findMany.mockRejectedValue(new Error("chết hẳn"));
    await expect(napRoleOverridesKhiKhoiDong({ soLan: 2, choMs: 1 })).rejects.toThrow("chết hẳn");
  });
});
