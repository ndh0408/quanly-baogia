/** @vitest-environment jsdom */
//
// SOÁT GIAO DIỆN 2026-11-25 (chủ repo: "xem còn chỗ nào lỗi css hay hiển thị chưa đẹp… fix giúp tôi luôn"). Đo bằng Chromium thật ở
// 1280×720 / 1366×768 / 1920×1080 / 390×844, sáng + tối; mỗi bài dưới đây khoá đúng LUẬT đã sửa, kèm số đo vì sao. jsdom không dàn
// trang nên chỗ nào cần hình học thì bài kiểm cấu trúc luật; riêng NỀN ô nới thì tự giải cascade như styles.oKhoaNhom.test.ts.
import { describe, it, expect, afterEach } from "vitest";

// jsdom thay `URL` toàn cục → ghép chuỗi rồi để node:url đổi sang đường dẫn (xem styles.oTranToi.test.tsx).
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: string, e: string) => string };
const nurl = (await import(/* @vite-ignore */ ["node", "url"].join(":"))) as { fileURLToPath: (u: string) => string };
const doc = (tuongDoi: string) => fs.readFileSync(nurl.fileURLToPath(import.meta.url.replace(/[^/]*$/, "") + tuongDoi), "utf8");
const STYLES = doc("./styles.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** Vị trí `}` đóng khối mở ở `mo` (có tính khối lồng). */
function dong(css: string, mo: number): number {
  let d = 0;
  for (let j = mo; j < css.length; j++) {
    if (css[j] === "{") d++;
    else if (css[j] === "}" && --d === 0) return j;
  }
  return css.length;
}
/** Các khối CẤP ĐẦU của styles.css: đầu khối (bộ chọn / "@media …") + ruột. */
const KHOI: { dau: string; ruot: string }[] = [];
for (let i = 0, batDau = 0; i < STYLES.length; i++) {
  if (STYLES[i] !== "{") continue;
  const het = dong(STYLES, i);
  KHOI.push({ dau: STYLES.slice(batDau, i).trim().replace(/\s+/g, " "), ruot: STYLES.slice(i + 1, het) });
  i = het;
  batDau = het + 1;
}
/** Ruột gộp các luật CẤP ĐẦU (ngoài @media) mà danh sách bộ chọn có đúng `chon`. */
const luat = (chon: string) => KHOI.filter((k) => !k.dau.startsWith("@") && k.dau.split(",").map((s) => s.trim()).includes(chon)).map((k) => k.ruot).join(";");
/** Ruột gộp mọi khối `@media <dieuKien>`. */
const khoiMedia = (dieuKien: string) => KHOI.filter((k) => k.dau === `@media ${dieuKien}`).map((k) => k.ruot).join("\n");

// ── Cascade rút gọn (bỏ @media — các luật nền của ô lưới đều ở cấp đầu) ───────────────────────────────────────────────────────
const boMedia = (css: string) => {
  let out = "";
  for (let i = 0; i < css.length; ) {
    const m = css.indexOf("@media", i);
    if (m < 0) { out += css.slice(i); break; }
    out += css.slice(i, m);
    i = dong(css, css.indexOf("{", m)) + 1;
  }
  return out;
};
const LUAT = boMedia((doc("../../public/style.css") + "\n" + doc("./styles.css")).replace(/\/\*[\s\S]*?\*\//g, ""))
  .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "")
  .match(/[^{}]+\{[^{}]*\}/g)!
  .map((r, thuTu) => { const i = r.indexOf("{"); return { ds: r.slice(0, i).trim(), than: r.slice(i + 1, -1), thuTu }; });
type DH = [number, number, number];
const soSanh = (x: DH, y: DH) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
function tachDs(ds: string) {
  const out: string[] = []; let sau = 0, cur = "";
  for (const ch of ds) { if (ch === "(") sau++; if (ch === ")") sau--; if (ch === "," && !sau) { out.push(cur.trim()); cur = ""; } else cur += ch; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
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
/** Màu nền THẮNG CUỐI CÙNG (background-color, hoặc `background` viết tắt không mang ảnh). */
function nenThang(el: Element): string | null {
  const ung: { v: string; dh: DH; thuTu: number; qt: boolean }[] = [];
  for (const l of LUAT) {
    if (!l.ds || !/(?<![\w-])background(?:-color)?\s*:/.test(l.than)) continue;
    const khop = tachDs(l.ds).filter((s) => !s.includes("::") && (() => { try { return el.matches(s); } catch { return false; } })());
    if (!khop.length) continue;
    const dh = khop.map(doUuTien).sort(soSanh).pop()!;
    for (const m of l.than.matchAll(/(?<![\w-])background(?:-color)?\s*:\s*([^;]+)/g)) {
      if (/gradient\(|url\(/.test(m[1])) continue;
      ung.push({ v: m[1].trim().replace(/\s*!important/, ""), dh, thuTu: l.thuTu, qt: /!important/.test(m[1]) });
    }
  }
  return ung.sort((x, y) => Number(x.qt) - Number(y.qt) || soSanh(x.dh, y.dh) || x.thuTu - y.thuTu).pop()?.v ?? null;
}

afterEach(() => { document.body.innerHTML = ""; document.documentElement.removeAttribute("data-theme"); });

/** Ô đang CHỌN (chưa vào sửa) mà chữ dài hơn ô — đúng lớp GridTable gắn: td cell-selected + cell-anchor, input readonly cell-lock cell-grow. */
function dungONoi(theme: "light" | "dark", hang: string, bang = "excel-table grid-fixed", dangSua = false) {
  document.documentElement.setAttribute("data-theme", theme);
  document.body.innerHTML = `<div class="editor"><table class="${bang}"><tbody><tr class="${hang}" data-row="0">
    <td class="col-qty has-formula cell-selected cell-anchor"><input id="o" data-f="quantity" class="${dangSua ? "cell-grow" : "cell-lock cell-grow"}"${dangSua ? "" : " readonly"}></td>
    <td class="col-qty"><input data-f="days"></td></tr></tbody></table></div>`;
  return document.getElementById("o")!;
}
const TRONG_SUOT = /^(transparent|none|0 0|rgba\([^)]*,\s*0\))$/;

describe("Lưới báo giá — ô công thức dài đang nới phải có NỀN ĐẶC ở mọi trạng thái", () => {
  // Chủ repo 2026-11-25 (ảnh ô SL nhóm "=sum(E7:E8)"): bấm vào ô thì chữ có tràn ra nhưng "bị cái gạch sau che" — trạng thái CHỌN
  // gắn thêm `[readonly].cell-lock` mà luật nền trong suốt của nó (0,3,2) thắng nền của `.cell-grow` (0,2,2): gạch dọc ranh cột, dấu ƒ
  // và ô vuông kéo của ô gốc lộ xuyên qua chữ. Đo Chromium trước sửa: nền rgba(0, 0, 0, 0).
  for (const [ten, hang, bang] of [
    ["hàng NHÓM", "section-row", "excel-table grid-fixed"],
    ["hàng NHÓM CON", "section-row subgroup-row", "excel-table grid-fixed"],
    ["hàng thường", "grp-head", "excel-table grid-fixed"],
    ["hàng nhóm Colorfull", "section-row", "excel-table grid-fixed clf-theme"],
  ] as const) {
    for (const theme of ["light", "dark"] as const) {
      it(`${ten} · ${theme === "light" ? "sáng" : "tối"}: đang CHỌN (readonly) — nền không trong suốt`, () => {
        const nen = nenThang(dungONoi(theme, hang, bang)) ?? "";
        expect(nen, `nền thắng là "${nen}"`).not.toMatch(TRONG_SUOT);
        expect(nen).not.toBe("");
      });
    }
  }
  it("đang SỬA (gõ) — nền vẫn là nền ô nới, cùng màu với lúc chọn (không nhảy màu khi bấm F2)", () => {
    const chon = nenThang(dungONoi("light", "section-row"));
    const sua = nenThang(dungONoi("light", "section-row", "excel-table grid-fixed", true));
    expect(sua).toBe(chon);
  });
  it("ô vuông kéo của ô đang nới dời ra góc HỘP NỚI (biến --o-noi do fitCell ghi) và nổi trên hộp (z-index > 6)", () => {
    const r = luat(".excel-table td:has(> input.cell-grow) > .fill-handle");
    expect(r).toMatch(/left:\s*calc\(var\(--o-noi[^)]*\)\s*-\s*6px\)/);
    expect(r).toMatch(/right:\s*auto/);
    const z = Number(/z-index:\s*(\d+)/.exec(r)?.[1]);
    expect(z).toBeGreaterThan(Number(/z-index:\s*(\d+)/.exec(luat(".excel-table td input.cell-grow"))?.[1]));
  });
});

describe("Lưới báo giá — tiêu đề cột không gãy chữ giữa từ ở mức sàn", () => {
  it("đệm ngang tiêu đề 4px (mức sàn STT 38px / SỐ LƯỢNG 62px: đệm 8px làm 'ST/T', 'SỐ LƯỢN/G')", () => {
    const r = luat(".excel-table.grid-fixed thead th");
    expect(r).toMatch(/padding-left:\s*4px/);
    expect(r).toMatch(/padding-right:\s*4px/);
  });
});

describe("Hàng lọc Hóa đơn đầu ra / đầu vào", () => {
  it("xuống dòng khi chật thay vì ép một hàng (1280×720: nút 'Xóa tất cả' gãy 3 dòng / bị khung cắt mất)", () => {
    expect(luat(".inv-filter-row.toolbar")).toMatch(/flex-wrap:\s*wrap/);
    expect(luat(".inv-filter-row.toolbar"), "ép một hàng là đúng lỗi cũ").not.toMatch(/flex-wrap:\s*nowrap/);
    const nut = luat(".inv-filter-row > .btn-ghost");
    expect(nut).toMatch(/white-space:\s*nowrap/);
    expect(nut).toMatch(/flex:\s*none/);
  });
});

describe("Thẻ thống kê đầu trang", () => {
  it("lưới auto-fit: thẻ rơi dòng giữ bề rộng cột (bản flex kéo thẻ 'Số hóa đơn' dài 960px một mình)", () => {
    const r = luat(".stat-row");
    expect(r).toMatch(/display:\s*grid/);
    expect(r).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(160px,\s*1fr\)\)/);
  });
});

describe("Tổng quan trên điện thoại", () => {
  it("chip kỳ một hàng trọn bề ngang, không gãy chữ, 'Làm mới' xuống dưới (390px: '30 / ngày' + thanh cuộn)", () => {
    const m = khoiMedia("(max-width: 560px)");
    expect(m).toMatch(/\.seg-btn\s*\{[^}]*white-space:\s*nowrap/);
    expect(m).toMatch(/\.seg\s*\{[^}]*flex:\s*1 1 100%/);
    expect(m).toMatch(/\.dash-controls\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(m, "dải chip cuộn ngang là lỗi cũ").not.toMatch(/\.seg\s*\{[^}]*overflow-x:\s*auto/);
  });
});

describe("Phân quyền — cột vai trò rộng đều, nút Lưu mọi cột cùng một hàng", () => {
  // Đo 1280×720 trước sửa: cột vai trò 128/143/159/119/158px (bảng tự co theo chữ), cột Nhân sự gấp "1 theo vai trò · 0 tùy chỉnh"
  // thành 3 dòng → nút Lưu thấp hơn các cột khác 8px. Sau sửa: 142px × 5, đáy nút cùng một hàng (sáng + tối, 1280 / 1920 / 390px).
  it("màn rộng: table-layout fixed + cột Quyền có bề rộng → phần còn lại chia ĐỀU cho các cột vai trò", () => {
    const rong = khoiMedia("not all and (max-width: 920px)");
    expect(rong).toMatch(/\.perm-matrix\s*\{\s*table-layout:\s*fixed/);
    expect(rong).toMatch(/\.perm-matrix thead th:first-child\s*\{\s*width:\s*\d+%/);
    expect(luat(".perm-matrix"), "chia đều ở cấp đầu sẽ làm bảng điện thoại (khối cuộn, chữ một dòng) tự nới cột Quyền").not.toMatch(/table-layout/);
  });
  it("hàng nút / nhãn 'khóa' dồn xuống ĐÁY ô tiêu đề (không phụ thuộc chữ phía trên gấp mấy dòng)", () => {
    expect(luat(".perm-matrix thead th")).toMatch(/height:\s*1px/);
    const dau = luat(".perm-matrix .role-head");
    expect(dau).toMatch(/display:\s*flex/);
    expect(dau).toMatch(/height:\s*100%/);
    expect(luat(".perm-matrix .role-head > .rh-nut")).toMatch(/margin-top:\s*auto/);
    // Lề trên inline (marginTop) thắng margin-top: auto của CSS → hàng nút phải mang lớp, không mang lề inline.
    const tsx = doc("./pages/Permissions.tsx");
    expect((tsx.match(/className="rh-nut"/g) || []).length, "cả nhánh nút Lưu lẫn nhánh 'khóa'").toBe(2);
    expect(tsx).not.toMatch(/marginTop:\s*4/);
  });
});

describe("Nhật ký hoạt động + hộp Tổng báo giá", () => {
  it("ô chọn hoạt động có trần bề rộng (tự rộng ~527px theo nhãn dài nhất → hàng lọc vỡ đôi ở 1280px)", () => {
    expect(luat(".toolbar select.au-loc")).toMatch(/max-width:\s*\d+px/);
  });
  it("tiêu đề đầu hộp Tổng báo giá không cộng lề trên vào đệm hộp (lề 18px + đệm 16px = chữ cách mép trên 35px)", () => {
    // Lề nằm ở style inline của QuoteEditor.tsx (thắng mọi luật CSS) nên bài đọc thẳng mã nguồn.
    const h3 = /<h3 style=\{\{ margin: "([^"]+)" \}\}>Tổng báo giá \(/.exec(doc("./pages/QuoteEditor.tsx"))?.[1];
    expect(h3, "không tìm thấy tiêu đề hộp Tổng báo giá").toBeTruthy();
    expect(h3!.split(/\s+/)[0]).toBe("0");
  });
});
