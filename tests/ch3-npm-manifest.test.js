// Cụm cấu-hình-dọn-rác — `package.json` phải khớp với thứ thật sự có trong repo.
//
// ── BA VẤN ĐỀ CÓ THẬT ĐÃ DẪN TỚI BỘ TEST NÀY ────────────────────────────────
//
// (1) `"e2e:hr": "node e2e-hr.mjs"` trỏ tới một file KHÔNG TỒN TẠI, và không bao giờ tồn tại được:
//     `.gitignore:59` chặn `e2e*.mjs`, `.dockerignore:35` cũng loại. Người mới clone gõ
//     `npm run e2e:hr` nhận `Cannot find module '/…/e2e-hr.mjs'` — một lệnh trong bảng script
//     chính thức của dự án mà chạy là gãy thì bảng script đó mất giá trị chỉ đường.
//
// (2) `playwright` nằm ở devDependencies nhưng KHÔNG file nào trong repo nhắc tới nó: không
//     `playwright.config.*`, không spec, không bước CI. `npm ci` ở job test (ci.yml:96) và job
//     security (ci.yml:293) tải nó về mỗi lượt để không kiểm gì.
//
// (3) `pdf-fontkit` và `nanoid` nằm ở khối `dependencies` (tức ĐI VÀO IMAGE PRODUCTION) mà không
//     mã nào import. `pdfkit` dùng gói `fontkit` RIÊNG của nó (node_modules/pdfkit/package.json:
//     `"fontkit": "^2.0.4"`), không liên quan `pdf-fontkit` — đã kiểm: không gói nào trong
//     node_modules khai phụ thuộc `pdf-fontkit`. Chuỗi "nanoid" duy nhất trong src là nhãn `case`
//     của switch trên `issue.format` của zod (src/zodErrorMap.ts), KHÔNG phải import.
//     Hậu quả thật: cả hai lọt vào phạm vi `npm audit --omit=dev --audit-level=high` (ci.yml:296)
//     vốn CHẶN MERGE — một advisory HIGH của thư viện không ai gọi cũng làm đỏ nhánh.
//
// Ba luật dưới đây là dạng TỔNG QUÁT của ba lỗi trên, nên chúng còn bắt được lần trôi sau.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

/** Mọi file mã nguồn của repo (bỏ node_modules, .git, dist, và web/ vì có manifest riêng). */
function docHetNguon(thuMuc) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist", "web", "coverage"].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) out.push(p);
    }
  };
  for (const d of thuMuc) {
    try {
      walk(path.join(ROOT, d));
    } catch {
      /* thư mục có thể không tồn tại */
    }
  }
  return out;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("package.json — script trỏ tới file có thật", () => {
  it("mọi script gọi một file .js/.mjs/.cjs trong repo thì file đó phải tồn tại", () => {
    const hong = [];
    for (const [ten, lenh] of Object.entries(pkg.scripts ?? {})) {
      // `node -e "…"` chạy mã nội tuyến, không có file để kiểm.
      if (/(?:^|\s)-e(?:\s|$)/.test(lenh)) continue;
      for (const tok of lenh.split(/\s+/)) {
        if (!/^[\w./@-]+\.(mjs|cjs|js)$/.test(tok)) continue;
        // dist/ là SẢN PHẨM BUILD: chưa `npm run build` thì chưa có, không phải lỗi manifest.
        if (tok.startsWith("dist/")) continue;
        if (!existsSync(path.join(ROOT, tok))) hong.push(`${ten} → ${tok}`);
      }
    }
    expect(
      hong,
      `Script trỏ tới file không tồn tại: ${hong.join(", ")}.\n` +
        `Một lệnh trong bảng script chính thức mà chạy là gãy thì phải xoá, không để lửng.`
    ).toEqual([]);
  });
});

describe("package.json — không nuôi gói không ai dùng", () => {
  it("mọi `dependencies` đều được src/scripts/prisma/shared import thật", () => {
    const all = docHetNguon(["src", "scripts", "prisma", "shared"])
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");

    // Gói KHÔNG xuất hiện dưới dạng import nhưng vẫn cần thật — mỗi mục kèm lý do kiểm chứng được.
    const NGOAI_LE = {
      // src/logger.ts:51 nạp qua TÊN (`transport: { target: "pino-pretty" }`), không import tĩnh.
      "pino-pretty": "nạp theo tên trong pino transport (src/logger.ts)",
      // Dockerfile:7-9 giải thích: k8s/helm/compose chạy `prisma migrate deploy` lúc khởi động nên
      // CLI phải sống sót qua `npm ci --omit=dev`.
      prisma: "CLI migrate chạy lúc khởi động (Dockerfile:7-9)",
      // Các script vận hành gọi `node --import tsx …` (pii:backfill, proof:migrate).
      tsx: "runtime TS cho script vận hành (`node --import tsx`)",
    };

    const chet = Object.keys(pkg.dependencies ?? {}).filter((dep) => {
      if (dep in NGOAI_LE) return false;
      const d = escRe(dep);
      // CHỈ khớp dạng import/require thật. Khớp chuỗi trần sẽ nhận nhầm `case "nanoid":` trong
      // src/zodErrorMap.ts (nhãn format của zod) thành một chỗ dùng gói nanoid.
      return !new RegExp(`(?:from|import|require\\()\\s*["']${d}(?:/[^"']*)?["']`).test(all);
    });

    expect(
      chet,
      `Có trong \`dependencies\` nhưng KHÔNG mã nào import: ${chet.join(", ")}.\n` +
        `Khối này đi thẳng vào image production và vào phạm vi \`npm audit --omit=dev\` (ci.yml) — ` +
        `gói không ai gọi vẫn chặn merge được khi có advisory. Xoá, hoặc thêm vào NGOAI_LE kèm lý do.`
    ).toEqual([]);
  });

  it("mọi `devDependencies` đều được cấu hình/script/test dùng thật", () => {
    // Hai kho văn bản TÁCH RIÊNG, cố ý.
    //   A. Cấu hình + mã ngoài tests/ + chuỗi lệnh trong scripts: khớp văn bản trần là đủ, vì công
    //      cụ ở đây được gọi bằng TÊN (eslint.config.js, `prettier --write .`, `husky || true`).
    //   B. tests/: CHỈ khớp dạng import/require. Nếu khớp văn bản trần thì một cái tên nằm trong
    //      chú thích của chính bài test này cũng đủ làm luật xanh — tức luật tự bãi bỏ chính nó.
    const fileCauHinh = docHetNguon(["."])
      .filter((f) => !f.startsWith(path.join(ROOT, "tests")))
      .concat(
        [".github/workflows/ci.yml", ".husky/pre-commit"].map((f) => path.join(ROOT, f)).filter((f) => existsSync(f))
      );
    const khoA = [...new Set(fileCauHinh)].map((f) => readFileSync(f, "utf8")).join("\n") + "\n" + JSON.stringify(pkg.scripts);
    const khoB = docHetNguon(["tests"])
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");

    const NGOAI_LE = (dep) =>
      // @types/* được TypeScript nạp ngầm qua node_modules/@types, không ai import bằng tên.
      dep.startsWith("@types/") ||
      // bật bằng CỜ `vitest run --coverage` (package.json:test:coverage), không phải import.
      dep === "@vitest/coverage-v8";

    const chet = Object.keys(pkg.devDependencies ?? {}).filter((dep) => {
      if (NGOAI_LE(dep)) return false;
      // Gói có scope hay được gọi bằng tên BINARY (đã bỏ scope): `@openai/codex-security` →
      // `codex-security scan .` trong npm script.
      const ten = [dep, dep.replace(/^@[^/]+\//, "")];
      if (ten.some((t) => khoA.includes(t))) return false;
      return !ten.some((t) => new RegExp(`(?:from|import|require\\()\\s*["']${escRe(t)}(?:/[^"']*)?["']`).test(khoB));
    });

    expect(
      chet,
      `devDependency không cấu hình/script/test nào dùng: ${chet.join(", ")}.\n` +
        `Mỗi lượt \`npm ci\` của CI đều tải nó về để không dùng vào việc gì.`
    ).toEqual([]);
  });
});
