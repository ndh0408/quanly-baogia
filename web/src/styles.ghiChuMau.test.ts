// Ô GHI CHÚ + 5 MÀU của Danh sách báo giá (chủ repo 2026-09-30: "chọn theo kiểu Zalo"). Bài này khoá:
//   · mỗi khoá màu trong `MAU_GHI_CHU` có ĐỦ ba biến (--qn-c chấm đặc, --qn-bg nền thẻ, --qn-fg chữ trên thẻ)
//     ở CẢ hai chế độ sáng/tối — thêm màu thứ sáu vào mảng mà quên CSS là chấm trong suốt, vô hình;
//   · chữ ghi chú trên nền thẻ màu ≥ 4.5:1 (đây là chữ người đọc hằng ngày, không phải trang trí);
//   · dấu ✓ trắng trên chấm đặc ≥ 3:1 (thành phần giao diện — WCAG 1.4.11): không đủ thì chấm "đang chọn"
//     chỉ còn nhìn ra bằng viền, mà đó đúng là thứ người kém phân biệt màu không thấy;
//   · ba màu chấm phân biệt được với nhau (không có hai màu gần như trùng).
// Đọc thẳng CSS như styles.contrast.test.ts (vitest chặn .css nên `?raw` về chuỗi rỗng).
import { describe, it, expect } from "vitest";
import { MAU_GHI_CHU } from "./lib/ghiChuMau";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync: (p: URL, e: string) => string };
const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const L = (h: string) => {
  const c = [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const tuongPhan = (a: string, b: string) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** Biến màu của `.qn-c-<k>` ở chế độ sáng (khối thường) hoặc tối (`[data-theme="dark"] .qn-c-<k>`). */
function bien(k: string, toi: boolean): Record<string, string> {
  const chon = toi ? `[data-theme="dark"] .qn-c-${k}` : `.qn-c-${k}`;
  // Neo ở `}` / đầu tệp (luật đứng riêng MỘT bộ chọn). Neo lỏng hơn (cho phép khoảng trắng đứng trước) thì
  // `.qn-c-red` của chế độ sáng khớp luôn luật `[data-theme="dark"] .qn-c-red` và bài đọc nhầm giá trị tối.
  const re = new RegExp(`(?:^|\\})\\s*${chon.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^{}]*)\\}`, "g");
  const out: Record<string, string> = {};
  for (const m of css.matchAll(re)) for (const v of m[1].matchAll(/(--qn-[a-z]+):\s*(#[0-9a-fA-F]{6})/g)) out[v[1]] = v[2];
  return out;
}

describe("Ghi chú danh sách báo giá — bảng 5 màu", () => {
  for (const toi of [false, true]) {
    const che = toi ? "tối" : "sáng";
    for (const k of MAU_GHI_CHU) {
      it(`${k} (${che}): đủ --qn-c / --qn-bg / --qn-fg; chữ ≥ 4.5:1 trên nền thẻ, ✓ trắng ≥ 3:1 trên chấm`, () => {
        const v = bien(k, toi);
        for (const t of ["--qn-c", "--qn-bg", "--qn-fg"]) expect(v[t], `${k} ${che}: thiếu ${t}`).toMatch(/^#[0-9a-fA-F]{6}$/);
        // Nền thẻ sáng và tối KHÁC nhau theo thiết kế — bằng nhau nghĩa là bộ đọc đã nhặt nhầm luật của chế độ kia.
        if (!toi) expect(v["--qn-bg"], `${k}: chế độ sáng đọc ra nền của chế độ tối`).not.toBe(bien(k, true)["--qn-bg"]);
        expect(tuongPhan(v["--qn-fg"], v["--qn-bg"]), `chữ ${v["--qn-fg"]} trên nền ${v["--qn-bg"]}`).toBeGreaterThanOrEqual(4.5);
        expect(tuongPhan("#ffffff", v["--qn-c"]), `✓ trắng trên chấm ${v["--qn-c"]}`).toBeGreaterThanOrEqual(3);
      });
    }
    it(`${che}: năm màu chấm đặc khác nhau rõ (không cặp nào gần như trùng)`, () => {
      const ds = MAU_GHI_CHU.map((k) => ({ k, c: bien(k, toi)["--qn-c"] }));
      for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
        expect(ds[i].c.toLowerCase(), `${ds[i].k} và ${ds[j].k} trùng màu`).not.toBe(ds[j].c.toLowerCase());
        // Khoảng cách màu (RGB Euclid) — đủ thô để bắt "hai màu xanh gần như một", không cần thang cảm thụ.
        const rgb = (h: string) => [1, 3, 5].map((p) => parseInt(h.slice(p, p + 2), 16));
        const d = Math.hypot(...rgb(ds[i].c).map((x, n) => x - rgb(ds[j].c)[n]));
        expect(d, `${ds[i].k} ↔ ${ds[j].k} (${ds[i].c} / ${ds[j].c}) quá gần nhau`).toBeGreaterThan(60);
      }
    });
  }

  it("chữ ghi chú CẮT hai dòng, không nowrap — ghi chú dài không được nới cột Ghi chú và cả bảng (đo: 328px / 1660px)", () => {
    const luat = (chon: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(",").map((x) => x.trim()).includes(chon)).map((m) => m[2]).join(";");
    expect(luat(".qn-clamp")).toMatch(/-webkit-line-clamp:\s*2/);
    expect(luat(".qn-clamp")).toMatch(/overflow:\s*hidden/);
    expect(luat(".qn-text"), "nowrap làm min-content của ô bằng độ dài cả ghi chú").not.toMatch(/white-space:\s*nowrap/);
    // Sàn của cột đủ để thấy chấm + vài chữ, nhưng KHÔNG to: sàn lớn là cộng thẳng vào bề rộng tối thiểu của bảng.
    const san = Number(/min-width:\s*(\d+)px/.exec(luat(".ql-note-th, .ql-note-cell") || [...css.matchAll(/\.ql-note-th,\s*\.ql-note-cell\s*\{([^{}]*)\}/g)].map((m) => m[1]).join(";"))?.[1]);
    expect(san).toBeGreaterThanOrEqual(120);
    expect(san).toBeLessThanOrEqual(160);
  });

  it("màn laptop (≤1700px): bảng thu đệm + chữ + sàn cột Ghi chú + tiêu đề cột xuống dòng để VỪA khung mà KHÔNG ẩn cột nào", () => {
    // Đo 2026-10-06 (Chromium thật, 8 báo giá mẫu): vùng đặc dừng ở 1500px thì 1501–1600 (FHD 125%) TRÀN hơn cả 1440 — bước nhảy
    // 1029 → 1179px; 1280×720 tràn 59px. Vùng đặc tới 1700 + tiêu đề xuống dòng + đệm 5px ≤1365: vừa khung từ 1280px.
    const m = /@media\s*\(min-width:\s*821px\)\s*and\s*\(max-width:\s*1700px\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(m, "mất khối @media cho laptop của .ql-table (821–1700px)").not.toBeNull();
    expect(css, "vùng đặc cũ dừng ở 1500px tạo bước nhảy — đừng đưa lại").not.toMatch(/\(min-width:\s*821px\)\s*and\s*\(max-width:\s*1500px\)/);
    const khoi = m![1];
    expect(khoi).toMatch(/\.ql-table td\s*\{[^}]*font-size:\s*13px/);
    const dem = Number(/\.ql-table th,\s*\.ql-table td\s*\{[^}]*padding-left:\s*(\d+)px/.exec(khoi)?.[1]);
    expect(dem, "đệm ngang laptop phải nhỏ hơn bản thường (10px)").toBeLessThan(10);
    expect(dem, "…nhưng không chật quá mức đọc được").toBeGreaterThanOrEqual(5);
    const san = Number(/\.ql-note-th,\s*\.ql-note-cell\s*\{[^}]*min-width:\s*(\d+)px/.exec(khoi)?.[1]);
    expect(san, "sàn cột Ghi chú ở laptop vẫn đủ thấy chấm + vài chữ").toBeGreaterThanOrEqual(100);
    expect(khoi, "tiêu đề cột phải được xuống dòng (nowrap của public/style.css ép bề rộng cả cột)").toMatch(/\.ql-table th\.sortable\s*\{[^}]*white-space:\s*normal/);
    expect(khoi, "thu gọn bằng đệm/chữ, KHÔNG ẩn cột (người dùng đã phàn nàn chuyện 'không thấy hết')").not.toMatch(/display:\s*none/);
    // Tầng chật hơn cho 1280×720 (FHD 150%): đệm 5px — vẫn ≥ 5.
    const hep = /@media\s*\(min-width:\s*821px\)\s*and\s*\(max-width:\s*1365px\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(hep, "mất tầng ≤1365px").not.toBeNull();
    expect(Number(/padding-left:\s*(\d+)px/.exec(hep![1])?.[1]), "≤1365px: đệm 5px").toBe(5);
    // KHÔNG ngắt giữa từ trong bảng: đã thử overflow-wrap:anywhere — gãy "Accoun/t", "showro/om".
    const anywhere = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((x) => x[1].includes(".ql-table") && /overflow-wrap:\s*anywhere|word-break:\s*break-all/.test(x[2]));
    expect(anywhere.map((x) => x[1].trim()), "cột chữ của bảng danh sách không được ngắt giữa từ").toEqual([]);
  });

  it("ô thao tác của dòng là table-cell (không phải flex) — flex làm ô thấp hơn hàng, vạch kẻ dưới hàng gãy bậc", () => {
    const luat = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((x) => x[1].split(",").map((s) => s.trim()).includes(".row-actions.qa-cell"));
    expect(luat.length, "mất luật .row-actions.qa-cell").toBeGreaterThan(0);
    const than = luat.map((x) => x[2]).join(";");
    expect(than).toMatch(/display:\s*table-cell/);
    expect(than).not.toMatch(/display:\s*flex/);
  });

  it("mã dự án trên hàng xám đủ tương phản AA: dùng --primary-hover (#854d0e) thay --primary (#a16207 chỉ 4,48:1 trên --row-alt)", () => {
    expect(css).toMatch(/\.list-table\.ql-table td a\s*\{[^}]*color:\s*var\(--primary-hover\)/);
  });

  it("ô ghi chú nằm GIỮA cột Trạng thái và cột thao tác (yêu cầu: cuối hàng, trước mấy cái nút) — đọc từ mã danh sách", async () => {
    const nguon = fs.readFileSync(new URL("./pages/QuoteList.tsx", import.meta.url), "utf8");
    // Tiêu đề cột Trạng thái nay là <SortTh> (cột nào cũng bấm được để sắp xếp) — chấp nhận cả hai dạng.
    const iTrangThai = Math.max(nguon.indexOf('<th scope="col">Trạng thái</th>'), nguon.indexOf('<SortTh f="status" label="Trạng thái" />'));
    const iGhiChu = nguon.indexOf('className="ql-note-th"');
    const iThaoTac = nguon.indexOf('className="actions" aria-label="Thao tác"');
    expect(iTrangThai, "không thấy cột Trạng thái").toBeGreaterThan(0);
    expect(iGhiChu, "không thấy cột Ghi chú").toBeGreaterThan(iTrangThai);
    expect(iThaoTac, "cột thao tác phải đứng SAU cột Ghi chú").toBeGreaterThan(iGhiChu);
    // Và bảng mang lớp `ql-table` — thiếu lớp này thì luật hàng trắng/xám (styles.hangXenKe.test.ts) không bám vào đâu.
    expect(nguon).toContain('className="list-table ql-table"');
  });
});
