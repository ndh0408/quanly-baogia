import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { stitchXlsxBuffers } from "../src/xlsxStitcher.js";

async function makeSheet(name, cellValue) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(name);
  ws.getCell("A1").value = cellValue;
  ws.getCell("A1").font = { name: "Times New Roman", family: 1, bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("stitchXlsxBuffers", () => {
  it("single buffer returns roundtrip-readable xlsx", async () => {
    const buf = await makeSheet("Only", "hello");
    const out = await stitchXlsxBuffers([buf], ["Only"]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out);
    expect(wb.worksheets).toHaveLength(1);
    expect(wb.worksheets[0].getCell("A1").value).toBe("hello");
  });

  it("two buffers merge into one workbook with both sheet names", async () => {
    const a = await makeSheet("First", "alpha");
    const b = await makeSheet("Second", "beta");
    const out = await stitchXlsxBuffers([a, b], ["S1", "S2"]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out);
    expect(wb.worksheets.map(w => w.name)).toEqual(["S1", "S2"]);
    expect(wb.worksheets[0].getCell("A1").value).toBe("alpha");
    expect(wb.worksheets[1].getCell("A1").value).toBe("beta");
  });

  it("preserves Vietnamese diacritics across sheets", async () => {
    const a = await makeSheet("Decor", "BẢNG BÁO GIÁ — Décor");
    const b = await makeSheet("Sampling", "BẢNG BÁO GIÁ — Sampling");
    const out = await stitchXlsxBuffers([a, b], ["Decor", "Sampling"]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out);
    expect(wb.worksheets[0].getCell("A1").value).toBe("BẢNG BÁO GIÁ — Décor");
    expect(wb.worksheets[1].getCell("A1").value).toBe("BẢNG BÁO GIÁ — Sampling");
  });

  it("output has no external definedNames and sequential sheetIds", async () => {
    const a = await makeSheet("A", "x");
    const b = await makeSheet("B", "y");
    const out = await stitchXlsxBuffers([a, b], ["A", "B"]);
    const zip = await JSZip.loadAsync(out);
    const wbxml = await zip.file("xl/workbook.xml").async("string");
    // No defined names referencing external workbooks like '[3]DATA'!...
    expect(/<definedName[^>]*>[^<]*\[\d+\]/.test(wbxml)).toBe(false);
    // sheetIds sequential 1,2
    const sheets = [...wbxml.matchAll(/<sheet [^/]*\/>/g)].map(m => m[0]);
    expect(sheets).toHaveLength(2);
    expect(/sheetId="1"/.test(sheets[0])).toBe(true);
    expect(/sheetId="2"/.test(sheets[1])).toBe(true);
  });

  it("merging same-style fonts does not duplicate or drop family attribute", async () => {
    const a = await makeSheet("A", "test1");
    const b = await makeSheet("B", "test2");
    const out = await stitchXlsxBuffers([a, b], ["A", "B"]);
    const zip = await JSZip.loadAsync(out);
    const styles = await zip.file("xl/styles.xml").async("string");
    const fonts = [...styles.matchAll(/<font>[\s\S]*?<\/font>/g)].map(m => m[0]);
    const missingFamily = fonts.filter(f => f.includes("<name") && !f.includes("<family"));
    expect(missingFamily).toEqual([]);
  });
});
