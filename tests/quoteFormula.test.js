import { describe, it, expect } from "vitest";
import { translateFormula, evalEditorFormula, buildFormulaContext, colLetter } from "../src/quoteFormula.js";

// --- ctx giả lập theo template GN (không ngày, CÓ Chi Tiết) ---
//   cột editor:  A=_stt B=name C=detail D=unit E=quantity F=unitPrice G=_amount H=notes
//   cột Excel :  stt=B name=C detail=D unit=E quantity=F unitPrice=G amount=H notes=I
//   hàng item :  editor row N (item idx N-1) → Excel firstRow 12 + (N-1)
const GN_COLS = { stt: "B", name: "C", detail: "D", unit: "E", quantity: "F", unitPrice: "G", amount: "H", notes: "I" };
function gnCtx() {
  return {
    colToField: { A: "_stt", B: "name", C: "detail", D: "unit", E: "quantity", F: "unitPrice", G: "_amount", H: "notes" },
    fieldToCol: { ...GN_COLS, _stt: "B", _amount: "H" },
    // Khớp buildFormulaContext: KHÔNG cho ref Thành Tiền (_amount) → tránh vòng lặp Excel.
    allowedRef: new Set(["quantity", "unitPrice", "days"]),
    rowToExcel: (n) => (n >= 1 && n <= 10 ? 11 + n : null),   // row1→12 … row10→21
    rangeOk: () => true,
  };
}

describe("translateFormula — số học thuần (không tham chiếu)", () => {
  const ctx = gnCtx();
  it("phần trăm giữ nguyên", () => expect(translateFormula("=1000000*8%", ctx)).toBe("1000000*8%"));
  it("dấu thập phân VN ',' → '.'", () => expect(translateFormula("=3,7*2,5", ctx)).toBe("3.7*2.5"));
  it("dấu thập phân '.' giữ nguyên", () => expect(translateFormula("=3.7*2.5", ctx)).toBe("3.7*2.5"));
  it("ký hiệu nhân × và x → *", () => {
    expect(translateFormula("=2×3", ctx)).toBe("2*3");
    expect(translateFormula("=2x3", ctx)).toBe("2*3");
  });
  it("không có dấu = đầu vẫn nhận", () => expect(translateFormula("500+700", ctx)).toBe("500+700"));
  it("chuỗi rỗng → null", () => expect(translateFormula("=", ctx)).toBeNull());
});

describe("translateFormula — tham chiếu ô (đổi toạ độ editor → Excel)", () => {
  const ctx = gnCtx();
  it("ref đơn: F3 (đơn giá item#3) → G14", () => {
    // editor F = unitPrice → Excel G; editor row 3 → Excel 14
    expect(translateFormula("=F3*1,1", ctx)).toBe("G14*1.1");
  });
  it("ref Số Lượng: E2 → F13", () => expect(translateFormula("=E2*100000", ctx)).toBe("F13*100000"));
  it("ref Thành Tiền (_amount) → null (tránh vòng lặp Excel)", () => expect(translateFormula("=G5+1000", ctx)).toBeNull());
  it("dải SUM(E3:E5) → SUM(F14:F16)", () => expect(translateFormula("=SUM(E3:E5)", ctx)).toBe("SUM(F14:F16)"));
  it("SUM nhiều ô: dấu ';' → ',' và đổi toạ độ", () =>
    expect(translateFormula("=SUM(F3;F4)", ctx)).toBe("SUM(G14,G15)"));
});

describe("translateFormula — fallback an toàn (trả null → ghi số)", () => {
  const ctx = gnCtx();
  it("hàm KHÔNG an toàn (CEILING) → null", () => expect(translateFormula("=CEILING(F3)", ctx)).toBeNull());
  it("tham chiếu cột CHỮ (name=B) → null", () => expect(translateFormula("=B3*2", ctx)).toBeNull());
  it("tham chiếu _stt (A) → null", () => expect(translateFormula("=A3+1", ctx)).toBeNull());
  it("ref hàng ngoài bảng → null", () => expect(translateFormula("=F99*2", ctx)).toBeNull());
  it("dải không liền mạch (rangeOk=false) → null", () => {
    const c = { ...gnCtx(), rangeOk: () => false };
    expect(translateFormula("=SUM(E3:E5)", c)).toBeNull();
  });
  it("AVG → AVERAGE (bí danh hợp lệ)", () => expect(translateFormula("=AVG(F3;F4)", ctx)).toBe("AVERAGE(G14,G15)"));
});

describe("evalEditorFormula — khớp ngữ nghĩa frontend", () => {
  it("=1000000*8% = 80000", () => expect(evalEditorFormula("=1000000*8%")).toBeCloseTo(80000));
  it("=3,7*2,5 = 9.25", () => expect(evalEditorFormula("=3,7*2,5")).toBeCloseTo(9.25));
  it("=SUM(10;20)+5 = 35", () => expect(evalEditorFormula("=SUM(10;20)+5")).toBeCloseTo(35));
  it("=ROUND(123456*8%;0) = 9876", () => expect(evalEditorFormula("=ROUND(123456*8%;0)")).toBeCloseTo(9876));
  it("hàm lạ → NaN/null", () => expect(evalEditorFormula("=NOPE(1;2)")).toBeNull());
});

// Dựng fctx như excel.js: bản đồ ĐỐI TƯỢNG item (item/sub đã đặt chỗ) → hàng Excel.
function fcFor(cols, items, slotRows) {
  const rowByItem = new Map();
  items.forEach((it, j) => {
    if (it && (it.kind === "item" || it.kind === "sub") && slotRows[j] != null) rowByItem.set(it, slotRows[j]);
  });
  return buildFormulaContext({
    cols, items,
    rowToExcel: (i) => (rowByItem.has(items[i]) ? rowByItem.get(items[i]) : null),
  });
}

describe("buildFormulaContext — end-to-end theo sheet GN", () => {
  // 3 item liên tiếp ở hàng Excel 12,13,14
  const items = [
    { kind: "item", quantity: 2, unitPrice: 80000, formulas: { unitPrice: "=1000000*8%" } },                 // 1000000*8% = 80000 ✓
    { kind: "item", quantity: 9.99, unitPrice: 95000, formulas: { quantity: "=3,33*3" } },                    // 3.33*3 = 9.99 ✓
    { kind: "item", quantity: 1, unitPrice: 80000, formulas: { unitPrice: "=F1*1" } },                        // ref đơn giá item#1 (80000) ✓
  ];
  const fc = fcFor(GN_COLS, items, [12, 13, 14]);

  it("công thức số học thuần được xuất (kết quả khớp)", () =>
    expect(fc.cellFormula(items[0].formulas.unitPrice, 80000)).toBe("1000000*8%"));
  it("công thức Số Lượng VN-decimal được xuất", () =>
    expect(fc.cellFormula(items[1].formulas.quantity, 9.99)).toBe("3.33*3"));
  it("công thức tham chiếu được đổi toạ độ (F1 → G12)", () =>
    expect(fc.cellFormula(items[2].formulas.unitPrice, 80000)).toBe("G12*1"));
  it("công thức rỗng → null (ghi số)", () =>
    expect(fc.cellFormula(undefined, 2)).toBeNull());
  it("TỰ KIỂM chặn: giá trị đã lưu LỆCH với công thức → null", () =>
    expect(fc.cellFormula(items[0].formulas.unitPrice, 999999)).toBeNull());
});

describe("buildFormulaContext — chặn ref vào hàng NHÓM", () => {
  // item#2 (idx1) là section → ref vào nó phải fallback
  const items = [
    { kind: "item", quantity: 1, unitPrice: 100, formulas: { unitPrice: "=G2*2" } },   // G2 = _amount của idx1 (section)
    { kind: "section", quantity: 0, unitPrice: 0 },
    { kind: "item", quantity: 1, unitPrice: 100 },
  ];
  const fc = fcFor(GN_COLS, items, [12, 13, 14]);
  it("ref trỏ vào hàng nhóm → null", () => expect(fc.cellFormula(items[0].formulas.unitPrice, 100)).toBeNull());
});

describe("buildFormulaContext — CLF: ref vượt qua dòng 'info' vẫn ĐÚNG toạ độ", () => {
  // editor: row1=info, row2=itemA(Đơn Giá 1.000.000), row3=itemB (=F2*1,1 → 1.100.000).
  // Dòng info bị lọc khỏi bảng (Excel) nên itemA ở Excel 12, itemB ở 13. Ref F2 (itemA)
  // PHẢI ra G12 — đây là lỗi lệch chỉ số mà bản sửa (tra theo đối tượng) khắc phục.
  const info = { kind: "info", name: "Thông tin chương trình" };
  const itemA = { kind: "item", quantity: 1, unitPrice: 1_000_000 };
  const itemB = { kind: "item", quantity: 1, unitPrice: 1_100_000, formulas: { unitPrice: "=F2*1,1" } };
  const editorItems = [info, itemA, itemB];        // thứ tự editor (gồm info)
  // rowToExcel theo đối tượng: info→null (đã lọc), itemA→12, itemB→13.
  const rowByItem = new Map([[itemA, 12], [itemB, 13]]);
  const fc = buildFormulaContext({
    cols: GN_COLS, items: editorItems,
    rowToExcel: (i) => (rowByItem.has(editorItems[i]) ? rowByItem.get(editorItems[i]) : null),
  });
  it("ref F2 (itemA) → G12, KHÔNG tự trỏ vào itemB", () =>
    expect(fc.cellFormula(itemB.formulas.unitPrice, 1_100_000)).toBe("G12*1.1"));
});

describe("colLetter", () => {
  it("0→A, 5→F, 25→Z, 26→AA", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(5)).toBe("F");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
  });
});
