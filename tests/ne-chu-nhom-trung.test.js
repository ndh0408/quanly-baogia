// CHỮ NHÓM TRÙNG SAU KHI NHẬP EXCEL — báo giá GN26008 (id 34) sheet "Lightbox" trên production, 2026-10-06.
//
// Tệp khách ghi cột STT của 5 hàng nhóm là: (trống), A, B, C, B — nhóm đầu thêm sau nên chưa đánh chữ, nhóm cuối
// chép từ nhóm "B". Bộ nhập giữ chữ của tệp khi nó KHÁC chữ app tự đánh, nhưng chữ tự đánh đếm theo VỊ TRÍ (A, B, C,
// D, E): nhóm đầu trống → tự đánh "A"; bốn nhóm sau đều "khác" vị trí của mình → đóng băng thành chữ tự đặt A, B, C, B.
// Màn soạn và tệp xuất hiện A, A, B, C, B — mà ô STT nhóm không sửa được trên màn soạn.
//
// Chốt: chữ tự đặt chỉ được giữ khi các nhóm vẫn mang chữ KHÔNG TRÙNG nhau. Trùng → bỏ hết chữ tự đặt của sheet đó
// (app đánh lại A, B, C…) và báo cho người nhập. ĐỎ trên mã cũ (label A/B/C/B, hiện A,A,B,C,B).
// Không làm hỏng ca hợp lệ: khách cố ý đánh nhóm I, II, III (khác chữ tự đánh, không trùng) → vẫn giữ.
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { parseQuoteWorkbook } from "../src/excelImport.js";
import { TEMPLATE_CONFIGS } from "../src/templateConfigs.js";

const CODE = "marico_decor";
const NHOM = ["Thay AW lightbox có sẵn tại rạp", "Sửa lightbox", "Lam Sơn Square", "GLX Go An Lạc", "Lightbox giao hàng"];
const items = NHOM.flatMap((ten, i) => [
  { kind: "section", name: ten, quantity: 1 },
  { kind: "item", name: `Hạng mục ${i + 1}`, unit: "bộ", quantity: 1, unitPrice: 100000 * (i + 1) },
]);
const baoGia = {
  quoteNumber: "GN26008", title: "Lên hương", toCompany: "Cty", vatPercent: 8, showTotals: true, city: "HCM",
  quoteDate: new Date("2026-09-14T00:00:00Z"), fromContact: "S",
  sheets: [{ order: 1, name: "Lightbox", groupSubtotal: true, template: { code: CODE }, items }],
};

/** Xuất tệp thật, ghi đè ô STT của 5 hàng nhóm bằng `stt`, rồi nhập lại. */
async function nhapVoiStt(stt) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildQuoteBuffer(baoGia));
  const ws = wb.worksheets[0];
  const c = TEMPLATE_CONFIGS[CODE].items.columns;
  NHOM.forEach((ten, i) => {
    let hang = 0;
    ws.eachRow((_r, rr) => { if (ws.getCell(`${c.name}${rr}`).value === ten) hang = rr; });
    expect(hang, `tìm thấy hàng nhóm "${ten}"`).toBeGreaterThan(0);
    ws.getCell(`${c.stt}${hang}`).value = stt[i] === "" ? null : stt[i];
  });
  const kq = await parseQuoteWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  return kq.sheets.find((s) => !s.skipped);
}
/** Chữ hiện ở ô STT của từng nhóm — đúng luật màn soạn/tệp xuất: chữ tự đặt, không có thì A, B, C theo thứ tự. */
const chuHien = (sheet) => sheet.items.filter((x) => x.kind === "section")
  .map((x, i) => x.label || String.fromCharCode(65 + i));

describe("nhập Excel: chữ nhóm trong tệp mà trùng nhau thì app đánh lại, không đóng băng", () => {
  it("STT nhóm (trống), A, B, C, B → hiện A, B, C, D, E và có cảnh báo", async () => {
    const s = await nhapVoiStt(["", "A", "B", "C", "B"]);
    expect(chuHien(s), "mã cũ: A, A, B, C, B").toEqual(["A", "B", "C", "D", "E"]);
    expect(s.items.filter((x) => x.kind === "section").map((x) => x.label ?? null)).toEqual([null, null, null, null, null]);
    expect(s.warnings.join(" | ")).toMatch(/chữ nhóm/i);
  });

  it("chữ nhóm khách cố ý đặt khác và không trùng (I, II, III, IV, V) → giữ nguyên, không cảnh báo", async () => {
    const s = await nhapVoiStt(["I", "II", "III", "IV", "V"]);
    expect(chuHien(s)).toEqual(["I", "II", "III", "IV", "V"]);
    expect(s.warnings.join(" | ")).not.toMatch(/chữ nhóm/i);
  });

  it("tệp đánh đúng A…E → không có chữ tự đặt nào (như cũ)", async () => {
    const s = await nhapVoiStt(["A", "B", "C", "D", "E"]);
    expect(s.items.filter((x) => x.kind === "section").every((x) => !x.label)).toBe(true);
    expect(chuHien(s)).toEqual(["A", "B", "C", "D", "E"]);
  });
});
