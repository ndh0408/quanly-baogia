/**
 * RBAC-10 — MỌI Ô TRÊN MA TRẬN PHÂN QUYỀN PHẢI CÓ TÁC DỤNG Ở MÁY CHỦ.
 *
 * Ma trận là thứ giám đốc dùng để hiểu "ai làm được gì". Trước bản vá, nhóm Quản trị hiện ba ô
 * role:assign / template:manage / company:manage mà KHÔNG endpoint nào kiểm — tích hay bỏ đều như
 * nhau. Bài tĩnh này đòi mỗi quyền trong PERMISSION_GROUPS được tham chiếu ở src/ ngoài
 * permissions.ts (qua `P.X` / `PERMISSIONS.X` hoặc chuỗi quyền), tức có ít nhất một chỗ cưỡng chế.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSION_GROUPS, PERMISSIONS } from "../src/permissions.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tep = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) tep(p, out);
    else if (/\.ts$/.test(e.name) && !p.endsWith(`${path.sep}permissions.ts`)) out.push(p);
  }
  return out;
};
const nguon = tep(path.join(ROOT, "src")).map((f) => readFileSync(f, "utf8")).join("\n");
const tenHang = Object.fromEntries(Object.entries(PERMISSIONS).map(([k, v]) => [v, k]));

// NỢ ĐÃ KHAI, kèm lý do — thêm vào đây nghĩa là chấp nhận một ô chưa có tác dụng, phải ghi vì sao.
const NO_DA_KHAI = new Map([
  // Phạm vi GHI danh bạ đang bám phạm vi ĐỌC (kho dùng chung có chủ đích, employeeService.ts).
  // Siết theo edit/delete:* đổi hành vi của tài khoản có tập quyền per-user — chờ chủ repo quyết (RBAC-04).
  ["employee:edit:all", "RBAC-04 chờ quyết định"],
  ["employee:delete:all", "RBAC-04 chờ quyết định"],
]);

describe("RBAC-10 — ma trận quyền không có ô chết", () => {
  it("mọi quyền hiển thị đều được tham chiếu ở ít nhất một chỗ cưỡng chế", () => {
    const chet = [];
    for (const g of PERMISSION_GROUPS) {
      for (const perm of g.perms) {
        if (NO_DA_KHAI.has(perm)) continue;
        const k = tenHang[perm];
        // Quyền PHẠM VI (`tài-nguyên:hành-động:own|all`) được kiểm ĐỘNG: canScoped(session, "customer",
        // action, …) / readScopeWhereOrThrow(session, "employee", …) / canOnQuote(session, action, …)
        // ghép chuỗi `${resource}:${action}:all` — nên đếm lời gọi theo TÀI NGUYÊN.
        const pv = /^(\w+):(\w+):(own|all)$/.exec(perm);
        const kiemDong = pv && (pv[1] === "quote"
          ? /\bcanOnQuote\(|\bquoteScopeWhere/.test(nguon)
          : new RegExp(`\\b(canScoped|readScopeWhereOrThrow)\\([^)]*"${pv[1]}"`).test(nguon));
        const coThamChieu = nguon.includes(`P.${k}`) || nguon.includes(`PERMISSIONS.${k}`) || nguon.includes(`"${perm}"`) || !!kiemDong;
        if (!coThamChieu) chet.push(perm);
      }
    }
    expect(chet, `ô trên ma trận không được kiểm ở đâu: ${chet.join(", ")}`).toEqual([]);
  });

  it("ba ô chết cũ không còn trên ma trận, nhưng hằng số vẫn giữ (không vỡ dữ liệu quyền đã lưu)", () => {
    const hienThi = new Set(PERMISSION_GROUPS.flatMap((g) => g.perms));
    for (const p of ["role:assign", "template:manage", "company:manage"]) {
      expect(hienThi.has(p), p).toBe(false);
      expect(Object.values(PERMISSIONS)).toContain(p);
    }
  });
});
