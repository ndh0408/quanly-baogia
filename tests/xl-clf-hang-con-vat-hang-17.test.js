// L47 — Colorfull: hàng con (sub) rơi vào hàng 17–18 thì ô Hạng Mục KHÔNG được gộp dọc.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// Mẫu Colorfull gộp sẵn C17:D17 cho ô "* Ghi chú" (templateConfigs.ts: footerMerges). Báo giá dài
// hơn số khe của mẫu thì `duplicateRow` đẩy chữ xuống, nhưng SỔ vùng gộp của ExcelJS (`_merges`)
// vẫn giữ khoá "C17". Vòng gộp dọc hàng con chạy TRƯỚC bước dọn footerMerges, nên
// `mergeCells("C16:C17")` ném "Cannot merge already merged cells" và `safeMerge` nuốt lỗi: STT
// (B16:B17) gộp được, Hạng Mục thì không. Tệp gửi khách có ô tên hàng con là một ô trống riêng.
// Nạp lại tệp đó: bộ nhập chỉ nhận "sub" khi ô Hạng Mục là ô phụ của vùng gộp dọc ⇒ hàng 17 thành
// hạng mục TÊN RỖNG (không cảnh báo), xuất lần sau thành STT 11 trống và dời STT các dòng sau.
//
// Bài này quét vị trí hàng con từ 14 tới 20 trên cả ba mẫu Colorfull, và có một ca "tệp cũ" (xuất
// trước bản sửa: STT gộp mà Hạng Mục không) để khoá phía nhập.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";

const MAU = ["clofull_decor", "clofull_conngay", "clofull_banner"];

/** Nhóm ở hàng 6, `truoc` hạng mục thường, rồi hạng mục cha + `soCon` hàng con, rồi một hạng mục đuôi. */
function baoGia(code, truoc, soCon = 1, ghiChu = null) {
  const items = [{ kind: "section", name: "NHÓM", quantity: 1 }];
  for (let i = 0; i < truoc; i++) items.push({ kind: "item", name: `Hạng mục ${i + 1}`, unit: "cái", quantity: 1, days: 1, unitPrice: 100000 });
  items.push({ kind: "item", name: "Hạng mục CHA", unit: "bộ", quantity: 1, days: 1, unitPrice: 200000 });
  for (let k = 0; k < soCon; k++) items.push({ kind: "sub", name: "", unit: "bộ", quantity: 2, days: 1, unitPrice: 50000 });
  items.push({ kind: "item", name: "Hạng mục ĐUÔI", unit: "cái", quantity: 1, days: 1, unitPrice: 1000 });
  return {
    quoteNumber: "CLF26L47", title: "Hàng con", toCompany: "Công ty ABC", toContact: "Anh A",
    vatPercent: 8, showTotals: false, city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"), notes: ghiChu,
    sheets: [{ order: 1, name: "S", groupSubtotal: false, template: { code }, items: items.map((x, i) => ({ order: i, ...x })) }],
  };
}
const giai = (m) => { const x = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m); return x ? { c1: x[1], r1: +x[2], c2: x[3], r2: +x[4] } : null; };
const cot = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

describe("L47: hàng con Colorfull ở mọi vị trí — STT và Hạng Mục cùng gộp dọc, nạp lại vẫn là 'sub'", () => {
  for (const code of MAU) {
    for (const hangCon of [14, 15, 16, 17, 18, 19, 20]) {
      it(`${code}: hàng con ở hàng ${hangCon}`, async () => {
        // Nhóm ở 6, hạng mục từ 7 ⇒ hạng mục cha ở hàng 7 + truoc; hàng con ngay dưới.
        const buf = await buildQuoteBuffer(baoGia(code, hangCon - 8));
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        const ws = wb.worksheets[0];
        expect(String(ws.getCell(`C${hangCon - 1}`).value), "dựng sai vị trí hạng mục cha").toBe("Hạng mục CHA");
        const merges = ws.model.merges || [];
        expect(merges, "STT không gộp dọc").toContain(`B${hangCon - 1}:B${hangCon}`);
        expect(merges, "Hạng Mục không gộp dọc — ô tên hàng con là ô trống riêng").toContain(`C${hangCon - 1}:C${hangCon}`);
        const vs = merges.map(giai).filter(Boolean);
        const chong = vs.some((a, i) => vs.some((b, j) => i < j && cot(a.c1) <= cot(b.c2) && cot(b.c1) <= cot(a.c2) && a.r1 <= b.r2 && b.r1 <= a.r2));
        expect(chong, "vùng gộp chồng nhau").toBe(false);

        const res = await parseQuoteWorkbook(buf);
        const items = res.sheets.find((s) => !s.skipped).items;
        const it17 = items.find((x) => x.row === hangCon);
        expect(it17?.kind, `nạp lại: hàng ${hangCon} ra ${it17?.kind} "${it17?.name}"`).toBe("sub");
        expect(items.filter((x) => x.kind === "item" && !x.name), "có hạng mục tên rỗng").toEqual([]);
      });
    }
  }

  it("clofull_decor: hạng mục cha + 3 hàng con vắt qua 16–19 — gộp trọn một khối", async () => {
    // Nhóm 6, 8 hạng mục 7–14, cha ở 15, ba hàng con 16–18, đuôi 19.
    const buf = await buildQuoteBuffer(baoGia("clofull_decor", 8, 3));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const merges = wb.worksheets[0].model.merges || [];
    expect(merges).toContain("B15:B18");
    expect(merges).toContain("C15:C18");
    const items = (await parseQuoteWorkbook(buf)).sheets[0].items;
    expect(items.filter((x) => x.row >= 16 && x.row <= 18).map((x) => x.kind)).toEqual(["sub", "sub", "sub"]);
  });

  it("clofull_decor: ô '* Ghi chú' (C:D) vẫn gộp đúng chỗ và giữ chữ khi có hàng con ở hàng 17", async () => {
    const buf = await buildQuoteBuffer(baoGia("clofull_decor", 9, 1, "Giao hàng trước 8h"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    let hangGC = null;
    ws.eachRow((row, r) => { if (String(row.getCell("C").value ?? "").startsWith("* Ghi chú")) hangGC = r; });
    expect(hangGC, "mất ô ghi chú").not.toBeNull();
    expect(String(ws.getCell(`C${hangGC}`).value)).toContain("Giao hàng trước 8h");
    expect(ws.model.merges).toContain(`C${hangGC}:D${hangGC}`);
  });

  it("tệp CŨ (STT gộp dọc mà Hạng Mục không) nạp lại vẫn nhận hàng con — không ra hạng mục tên rỗng", async () => {
    // Dựng đúng hình dạng tệp đã gửi khách trước bản sửa: gỡ gộp C16:C17, giữ B16:B17.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(baoGia("clofull_decor", 9)));
    const ws = wb.worksheets[0];
    ws.unMergeCells("C16:C17");
    expect(ws.model.merges).toContain("B16:B17");
    const res = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
    const items = res.sheets[0].items;
    const h17 = items.find((x) => x.row === 17);
    expect(h17?.kind, `hàng 17 ra ${h17?.kind} "${h17?.name}"`).toBe("sub");
    expect(items.filter((x) => x.kind === "item" && !x.name)).toEqual([]);
  });
});
