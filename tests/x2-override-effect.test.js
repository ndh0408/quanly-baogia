// BẢN GHI ĐÈ `effect` — cùng hai đường hỏng im lặng như tests/x2-override-deepmerge.test.js.
//
// `@prisma/config@7.10.x` GHIM CHÍNH XÁC `effect@3.20.0`, mà mọi bản <= 3.22.0 dính ReDoS trong
// Schema.TemplateLiteral (advisory mức high, công bố 11/2026 — `npm audit --omit=dev` đỏ cổng [10/13]).
// `npm audit fix --force` tụt prisma về 6.12 (đổi lớn) nên repo ép `^3.22.5` bằng `overrides` (cùng
// major 3 mà prisma khai). Lý do ở docs/REMAINING_RISKS.md mục "Ghim phụ thuộc bằng overrides".
//
// LỖ 1: `npm audit` đọc CÂY ĐÃ CÀI, không đọc `overrides` — gỡ dòng override mà chưa `npm install`
// thì cổng vẫn xanh, lần `npm ci` kế tiếp mới lặng lẽ cài lại 3.20.0. Bài này đọc package.json.
// LỖ 2: override không phạm vi — khi prisma tự nâng `effect` lên bản đã vá (hoặc major 4), dòng của
// ta thành rác và có thể kéo prisma xuống major cũ. Bài này bắt phải gỡ lúc đó.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GOC = fileURLToPath(new URL("..", import.meta.url));
const json = (p) => JSON.parse(readFileSync(join(GOC, p), "utf8"));
const ghiDe = json("package.json").overrides?.effect;

/** "3.22.5" / "^3.22.5" → [3, 22, 5]; null nếu không đọc được. */
const so = (r) => { const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(r || "")); return m ? m.slice(1).map(Number) : null; };
/** a >= b theo [major, minor, patch]. */
const geq = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2];
const DA_VA = [3, 22, 1];   // bản đầu tiên thoát advisory (dải lỗi <= 3.22.0)

function ghimCuaPrisma() {
  try { return json("node_modules/@prisma/config/package.json").dependencies?.effect ?? null; } catch { return null; }
}

describe("override effect — phải còn đó chừng nào prisma còn ghim bản dính ReDoS", () => {
  it("override được KHAI trong package.json và trỏ tới bản đã vá (>= 3.22.1, cùng major 3)", () => {
    expect(ghiDe, "overrides['effect'] biến mất — `npm audit` vẫn xanh tới lần `npm ci` kế tiếp rồi cài lại 3.20.0").toBeTruthy();
    const v = so(ghiDe);
    expect(v && geq(v, DA_VA), `override đang là "${ghiDe}"`).toBe(true);
    expect(v?.[0], "đổi major của effect là đổi API mà prisma không được thử cùng").toBe(3);
  });

  it("bản THẬT ĐANG CÀI cũng >= 3.22.1", () => {
    let daCai = null;
    try { daCai = json("node_modules/effect/package.json").version; } catch { /* chưa cài */ }
    if (!daCai) return;
    expect(geq(so(daCai), DA_VA), `đang cài effect@${daCai} trong khi override khai "${ghiDe}"`).toBe(true);
  });
});

describe("override effect — phải BỎ ĐI khi prisma tự nâng", () => {
  it("prisma còn ghim bản dính lỗ thì override còn cần; prisma tự lên bản đã vá thì override là RÁC", () => {
    const ghim = ghimCuaPrisma();
    if (!ghim) return;
    const v = so(ghim);
    if (v && geq(v, DA_VA)) {
      expect(ghiDe, `@prisma/config nay ghim effect "${ghim}" — đã thoát advisory. GỠ overrides['effect'] khỏi package.json, ` +
        "`npm install` rồi `npm run verify`.").toBeFalsy();
    } else {
      expect(v && geq(v, DA_VA), `@prisma/config ghim "${ghim}" — vẫn dính lỗ, override còn cần`).toBe(false);
    }
  });
});

describe("tài liệu về override", () => {
  it("docs/REMAINING_RISKS.md có dòng effect và chỉ tới bài test này", () => {
    const rr = readFileSync(join(GOC, "docs/REMAINING_RISKS.md"), "utf8");
    expect(rr).toMatch(/\|\s*`effect`\s*\|/);
    expect(rr).toMatch(/x2-override-effect/);
  });
});
