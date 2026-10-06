/** @vitest-environment jsdom */
//
// Ô "Hiện Thành Tiền nhóm" BỊ KHOÁ Ở TRẠNG THÁI BẬT (GridTable: còn nhóm SL > 1 thì ô tự bật rồi khoá) phải NHÌN RA
// là "đã tích + khoá". Trình duyệt vẽ ô `checked:disabled` mặc định bằng nền xám nhạt + dấu tích trắng: ở giao diện sáng
// gần như tàng hình, không phân biệt được với ô tắt — người dùng tưởng ô chưa tích, mà ô lại không bấm được.
//
// Bài này tự giải CASCADE của đúng hai tệp CSS app nạp (public/style.css trước, styles.css sau) cho một ô dựng trong jsdom:
// luật nào khớp (Element.matches), độ ưu tiên, thứ tự — rồi hỏi màu nền / viền / độ đục / kiểu vẽ THẮNG CUỐI CÙNG, và đo
// tương phản (WCAG 1.4.11: thành phần giao diện ≥ 3:1; dấu tích trên nền ô ≥ 4.5:1). Đo nền TRANG thật: sáng #ffffff /
// #f5f6f8, tối #141821 / #1a1f2a. Bản cascade rút gọn của styles.vungChonNhom.test.ts (bỏ qua @media — luật của ô này không nằm trong @media).
import { describe, it, expect } from "vitest";

// jsdom thay `URL` toàn cục → ghép chuỗi rồi để node:url đổi sang đường dẫn (xem styles.oTranToi.test.tsx).
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: string, e: string) => string };
const nurl = (await import(/* @vite-ignore */ ["node", "url"].join(":"))) as { fileURLToPath: (u: string) => string };
const doc = (tuongDoi: string) => fs.readFileSync(nurl.fileURLToPath(import.meta.url.replace(/[^/]*$/, "") + tuongDoi), "utf8");
const LUAT = (doc("../../public/style.css") + "\n" + doc("./styles.css"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
  .match(/[^{}]+\{[^{}]*\}/g)!
  .map((r, thuTu) => { const i = r.indexOf("{"); return { ds: r.slice(0, i).trim(), than: r.slice(i + 1, -1), thuTu }; });

type DH = [number, number, number];
const soSanh = (x: DH, y: DH) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
/** Độ ưu tiên của MỘT bộ chọn phức (đủ cho CSS repo này: :is/:not/:where/:has lồng một tầng). */
function doUuTien(sel: string): DH {
  const d: DH = [0, 0, 0];
  let s = sel.replace(/::[\w-]+/g, () => { d[2]++; return ""; });
  s = s.replace(/:(is|not|where|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_, fn: string, args: string) => {
    if (fn !== "where") { const m = tachDs(args).map(doUuTien).sort(soSanh).pop()!; d[0] += m[0]; d[1] += m[1]; d[2] += m[2]; }
    return " ";
  });
  s = s.replace(/\[[^\]]*\]/g, () => { d[1]++; return ""; });
  s = s.replace(/#[\w-]+/g, () => { d[0]++; return ""; });
  s = s.replace(/[.:][\w-]+/g, () => { d[1]++; return ""; });
  d[2] += (s.match(/(?:^|[\s>+~(])[a-zA-Z][\w-]*/g) || []).length;
  return d;
}
function tachDs(ds: string) {
  const out: string[] = []; let sau = 0, cur = "";
  for (const ch of ds) { if (ch === "(") sau++; if (ch === ")") sau--; if (ch === "," && !sau) { out.push(cur.trim()); cur = ""; } else cur += ch; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Giá trị THẮNG CUỐI CÙNG của một thuộc tính cho phần tử. `background` viết tắt chỉ tính là `background-color` khi
 *  không mang ảnh / gradient (đủ cho CSS repo này). */
function thang(el: Element, prop: string): string | null {
  const ung: { v: string; dh: DH; thuTu: number; qt: boolean }[] = [];
  const coThuocTinh = new RegExp(String.raw`(?<![\w-])${prop}\s*:`);
  const layHet = new RegExp(String.raw`(?<![\w-])${prop}\s*:\s*([^;]+)`, "g");
  const tatBg = prop === "background-color";
  const coTatBg = /(?<![\w-])background\s*:/;
  const layTatBg = /(?<![\w-])background\s*:\s*([^;]+)/g;
  for (const l of LUAT) {
    if (!l.ds || !(coThuocTinh.test(l.than) || (tatBg && coTatBg.test(l.than)))) continue;
    const khop = tachDs(l.ds).filter((s) => !s.includes("::") && (() => { try { return el.matches(s); } catch { return false; } })());
    if (!khop.length) continue;
    const dh = khop.map(doUuTien).sort(soSanh).pop()!;
    const them = (v: string) => ung.push({ v: v.trim().replace(/\s*!important/, ""), dh, thuTu: l.thuTu, qt: /!important/.test(v) });
    for (const m of l.than.matchAll(layHet)) them(m[1]);
    if (tatBg) for (const m of l.than.matchAll(layTatBg)) if (!/gradient\(|url\(/.test(m[1])) them(m[1]);
  }
  return ung.sort((x, y) => Number(x.qt) - Number(y.qt) || soSanh(x.dh, y.dh) || x.thuTu - y.thuTu).pop()?.v ?? null;
}

const L = (h: string) => {
  const x = h.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const tuongPhan = (a: string, b: string) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Dựng nhãn + ô tích giống hệt GridTable: `khoa` = có lớp `gf-group-sub-khoa`; ô luôn `checked`, `disabled` khi khoá. */
function dung(theme: "light" | "dark", trangThai: "khoa" | "bat-tu-do" | "tat") {
  document.documentElement.setAttribute("data-theme", theme);
  const khoa = trangThai === "khoa";
  document.body.innerHTML = `<div class="editor"><label class="toggle-totals gf-group-sub${khoa ? " gf-group-sub-khoa" : ""}">
    <input type="checkbox" id="o"${trangThai === "tat" ? "" : " checked"}${khoa ? " disabled" : ""}><span>Hiện <strong>Thành Tiền nhóm</strong></span></label></div>`;
  return document.getElementById("o") as HTMLInputElement;
}

// Nền trang thật sau ô: sáng — paper trắng và --bg; tối — --surface và --surface-2 (styles.contrast.test.ts đo cùng bộ nền).
const NEN = { light: ["#ffffff", "#f5f6f8"], dark: ["#141821", "#1a1f2a"] } as const;
// Nền của ô TẮT / ô bị khoá kiểu mặc định (--field-disabled): ô "đã tích + khoá" không được giống nó.
const NEN_O_TAT = { light: "#f5f6f9", dark: "#161b27" } as const;

/** Màu nét của dấu tích, đọc lại từ ảnh SVG nhúng trong `background-image` của luật (phần tử PHẢI còn nằm trong document). */
function mauTich(el: Element) {
  const anh = thang(el, "background-image") ?? "";
  return decodeURIComponent(/stroke='([^']+)'/.exec(anh)?.[1] ?? "");
}

describe("ô Thành Tiền nhóm khoá ở trạng thái bật: nhìn ra 'ĐÃ TÍCH + khoá', cả hai giao diện", () => {
  it("đọc được luật của hai tệp", () => expect(LUAT.length).toBeGreaterThan(500));

  it("styles.css không lẫn ký tự điều khiển (một lần ghi tệp từng nuốt chuỗi thoát CSS thành U+0001 — CSS vẫn 'hợp lệ' mà chữ hỏng)", () => {
    const hong = [...doc("./styles.css")].filter((c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)));
    expect(hong.map((c) => c.charCodeAt(0))).toEqual([]);
  });

  for (const theme of ["light", "dark"] as const) {
    describe(theme === "light" ? "giao diện SÁNG" : "giao diện TỐI", () => {
      it("tự vẽ (appearance: none) — không để trình duyệt vẽ ô xám nhạt", () => {
        const o = dung(theme, "khoa");
        expect(thang(o, "appearance")).toBe("none");
      });

      it("KHÔNG giảm độ đục (mặc định của ô khoá là mờ)", () => {
        const o = dung(theme, "khoa");
        expect(thang(o, "opacity")).toBe("1");
      });

      it("nền ô đặc, tương phản với nền TRANG ≥ 7:1 (WCAG 1.4.11 chỉ đòi 3:1 — đây là chốt 'không được nhạt')", () => {
        const o = dung(theme, "khoa");
        const nen = thang(o, "background-color") ?? "";
        expect(nen, "nền ô phải là màu hex cụ thể").toMatch(HEX);
        for (const trang of NEN[theme]) expect(tuongPhan(nen, trang), `${nen} trên nền trang ${trang}`).toBeGreaterThanOrEqual(7);
      });

      it("viền cùng màu nền (ô nhìn thành một khối đặc) và cũng ≥ 3:1 trên nền trang", () => {
        const o = dung(theme, "khoa");
        const vien = (thang(o, "border-color") ?? "").toLowerCase();
        expect(vien, "viền phải là màu hex cụ thể").toMatch(HEX);
        expect(vien).toBe((thang(o, "background-color") ?? "").toLowerCase());
        for (const trang of NEN[theme]) expect(tuongPhan(vien, trang)).toBeGreaterThanOrEqual(3);
      });

      it("dấu tích rõ trên nền ô ≥ 4,5:1", () => {
        const o = dung(theme, "khoa");
        const tich = mauTich(o);
        expect(tich, "không đọc được màu nét dấu tích trong ảnh SVG").toMatch(HEX);
        expect(tuongPhan(tich, thang(o, "background-color") ?? "")).toBeGreaterThanOrEqual(4.5);
      });

      it("không giống ô TẮT: nền ô khoá tương phản ≥ 7:1 với nền ô tắt mặc định (--field-disabled)", () => {
        const o = dung(theme, "khoa");
        expect(tuongPhan(thang(o, "background-color") ?? "", NEN_O_TAT[theme])).toBeGreaterThanOrEqual(7);
      });

      it("con trỏ 'không được phép' và ô đủ lớn để thấy (≥ 14px)", () => {
        const o = dung(theme, "khoa");
        expect(thang(o, "cursor")).toBe("not-allowed");
        expect(parseInt(thang(o, "width") ?? "0", 10)).toBeGreaterThanOrEqual(14);
        expect(parseInt(thang(o, "height") ?? "0", 10)).toBeGreaterThanOrEqual(14);
      });

      it("luật CHỈ bắt ô đã khoá: ô bật-mở-khoá và ô tắt không dính kiểu riêng", () => {
        const khoa = thang(dung(theme, "khoa"), "background-color");
        expect(thang(dung(theme, "bat-tu-do"), "appearance"), "ô bật nhưng chưa khoá vẫn theo kiểu mặc định của trình duyệt").not.toBe("none");
        expect(thang(dung(theme, "bat-tu-do"), "background-color")).not.toBe(khoa);
        expect(thang(dung(theme, "tat"), "appearance")).not.toBe("none");
      });
    });
  }

  it("hai giao diện dùng HAI bộ màu khác nhau (sáng: nền tối + tích sáng; tối: nền sáng + tích tối) — không dùng chung một màu", () => {
    const sang = thang(dung("light", "khoa"), "background-color") ?? "";
    const toi = thang(dung("dark", "khoa"), "background-color") ?? "";
    expect(L(sang), "sáng: nền ô phải TỐI").toBeLessThan(0.2);
    expect(L(toi), "tối: nền ô phải SÁNG").toBeGreaterThan(0.5);
    expect(L(mauTich(dung("light", "khoa"))), "sáng: tích SÁNG").toBeGreaterThan(0.5);
    expect(L(mauTich(dung("dark", "khoa"))), "tối: tích TỐI").toBeLessThan(0.2);
  });
});
