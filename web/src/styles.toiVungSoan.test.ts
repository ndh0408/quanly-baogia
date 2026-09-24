// CHẾ ĐỘ TỐI CỦA VÙNG SOẠN BÁO GIÁ — người dùng báo 2026-09-23: "lỗi chuyển sáng tối nhiều chỗ",
// "sáng tối chỉ trên web thôi đâu liên quan gì đến excel", "nhìn tối mắt phải dễ chịu".
// Đo trên dev trước khi sửa: chữ ô nhập #e8eaf0 trên giấy trắng 1.2:1; dòng bảng "Tổng báo giá"
// #1b2034 trên #1a1f2a 1.02:1. Bài này đọc thẳng khối "CHẾ ĐỘ TỐI CHO VÙNG SOẠN" trong styles.css:
// đổi một màu ở đó mà tụt dưới 4.5:1 (WCAG AA, chữ thường) là đỏ. Cách đọc tệp giống
// styles.contrast.test.ts (vitest chặn .css nên `?raw` về chuỗi rỗng).
import { describe, it, expect } from "vitest";
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const editor = fs.readFileSync(new URL("./pages/QuoteEditor.tsx", import.meta.url), "utf8");

const khoi = (() => {
  const a = css.indexOf("/* ══ CHẾ ĐỘ TỐI CHO VÙNG SOẠN BÁO GIÁ");
  return a >= 0 ? css.slice(a) : "";
})();

const hex = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
const L = (h: string) => {
  const c = hex(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const tuongPhan = (a: string, b: string) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** color-mix(in srgb, <mau> p%, <nen>) — đúng phép pha của trình duyệt. */
const pha = (mau: string, p: number, nen: string) => {
  const a = hex(mau), b = hex(nen);
  return "#" + a.map((v, i) => Math.round(v * p + b[i] * (1 - p)).toString(16).padStart(2, "0")).join("");
};

const SURFACE = "#141821";   // --surface dark (public/style.css)
const SURFACE_2 = "#1a1f2a"; // --surface-2 dark

/** Lấy mọi cặp (--X-nen: color-mix(… mau p% …), --X-chu: #…) cùng một luật trong khối. */
function capMau(tenNen: string, tenChu: string) {
  const re = new RegExp(`\\{([^{}]*${tenNen}:\\s*color-mix\\(in srgb, (#[0-9a-fA-F]{6}) (\\d+)%, var\\(--surface\\)\\)[^{}]*)\\}`, "g");
  const out: { mau: string; p: number; chu: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(khoi))) {
    const chu = new RegExp(`${tenChu}:\\s*(#[0-9a-fA-F]{6})`).exec(m[1])?.[1] ?? "";
    out.push({ mau: m[2], p: Number(m[3]) / 100, chu });
  }
  return out;
}

describe("Chế độ tối của vùng soạn báo giá — đọc được và dịu mắt", () => {
  it("khối CSS tồn tại", () => expect(khoi).not.toBe(""));

  it("ô nhập gốc của trình duyệt theo NÚT sáng/tối của app (color-scheme), không theo Windows", () => {
    expect(khoi).toMatch(/:root\[data-theme="dark"\] \{[^}]*color-scheme: dark/);
    expect(khoi).toMatch(/:root\[data-theme="light"\] \{[^}]*color-scheme: light/);
  });

  it("khung soạn + thanh công thức không còn giấy trắng ở dark", () => {
    expect(khoi).toMatch(/:root\[data-theme="dark"\] \.editor \{[^}]*background: var\(--surface\)/);
    expect(khoi).toMatch(/:root\[data-theme="dark"\] #fx-input \{[^}]*background: var\(--surface\)/);
    expect(khoi).toMatch(/:root\[data-theme="dark"\] \.summary-table \{[^}]*color: var\(--text\)/);
  });

  it("hàng nhóm / nhóm con (GN + Colorfull): chữ trên bản TỐI của màu mẫu ≥ 4.5:1", () => {
    const cap = capMau("--nen", "--chu");
    expect(cap.length, "phải có đủ 4 cặp: GN nhóm, GN nhóm con, CLF nhóm, CLF nhóm con").toBe(4);
    for (const { mau, p, chu } of cap) {
      const nen = pha(mau, p, SURFACE);
      expect(tuongPhan(chu, nen), `chữ ${chu} trên ${mau} ${p * 100}% → ${nen}`).toBeGreaterThanOrEqual(4.5);
      // "Dịu mắt": nền phải còn TỐI (không để lại dải sáng chói giữa nền tối).
      expect(L(nen), `nền ${nen} quá sáng cho dark mode`).toBeLessThan(0.08);
    }
  });

  // L66 (soát toàn diện): bài trên chỉ kiểm cặp --nen/--chu nên bỏ lọt chữ gợi ý — pha 55% đo trên dev
  // chỉ 2.32–3.08:1 ("Ghi chú nhóm", "(không xuất Excel)", "Tên nhóm (vd: Wallsticker)" chìm vào nền).
  it("chữ gợi ý (placeholder) trên hàng nhóm / nhóm con ≥ 4.5:1 trên ĐÚNG nền của hàng, vẫn nhạt hơn chữ thật", () => {
    const m = /tr\.section-row:not\(#nhom-toi\) td :is\(input, textarea\)::placeholder \{[^}]*color: color-mix\(in srgb, var\(--chu\) (\d+)%, var\(--surface\)\)/.exec(khoi);
    expect(m, "phải còn luật placeholder riêng của hàng nhóm tối").toBeTruthy();
    const pGoiY = Number(m![1]) / 100;
    const cap = capMau("--nen", "--chu");
    expect(cap.length).toBe(4);
    for (const { mau, p, chu } of cap) {
      const nen = pha(mau, p, SURFACE), goiY = pha(chu, pGoiY, SURFACE);
      expect(tuongPhan(goiY, nen), `gợi ý ${goiY} trên ${nen}`).toBeGreaterThanOrEqual(4.5);
      expect(tuongPhan(goiY, nen), "gợi ý phải nhạt hơn chữ thật để còn phân biệt").toBeLessThan(tuongPhan(chu, nen));
    }
  });

  it("tiêu đề cột (GN + Colorfull) và dòng tổng của bảng Tổng báo giá ≥ 4.5:1, nền vẫn tối", () => {
    const cap = [...capMau("--tieu-de-nen", "--tieu-de-chu"), ...capMau("--tong-nen", "--tong-chu")];
    expect(cap.length).toBe(4);
    for (const { mau, p, chu } of cap) {
      const nen = pha(mau, p, SURFACE);
      expect(tuongPhan(chu, nen), `chữ ${chu} trên ${nen}`).toBeGreaterThanOrEqual(4.5);
      expect(L(nen)).toBeLessThan(0.08);
    }
  });

  it("chữ hạng mục / STT (xanh) và ghi chú nội bộ trên nền tối ≥ 4.5:1", () => {
    const xanh = /td:is\(\.col-stt, \.col-hangmuc\) :is\(input, textarea\) \{\s*color: (#[0-9a-fA-F]{6})/.exec(khoi)?.[1] ?? "";
    const noiBo = /td\.col-internal-note textarea \{\s*color: (#[0-9a-fA-F]{6})/.exec(khoi)?.[1] ?? "";
    for (const [ten, c] of [["hạng mục", xanh], ["ghi chú nội bộ", noiBo]] as const) {
      for (const n of [SURFACE, SURFACE_2]) expect(tuongPhan(c, n), `${ten} ${c} trên ${n}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("công thức hiện trong ô khi bấm đúp (--fx-cell) đọc được trên MỌI nền, cả hai chế độ", () => {
    const sang = /:root \{\s*--fx-cell: (#[0-9a-fA-F]{6})/.exec(khoi)?.[1] ?? "";
    const toi = /:root\[data-theme="dark"\] \{\s*--fx-cell: (#[0-9a-fA-F]{6})/.exec(khoi)?.[1] ?? "";
    expect(khoi).toMatch(/\[data-fx-shown\] \{\s*color: var\(--fx-cell\) !important/);
    // Sáng: giấy trắng + nền nhóm/nhóm con của GN và Colorfull (màu in, khớp Excel).
    for (const n of ["#ffffff", "#fae9db", "#c9d9ef", "#f4cfb0", "#cad8aa"]) expect(tuongPhan(sang, n), `sáng ${sang} trên ${n}`).toBeGreaterThanOrEqual(4.5);
    // Tối: nền thường + bản tối của mọi màu nhóm.
    const nenToi = [SURFACE, ...capMau("--nen", "--chu").map(({ mau, p }) => pha(mau, p, SURFACE))];
    for (const n of nenToi) expect(tuongPhan(toi, n), `tối ${toi} trên ${n}`).toBeGreaterThanOrEqual(4.5);
  });

  it("số đỏ 'Thành tiền' trên dòng tổng tối, và nút ✕ khi rê chuột ≥ 4.5:1", () => {
    const do_ = /\.summary-table tfoot \.summary-formula-value\.danger \{\s*color: (#[0-9a-fA-F]{6})/.exec(khoi)?.[1] ?? "";
    for (const { mau, p } of capMau("--tong-nen", "--tong-chu")) {
      const nen = pha(mau, p, SURFACE);
      expect(tuongPhan(do_, nen), `${do_} trên ${nen}`).toBeGreaterThanOrEqual(4.5);
    }
    const hover = /button\.rm-row:hover \{\s*background: (#[0-9a-fA-F]{6});\s*[^}]*color: (#[0-9a-fA-F]{6})/.exec(khoi);
    expect(hover, "phải có luật hover riêng cho nút ✕ ở dark").toBeTruthy();
    expect(tuongPhan(hover![2], hover![1])).toBeGreaterThanOrEqual(4.5);
  });

  it("bảng Tổng báo giá của Colorfull ở bản SÁNG = F4CFB0 (khớp sheet 'Tổng Báo Giá' của tệp Excel)", () => {
    expect(khoi).toMatch(/\.summary-table\.clf-theme thead th,\s*\.summary-table\.clf-theme tfoot td \{\s*background: #f4cfb0/);
    // và màn soạn thật sự gắn lớp đó khi báo giá có sheet Colorfull (cùng quy tắc với src/excel.ts `isClf`)
    expect(editor).toMatch(/className=\{`summary-table\$\{sheets\.some\([^`]*startsWith\("clofull"\)[^`]*" clf-theme"/);
  });
});
