// L74 (soát toàn diện): máy bật "giảm chuyển động" (Windows tắt Animation effects — hay gặp ở máy văn
// phòng / RDP) bấm đổi sáng/tối khi đang mở báo giá lớn thì khựng: INP 224–256 ms. public/style.css (đóng
// băng) đặt `* { transition-duration: 0.001ms !important }` trong @media (prefers-reduced-motion: reduce):
// transition-property mặc định là `all`, nên duration > 0 biến MỌI phần tử thành có transition — đổi chủ
// đề là mỗi thuộc tính đổi màu của hàng nghìn ô sinh transitionrun/start/end (đo trên #284: 9.676
// transitionrun mỗi lần, long task 163–260 ms; ép 0s thì 0 sự kiện, hết long task).
// Bài này tính giá trị THẮNG CUỐI CÙNG cho `*` trong các khối reduced-motion của đúng hai tệp CSS app nạp
// (public/style.css trước, styles.css sau — cùng độ ưu tiên, cùng !important thì bản sau thắng).
import { describe, it, expect } from "vitest";
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const CSS = [
  fs.readFileSync(new URL("../../public/style.css", import.meta.url), "utf8"),
  fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8"),
].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

/** Thân của mọi khối `@media (prefers-reduced-motion: reduce) { … }`, theo thứ tự nạp. */
function khoiGiamChuyenDong() {
  const out: string[] = [];
  const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS))) {
    let sau = 1, j = m.index + m[0].length;
    for (; j < CSS.length && sau; j++) { if (CSS[j] === "{") sau++; else if (CSS[j] === "}") sau--; }
    out.push(CSS.slice(m.index + m[0].length, j - 1));
  }
  return out;
}
const giay = (v: string) => { const m = /(-?[\d.]+)(ms|s)/.exec(v); return m ? Number(m[1]) / (m[2] === "ms" ? 1000 : 1) : 0; };

/** transition thắng cuối cùng cho phần tử bất kỳ (bộ chọn `*`) khi máy bật giảm chuyển động. */
function transitionCuoi() {
  const st = { property: "all", duration: "0s", delay: "0s" };
  for (const khoi of khoiGiamChuyenDong()) {
    for (const r of khoi.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!r[1].split(",").some((s) => s.trim() === "*")) continue;
      for (const d of r[2].matchAll(/(transition(?:-property|-duration|-delay)?)\s*:\s*([^;]+?)\s*!important/g)) {
        const v = d[2].trim();
        if (d[1] === "transition") {
          if (v === "none") Object.assign(st, { property: "none", duration: "0s", delay: "0s" });
          else { const t = v.match(/-?[\d.]+m?s/g) ?? []; Object.assign(st, { property: v.split(/\s/)[0], duration: t[0] ?? "0s", delay: t[1] ?? "0s" }); }
        } else st[d[1].replace("transition-", "") as "property" | "duration" | "delay"] = v;
      }
    }
  }
  return st;
}

describe("L74 — giảm chuyển động: KHÔNG sinh transition nào (đổi sáng/tối không còn hàng nghìn sự kiện)", () => {
  it("có khối reduced-motion", () => expect(khoiGiamChuyenDong().length).toBeGreaterThan(0));

  it("transition thắng cuối cùng cho `*`: property none, hoặc duration + delay = 0 (spec: tổng > 0 mới tạo transition)", () => {
    const t = transitionCuoi();
    const khongTao = t.property === "none" || giay(t.duration) + Math.max(0, giay(t.delay)) <= 0;
    expect(khongTao, `transition cuối: ${JSON.stringify(t)}`).toBe(true);
  });

  it("animation vẫn rút ngắn như cũ (khối gốc giữ nguyên — không tắt nhầm phần đó)", () => {
    expect(khoiGiamChuyenDong().join("\n")).toMatch(/animation-duration:\s*0\.001ms\s*!important/);
  });
});
