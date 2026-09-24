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

// ── CHỮ GỢI Ý (placeholder) CHẾ ĐỘ SÁNG (soát toàn diện đợt 3 2d) ─────────────────────────────────
// Chế độ tối đã được nâng ở L67; chế độ sáng thì còn hai chỗ dưới ngưỡng: ô công thức #fx-input
// (#aab2bd của public/style.css — ĐÓNG BĂNG, nên đè ở styles.css) chỉ 2,14:1 trên nền trắng, và chữ
// gợi ý hàng nhóm / nhóm con ("Tên nhóm (vd: Wallsticker)", "Ghi chú nhóm"…) là #757575 mặc định của
// Chrome trên nền màu của hàng: 3,05–3,89:1. Giá trị THẮNG CUỐI CÙNG đọc từ cả hai tệp CSS app nạp
// (public/style.css trước, styles.css sau), rule cấp đầu, đúng bộ chọn.
const goc = fs.readFileSync(new URL("../../public/style.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Rule CẤP ĐẦU của hai tệp theo thứ tự nạp — mọi at-rule (@media, @keyframes…) bỏ qua cả khối. */
const ruleCapDau = (() => {
  const t = goc + "\n" + css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { chon: string[]; than: string }[] = [];
  for (let k = 0; k < t.length;) {
    const mo = t.indexOf("{", k);
    if (mo < 0) break;
    let sau = 1, j = mo + 1;
    for (; j < t.length && sau; j++) { if (t[j] === "{") sau++; else if (t[j] === "}") sau--; }
    const dau = t.slice(k, mo).trim();
    // Tách danh sách bộ chọn ở dấu phẩy CẤP NGOÀI — dấu phẩy trong `:is(input, textarea)` không tách.
    if (!dau.startsWith("@")) out.push({ chon: dau.split(/,(?![^()]*\))/).map((x) => x.trim().replace(/\s+/g, " ")), than: t.slice(mo + 1, j - 1) });
    k = j;
  }
  return out;
})();
const hex6 = (h: string) => (/^#[0-9a-fA-F]{3}$/.test(h) ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h);
/** Giá trị cuối cùng của `prop` khai cho ĐÚNG bộ chọn `chon` ở rule cấp đầu (cùng độ ưu tiên → bản nạp sau thắng). */
const giaTri = (chon: string, prop: string): string | null => {
  let v: string | null = null;
  for (const r of ruleCapDau) {
    if (!r.chon.includes(chon)) continue;
    const d = new RegExp("(?:^|[;\\s])" + prop + ":\\s*([^;]+)").exec(r.than);
    if (d) v = hex6(d[1].trim());
  }
  return v;
};
/** var(--x) → giá trị token SÁNG trong khối `:root {…}` đầu tiên của public/style.css. */
const giaiBien = (v: string) => {
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  if (!m) return v;
  const root = ruleCapDau.find((r) => r.chon.length === 1 && r.chon[0] === ":root")?.than ?? "";
  return new RegExp(m[1] + ":\\s*(#[0-9a-fA-F]{6})").exec(root)?.[1] ?? v;
};
const MAC_DINH_CHROME = "#757575";   // chữ gợi ý mặc định của Chrome (đo headless — xem styles.placeholderToi.test.ts)

describe("Chữ gợi ý chế độ SÁNG ≥ 4.5:1", () => {
  it("ô công thức #fx-input: trên nền trắng, nền lúc focus và nền chỉ-đọc — và vẫn nhạt hơn chữ thật", () => {
    const ph = giaiBien(giaTri("#fx-input::placeholder", "color") ?? MAC_DINH_CHROME);
    const chu = giaTri("#fx-input", "color") ?? "#111111";
    const nen = { "nền": giaTri("#fx-input", "background") ?? "#ffffff", "focus": giaTri("#fx-input:focus", "background") ?? "", "chỉ đọc": giaTri("#fx-input[readonly]", "background") ?? "" };
    for (const [ten, n] of Object.entries(nen)) {
      expect(n, `không đọc được nền ${ten}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(tuongPhan(ph, n), `gợi ý ${ph} trên nền ${ten} ${n}`).toBeGreaterThanOrEqual(4.5);
      expect(tuongPhan(ph, n), "gợi ý phải nhạt hơn chữ thật").toBeLessThan(tuongPhan(chu, n));
    }
  });

  // [tên, nền hàng, màu chữ hàng, bộ chọn placeholder]
  const HANG: [string, string, string, string][] = [
    ["GN nhóm", ".excel-table tr.section-row td", ".excel-table tr.section-row input", ".excel-table tr.section-row:not(.subgroup-row) td :is(input, textarea)::placeholder"],
    ["GN nhóm con", ".excel-table tr.subgroup-row td", ".excel-table tr.subgroup-row input", ".excel-table tr.subgroup-row td :is(input, textarea)::placeholder"],
    ["Colorfull nhóm", ".excel-table.clf-theme tr.section-row td", ".excel-table.clf-theme tr.section-row input", ".excel-table.clf-theme tr.section-row:not(.subgroup-row) td :is(input, textarea)::placeholder"],
    ["Colorfull nhóm con", ".excel-table.clf-theme tr.subgroup-row td", ".excel-table.clf-theme tr.subgroup-row input", ".excel-table.clf-theme tr.subgroup-row td :is(input, textarea)::placeholder"],
  ];
  for (const [ten, chonNen, chonChu, chonPh] of HANG) {
    it(`${ten}: gợi ý ≥ 4.5:1 trên nền hàng, vẫn xám trung tính như mặc định, không đậm hơn chữ thật`, () => {
      const nen = giaTri(chonNen, "background") ?? "", chu = giaTri(chonChu, "color") ?? "";
      const ph = giaTri(chonPh, "color") ?? MAC_DINH_CHROME;
      expect(nen).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(chu).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(tuongPhan(ph, nen), `gợi ý ${ph} trên nền ${nen}`).toBeGreaterThanOrEqual(4.5);
      // Không lệch tông: vẫn là xám trung tính (R = G = B) như #757575 của trình duyệt — khác hẳn sắc
      // của chữ thật (nâu / xanh / đỏ gạch / rêu), nên không lẫn với tên nhóm đã gõ.
      const [r, g, b] = [1, 3, 5].map((i) => ph.slice(i, i + 2));
      expect(r === g && g === b, `${ph} không phải xám trung tính`).toBe(true);
      // Hàng nhóm GN có chữ thật chỉ 4,57:1 — không thể vừa ≥ 4,5 vừa nhạt hơn hẳn; cho phép sát ngang.
      expect(tuongPhan(ph, nen), "gợi ý đậm hơn chữ thật").toBeLessThanOrEqual(tuongPhan(chu, nen) + 0.1);
      // Firefox mặc định làm mờ placeholder 0.54 — cộng dồn là tụt dưới ngưỡng.
      expect(giaTri(chonPh, "opacity")).toBe("1");
    });
  }
});
