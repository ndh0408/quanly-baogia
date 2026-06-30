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
    // Thành Tiền (cột H) là công thức làm tròn ROUND(=G*F, 0)
    expect(ws.getCell("H12").formula).toBe("ROUND(G12*F12,0)");
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

  // Thành Tiền LÀM TRÒN số nguyên (bỏ ,50) + các dòng cộng lại ĐÚNG bằng Tổng Cộng.
  it("Thành Tiền làm tròn số nguyên, dòng cộng = tổng", async () => {
    const q = makeQuote("marico_decor");   // amountFormula G*F (G=ĐơnGiá, F=SốLượng), firstRow=12
    q.sheets[0].items = [
      { kind: "item", name: "A", detail: "", unit: "m2", quantity: 1.5, unitPrice: 95001, days: null, notes: "" }, // 142501.5 → 142502
      { kind: "item", name: "B", detail: "", unit: "m2", quantity: 2.5, unitPrice: 95001, days: null, notes: "" }, // 237502.5 → 237503
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    const ws = wb.worksheets[0];
    const h12 = Number(ws.getCell("H12").result), h13 = Number(ws.getCell("H13").result);
    expect(h12).toBe(142502);                    // làm tròn lên (HALF_UP), không còn ,50
    expect(h13).toBe(237503);
    expect(Number.isInteger(h12) && Number.isInteger(h13)).toBe(true);
    expect(ws.getCell("H12").formula).toBe("ROUND(G12*F12,0)");
    // Tổng Cộng = đúng tổng các dòng đã làm tròn (142502 + 237503 = 380005)
    let foundSub = false;
    ws.eachRow((row) => row.eachCell((c) => { if (Number(c.value?.result ?? c.value) === 380005) foundSub = true; }));
    expect(foundSub).toBe(true);
  });

  // Số Lượng LÀM TRÒN 1 số (ROUND) trong Excel — vẫn GIỮ công thức (bọc ROUND); Thành Tiền theo số đã tròn.
  it("Số Lượng làm tròn 1 số (ROUND) + giữ công thức + Thành Tiền theo số đã tròn", async () => {
    const q = makeQuote("marico_decor");   // F=Số Lượng, G=Đơn Giá, H=Thành Tiền, firstRow=12
    q.sheets[0].items = [
      // qty có công thức =2.75*2.05 (=5.6375) → làm tròn 5,6, ô GIỮ công thức (bọc ROUND)
      { kind: "item", name: "A", detail: "", unit: "m2", quantity: 5.6375, unitPrice: 100000, days: null, notes: "", formulas: { quantity: "=2.75*2.05" } },
      // qty thường 7.621 → làm tròn 7,6 (không công thức)
      { kind: "item", name: "B", detail: "", unit: "m2", quantity: 7.621, unitPrice: 100000, days: null, notes: "" },
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    const ws = wb.worksheets[0];
    // Số Lượng: ô có công thức → bọc ROUND (vẫn hiện công thức), giá trị làm tròn 1 số
    expect(ws.getCell("F12").formula).toBe("ROUND(2.75*2.05,1)");
    expect(Number(ws.getCell("F12").result)).toBe(5.6);
    // Số Lượng thường → ghi thẳng số đã làm tròn, không phải công thức
    expect(ws.getCell("F13").formula).toBeUndefined();
    expect(Number(ws.getCell("F13").value)).toBe(7.6);
    // Thành Tiền = ROUND(Đơn Giá × Số Lượng-đã-tròn): 100000×5,6=560000 ; 100000×7,6=760000
    expect(Number(ws.getCell("H12").result)).toBe(560000);
    expect(Number(ws.getCell("H13").result)).toBe(760000);
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

  // BUG cũ: Số Lượng lẻ (vd 7,7) ở hàng NHÂN BẢN (quá 10 mục → duplicateRow) bị in ra "8"
  // vì numFmt không "ăn" trên hàng nhân bản (style dùng chung). Phải vẫn là "0.0" (1 số lẻ).
  it("Số Lượng lẻ ở hàng nhân bản (>10 mục) vẫn định dạng 1 số (không làm tròn lên nguyên)", async () => {
    const q = makeQuote("marico_decor");
    const items = [];
    for (let i = 1; i <= 13; i++) items.push({ kind: "item", name: "MUC" + i, detail: "", unit: "m2", quantity: (i === 12 ? 7.7 : 3), unitPrice: 95000, days: null, notes: "" });
    q.sheets[0].items = items;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    const ws = wb.worksheets[0];
    let rn = null; ws.eachRow((row, n) => { if (String(row.getCell("C").value ?? "").includes("MUC12")) rn = n; });
    expect(rn).not.toBeNull();
    expect(rn).toBeGreaterThan(21);                  // MUC12 nằm ở hàng nhân bản (sau slot mẫu 12–21)
    expect(ws.getCell("F" + rn).numFmt).toBe("0.0"); // vẫn 1 số → hiện "7.7" chứ không "8"
    expect(Number(ws.getCell("F" + rn).value)).toBe(7.7);
  });

  // gn_banner: y hệt GN không ngày, CHỉ khác đánh STT — nhóm con 1,2,3 (reset mỗi nhóm chính),
  // mục bên dưới KHÔNG đánh số. marico/gn_banner: STT=cột B, Hạng Mục=cột C.
  it("gn_banner: nhóm con đánh số 1,2,3; mục bên dưới không đánh số; nhóm chính giữ A/B/C", async () => {
    const q = makeQuote("gn_banner");
    q.sheets[0].items = [
      { kind: "section", name: "HCM", label: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" },
      { kind: "subsection", name: "LM81", label: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" },
      { kind: "item", name: "Vách giữa", detail: "", unit: "m2", quantity: 5, unitPrice: 95000, days: null, notes: "" },
      { kind: "item", name: "Chi phí thi công A", detail: "", unit: "m2", quantity: 5, unitPrice: 65000, days: null, notes: "" },
      { kind: "subsection", name: "SVH hallway", label: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" },
      { kind: "item", name: "AW banner", detail: "", unit: "m2", quantity: 5, unitPrice: 95000, days: null, notes: "" },
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    const ws = wb.worksheets[0];
    const sttOf = (nameFrag) => { let v = undefined; ws.eachRow((row) => { if (String(row.getCell("C").value ?? "").includes(nameFrag)) v = row.getCell("B").value; }); return v; };
    expect(String(sttOf("HCM"))).toBe("A");          // nhóm chính giữ chữ A/B/C
    expect(String(sttOf("LM81"))).toBe("1");         // nhóm con → 1
    expect(String(sttOf("SVH hallway"))).toBe("2");  // nhóm con → 2
    expect(sttOf("Vách giữa") == null).toBe(true);   // mục bên dưới → KHÔNG đánh số
    expect(sttOf("AW banner") == null).toBe(true);
  });

  // marico_decor (GN không ngày thường) GIỮ cách cũ: mục đánh 1,2; nhóm con không số.
  it("marico_decor giữ cách cũ: mục đánh 1,2 (không phải nhóm con)", async () => {
    const q = makeQuote("marico_decor");
    q.sheets[0].items = [
      { kind: "subsection", name: "LM81", label: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" },
      { kind: "item", name: "Vách giữa", detail: "", unit: "m2", quantity: 5, unitPrice: 95000, days: null, notes: "" },
      { kind: "item", name: "Chi phí thi công A", detail: "", unit: "m2", quantity: 5, unitPrice: 65000, days: null, notes: "" },
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    const ws = wb.worksheets[0];
    const sttOf = (nameFrag) => { let v = undefined; ws.eachRow((row) => { if (String(row.getCell("C").value ?? "").includes(nameFrag)) v = row.getCell("B").value; }); return v; };
    expect(Number(sttOf("Vách giữa"))).toBe(1);      // GN thường: mục vẫn đánh số
    expect(Number(sttOf("Chi phí thi công A"))).toBe(2);
  });

  // BANNER: ĐƠN GIÁ nhóm CHA = Σ ĐƠN GIÁ các nhóm con (mỗi nhóm con = Σ Thành Tiền mục) — KHÔNG trùng.
  it("gn_banner: đơn giá nhóm cha = SUM đơn giá nhóm con (live, không double-count)", async () => {
    const q = makeQuote("gn_banner");
    q.sheets[0].groupSubtotal = false;
    q.sheets[0].items = [
      { kind: "section", name: "HCM", label: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" },
      { kind: "subsection", name: "LM81", label: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" },
      { kind: "item", name: "A", detail: "", unit: "m2", quantity: 7.4, unitPrice: 95000, days: null, notes: "" },   // 703.000
      { kind: "item", name: "B", detail: "", unit: "m2", quantity: 7.4, unitPrice: 65000, days: null, notes: "" },   // 481.000
      { kind: "subsection", name: "BHD", label: "", unit: "", quantity: 0, unitPrice: 0, days: null, notes: "" },
      { kind: "item", name: "C", detail: "", unit: "m2", quantity: 3.2, unitPrice: 110000, days: null, notes: "" },   // 352.000
    ];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(JSON.parse(JSON.stringify(q))));
    const ws = wb.worksheets[0];
    const rowOf = (nm) => { let r = null; ws.eachRow((row, n) => { if (String(row.getCell("C").value ?? "").trim() === nm) r = n; }); return r; };
    const rHCM = rowOf("HCM"), rLM = rowOf("LM81"), rBHD = rowOf("BHD");
    // Nhóm con = Σ Thành Tiền (H) mục con
    expect(ws.getCell(`G${rLM}`).formula).toMatch(/^SUM\(H\d+:H\d+\)$/);
    expect(Number(ws.getCell(`G${rLM}`).result)).toBe(1_184_000);   // 703.000 + 481.000
    expect(Number(ws.getCell(`G${rBHD}`).result)).toBe(352_000);
    // Nhóm CHA = Σ ĐƠN GIÁ (G) các nhóm con (rời ô) — KHÔNG cộng lại từng mục (tránh double-count)
    expect(ws.getCell(`G${rHCM}`).formula).toBe(`SUM(G${rLM},G${rBHD})`);
    expect(Number(ws.getCell(`G${rHCM}`).result)).toBe(1_536_000);  // 1.184.000 + 352.000
  });

  // Exercises the REAL worker-thread path end-to-end (spawn worker → build in
  // worker → transfer buffer back → validate). Proves the worker plumbing works.
  it("runExportJob generates a valid xlsx via the worker thread", async () => {
    const buf = await runExportJob("xlsx", JSON.parse(JSON.stringify(makeQuote())), () => buildQuoteBuffer(makeQuote()));
    expect(isXlsx(buf)).toBe(true);
  }, 20_000);
});

// Khách sửa Số Lượng/Đơn Giá 1 mục trong file Excel → đơn giá nhóm, thành tiền nhóm, Tổng Cộng,
// VAT, Thành Tiền PHẢI tự tính lại (công thức SỐNG, không phải ô tổng "chết").
describe("Excel — công thức SỐNG cho nhóm", () => {
  const item = (n, q, p) => ({ kind: "item", name: n, unit: "cái", quantity: q, unitPrice: p, days: null });
  const grouped = () => ({
    quoteNumber: "GN26GRP", title: "T", toCompany: "KH", vatPercent: 8, discount: 0, showTotals: false,
    city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-06-13"),
    sheets: [{ order: 1, name: "S1", groupSubtotal: true, template: { code: "marico_decor" }, items: [
      { kind: "section", name: "Nhóm A", quantity: 2 }, item("A1", 1, 100000), item("A2", 3, 50000),
      { kind: "section", name: "Nhóm B", quantity: 1 }, item("B1", 2, 200000),
    ] }],
  });
  const load = async (q) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildQuoteBuffer(q)); return wb.worksheets[0]; };
  const fx = (ws, a) => { const v = ws.getCell(a).value; return v && typeof v === "object" ? v.formula : null; };
  const res = (ws, a) => { const v = ws.getCell(a).value; return v && typeof v === "object" ? v.result : v; };

  it("đơn giá nhóm = SUM mục con; thành tiền nhóm = đơn giá × SL nhóm", async () => {
    const ws = await load(grouped());
    expect(fx(ws, "G12")).toBe("SUM(H13:H14)");   // Nhóm A: đơn giá = tổng Thành Tiền mục con
    expect(fx(ws, "H12")).toBe("G12*F12");          // Thành tiền nhóm A = đơn giá × SL(2)
    expect(res(ws, "H12")).toBe(500000);
    expect(fx(ws, "G15")).toBe("SUM(H16:H16)");   // Nhóm B
    expect(fx(ws, "H15")).toBe("G15");              // SL nhóm B = 1 → = đơn giá nhóm
    expect(res(ws, "H15")).toBe(400000);
  });

  it("subtotal có nhóm = cộng dòng NHÓM (không double-count mục con)", async () => {
    const ws = await load(grouped());
    let subRow = null;
    for (let r = 16; r < 30; r++) { if (fx(ws, `H${r}`) === "H12+H15") { subRow = r; break; } }
    expect(subRow).not.toBeNull();
    expect(res(ws, `H${subRow}`)).toBe(900000);             // 500k + 400k, KHÔNG cộng H13/H14/H16
    expect(fx(ws, `H${subRow + 1}`)).toMatch(/H\d+\*8%/);   // VAT trỏ về ô subtotal
  });

  it("không nhóm: subtotal vẫn là SUM cột Thành Tiền (sống)", async () => {
    const ws = await load(makeQuote());   // groupSubtotal:false
    let f = null; for (let r = 12; r < 30; r++) { const ff = fx(ws, `H${r}`); if (ff && /^SUM\(H\d+:H\d+\)$/.test(ff)) f = ff; }
    expect(f).toMatch(/^SUM\(H\d+:H\d+\)$/);
  });
});
