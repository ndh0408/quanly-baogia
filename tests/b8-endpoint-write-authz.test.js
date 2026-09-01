// Lỗ mà `--check-guards` KHÔNG bịt được, và bài test này chốt lớp bịt mới.
//
// ── ĐO TRƯỚC KHI VIẾT ────────────────────────────────────────────────────────
// `--check-guards` coi `requireAuth` là "có gác", mà
// 16/23 file route mở đầu bằng `router.use(requireAuth)`
// — nên MỘT route GHI mới thêm vào bất kỳ file nào trong số đó luôn xanh
// dù không có bất kỳ phép kiểm QUYỀN nào. Vùng mù ấy KHÔNG phủ hết cây route:
// 4 file (admin/audit/users/webhooks) gác bằng `router.use(requirePermission(...))` — tức đã khai
// quyền ngay ở cấp router và cổng này thấy được; analytics + export có CẢ requireAuth lẫn
// requirePermission; 3 file (auth/jobs/stream) không có guard cấp router nào.
// Đo trên cây hiện tại: 78 endpoint GHI (POST/PUT/PATCH/DELETE), trong đó 46 KHÔNG có middleware
// phân quyền nào ở cấp route/router. Các con số file này do tests/w4-route-guard-counts.test.js
// đo lại từ mã nguồn và chốt, nên chúng không trôi âm thầm nữa.
//
// `--check` cũng không bịt: nó đòi mỗi endpoint phải CÓ một dòng trong ma trận
// docs/product/ROLES_PERMISSIONS.md, nhưng KHÔNG hề đọc cột QUYỀN — một dòng ghi `—` vẫn qua.
//
// Lớp mới (`--check-write-authz`) đòi mỗi endpoint GHI phải có ÍT NHẤT MỘT trong ba:
//   (a) middleware phân quyền ở cấp route/router (requirePermission / requireAnyPermission /
//       requireRole) — `requireAuth` KHÔNG tính, nó chỉ là xác thực;
//   (b) một dòng ma trận có cột QUYỀN ghi một quyền THẬT (repo này kiểm quyền trong thân handler
//       hoặc trong service rất nhiều, nên ma trận là nơi khai báo hợp lệ);
//   (c) tên trong danh sách miễn trừ tường minh, kèm lý do, ngay trong script.
// Đo trên cây hiện tại: đúng 17 endpoint rơi vào (c) — toàn bộ là đường TỰ PHỤC VỤ trên chính tài
// khoản/phiên của người gọi (đăng nhập, đổi mật khẩu của mình, MFA của mình, đọc thông báo của
// mình…), nên không có quyền nào để đòi.
//
// Điều này VẪN KHÔNG khẳng định quyền ghi trong ma trận là ĐÚNG — xem phần giới hạn ở đầu
// scripts/ci/endpoint-inventory.mjs. Nó chỉ khẳng định: không ai thêm được một route GHI mà không
// phải viết ra ai được phép gọi.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  mutationsWithoutAuthz,
  quyenDaKhai,
  MIEN_TRU_GHI,
  inventory,
  docMatrix,
} from "../scripts/ci/endpoint-inventory.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const doc1 = (path_, quyen) => [{ method: "POST", path: path_, quyen }];

describe("endpoint-inventory: cổng phân quyền cho endpoint GHI", () => {
  it("route GHI chỉ có requireAuth + ma trận ghi `—` → BỊ BẮT", () => {
    const rows = [{ method: "POST", path: "/api/quotes/:id/moi", capRoute: [], capRouter: ["requireAuth"], source: "src/routes/quotes.routes.ts" }];
    const ket = mutationsWithoutAuthz(rows, doc1("/api/quotes/:id/moi", "—"));
    expect(ket.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /api/quotes/:id/moi"]);
  });

  it("route GHI không có dòng ma trận nào → BỊ BẮT (không được im lặng cho qua)", () => {
    const rows = [{ method: "DELETE", path: "/api/venues/:id", capRoute: [], capRouter: ["requireAuth"], source: "x" }];
    expect(mutationsWithoutAuthz(rows, []).length).toBe(1);
  });

  it("có requirePermission ở cấp route → QUA, dù ma trận ghi `—`", () => {
    const rows = [{ method: "POST", path: "/api/venues", capRoute: ["requirePermission"], capRouter: ["requireAuth"], source: "x" }];
    expect(mutationsWithoutAuthz(rows, doc1("/api/venues", "—"))).toEqual([]);
  });

  it("ma trận khai một quyền thật → QUA (repo kiểm quyền trong service/handler)", () => {
    const rows = [{ method: "POST", path: "/api/venues", capRoute: [], capRouter: ["requireAuth"], source: "x" }];
    expect(mutationsWithoutAuthz(rows, doc1("/api/venues", "`venue:manage`"))).toEqual([]);
    expect(mutationsWithoutAuthz(rows, doc1("/api/venues", "người tạo **hoặc** `quote:update:all`"))).toEqual([]);
  });

  it("miễn trừ tường minh → QUA", () => {
    const rows = [{ method: "POST", path: "/api/auth/login", capRoute: [], capRouter: [], source: "x" }];
    expect(mutationsWithoutAuthz(rows, doc1("/api/auth/login", "—"), new Set(["POST /api/auth/login"]))).toEqual([]);
  });

  it("endpoint ĐỌC không bị đụng tới (GET không nằm trong phạm vi cổng này)", () => {
    const rows = [{ method: "GET", path: "/api/quotes", capRoute: [], capRouter: ["requireAuth"], source: "x" }];
    expect(mutationsWithoutAuthz(rows, doc1("/api/quotes", "—"))).toEqual([]);
  });

  it("quyenDaKhai phân biệt được ô rỗng với ô có quyền thật", () => {
    expect(quyenDaKhai("—")).toBe(false);
    expect(quyenDaKhai("")).toBe(false);
    expect(quyenDaKhai("— *(cố ý: đường ĐỌC)*")).toBe(false);
    expect(quyenDaKhai("`quote:read:*`")).toBe(true);
    expect(quyenDaKhai("`role=admin`")).toBe(true);
    expect(quyenDaKhai("allowlist `notif.channels`, còn lại `settings:manage`")).toBe(true);
  });

  it("CÂY HIỆN TẠI: mọi endpoint GHI đều qua cổng, và mọi miễn trừ đều còn trỏ vào endpoint thật", () => {
    const { rows } = inventory();
    const doc = docMatrix(readFileSync(path.join(ROOT, "docs/product/ROLES_PERMISSIONS.md"), "utf8"));
    const thieu = mutationsWithoutAuthz(rows, doc, new Set(MIEN_TRU_GHI.keys()));
    expect(thieu.map((r) => `${r.method} ${r.path}`)).toEqual([]);

    const khoa = new Set(rows.map((r) => `${r.method} ${r.path.replace(/\/+$/, "") || "/"}`));
    const thua = [...MIEN_TRU_GHI.keys()].filter((k) => !khoa.has(k));
    expect(thua, "miễn trừ trỏ vào endpoint không còn tồn tại").toEqual([]);
  });
});
