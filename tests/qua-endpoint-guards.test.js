// Bộ kiểm kê endpoint của CI KHÔNG hề nhìn thấy middleware gác — chốt hồi quy công cụ.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `.github/workflows/ci.yml` đặt tên bước là "Gác MA TRẬN PHÂN QUYỀN … Thêm route mà quên soát
// quyền là đỏ pipeline ngay". Nhưng `scripts/ci/endpoint-inventory.mjs --check` chỉ so CON SỐ
// endpoint trong mã với con số công bố ở docs/product/ROLES_PERMISSIONS.md và README.md; nó không
// nhắc tới `requireAuth`/`requirePermission` lấy một lần, và không đọc dòng nào của bảng ma trận.
// Thêm một route KHÔNG GÁC gì rồi nhớ +1 vào tài liệu là CI xanh. Nhãn hứa nhiều hơn thứ công cụ làm.
//
// ── ĐÂY LÀ LỖ PHÁT HIỆN, KHÔNG PHẢI LỖ KHAI THÁC ────────────────────────────
// Không có endpoint nào đang hở vì chuyện này (chạy `--check-guards` trên mã hiện tại: 0 vi phạm
// ngoài miễn trừ). Cái thiếu là hàng rào ngăn hồi quy TƯƠNG LAI.
//
// ── VÌ SAO TEST Ở LỚP NÀY ───────────────────────────────────────────────────
// Lỗi nằm trong bộ phân tích tĩnh, nên test cho nó ăn ĐÚNG thứ nó phải phân tích: mã nguồn router
// giả lập, gồm cả những cái bẫy làm bộ phân tích ngây thơ đọc sai (dấu `)` nằm trong chuỗi và
// trong regex literal). Kèm một lần chạy CLI thật để chốt cả đường dây.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  extractRoutes, routerLevelGuards, routesWithoutGuards, inventory, argsSlice,
  docMatrix, doiChieuMaTran, chuanDuong,
} from "../scripts/ci/endpoint-inventory.mjs";
import { readFileSync } from "node:fs";

const SCRIPT = join(process.cwd(), "scripts/ci/endpoint-inventory.mjs");

// Router giả lập: 1 route có gác, 1 route QUÊN gác, 1 route mà đối số chứa `)` trong chuỗi + regex.
const NGUON = `
import { Router } from "express";
const router = Router();
router.use(requireAuth);

router.get("/an-toan", requirePermission(P.QUOTE_READ_ALL), asyncHandler(async (req, res) => res.json({})));

router.post(
  "/bay-chuoi",
  // Chuỗi có dấu ngoặc lẻ ")" và regex literal chứa ")" — bộ phân tích ngây thơ sẽ cắt sớm ở đây
  // rồi kết luận nhầm là route KHÔNG có guard nào.
  validate({ body: z.object({ x: z.string().regex(/^a\\)b(c|d)$/, "hỏng )") }) }),
  requireRole("admin"),
  asyncHandler(async (req, res) => res.json({}))
);
`;

// Router KHÔNG có guard cấp router — đúng kịch bản "thêm route mà quên soát quyền".
const NGUON_QUEN = `
const router = Router();
router.use("/con", subRouter);
router.post("/quen-gac", asyncHandler(async (req, res) => res.json({})));
`;

describe("endpoint-inventory: phải bóc được middleware gác của từng route", () => {
  it("gác cấp route được nhận diện, kể cả sau đối số có ')' trong chuỗi/regex", () => {
    const rows = extractRoutes(NGUON, "router");
    expect(rows.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /an-toan", "POST /bay-chuoi"]);
    expect(rows[0].capRoute).toEqual(["requirePermission"]);
    // Đây là ca then chốt: `requireRole` nằm SAU cái regex có dấu ')' bên trong.
    expect(rows[1].capRoute).toEqual(["requireRole"]);
  });

  it("gác cấp router (`router.use(requireAuth)`) áp cho mọi route trong file", () => {
    expect(routerLevelGuards(NGUON, "router")).toEqual(["requireAuth"]);
    for (const r of extractRoutes(NGUON, "router")) expect(r.capRouter).toEqual(["requireAuth"]);
  });

  it("`router.use('/con', subRouter)` KHÔNG bị tính là guard cấp router", () => {
    expect(routerLevelGuards(NGUON_QUEN, "router")).toEqual([]);
  });

  it("route quên gác bị nêu tên; miễn trừ tường minh thì được tha", () => {
    const rows = extractRoutes(NGUON_QUEN, "router");
    expect(routesWithoutGuards(rows).map((r) => r.path)).toEqual(["/quen-gac"]);
    expect(routesWithoutGuards(rows, new Set(["POST /quen-gac"]))).toEqual([]);
  });

  it("argsSlice dừng đúng ở dấu ')' cân bằng, không dừng ở ')' trong chuỗi", () => {
    const t = `f("a)b", g(1), 2) SAU`;
    expect(argsSlice(t, 2)).toBe(`"a)b", g(1), 2`);
  });

  it("trên mã THẬT: route đã gác mang theo tên guard", () => {
    const { rows } = inventory();
    const tim = (m, p) => rows.find((r) => r.method === m && r.path === p);
    // Gác cấp router (files.routes.ts: `router.use(requireAuth)`) + gác cấp route vừa thêm.
    expect(tim("POST", "/api/files/sign-upload").capRouter).toContain("requireAuth");
    expect(tim("POST", "/api/files/sign-upload").capRoute).toContain("requirePermission");
    // Gác cấp router bằng requirePermission (admin.routes.ts) — không có requireAuth mà vẫn là gác.
    expect(tim("POST", "/api/admin/backup.dump").capRouter).toContain("requirePermission");
  });

  it("CLI --check-guards chạy được và mã hiện tại sạch", () => {
    const out = execFileSync("node", [SCRIPT, "--check-guards"], { encoding: "utf8" });
    expect(out).toMatch(/mọi endpoint đều có middleware gác/);
    // Không được im lặng về giới hạn của chính mình: "có gác" ≠ "gác đúng".
    expect(out).toMatch(/không phải gác ĐÚNG/);
  });

  it("CLI --check chạy sạch trên mã hiện tại và nói rõ nó khớp TỪNG DÒNG", () => {
    const out = execFileSync("node", [SCRIPT, "--check"], { encoding: "utf8" });
    expect(out).toMatch(/KHỚP TỪNG DÒNG với ma trận/);
  });
});

/**
 * ============================================================================
 * LỖ THẬT: `--check-guards` KHÔNG bịt được "thêm route không ai soát mà nhớ +1 con số".
 *
 * ĐO ĐƯỢC (khẳng định ngay dưới đây, không phải suy đoán): 20/24 file route mở đầu bằng
 * `router.use(requireAuth)`, mà `routerLevelGuards` coi một dòng như thế là phủ MỌI route trong
 * file — nên phần lớn endpoint không bao giờ lọt vào `routesWithoutGuards`. Thêm một route hở vào
 * bất kỳ file nào trong số đó rồi sửa con số 137→138 là CI xanh trơn.
 *
 * BỊT BẰNG: `--check` nay đối chiếu TỪNG DÒNG với bảng ma trận. Muốn xanh phải viết một dòng bảng,
 * tức phải điền cột QUYỀN / P.VI / T.NGUYÊN — tức phải soát.
 * ============================================================================
 */
describe("endpoint-inventory: đối chiếu TỪNG DÒNG với ma trận phân quyền", () => {
  const MA_TRAN = join(process.cwd(), "docs/product/ROLES_PERMISSIONS.md");
  const doc = () => docMatrix(readFileSync(MA_TRAN, "utf8"));

  it("nói ĐÚNG tầm với của --check-guards: phần lớn endpoint nằm ngoài nó", () => {
    const { rows } = inventory();
    const chiCapRouter = rows.filter((r) => !r.capRoute?.length && r.capRouter?.length);
    // Con số cụ thể sẽ trôi khi repo lớn lên; điều PHẢI đúng là "đa số", vì đó là lý do khối chú
    // thích đầu script không được gọi --check-guards là phần bù cho lỗ trên.
    expect(chiCapRouter.length).toBeGreaterThan(rows.length / 2);
  });

  it("bóc được ma trận và khớp mã nguồn theo CẢ HAI CHIỀU", () => {
    const { rows } = inventory();
    const { thieuDong, dongChet } = doiChieuMaTran(rows, doc());
    expect(thieuDong, `endpoint chưa có dòng ma trận: ${thieuDong.map((r) => r.method + " " + r.path).join(", ")}`).toEqual([]);
    expect(dongChet, `dòng ma trận chết: ${dongChet.map((d) => d.method + " " + d.path).join(", ")}`).toEqual([]);
  });

  it("hiểu ô gộp `PUT/DELETE` và đường viết tắt sau dấu ·", () => {
    const d = doc();
    const co = (m, p) => d.some((x) => x.method === m && x.path === p);
    // `| PUT/DELETE | /settings/:key |` → hai endpoint.
    expect(co("PUT", "/api/settings/:key")).toBe(true);
    expect(co("DELETE", "/api/settings/:key")).toBe(true);
    // `| POST | /mfa/setup · /enable · /disable |` → ba endpoint dưới /api/mfa.
    for (const x of ["setup", "enable", "disable"]) expect(co("POST", `/api/mfa/${x}`)).toBe(true);
    // Đường viết tắt bám theo NHÓM chứ không theo thư mục cha: /notifications/:id/read · /read-all.
    expect(co("POST", "/api/notifications/read-all")).toBe(true);
    // Mục "Ngoài router" dùng đường tuyệt đối sẵn.
    expect(co("GET", "/api/csrf-token")).toBe(true);
  });

  it("giữ được cột QUYỀN — nguồn để người soát đối chiếu năng lực đòi hỏi", () => {
    const d = doc();
    expect(d.find((x) => x.method === "GET" && x.path === "/api/quotes/next-number").quyen).toContain("quote:create");
    expect(d.find((x) => x.method === "POST" && x.path === "/api/auth/login").quyen).toBe("—");
  });

  it("ĐỎ khi mã có endpoint mà ma trận không có dòng (kịch bản 'quên soát')", () => {
    const rows = [
      { method: "GET", path: "/api/quotes/", source: "x.ts" },
      { method: "GET", path: "/api/quotes/zzz-quen-gac", source: "x.ts" },
    ];
    const gia = [{ method: "GET", path: "/api/quotes", quyen: "quote:read:*" }];
    const { thieuDong } = doiChieuMaTran(rows, gia);
    expect(thieuDong).toHaveLength(1);
    expect(thieuDong[0].path).toBe("/api/quotes/zzz-quen-gac");
  });

  it("ĐỎ khi ma trận còn dòng chết — route mới trùng đường dẫn sẽ được tha im lặng", () => {
    const rows = [{ method: "GET", path: "/api/quotes", source: "x.ts" }];
    const gia = [
      { method: "GET", path: "/api/quotes", quyen: "quote:read:*" },
      { method: "DELETE", path: "/api/quotes/da-go", quyen: "quote:delete" },
    ];
    const { dongChet } = doiChieuMaTran(rows, gia);
    expect(dongChet).toHaveLength(1);
    expect(dongChet[0].path).toBe("/api/quotes/da-go");
  });

  it("dòng ký tự đại diện `/webhooks/*` phủ CẢ đường gốc lẫn đường con", () => {
    const rows = [
      { method: "POST", path: "/api/webhooks", source: "x.ts" },
      { method: "PUT", path: "/api/webhooks/:id", source: "x.ts" },
      { method: "POST", path: "/api/webhooks-khac", source: "x.ts" },   // KHÔNG được phủ
    ];
    const gia = [
      { method: "POST", path: "/api/webhooks/*", quyen: "settings:manage" },
      { method: "PUT", path: "/api/webhooks/*", quyen: "settings:manage" },
    ];
    const { thieuDong } = doiChieuMaTran(rows, gia);
    expect(thieuDong.map((r) => r.path)).toEqual(["/api/webhooks-khac"]);
  });

  it("chuanDuong coi `/api/settings/` và `/api/settings` là một", () => {
    expect(chuanDuong("/api/settings/")).toBe("/api/settings");
    expect(chuanDuong("/")).toBe("/");
  });
});
