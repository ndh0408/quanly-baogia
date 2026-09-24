// L76 (soát toàn diện): hộp "Nhập từ Excel" NHẢY khi bảng xem trước hiện ra (CLS 0,188 đo trên dev).
// .modal-backdrop căn giữa theo chiều dọc (grid place-items: center) nên khi phần giới thiệu + vùng kéo
// thả (~360px) được thay bằng bảng kế hoạch + xem trước (tới max-height 92vh), mép trên nhảy lên
// (cao mới − cao cũ)/2 — đo ở cửa sổ 950px: mép trên 297px → 38px, nút ✕ chạy theo.
// Bài này tính giá trị THẮNG CUỐI CÙNG khai cho đúng bộ chọn trong hai tệp CSS app nạp (public/style.css
// trước, styles.css sau): theo độ ưu tiên bộ chọn rồi thứ tự nạp; khối @media chỉ tính khi nêu cỡ cửa sổ.
import { describe, it, expect } from "vitest";
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const CSS = [
  fs.readFileSync(new URL("../../public/style.css", import.meta.url), "utf8"),
  fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8"),
].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

type Rule = { chon: string[]; media: string | null; khai: string; thuTu: number };
/** Tách rule theo cấp: rule CẤP ĐẦU (media = null) và rule nằm trong `@media …`. At-rule khác
 *  (@keyframes, @supports…) bỏ qua cả khối — khung trong @keyframes không phải bộ chọn. */
function tachRule(css: string): Rule[] {
  const out: Rule[] = [];
  let thuTu = 0;
  const khoi = (tu: number) => { let sau = 1, j = tu; for (; j < css.length && sau; j++) { if (css[j] === "{") sau++; else if (css[j] === "}") sau--; } return j; };
  const docRule = (tu: number, den: number, media: string | null) => {
    let k = tu;
    while (k < den) {
      const mo = css.indexOf("{", k);
      if (mo < 0 || mo >= den) break;
      const dau = css.slice(k, mo).trim();
      const dong = khoi(mo + 1);
      if (dau.startsWith("@media") && media == null) docRule(mo + 1, dong - 1, dau.slice(6).trim());
      else if (!dau.startsWith("@")) out.push({ chon: dau.split(",").map((x) => x.trim().replace(/\s+/g, " ")), media, khai: css.slice(mo + 1, dong - 1), thuTu: thuTu++ });
      k = dong;
    }
  };
  docRule(0, css.length, null);
  return out;
}
const RULES = tachRule(CSS);

/** Điều kiện @media có khớp cửa sổ rộng `w` không (chỉ max-width/min-width; điều kiện khác coi là không khớp). */
function khopMedia(q: string, w: number): boolean {
  const dk = [...q.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
  if (!dk.length) return false;
  return dk.every((d) => {
    const m = /^(max|min)-width:\s*([\d.]+)px$/.exec(d);
    if (!m) return false;
    return m[1] === "max" ? w <= +m[2] : w >= +m[2];
  });
}
const doUuTien = (chon: string) => (chon.match(/\.[\w-]+/g) || []).length;

/** Giá trị THẮNG CUỐI CÙNG của `prop` cho phần tử khớp các bộ chọn `chon` (cửa sổ rộng `w`; bỏ `w` =
 *  chỉ rule CẤP ĐẦU, đúng như chú thích cũ nói mà regex cũ không làm). */
function thang(chon: string[], prop: string, w?: number): string | null {
  let tot: { v: string; uu: number; thuTu: number } | null = null;
  for (const r of RULES) {
    if (r.media != null && (w == null || !khopMedia(r.media, w))) continue;
    const trung = r.chon.filter((c) => chon.includes(c));
    if (!trung.length) continue;
    const d = new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`).exec(r.khai);
    if (!d) continue;
    const quanTrong = /!important/.test(d[1]);
    const uu = Math.max(...trung.map(doUuTien)) + (quanTrong ? 1000 : 0);
    if (!tot || uu > tot.uu || (uu === tot.uu && r.thuTu > tot.thuTu)) tot = { v: d[1].replace(/!important/, "").trim(), uu, thuTu: r.thuTu };
  }
  return tot?.v ?? null;
}
const cuoi = (boChon: string, prop: string) => thang([boChon], prop);

describe("L76 — hộp Nhập từ Excel neo mép trên, không nhảy khi nội dung đổi cao", () => {
  it("hộp nhập Excel tự neo ở trên (align-self: start) — mép trên đứng yên, hộp chỉ dài xuống", () => {
    expect(cuoi(".modal.import-modal", "align-self")).toBe("start");
  });
  it("các hộp thoại khác KHÔNG đổi: nền mờ dùng chung vẫn căn giữa", () => {
    expect(cuoi(".modal-backdrop", "place-items")).toBe("center");
  });
  it("chỉ tính rule CẤP ĐẦU khi không nêu cỡ cửa sổ — rule trong @media không lọt vào", () => {
    // `.modal { max-height: 96vh }` chỉ nằm trong @media (max-width: 760px).
    expect(cuoi(".modal", "max-height")).toBe("92vh");
    expect(thang([".modal"], "max-height", 700)).toBe("96vh");
  });

  it("mép trên = đúng chỗ của hộp cỡ tối đa khi còn căn giữa (4vh) → lúc bảng hiện ra cũng không xê dịch", () => {
    // Nền mờ có padding 20px; hộp cao tối đa 92vh căn giữa thì mép trên = 20px + (100vh − 40px − 92vh)/2 = 4vh.
    expect(cuoi(".modal.import-modal", "margin-top")).toBe("max(0px, calc(4vh - 20px))");
  });
});
