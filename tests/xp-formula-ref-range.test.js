// LỖI: src/quoteFormula.ts — `refsInFormula` bung MỌI dải ô "A1:A<n>" thành một đối tượng
//      {row, field} cho TỪNG hàng, không có trần nào. Nó chạy ở DÒNG ĐẦU TIÊN của
//      `cellFormula`, tức TRƯỚC `translateFormula` — nơi duy nhất từ chối hàng nằm ngoài bảng
//      (mapRef → rowToExcel). Nên trần "ngoài phạm vi" không bao giờ kịp chặn.
//
// TÁI HIỆN: người dùng gõ vào ô Số Lượng công thức `=SUM(G1:G4000000)` (G = cột Thành Tiền
//      trong hệ toạ độ editor). Chuỗi công thức được lưu nguyên văn: validators chỉ giới hạn
//      ĐỘ DÀI (`z.record(z.string().max(40), z.string().max(2000))`), không soi nội dung.
//      Đo bằng đồng hồ: chưa vá mất ~1,5 s và ~280 MB heap cho MỘT ô (dải 2 triệu hàng đã là
//      778 ms / 140 MB); vá rồi trả về gần như tức thì.
//
// HẬU QUẢ: một báo giá "nhiễm" như vậy làm hết heap MỖI LẦN có người bấm Xuất Excel. Worker
//      xuất file không đặt resourceLimits và còn nhánh dự phòng chạy NGAY trong tiến trình API
//      → hết heap là abort cả server, không riêng job xuất.
import { describe, it, expect } from "vitest";
import { buildFormulaContext } from "../src/quoteFormula.js";

// Template GN (có Chi Tiết, không có Số Ngày) → cột editor:
//   A=_stt B=name C=detail D=unit E=quantity F=unitPrice G=_amount H=notes
const GN_COLS = { stt: "B", name: "C", detail: "D", unit: "E", quantity: "F", unitPrice: "G", amount: "H", notes: "I" };
function fcFor(items, slotRows) {
  const byItem = new Map();
  items.forEach((it, j) => { if (it && (it.kind === "item" || it.kind === "sub") && slotRows[j] != null) byItem.set(it, slotRows[j]); });
  return buildFormulaContext({ cols: GN_COLS, items, rowToExcel: (i) => (byItem.has(items[i]) ? byItem.get(items[i]) : null) });
}
const threeItems = () => [
  { kind: "item", name: "A", quantity: 2, unitPrice: 100000 },
  { kind: "item", name: "B", quantity: 3, unitPrice: 200000 },
  { kind: "item", name: "C", quantity: 1, unitPrice: 50000, formulas: {} },
];

describe("quoteFormula — dải ô khổng lồ không được bung ra bộ nhớ", () => {
  it("dải 4 triệu hàng trỏ vào cột Thành Tiền: trả null NGAY, không ngốn heap", () => {
    const items = threeItems();
    items[2].formulas.quantity = "=SUM(G1:G4000000)";
    const fc = fcFor(items, [12, 13, 14]);
    const t0 = Date.now();
    const out = fc.cellFormula(items[2].formulas.quantity, 1, { item: items[2], field: "quantity" });
    const dt = Date.now() - t0;
    expect(out).toBeNull();                 // ngoài bảng → ghi số (đúng như trước)
    expect(dt).toBeLessThan(300);           // ĐỎ khi chưa vá: ~1500 ms
  });

  it("dải khổng lồ trỏ vào cột Đơn Giá (không phải Thành Tiền) cũng phải trả null NGAY", () => {
    const items = threeItems();
    items[2].formulas.quantity = "=SUM(F1:F4000000)";
    const fc = fcFor(items, [12, 13, 14]);
    const t0 = Date.now();
    const out = fc.cellFormula(items[2].formulas.quantity, 1, { item: items[2], field: "quantity" });
    expect(out).toBeNull();
    expect(Date.now() - t0).toBeLessThan(300);
  });

  it("công thức nhiễm ở hàng KHÁC không làm chậm việc dịch hàng lành (đồ thị phụ thuộc)", () => {
    const items = threeItems();
    items[0].formulas = { unitPrice: "=SUM(G1:G4000000)" };   // hàng 1 bị nhiễm
    items[2].formulas.quantity = "=G1*1";                     // hàng 3 tham chiếu hàng 1 → duyệt đồ thị
    const fc = fcFor(items, [12, 13, 14]);
    const t0 = Date.now();
    fc.cellFormula(items[2].formulas.quantity, 200000, { item: items[2], field: "quantity" });
    expect(Date.now() - t0).toBeLessThan(300);                // ĐỎ khi chưa vá: depsOf() bung lại dải
  });

  it("KHÔNG ĐỔI HÀNH VI: dải ô bình thường vẫn dịch được sang công thức Excel", () => {
    const items = threeItems();
    items[2].formulas.quantity = "=SUM(E1:E2)";               // E = quantity → Excel F12:F13
    const fc = fcFor(items, [12, 13, 14]);
    expect(fc.cellFormula(items[2].formulas.quantity, 5, { item: items[2], field: "quantity" })).toBe("SUM(F12:F13)");
  });

  it("KHÔNG ĐỔI HÀNH VI: ref cột Thành Tiền hợp lệ vẫn xuất được", () => {
    const items = threeItems();
    items[2].formulas.quantity = "=G1*1";                     // G1 = Thành Tiền item#1 = 200000
    const fc = fcFor(items, [12, 13, 14]);
    expect(fc.cellFormula(items[2].formulas.quantity, 200000, { item: items[2], field: "quantity" })).toBe("H12*1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VÒNG 2 — LỖ HỔNG CÒN LẠI: trần MAX_REF_ROWS đặt theo TỪNG DẢI, không phải theo
// TỔNG số ref bung ra trong MỘT công thức. `refsInFormula` kiểm `r1 - r0 > MAX_REF_ROWS`
// bên trong mỗi lần khớp regex, nhưng mảng `out` thì tích luỹ qua TẤT CẢ các dải.
//
// TÁI HIỆN: `=SUM(G1:G20001, G1:G20001, …)` lặp 199 lần dài đúng 1995 ký tự — LỌT trần
//      2000 ký tự của `formulas: z.record(z.string().max(40), z.string().max(2000))` — và
//      bung ~4.000.000 đối tượng. Đo trên mã chưa vá vòng 2: 1265 ms / 430 MB heap cho MỘT ô.
//      Ca test dưới đây cố ý dùng payload RẺ (10 dải × 5001 hàng = 50.010 ref) để chính test
//      không phải ngốn 400 MB mỗi lần chạy — bất biến bị vi phạm là như nhau.
//
// VÌ SAO KHẲNG ĐỊNH TRÊN `_refsInFormula` chứ không phải `cellFormula`: cellFormula vốn ĐÃ
//      trả null cho các dải này (ref ngoài bảng), nên nó XANH cả khi lỗ hổng còn nguyên —
//      đúng cái bẫy làm bộ test vòng 1 bỏ lọt. Bất biến thật sự cần ghim là "số ref bung ra
//      bị chặn", và nó đo được trực tiếp bằng giá trị trả về của refsInFormula.
describe("quoteFormula — trần ref phải TÍCH LUỸ cho cả công thức, không phải theo từng dải", () => {
  const ctxOf = () => fcFor(threeItems(), [12, 13, 14]);

  it("nhiều dải NHỎ cộng lại vượt trần: refsInFormula trả null (không bung 50.000 ref)", () => {
    // Mỗi dải chỉ 5001 hàng — dưới trần 20.000 theo-dải, nên trần cũ KHÔNG chặn.
    const f = "=SUM(" + Array.from({ length: 10 }, () => "G1:G5001").join(",") + ")";
    expect(f.length).toBeLessThanOrEqual(2000);   // tiền đề: Zod lưu được chuỗi này
    expect(ctxOf()._refsInFormula(f)).toBeNull(); // ĐỎ khi chưa vá: mảng 50.010 phần tử
  });

  it("bộ tự kiểm (editorRefs.range) cũng không được là đường vòng bung lại", () => {
    const refs = ctxOf()._editorRefs;
    // Gọi 10 lần, mỗi lần 5001 hàng: ngân sách dùng chung của MỘT lần dịch phải cạn.
    const lens = Array.from({ length: 10 }, () => refs.range("G1", "G5001").length);
    const total = lens.reduce((s, n) => s + n, 0);
    expect(total).toBeLessThanOrEqual(20_000);    // ĐỎ khi chưa vá: 50.010
  });

  it("KHÔNG ĐỔI HÀNH VI: công thức thật (nhiều dải nhỏ) vẫn dịch được", () => {
    const items = threeItems();
    items[2].formulas.quantity = "=SUM(E1:E2)+SUM(E1:E2)";   // 2 dải × 2 hàng
    const fc = fcFor(items, [12, 13, 14]);
    expect(fc.cellFormula(items[2].formulas.quantity, 10, { item: items[2], field: "quantity" }))
      .toBe("SUM(F12:F13)+SUM(F12:F13)");
  });
});

// Ghim TIỀN ĐỀ của cả nhóm test trên bằng chính Zod của app, thay vì chỉ ghi trong bình luận:
// payload công thức "nhiễm" phải LƯU ĐƯỢC thì lỗ hổng mới có đường đi tới lúc xuất file.
describe("quoteFormula — tiền đề: validators chỉ giới hạn ĐỘ DÀI công thức", () => {
  it("QuoteCreateSchema chấp nhận công thức 199 dải (1995 ký tự)", async () => {
    const { QuoteCreateSchema } = await import("../src/validators.js");
    const evil = "=SUM(" + Array.from({ length: 199 }, () => "G1:G20001").join(",") + ")";
    expect(evil.length).toBe(1995);
    const r = QuoteCreateSchema.safeParse({
      title: "T", toCompany: "K", companyId: 1,
      sheets: [{ name: "S", templateId: 1, items: [{ kind: "item", name: "A", quantity: 1, unitPrice: 1000, formulas: { quantity: evil } }] }],
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(r.data.sheets[0].items[0].formulas.quantity).toBe(evil);   // lưu NGUYÊN VĂN
  });
});
