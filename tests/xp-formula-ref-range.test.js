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
