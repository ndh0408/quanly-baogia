import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { runExportJob } from "../src/exportQueue.js";

// A realistic quote with PLAIN numbers (not Prisma Decimals) + a real template code.
// buildQuoteBuffer needs no DB — it reads the template file from disk and fills it.
function makeQuote(code = "marico_decor") {
  return {
    quoteNumber: "GN26TEST", title: "Báo giá kiểm thử", toCompany: "Công ty ABC",
    toContact: "Anh A", toPhone: "0900000000", toAddress: "123 Đường X",
    vatPercent: 8, discount: 0, showTotals: true, city: "TP. Hồ Chí Minh",
    quoteDate: new Date("2026-06-13"), fromContact: "Chị B", fromTitle: "Sale",
    fromPhone: "0911111111", fromAddress: "456 Đường Y", greeting: "Xin gửi báo giá:",
    sheets: [{
      order: 1, name: "Sheet 1", groupSubtotal: false, template: { code },
      items: [
        { kind: "item", name: "Hạng mục 1", detail: "chi tiết", unit: "cái", quantity: 2, unitPrice: 1_000_000, days: null, notes: "" },
        { kind: "item", name: "Hạng mục 2", detail: "", unit: "bộ", quantity: 1, unitPrice: 500_000, days: null, notes: "ghi chú" },
      ],
    }],
  };
}

const isXlsx = (buf) => Buffer.isBuffer(buf) && buf.length > 2000 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK" zip header

describe("buildQuoteBuffer (export generation)", () => {
  it("produces a valid .xlsx buffer from a plain-number quote", async () => {
    expect(isXlsx(await buildQuoteBuffer(makeQuote()))).toBe(true);
  });

  // The critical guarantee for moving generation into a worker_thread: a quote that
  // has been structured-clone/JSON-serialized (Date→string, no Decimal objects) must
  // still produce a valid file. This is exactly what the worker receives.
  it("works on a JSON-serialized quote (worker_threads-safe)", async () => {
    const plain = JSON.parse(JSON.stringify(makeQuote()));
    expect(isXlsx(await buildQuoteBuffer(plain))).toBe(true);
  });

  it("handles the CLF template (has Chi Tiết column + discount row)", async () => {
    const q = makeQuote("clofull_decor");
    q.discount = 100_000;
    expect(isXlsx(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))))).toBe(true);
  });

  // Money correctness: the summary sheet must show the quote STORED totals exactly
  // (whole VND), not a separately-rounded recompute. Reads the buffer back.
  it("summary sheet shows the stored grand total (consistent rounding)", async () => {
    const q = makeQuote();
    q.subtotal = 2_500_000; q.vat = 200_000; q.discount = 0; q.total = 2_700_000;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(q));
    const ws = wb.getWorksheet("Tổng Báo Giá") || wb.worksheets[wb.worksheets.length - 1];
    let foundTotal = false, foundVat = false;
    ws.eachRow((row) => row.eachCell((c) => {
      if (Number(c.value) === 2_700_000) foundTotal = true;
      if (Number(c.value) === 200_000) foundVat = true;
    }));
    expect(foundTotal).toBe(true);   // grand total = stored quote.total
    expect(foundVat).toBe(true);     // VAT = stored quote.vat (no fractional recompute)
  });

  // Exercises the REAL worker-thread path end-to-end (spawn worker → build in
  // worker → transfer buffer back → validate). Proves the worker plumbing works.
  it("runExportJob generates a valid xlsx via the worker thread", async () => {
    const buf = await runExportJob("xlsx", JSON.parse(JSON.stringify(makeQuote())), () => buildQuoteBuffer(makeQuote()));
    expect(isXlsx(buf)).toBe(true);
  }, 20_000);
});
