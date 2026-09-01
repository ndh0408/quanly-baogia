// BẢN GHI ĐÈ `deepmerge-ts` — hai đường nó hỏng IM LẶNG, và không cổng nào bắt được.
//
// ── VÌ SAO CÓ BẢN GHI ĐÈ ────────────────────────────────────────────────────
// `@prisma/config` GHIM CHÍNH XÁC `deepmerge-ts@7.1.5`, mà bản đó dính GHSA-ggr8-5vv4-36mx
// (stack exhaustion khi merge đồ thị object đệ quy, mức high). Không bản prisma 7.x nào thoát, và
// `npm audit fix --force` thì tụt prisma về 6.12 — đổi lớn. Nên repo ép `^8.0.2` bằng `overrides`.
//
// ── LỖ 1: GỠ OVERRIDE ĐI THÌ CỔNG VẪN XANH ──────────────────────────────────
// docs/REMAINING_RISKS.md TỪNG khẳng định: "Gỡ dòng override rồi chạy `npm run verify`: bước
// [9/9] Phụ thuộc sẽ đỏ ngay". ĐO THẬT thì SAI: `npm audit` đọc CÂY ĐÃ CÀI (node_modules +
// package-lock), không đọc `overrides` trong package.json. Xoá dòng override mà chưa `npm install`
// → audit vẫn xanh. Người xoá nó sẽ thấy toàn bộ cổng xanh và tin là an toàn; lần `npm ci` kế
// tiếp (trên máy khác, hoặc trong Dockerfile) mới cài lại bản 7.1.5 dính lỗ hổng — lúc đó không
// ai đang nhìn.
//
// ── LỖ 2: OVERRIDE KHÔNG PHẠM VI, NÊN NÓ CŨNG GHIM CẢ TƯƠNG LAI ─────────────
// `overrides` không giới hạn theo gói cha. Khi `@prisma/config` tự nâng lên `deepmerge-ts@9`,
// dòng `^8.0.2` của ta sẽ ÂM THẦM KÉO NÓ XUỐNG 8.x — prisma chạy với bản thư viện mà nó không
// được thử cùng, và không có gì báo. Bản ghi đè là thuốc, không phải vitamin: hết bệnh thì phải bỏ.
//
// Bài này bịt CẢ HAI: nó đọc `package.json` (nguồn của sự thật về ý định) và bản GHIM THẬT của
// `@prisma/config` trong node_modules, rồi bắt hai bên phải nhất quán.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GOC = new URL("..", import.meta.url).pathname;
const json = (p) => JSON.parse(readFileSync(join(GOC, p), "utf8"));

const pkg = json("package.json");
const ghiDe = pkg.overrides?.["deepmerge-ts"];

/** Bản deepmerge-ts mà @prisma/config TỰ khai — tức thứ sẽ được cài NẾU không có override. */
function ghimCuaPrisma() {
  try {
    return json("node_modules/@prisma/config/package.json").dependencies?.["deepmerge-ts"] ?? null;
  } catch {
    return null;   // chưa cài — bài dưới tự bỏ qua
  }
}

/** Số major đầu tiên trong một dải semver ("7.1.5" → 7, "^8.0.2" → 8, ">=8" → 8). */
const major = (r) => {
  const m = /(\d+)\./.exec(String(r || "")) || /(\d+)/.exec(String(r || ""));
  return m ? Number(m[1]) : null;
};

describe("override deepmerge-ts — phải còn đó chừng nào prisma còn ghim bản dính lỗ hổng", () => {
  it("override được KHAI trong package.json", () => {
    // Đây là chốt chặn cho LỖ 1. `npm audit` không thấy chuyện này; bài test thì thấy.
    expect(ghiDe,
      "overrides['deepmerge-ts'] biến mất khỏi package.json. `npm audit` sẽ VẪN XANH cho tới lần " +
      "`npm ci` kế tiếp, rồi mới lặng lẽ cài lại 7.1.5 (GHSA-ggr8-5vv4-36mx). Xem " +
      "docs/REMAINING_RISKS.md mục 'Ghim phụ thuộc bằng overrides'.")
      .toBeTruthy();
  });

  it("override trỏ tới major ĐÃ VÁ (>= 8) — 7.x là bản dính GHSA-ggr8-5vv4-36mx", () => {
    expect(major(ghiDe), `override đang là "${ghiDe}"`).toBeGreaterThanOrEqual(8);
  });

  it("bản THẬT ĐANG CÀI cũng >= 8, không chỉ ý định trên giấy", () => {
    // package.json nói một đằng mà node_modules cài một nẻo là chuyện có thật (override gõ sai tên
    // gói, hoặc lockfile cũ). Kiểm cây thật.
    let daCai = null;
    try {
      daCai = json("node_modules/deepmerge-ts/package.json").version;
    } catch { /* chưa cài */ }
    if (!daCai) return;      // môi trường chưa `npm install` — không có gì để khẳng định
    expect(major(daCai), `đang cài deepmerge-ts@${daCai} trong khi override khai "${ghiDe}"`)
      .toBeGreaterThanOrEqual(8);
  });
});

describe("override deepmerge-ts — phải BỎ ĐI khi prisma tự nâng", () => {
  it("prisma còn ghim 7.x thì override còn cần; prisma lên >= 8 thì override là RÁC phải gỡ", () => {
    const ghim = ghimCuaPrisma();
    if (!ghim) return;       // chưa cài @prisma/config — không khẳng định gì

    const mPrisma = major(ghim);
    if (mPrisma !== null && mPrisma >= 8) {
      // Đây là ngày phải gỡ. Không gỡ thì `^8.0.2` sẽ KÉO XUỐNG một bản 9.x mà prisma cần, âm thầm.
      expect(ghiDe,
        `@prisma/config nay ghim deepmerge-ts "${ghim}" — tự nó đã thoát GHSA-ggr8-5vv4-36mx. ` +
        `Bản ghi đè "${ghiDe}" thành RÁC, và tệ hơn: nó sẽ kéo prisma xuống major ${major(ghiDe)} ` +
        `nếu prisma nâng tiếp. GỠ dòng overrides['deepmerge-ts'] khỏi package.json, chạy ` +
        `\`npm install\` rồi \`npm run verify\`.`)
        .toBeFalsy();
    } else {
      expect(mPrisma, `@prisma/config ghim "${ghim}" — vẫn là bản dính lỗ hổng, override còn cần`)
        .toBeLessThan(8);
    }
  });
});

describe("tài liệu về override phải nói ĐÚNG cách nó hỏng", () => {
  const rr = readFileSync(join(GOC, "docs/REMAINING_RISKS.md"), "utf8");

  it("KHÔNG khẳng định `npm audit` sẽ đỏ khi gỡ override — đã đo là SAI", () => {
    // Câu cũ: "Gỡ dòng override rồi chạy `npm run verify`: bước `[9/9] Phụ thuộc` sẽ **đỏ ngay**".
    // Đo được (2026-08-27): gỡ dòng đó khỏi package.json rồi chạy
    // `npm audit --omit=dev --audit-level=high` → vẫn thoát 0, vì audit đọc cây ĐÃ CÀI.
    // Một lời hứa an toàn SAI còn nguy hơn không hứa gì.
    const doan = rr.slice(rr.indexOf("Ghim phụ thuộc bằng"), rr.indexOf("Ghim phụ thuộc bằng") + 4000);
    expect(doan, "tài liệu vẫn hứa một cổng không tồn tại")
      .not.toMatch(/Phụ thuộc.{0,40}(sẽ|se).{0,20}đỏ ngay/);
  });

  it("có chỉ tới bài test này — thứ THẬT SỰ bắt được việc gỡ override", () => {
    expect(rr).toMatch(/x2-override-deepmerge/);
  });
});
