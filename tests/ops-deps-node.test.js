/**
 * OPS · DEP-03 — phụ thuộc "ma"; DEP-04 / INFRA-12 — một phiên bản Node cho mọi nơi.
 *
 * DEP-03: `jszip` được import trên đường xuất Excel (src/xlsxStitcher.ts) và hợp đồng DOCX
 *   (src/services/contractDocx.ts) nhưng KHÔNG có trong package.json — nó chỉ tồn tại vì exceljs kéo
 *   vào. `yaml`/`saxes` cũng vậy ở scripts/tests. check-deps chỉ gác chiều "khai mà không dùng".
 * DEP-04: production chạy `node:22-alpine` (tag trôi, không digest), còn máy duy nhất chạy cổng dùng
 *   Node 24, tsc kiểm theo @types/node 26. Không phép kiểm nào đòi chúng trùng nhau.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { goiDuocImport, timGoiMa } from "../scripts/ci/check-deps.mjs";

const GOC = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(GOC, "package.json"), "utf8"));
const doc = (f) => readFileSync(path.join(GOC, f), "utf8");

describe("DEP-03 — gói được import phải được khai", () => {
  it("jszip là dependency TRỰC TIẾP (đường xuất Excel/DOCX của production)", () => {
    expect(pkg.dependencies.jszip).toBeTruthy();
    expect([...goiDuocImport(doc("src/xlsxStitcher.ts"))]).toContain("jszip");
  });

  it("yaml và saxes (dùng ở scripts/tests) được khai là devDependency", () => {
    expect(pkg.devDependencies.yaml).toBeTruthy();
    expect(pkg.devDependencies.saxes).toBeTruthy();
  });

  it("check-deps bắt gói ma: import trong src/ mà chỉ có ở devDependencies hoặc không khai là ĐỎ", () => {
    const tep = [
      { tep: "src/a.ts", noiDung: 'import JSZip from "jszip";\nimport x from "node:fs";\nimport y from "./y.js";' },
      { tep: "src/b.ts", noiDung: 'const s = await import("saxes");' },
      { tep: "tests/c.test.js", noiDung: 'import { SaxesParser } from "saxes";' },
      { tep: "src/d.ts", noiDung: '// ví dụ trong chú thích: from "khong-tinh"\nimport "fs";' },
    ];
    const loi = timGoiMa(tep, { dependencies: {}, devDependencies: { saxes: "1" } });
    expect(loi.map((l) => `${l.tep}:${l.goi}`).sort()).toEqual(["src/a.ts:jszip", "src/b.ts:saxes"]);
  });
});

describe("DEP-04 — một phiên bản Node, ghim digest", () => {
  const nodeImage = /^ARG NODE_IMAGE=(\S+)$/m.exec(doc("Dockerfile"))?.[1] ?? "";
  const major = (s) => /(\d+)/.exec(s)?.[1];

  it("Dockerfile ghim ảnh Node theo digest", () => {
    expect(nodeImage).toMatch(/^node:\d+(\.\d+){0,2}-alpine@sha256:[0-9a-f]{64}$/);
  });

  it(".nvmrc, Dockerfile, engines và @types/node cùng một major", () => {
    const m = major(doc(".nvmrc").trim());
    expect(major(nodeImage)).toBe(m);
    expect(major(pkg.devDependencies["@types/node"])).toBe(m);
    expect(pkg.engines.node).toContain(`>=${m}`);
    expect(pkg.engines.node).toContain(`<${Number(m) + 1}`);
  });

  it("docker-smoke dựng image trên ĐÚNG ảnh nền của Dockerfile (không chép cứng tag riêng)", () => {
    const lenh = doc("scripts/ci/docker-smoke.sh").split("\n").filter((d) => !/^\s*#/.test(d)).join("\n");
    expect(lenh).not.toMatch(/node:\d+-alpine/);
    expect(lenh).toMatch(/ARG NODE_IMAGE/);
  });

  it("verify-local chặn khi Node của máy khác major với .nvmrc", () => {
    expect(doc("scripts/verify-local.sh")).toMatch(/\.nvmrc/);
  });
});
