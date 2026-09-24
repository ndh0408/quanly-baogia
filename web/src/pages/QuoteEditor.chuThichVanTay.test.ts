// Soát toàn diện đợt 5 (d5-soan 1): `boKhoaPhien` (đợt 4, d89d8f9) được chèn vào GIỮA khối JSDoc
// "app#11 — VÂN TAY PHẦN NGOÀI HÀ NỘI" và hàm `vanTayMain` mà khối đó mô tả. TS/IDE gắn JSDoc liền kề
// vào nút đứng ngay sau nó: `vanTayMain` mất chú thích, còn khối app#11 nằm mồ côi trên một khối JSDoc
// khác — người đọc tưởng nó đang tả `boKhoaPhien`. Không đổi hành vi, nhưng khối đó giải thích luật
// khoá lạc quan (vì sao không được nhận mốc updatedAt mới) — chính thứ người sửa sau cần đọc trước.
import { describe, it, expect } from "vitest";

// tsconfig của web/ là browser-scoped (không có @types/node) — nạp node:fs bằng import động (xem
// styles.zindex.test.ts).
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const NGUON = fs.readFileSync(new URL("./QuoteEditor.tsx", import.meta.url), "utf8");

/** Khối JSDoc đứng LIỀN trước `mau` (chỉ cách khoảng trắng) — đúng khối TS gắn vào khai báo đó; null nếu không có. */
function jsdocLienTruoc(mau: string): string | null {
  const i = NGUON.indexOf(mau);
  if (i < 0) throw new Error("không thấy " + mau);
  const truoc = NGUON.slice(0, i).trimEnd();
  if (!truoc.endsWith("*/")) return null;
  return truoc.slice(truoc.lastIndexOf("/**"));
}

describe("đợt 5 — JSDoc của vanTayMain / boKhoaPhien nằm đúng chỗ", () => {
  it("khối app#11 đứng NGAY trên vanTayMain", () => {
    expect(jsdocLienTruoc("export const vanTayMain"), "vanTayMain mất chú thích app#11").toMatch(/app#11 — VÂN TAY PHẦN NGOÀI HÀ NỘI/);
  });

  it("boKhoaPhien mang khối đợt 4 của chính nó, và khối đó không đứng sau một khối JSDoc khác (mồ côi)", () => {
    const k = jsdocLienTruoc("const boKhoaPhien");
    expect(k).toMatch(/bỏ mọi khoá bắt đầu bằng '_'/);
    expect(k).not.toMatch(/app#11/);
    const i = NGUON.indexOf(k!);
    expect(NGUON.slice(0, i).trimEnd().endsWith("*/"), "còn một khối JSDoc mồ côi ngay trên khối đợt 4").toBe(false);
  });
});
