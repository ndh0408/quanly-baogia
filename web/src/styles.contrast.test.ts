// FE-06: tương phản chữ ↔ nền của các token trạng thái phải đạt WCAG AA 4.5:1 (chữ thường; nút
// 12.5–14px không phải "chữ lớn"). Đọc thẳng khối FE-06 trong styles.css — đổi màu ở đó mà tụt dưới
// ngưỡng là bài này đỏ.
import { describe, it, expect } from "vitest";
// KHÔNG dùng `?raw` như các bài đọc mã nguồn khác: vitest chặn mọi tệp .css (xử lý CSS tắt) nên
// `styles.css?raw` về chuỗi RỖNG — đo được. Đọc thẳng đĩa; import động bằng chuỗi ghép để tsc (types
// chỉ có vite/client, không có node) không đòi kiểu cho node:fs.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

const L = (h: string) => {
  const x = h.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const tuongPhan = (a: string, b: string) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const khoi = (() => {
  const a = css.indexOf("/* FE-06 BẮT ĐẦU"), b = css.indexOf("/* FE-06 HẾT */");
  return a >= 0 && b > a ? css.slice(a, b) : "";
})();
const bien = (selector: string) => {
  const i = khoi.indexOf(selector + " {");
  const than = i >= 0 ? khoi.slice(i, khoi.indexOf("}", i)) : "";
  return Object.fromEntries([...than.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
};
const nenNut = (cls: string) => new RegExp(`\\.${cls},[\\s\\S]*?background:\\s*(#[0-9a-fA-F]{6})`).exec(khoi)?.[1] ?? "";

// Nền thật của public/style.css (sáng: trắng + surface; tối: --surface #141821, --surface-2 #1a1f2a).
const NEN_SANG = ["#ffffff"], NEN_TOI = ["#141821", "#1a1f2a"];

describe("FE-06 — tương phản token trạng thái ≥ 4.5:1", () => {
  it("khối override tồn tại", () => expect(khoi).not.toBe(""));

  it("chữ --danger / --success / --warn trên nền sáng và nền tối", () => {
    const sang = bien(":root"), toi = bien('[data-theme="dark"]');
    for (const k of ["--danger", "--success", "--warn"]) {
      for (const n of NEN_SANG) expect(tuongPhan(sang[k], n), `${k} ${sang[k]} trên ${n}`).toBeGreaterThanOrEqual(4.5);
      for (const n of NEN_TOI) expect(tuongPhan(toi[k], n), `dark ${k} ${toi[k]} trên ${n}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("chữ lỗi trên nền khung lỗi (.err dùng --danger trên --danger-bg), cả hai chế độ", () => {
    const sang = bien(":root"), toi = bien('[data-theme="dark"]');
    expect(tuongPhan(sang["--danger"], sang["--danger-bg"])).toBeGreaterThanOrEqual(4.5);
    expect(tuongPhan(toi["--danger"], toi["--danger-bg"])).toBeGreaterThanOrEqual(4.5);
  });

  it("banner cảnh báo: chữ thường (#e8eaf0 ở dark, #1f2937 ở sáng) trên --warn-bg", () => {
    expect(tuongPhan("#e8eaf0", bien('[data-theme="dark"]')["--warn-bg"])).toBeGreaterThanOrEqual(4.5);
    expect(tuongPhan("#1f2937", bien(":root")["--warn-bg"])).toBeGreaterThanOrEqual(4.5);
  });

  it("chữ trắng trên nút danger / success / warn và toast thành công", () => {
    for (const c of ["btn-danger", "btn-success", "btn-warn"]) expect(tuongPhan("#ffffff", nenNut(c)), c).toBeGreaterThanOrEqual(4.5);
    const toast = /\.toast-success \{\s*background:\s*(#[0-9a-fA-F]{6})/.exec(khoi)?.[1] ?? "";
    expect(tuongPhan("#ffffff", toast)).toBeGreaterThanOrEqual(4.5);
  });
});
