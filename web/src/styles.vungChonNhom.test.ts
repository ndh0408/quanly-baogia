/** @vitest-environment jsdom */
//
// L68 (soát toàn diện): VÙNG CHỌN nhiều ô không tô lên hàng nhóm / nhóm con — ô vẫn mang lớp
// `cell-selected` nhưng nền y như ô chưa chọn (cả hai chế độ, cả Gia Nguyễn lẫn Colorfull), nên người
// dùng không thấy ô nhóm nào đang nằm trong vùng sắp copy / xoá / điền. Nguyên nhân là ĐỘ ƯU TIÊN:
// `.excel-table td.cell-selected` (0,2,1) thua `.excel-table tr.section-row td` (0,2,2), các luật
// `.clf-theme` và luật tối có `:not(#nhom-toi)` (cấp id).
//
// Bài này tự giải CASCADE của đúng hai tệp CSS app nạp (public/style.css trước, styles.css sau) cho một
// ô dựng trong jsdom: luật nào khớp (Element.matches), độ ưu tiên, thứ tự, !important — rồi hỏi lớp
// NỀN ẢNH (lớp phủ) và MÀU NỀN (màu hàng) thắng cuối cùng là gì.
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
/** Tách danh sách bộ chọn theo dấu phẩy ở tầng ngoài cùng. */
function tachDs(ds: string) {
  const out: string[] = []; let sau = 0, cur = "";
  for (const ch of ds) { if (ch === "(") sau++; if (ch === ")") sau--; if (ch === "," && !sau) { out.push(cur.trim()); cur = ""; } else cur += ch; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Giá trị thắng cuối cùng của background-image / background-color cho phần tử. */
function nen(el: Element) {
  const ung: { anh: string; mau: string | null; quanTrong: boolean; dh: DH; thuTu: number }[] = [];
  for (const l of LUAT) {
    if (!l.ds || !/background/.test(l.than)) continue;
    const khop = tachDs(l.ds).filter((s) => !s.includes("::") && (() => { try { return el.matches(s); } catch { return false; } })());
    if (!khop.length) continue;
    const dh = khop.map(doUuTien).sort(soSanh).pop()!;
    for (const m of l.than.matchAll(/(background(?:-image|-color)?)\s*:\s*([^;]+)/g)) {
      const v = m[2].trim(), quanTrong = /!important/.test(v);
      if (m[1] === "background-image") ung.push({ anh: v, mau: null, quanTrong, dh, thuTu: l.thuTu });
      else if (m[1] === "background-color") ung.push({ anh: "", mau: v, quanTrong, dh, thuTu: l.thuTu });
      else { const coAnh = /gradient\(|url\(/.test(v); ung.push({ anh: coAnh ? v : "none", mau: coAnh ? "transparent" : v, quanTrong, dh, thuTu: l.thuTu }); }
    }
  }
  const thang = (loc: (u: (typeof ung)[number]) => boolean) =>
    ung.filter(loc).sort((x, y) => Number(x.quanTrong) - Number(y.quanTrong) || soSanh(x.dh, y.dh) || x.thuTu - y.thuTu).pop();
  return { anh: thang((u) => u.anh !== "")?.anh ?? "none", mau: thang((u) => u.mau !== null)?.mau ?? "transparent" };
}

function dung(theme: string, clf: boolean, loaiHang: "thuong" | "nhom" | "con") {
  document.documentElement.setAttribute("data-theme", theme);
  const lop = loaiHang === "thuong" ? "" : loaiHang === "nhom" ? "section-row" : "section-row subgroup-row";
  document.body.innerHTML = `<div class="editor"><table class="excel-table${clf ? " clf-theme" : ""}"><tbody>
    <tr class="${lop}" data-row="0"><td class="col-dvt" id="chua"><input></td><td class="col-dvt cell-selected" id="chon"><input></td><td class="col-qty cell-selected cell-anchor" id="neo"><input></td></tr>
  </tbody></table></div>`;
  return { chua: nen(document.getElementById("chua")!), chon: nen(document.getElementById("chon")!), neo: nen(document.getElementById("neo")!) };
}
const XANH_CHON = /#1769d6|23,?\s*105,?\s*214/i;

describe("L68 — vùng chọn nhiều ô hiện trên CẢ hàng nhóm / nhóm con", () => {
  it("đọc được luật của hai tệp", () => expect(LUAT.length).toBeGreaterThan(500));

  it("hàng thường: ô chọn đã có nền xanh (đối chứng — cơ chế cũ vẫn giữ)", () => {
    for (const theme of ["light", "dark"]) {
      const r = dung(theme, false, "thuong");
      expect(r.chon.mau, theme).toMatch(XANH_CHON);
    }
  });

  for (const theme of ["light", "dark"]) {
    for (const clf of [false, true]) {
      for (const hang of ["nhom", "con"] as const) {
        it(`${theme} · ${clf ? "Colorfull" : "Gia Nguyễn"} · hàng ${hang === "nhom" ? "nhóm" : "nhóm con"}: lớp phủ xanh trên ô chọn, màu hàng giữ nguyên, ô neo không phủ`, () => {
          const r = dung(theme, clf, hang);
          expect(r.chon.anh, "ô chọn phải có lớp phủ xanh").toMatch(XANH_CHON);
          expect(r.chon.mau, "màu hàng (phân cấp nhóm) không được mất").toBe(r.chua.mau);
          expect(r.chua.anh, "ô KHÔNG chọn thì không phủ").toBe("none");
          expect(r.neo.anh, "ô neo giữ nền gốc như Excel (chỉ có viền)").toBe("none");
        });
      }
    }
  }
});
