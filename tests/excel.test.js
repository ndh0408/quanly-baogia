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

  // GHI CHÚ NỘI BỘ (internalNote): hiện trong app cho mọi người NHƯNG tuyệt đối KHÔNG
  // lọt vào file Excel xuất ra. notes (ghi chú công khai) thì VẪN xuất bình thường.
  it("KHÔNG xuất internalNote ra Excel, nhưng notes thì CÓ", async () => {
    const q = makeQuote("marico_decor");
    q.sheets[0].items = [
      { kind: "item", name: "Hạng mục", detail: "", unit: "cái", quantity: 1, unitPrice: 100_000, days: null, notes: "GHICHU_CONGKHAI_ABC", internalNote: "BIMAT_NOIBO_XYZ" },
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    let foundInternal = false, foundPublic = false;
    wb.worksheets.forEach((ws) => ws.eachRow((row) => row.eachCell((c) => {
      const v = String(c.value ?? "");
      if (v.includes("BIMAT_NOIBO_XYZ")) foundInternal = true;
      if (v.includes("GHICHU_CONGKHAI_ABC")) foundPublic = true;
    })));
    expect(foundInternal).toBe(false);   // ghi chú nội bộ KHÔNG có trong file Excel
    expect(foundPublic).toBe(true);      // ghi chú công khai VẪN xuất (xác nhận test đúng hướng)
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

  // Nhóm con (subsection): 2 ô STT + Ghi Chú phải để TRẮNG (không tô nền) — chỉ tô dải
  // giữa. Khoá đúng yêu cầu "bỏ màu 2 ô đó của nhóm con".
  it("nhóm con: ô STT và Ghi Chú KHÔNG tô nền, dải giữa vẫn tô", async () => {
    const q = makeQuote("marico_decor");   // stt=B, name=C, notes=I
    q.sheets[0].items = [
      { kind: "subsection", name: "NHÓM CON KIỂM THỬ", label: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" },
      { kind: "item", name: "Hạng mục con", detail: "", unit: "cái", quantity: 1, unitPrice: 100_000, days: null, notes: "" },
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    const ws = wb.worksheets[0];
    let subRow = null;
    ws.eachRow((row, rn) => {
      const v = row.getCell("C").value;
      if (v && String(v).includes("NHÓM CON KIỂM THỬ")) subRow = rn;
    });
    expect(subRow).not.toBeNull();
    const pattern = (addr) => { const f = ws.getCell(addr).fill; return f && f.pattern; };
    expect(pattern(`C${subRow}`)).toBe("solid");      // tên nhóm con: vẫn tô nền
    expect(pattern(`B${subRow}`)).not.toBe("solid");  // STT: không nền
    expect(pattern(`I${subRow}`)).not.toBe("solid");  // Ghi Chú: không nền
  });

  // Multi-sheet stitch must not leak a stray "khung"/nền grid right of the table from sheet 2
  // onward. Root cause was the stitcher remapping cell s= but NOT row/col default styles, so a
  // stitched sheet's row style pointed at the BASE sheet's (bordered) xf. A FEW-item non-first
  // sheet exposes it (a many-item sheet overwrites the band). Assert no BODY row carries a
  // decorated (border/fill) ROW-level style on any sheet.
  it("multi-sheet stitch leaves no decorated row-style past the table (sheet 2+)", async () => {
    const q = makeQuote("marico_decor");
    const fewItems = [
      { kind: "section", name: "Nhóm A", quantity: 0, unitPrice: 0, days: null },
      { kind: "item", name: "Mục", unit: "m2", quantity: 2, unitPrice: 100000, days: null, notes: "" },
    ];
    q.sheets = [
      { ...q.sheets[0], name: "Sheet 1" },
      { order: 2, name: "Sheet 2 (few)", groupSubtotal: true, template: { code: "marico_decor" }, items: fewItems },
      { order: 3, name: "Sheet 3 (few)", groupSubtotal: true, template: { code: "marico_decor" }, items: fewItems },
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    const decorated = (st) => {
      const b = st && st.border, f = st && st.fill;
      const hasB = b && ["top", "bottom", "left", "right"].some((s) => b[s] && b[s].style);
      const hasF = f && f.type === "pattern" && f.pattern && f.pattern !== "none";
      return !!(hasB || hasF);
    };
    let bad = 0;
    for (const ws of wb.worksheets) {
      for (let r = 12; r <= 60; r++) if (decorated(ws.getRow(r).style)) bad++;
    }
    expect(bad).toBe(0);
  });

  // CÔNG THỨC NGƯỜI DÙNG TỰ GÕ: ô Đơn Giá có it.formulas phải xuất ra CÔNG THỨC Excel
  // (không chỉ con số). marico_decor: unitPrice=cột G, firstRow=12 → item#1 G12, item#2 G13.
  it("xuất công thức người dùng (số học + tham chiếu) ra ô Excel", async () => {
    const q = makeQuote("marico_decor");
    q.sheets[0].items = [
      // item#1: Đơn Giá nhập "=500000+500000" → 1.000.000
      { kind: "item", name: "Mục 1", detail: "", unit: "cái", quantity: 2, unitPrice: 1_000_000, days: null, notes: "", formulas: { unitPrice: "=500000+500000" } },
      // item#2: Đơn Giá nhập "=F1*0,5" (editor F=Đơn Giá, row1=item#1) → 500.000
      { kind: "item", name: "Mục 2", detail: "", unit: "bộ", quantity: 1, unitPrice: 500_000, days: null, notes: "", formulas: { unitPrice: "=F1*0,5" } },
      // item#3: KHÔNG có công thức → vẫn ghi số thường
      { kind: "item", name: "Mục 3", detail: "", unit: "cái", quantity: 1, unitPrice: 333_000, days: null, notes: "" },
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    const ws = wb.worksheets[0];
    // Số học thuần → công thức + kết quả đúng
    expect(ws.getCell("G12").formula).toBe("500000+500000");
    expect(Number(ws.getCell("G12").result)).toBe(1_000_000);
    // Tham chiếu → đổi toạ độ editor F1 → Excel G12, dấu thập phân ',' → '.'
    expect(ws.getCell("G13").formula).toBe("G12*0.5");
    expect(Number(ws.getCell("G13").result)).toBe(500_000);
    // Ô không công thức → số thường (không phải formula cell)
    expect(ws.getCell("G14").formula).toBeUndefined();
    expect(Number(ws.getCell("G14").value)).toBe(333_000);
    // Thành Tiền (cột H) vẫn là công thức =G*F như trước
    expect(ws.getCell("H12").formula).toBe("G12*F12");
  });

  // CLF lọc dòng "info" ra banner → lệch chỉ số mảng item. Công thức tham chiếu VƯỢT QUA
  // dòng info phải vẫn trỏ đúng ô (tra theo ĐỐI TƯỢNG item). CLF: firstRow=6, unitPrice=G.
  it("CLF: ref công thức vượt qua dòng 'info' trỏ ĐÚNG ô (không lệch do lọc)", async () => {
    const q = makeQuote("clofull_decor");
    q.sheets[0].items = [
      { kind: "info", name: "Thông tin chương trình", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" },   // row editor 1 → banner
      { kind: "item", name: "Mục A", detail: "", unit: "cái", quantity: 1, unitPrice: 1_000_000, days: null, notes: "" },              // row editor 2 → Excel G6
      { kind: "item", name: "Mục B", detail: "", unit: "cái", quantity: 1, unitPrice: 1_100_000, days: null, notes: "", formulas: { unitPrice: "=F2*1,1" } }, // row editor 3 → Excel G7, ref F2=Mục A
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    const ws = wb.worksheets[0];
    expect(ws.getCell("G7").formula).toBe("G6*1.1");   // trỏ về Mục A (G6), KHÔNG tự trỏ G7
    expect(Number(ws.getCell("G7").result)).toBe(1_100_000);
  });

  // AN TOÀN: nếu giá trị đã lưu LỆCH với công thức (vd dữ liệu cũ chưa tính lại) → ghi
  // SỐ chứ không xuất công thức sai. Không bao giờ ship công thức cho ra số khác.
  it("không xuất công thức khi kết quả lệch với giá trị đã lưu (fallback số)", async () => {
    const q = makeQuote("marico_decor");
    q.sheets[0].items = [
      { kind: "item", name: "Mục", detail: "", unit: "cái", quantity: 1, unitPrice: 999_999, days: null, notes: "", formulas: { unitPrice: "=1000000*8%" } },
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    const ws = wb.worksheets[0];
    expect(ws.getCell("G12").formula).toBeUndefined();
    expect(Number(ws.getCell("G12").value)).toBe(999_999);
  });

  // Exercises the REAL worker-thread path end-to-end (spawn worker → build in
  // worker → transfer buffer back → validate). Proves the worker plumbing works.
  it("runExportJob generates a valid xlsx via the worker thread", async () => {
    const buf = await runExportJob("xlsx", JSON.parse(JSON.stringify(makeQuote())), () => buildQuoteBuffer(makeQuote()));
    expect(isXlsx(buf)).toBe(true);
  }, 20_000);
});
