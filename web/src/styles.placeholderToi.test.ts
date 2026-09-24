// L67 (soát toàn diện): chế độ tối, CHỮ GỢI Ý (placeholder) của gần như mọi ô trong app — ô tìm ở thanh
// công cụ các trang danh sách, ô trong hộp thoại, phần đầu báo giá, "(không xuất Excel)" ở hàng thường…
// — vẫn là #757575 mặc định của trình duyệt (Chrome KHÔNG đổi màu này theo color-scheme — đo bằng Chrome
// headless): 3.58:1 trên --surface-2, 3.85:1 trên --surface, 3.92:1 trên --field-bg. Cả CSS chỉ có luật
// placeholder riêng cho #fx-input, ô tìm thanh bên và hàng nhóm tối.
// Bài này đọc thẳng hai tệp CSS app nạp (cách đọc như styles.contrast.test.ts: vitest chặn .css nên
// `?raw` về chuỗi rỗng).
import { describe, it, expect } from "vitest";
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const boChu = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const css = boChu(fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8"));
const goc = boChu(fs.readFileSync(new URL("../../public/style.css", import.meta.url), "utf8"));

const L = (h: string) => {
  const c = [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const tuongPhan = (a: string, b: string) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** Giá trị token trong khối `[data-theme="dark"] {…}` (public/style.css) hoặc `:root[data-theme="dark"] {…}`. */
const tokenToi = (nguon: string, ten: string) => {
  for (const m of nguon.matchAll(/(?:^|\})\s*(?::root)?\[data-theme="dark"\]\s*\{([^{}]*)\}/g)) {
    const v = new RegExp(`${ten}:\\s*(#[0-9a-fA-F]{6})`).exec(m[1])?.[1];
    if (v) return v;
  }
  return "";
};

const luat = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, " "), than: m[2] }));

describe("L67 — chữ gợi ý chế độ tối đọc được trên mọi nền tối", () => {
  it("có luật placeholder CHUNG cho chế độ tối, độ ưu tiên thấp nhất (luật riêng như #fx-input, hàng nhóm vẫn thắng)", () => {
    const chung = luat.find((l) => l.sel === ':where(:root[data-theme="dark"]) ::placeholder');
    expect(chung, "thiếu luật `:where(:root[data-theme=\"dark\"]) ::placeholder`").toBeTruthy();
    expect(chung!.than).toMatch(/color:\s*var\(--text-muted\)/);
    // Firefox mặc định làm mờ placeholder 0.54 — cộng dồn là tụt dưới ngưỡng.
    expect(chung!.than).toMatch(/opacity:\s*1/);
  });

  it("--text-muted tối ≥ 4.5:1 trên --bg / --surface / --surface-2 / --field-bg tối, và nhạt hơn chữ thường", () => {
    const muted = tokenToi(goc, "--text-muted"), text = tokenToi(goc, "--text");
    const nen = { "--bg": tokenToi(goc, "--bg"), "--surface": tokenToi(goc, "--surface"), "--surface-2": tokenToi(goc, "--surface-2"), "--field-bg": tokenToi(css, "--field-bg") };
    expect(muted).not.toBe("");
    for (const [ten, n] of Object.entries(nen)) {
      expect(n, `không đọc được token ${ten}`).not.toBe("");
      expect(tuongPhan(muted, n), `${muted} trên ${ten} ${n}`).toBeGreaterThanOrEqual(4.5);
      expect(tuongPhan(muted, n), "gợi ý phải nhạt hơn chữ thật").toBeLessThan(tuongPhan(text, n));
    }
  });

  it("chỉ áp chế độ tối: #9aa3b3 trên nền trắng chỉ 2.5:1 — không có luật placeholder chung nào ngoài dark", () => {
    const chungNgoaiToi = luat.filter((l) => /^(?::where\([^)]*\) )?::placeholder$/.test(l.sel) && !l.sel.includes('data-theme="dark"'));
    expect(chungNgoaiToi).toEqual([]);
  });
});
