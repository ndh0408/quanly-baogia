// Soát toàn diện L46 — dòng PHÍ tính theo Thành Tiền các dòng BÊN TRÊN (Đơn Giá =SUM(H7:H8)*10%)
// bị nạp thành NHÓM CON, Đơn Giá về 0, mất tiền phí.
//
// ĐÃ ĐO trước khi sửa: `hasGroupPriceFormula` chỉ hỏi "mọi tham chiếu có nằm ở cột Thành Tiền
// không", không hỏi HƯỚNG (dòng trên hay dòng dưới) lẫn HÌNH DẠNG (SUM thuần hay có nhân hệ số).
//   · clofull_decor còn mã A1, STT trống → kind=subsection ĐG=0 · tổng tự tính 1.400.000 (đúng 1.540.000)
//   · xoá A1, STT="2" → cả sheet lật numberSubs=true → đoán ra mẫu Banner → web ghép không được
//     vào sheet Décor đang có và mặc định TẠO SHEET MỚI.
//   · mẫu Banner còn A1, STT="2" → subsection ĐG=0.
// Cùng ý nghĩa đó viết =G6*13/100 (tham chiếu Đơn Giá nhóm) thì lại nạp đúng thành hạng mục.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { computeSubtotal, parseQuoteWorkbook } from "../src/excelImport.js";
import { TEMPLATE_CONFIGS } from "../src/templateConfigs.js";

const baoGia = (code) => ({
  quoteNumber: "GN26L46", title: "Phí quản lý", toCompany: "Cty", vatPercent: 8, showTotals: true, city: "HCM",
  quoteDate: new Date("2026-08-01T00:00:00Z"), fromContact: "S",
  sheets: [{ order: 1, name: "Décor", groupSubtotal: true, template: { code }, items: [
    { kind: "section", name: "NHÓM A", quantity: 1 },
    { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250000 },
    { kind: "item", name: "Standee", unit: "cái", quantity: 3, unitPrice: 300000 },
  ] }],
});

/** Tệp app xuất → (tuỳ chọn) chèn dòng phí dưới hạng mục cuối → (tuỳ chọn) xoá mã A1. */
async function tep(code, { chenPhi, stt = "", boA1 = false }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(baoGia(code)));
  const ws = wb.worksheets[0];
  const c = TEMPLATE_CONFIGS[code].items.columns;
  let rB = 0, rS = 0;
  ws.eachRow((row, r) => {
    const v = ws.getCell(`${c.name}${r}`).value;
    if (v === "Backdrop") rB = r;
    if (v === "Standee") rS = r;
  });
  expect(rB && rS, "không tìm thấy hàng hạng mục trong tệp xuất").toBeTruthy();
  if (chenPhi) {
    const r = rS + 1;
    ws.insertRow(r, [], "i");   // "Format Same As Above" — chép kiểu hàng Standee
    if (c.stt) ws.getCell(`${c.stt}${r}`).value = stt;
    ws.getCell(`${c.name}${r}`).value = "Phí quản lý 10%";
    ws.getCell(`${c.unit}${r}`).value = "gói";
    ws.getCell(`${c.quantity}${r}`).value = 1;
    ws.getCell(`${c.unitPrice}${r}`).value = { formula: `SUM(${c.amount}${rB}:${c.amount}${rS})*10%`, result: 140000 };
    ws.getCell(`${c.amount}${r}`).value = { formula: `ROUND(${c.unitPrice}${r}*${c.quantity}${r},0)`, result: 140000 };
  }
  if (boA1) ws.getCell("A1").value = null;
  const res = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  return res.sheets.find((s) => !s.skipped);
}

const CA = [];
for (const code of ["clofull_decor", "marico_decor", "clofull_banner", "gn_banner"])
  for (const stt of ["", "2"])
    for (const boA1 of [false, true]) CA.push([code, stt, boA1]);

describe("L46: dòng phí =SUM(các dòng TRÊN)*10% là HẠNG MỤC, không phải nhóm con", () => {
  it.each(CA)("%s · STT=%j · bỏ A1=%s", async (code, stt, boA1) => {
    const goc = await tep(code, { chenPhi: false, boA1 });
    const sheet = await tep(code, { chenPhi: true, stt, boA1 });
    const phi = sheet.items.find((i) => i.name === "Phí quản lý 10%");
    expect(phi, "mất dòng phí").toBeTruthy();
    expect(phi.kind, "dòng phí bị xếp thành nhóm → Đơn Giá ép 0").toBe("item");
    expect(phi.unitPrice).toBe(140000);
    expect(phi.quantity).toBe(1);
    // Một dòng phí KHÔNG được lật cách đánh số nhóm con của cả sheet, cũng không đổi mẫu đoán
    // (đổi mẫu = web ghép không được vào sheet đang có → mặc định tạo sheet mới).
    expect(sheet.numberSubs).toBe(goc.numberSubs);
    expect(sheet.templateCode).toBe(goc.templateCode);
    expect(computeSubtotal(sheet)).toBe(1540000);
  });

  it("nhóm của app xuất (Đơn Giá =SUM các dòng DƯỚI) vẫn là nhóm", async () => {
    const sheet = await tep("clofull_decor", { chenPhi: true, boA1: true });
    expect(sheet.items[0]).toMatchObject({ kind: "section", name: "NHÓM A", unitPrice: 0 });
  });
});
