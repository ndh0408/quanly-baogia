// Vòng đo HÀNG TIÊU ĐỀ CỘT dựng lại model cả sheet cho TỪNG ô bật wrap — soát toàn diện đợt 4 d4-excel 2.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `ws.model` của ExcelJS không phải thuộc tính có sẵn: mỗi lần đọc là một lần DỰNG LẠI model của cả
// sheet (duyệt mọi hàng, mọi ô) — tốn O(số ô). Khối "HÀNG TIÊU ĐỀ CỘT: NỚI THEO CHỮ" (đợt 3, 1d) đã
// lấy danh sách vùng gộp một lần (`gop`) nhưng với mỗi ô bật wrap vẫn gọi `beRongVungGop`, mà hàm
// đó lại đọc `ws.model` thêm lần nữa: GN đọc thêm 4–5 lần/sheet, Colorfull 2–3 lần/sheet. Đo trên
// báo giá 3 sheet × 500 dòng: 28 lần đọc, riêng việc dựng model tốn ~0,2–0,8 giây mỗi lần xuất.
//
// Bài này đếm số lần mã xuất (src/excel.ts) đọc `ws.model` khi xuất MỘT sheet. Mỗi bước cần danh
// sách vùng gộp MỚI NHẤT (các bước trước vừa gỡ/gộp lại ô) được đọc một lần: khối "Kính gửi" (CLF),
// nối vùng gộp sang cột ảnh (khi bật ảnh), hai ô gộp ngoài bảng (CLF: "Kính gửi", dải thông tin —
// ô rỗng không đo), ô tiêu đề, và hàng tiêu đề cột — MỘT lần dù hàng đó có bao nhiêu ô bật wrap.
// Hai lần ExcelJS tự đọc khi ghi tệp không tính.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";

const proto = Object.getPrototypeOf(new ExcelJS.Workbook().addWorksheet("x"));
const goc = Object.getOwnPropertyDescriptor(proto, "model");
let cuaTa = 0;
beforeAll(() => {
  Object.defineProperty(proto, "model", {
    ...goc,
    get() {
      // Khung [0] "Error", [1] getter này, [2] nơi đọc: chỉ đếm lần đọc từ mã xuất của app.
      const noiDoc = (new Error().stack || "").split("\n")[2] || "";
      if (/src[\\/]excel\.ts/.test(noiDoc)) cuaTa++;
      return goc.get.call(this);
    },
  });
});
afterAll(() => { Object.defineProperty(proto, "model", goc); });

async function demKhiXuat(code, anh) {
  cuaTa = 0;
  const buf = await buildQuoteBuffer({
    quoteNumber: "GN26D4", title: "Moana", toCompany: "Công ty ABC", toContact: "Anh A", vatPercent: 8, showTotals: true,
    city: "TP. Hồ Chí Minh", quoteDate: new Date("2026-09-24"),
    sheets: [{ order: 1, name: "", showImages: anh, template: { code }, items: [{ order: 0, kind: "item", name: "A", unit: "cái", quantity: 1, unitPrice: 1000 }] }],
  });
  expect(buf.length).toBeGreaterThan(0);
  return cuaTa;
}

// [mẫu, số lần đọc tối đa khi KHÔNG / CÓ cột ảnh]
//   Colorfull: Kính gửi (vùng gộp) + ô Kính gửi + tiêu đề + hàng tiêu đề cột = 4; bật ảnh +1.
//   GN      : tiêu đề + hàng tiêu đề cột = 2; bật ảnh +1.
const MAU = [
  ["clofull_decor", 4, 5], ["clofull_banner", 4, 5], ["clofull_conngay", 4, 5],
  ["marico_decor", 2, 3], ["unibenfood", 2, 3], ["gn_banner", 2, 3],
];

describe("Xuất Excel: hàng tiêu đề cột lấy danh sách vùng gộp MỘT lần", () => {
  for (const [code, khong, co] of MAU) {
    for (const anh of [false, true]) {
      const toiDa = anh ? co : khong;
      it(`${code}${anh ? " + cột ảnh" : ""}: đọc ws.model ≤ ${toiDa} lần cho một sheet`, async () => {
        const n = await demKhiXuat(code, anh);
        expect(n, "bài phải đếm được lần đọc của mã xuất").toBeGreaterThan(0);
        expect(n, `đọc ws.model ${n} lần — mỗi lần dựng lại model cả sheet`).toBeLessThanOrEqual(toiDa);
      });
    }
  }
});
