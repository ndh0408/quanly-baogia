// Chốt con số "bao nhiêu file route có guard gì ở CẤP ROUTER", để nó không trôi nữa.
//
// ── VÌ SAO CÓ BÀI TEST NÀY ───────────────────────────────────────────────────
// Con số này là tiền đề của MỌI câu giải thích về vùng mù của `--check-guards` và về lý do phải
// thêm `--check-write-authz`. Nó bị chép tay vào BỐN chỗ (ci.yml, bài test b8, và hai khối chú
// thích trong endpoint-inventory.mjs) rồi cả bốn cùng sai: ghi "20/24 file route mở đầu bằng
// `router.use(requireAuth)`". Đo lại trên cây hiện tại thì "20/24" là số file có guard cấp router
// BẤT KỲ trên tổng số NGUỒN mà `inventory()` quét (23 file trong src/routes/ cộng src/app.ts) —
// không phải số file dùng `requireAuth`. Số dùng `requireAuth` là 16/23.
//
// Chú thích sai kiểu này không làm CI đỏ, nên nó sống mãi. Bài test này biến nó thành thứ đỏ được:
// nó ĐO từ mã nguồn rồi đòi chú thích ở cả ba chỗ phải mang đúng con số vừa đo.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { routerLevelGuards } from "../scripts/ci/endpoint-inventory.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const doc = (p) => readFileSync(path.join(ROOT, p), "utf8");

// `requireAuth` CỐ Ý không nằm đây — nó trả lời "anh là ai", không trả lời "anh được làm gì".
// Danh sách giữ khớp với AUTHZ_MIDDLEWARE trong scripts/ci/endpoint-inventory.mjs.
const AUTHZ = ["requirePermission", "requireAnyPermission", "requireRole"];

/** Phân loại từng file src/routes/*.ts theo guard CẤP ROUTER, dùng chính bộ phân tích của CI. */
function doGuardCapRouter() {
  const files = readdirSync(path.join(ROOT, "src/routes")).filter((f) => f.endsWith(".ts")).sort();
  const coRequireAuth = [], chiRequirePermission = [], khongGuard = [];
  for (const f of files) {
    const src = doc(`src/routes/${f}`);
    const g = routerLevelGuards(src, "router");
    if (g.length === 0) khongGuard.push(f);
    else if (!g.includes("requireAuth") && g.some((x) => AUTHZ.includes(x))) chiRequirePermission.push(f);
    if (g.includes("requireAuth")) coRequireAuth.push(f);
  }
  return { files, coRequireAuth, chiRequirePermission, khongGuard };
}

const ten = (f) => f.replace(/\.routes\.ts$/, "");

describe("số file route theo guard cấp router — đo từ mã nguồn", () => {
  it("khớp con số đã chốt (đổi thì phải sửa cả chú thích lẫn dòng này)", () => {
    const { files, coRequireAuth, chiRequirePermission, khongGuard } = doGuardCapRouter();
    expect(files.length).toBe(23);
    expect(coRequireAuth.length).toBe(16);
    // 4 file này KHÔNG có requireAuth cấp router — chúng gác thẳng bằng requirePermission, tức
    // đã khai quyền ở cấp router, nên KHÔNG nằm trong vùng mù mà --check-write-authz phải bù.
    expect(chiRequirePermission.map(ten)).toEqual(["admin", "audit", "users", "webhooks"]);
    // 3 file này không có guard cấp router nào; cộng src/app.ts là 4 NGUỒN mà --check-guards thật
    // sự có hiệu lực (app.ts chỉ gác bằng `app.use("/api/", …)` — dạng có đường dẫn, không tính).
    expect(khongGuard.map(ten)).toEqual(["auth", "jobs", "stream"]);
    expect(routerLevelGuards(doc("src/app.ts"), "app")).toEqual([]);
  });

  it("analytics/export có CẢ requireAuth lẫn requirePermission cấp router", () => {
    // Đây là lý do "số file requirePermission" (6) khác "số file CHỈ requirePermission" (4).
    // Nếu ai đó gộp hai con số này lại thì chú thích lại sai lần nữa.
    for (const f of ["analytics.routes.ts", "export.routes.ts"]) {
      const g = routerLevelGuards(doc(`src/routes/${f}`), "router");
      expect(g).toContain("requireAuth");
      expect(g).toContain("requirePermission");
    }
  });
});

// BỐN chỗ chép tay con số — không phải ba. Bản rà đầu bỏ sót tests/qua-endpoint-guards.test.js,
// nơi chú thích còn TỰ NHẬN "ĐO ĐƯỢC … không phải suy đoán" trong khi mang đúng con số sai. Một
// chú thích sai mà tự khẳng định là đã đo thì tệ hơn chú thích không nói gì.
// Mọi chỗ khác nói "N/M file route" đều phải mang đúng cặp số vừa đo.
const NOI_CHEP = [
  ".github/workflows/ci.yml",
  "tests/b8-endpoint-write-authz.test.js",
  "scripts/ci/endpoint-inventory.mjs",
  "tests/qua-endpoint-guards.test.js",
];

describe("chú thích mang đúng con số vừa đo", () => {
  const { files, coRequireAuth, chiRequirePermission } = doGuardCapRouter();
  const cauAuth = `${coRequireAuth.length}/${files.length} file route mở đầu bằng \`router.use(requireAuth)\``;
  const cauPerm = `${chiRequirePermission.length} file (${chiRequirePermission.map(ten).join("/")}) gác bằng \`router.use(requirePermission(...))\``;

  for (const f of NOI_CHEP) {
    it(`${f} — có câu số requireAuth và câu nhóm requirePermission`, () => {
      const src = doc(f);
      expect(src).toContain(cauAuth);
      expect(src).toContain(cauPerm);
    });

    it(`${f} — KHÔNG còn cặp số "N/M file route" nào lạc`, () => {
      const lac = [...doc(f).matchAll(/(\d+)\/(\d+) file route/g)]
        .filter((m) => m[1] !== String(coRequireAuth.length) || m[2] !== String(files.length))
        .map((m) => m[0]);
      expect(lac).toEqual([]);
    });
  }
});
