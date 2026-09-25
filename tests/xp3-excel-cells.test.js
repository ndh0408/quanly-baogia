// P3 — hai lỗi ghi ô trong src/excel.ts, đều chỉ hại FILE GỬI KHÁCH:
//  1) `writeMerged` (khối chữ ký cuối báo giá) gán thẳng `cell.value = value` — KHÔNG qua
//     `neutralizeFormula` như `setCell`, dù nó nhận `quote.fromContact/fromTitle/fromPhone`
//     là chữ người dùng gõ tự do.
//  2) Tính năng logo khách hàng đã gỡ khỏi UI / máy chủ / Excel. Schema vẫn nhận trường cũ để
//     client đang cache không vỡ, nhưng payload đó KHÔNG được đổi nội dung hay media file xuất.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { buildQuoteBuffer } from "../src/excel.js";
import { TEMPLATE_CONFIGS } from "../src/templateConfigs.js";

function makeQuote(code, over = {}) {
  return {
    quoteNumber: "GN26XP3", title: "Báo giá kiểm thử XP3", toCompany: "Công ty ABC",
    toContact: "Anh A", toPhone: "0900000000", toAddress: "123 Đường X",
    vatPercent: 8, discount: 0, showTotals: true, city: "TP. Hồ Chí Minh",
    quoteDate: new Date("2026-06-13"), fromContact: "Chị B", fromTitle: "Sale",
    fromPhone: "0911111111", fromAddress: "456 Đường Y", greeting: "Xin gửi báo giá:",
    sheets: [{
      order: 1, name: "Sheet 1", groupSubtotal: false, template: { code },
      items: [
        { kind: "item", name: "Hạng mục 1", detail: "chi tiết", unit: "cái", quantity: 2, unitPrice: 1_000_000, days: null, notes: "" },
      ],
    }],
    ...over,
  };
}

/** Đọc chữ hiển thị của mọi ô trong sheet đầu (kể cả ô công thức). */
async function cellTexts(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      out.push({ addr: cell.address, value: cell.value, type: cell.type });
    });
  });
  return out;
}

describe("writeMerged (khối chữ ký) đi qua neutralizeFormula", () => {
  // Cờ showSender hiện là false ở mọi config nên nhánh này KHÔNG chạy trong production —
  // bật tạm ngay tại đây để bài test đi đúng qua lớp có lỗi thay vì gọi hàm nội bộ.
  const sign = TEMPLATE_CONFIGS.marico_decor.palette.footer.sign;
  const saved = sign.showSender;
  beforeAll(() => { sign.showSender = true; });
  afterAll(() => { sign.showSender = saved; });

  it("tên/chức danh/điện thoại người gửi bắt đầu bằng ký tự công thức đều được thêm dấu nháy", async () => {
    const buf = await buildQuoteBuffer(makeQuote("marico_decor", {
      fromContact: "=1+1", fromTitle: "+84 Sale", fromPhone: "-0911111111",
    }));
    const cells = await cellTexts(buf);
    const texts = cells.filter((c) => typeof c.value === "string").map((c) => c.value);
    // Ba giá trị PHẢI có mặt (nhánh showSender thật sự đã chạy)…
    expect(texts.some((t) => t.includes("1+1"))).toBe(true);
    expect(texts.some((t) => t.includes("84 Sale"))).toBe(true);
    expect(texts.some((t) => t.includes("0911111111"))).toBe(true);
    // …và không ô chữ nào được để mở đầu bằng ký tự công thức.
    for (const t of texts) expect(/^[=+\-@\t\r]/.test(t)).toBe(false);
    // Đồng thời không được biến thành ô CÔNG THỨC thật.
    for (const c of cells) {
      if (typeof c.value === "object" && c.value && "formula" in c.value) {
        expect(String(c.value.formula)).not.toContain("1+1");
      }
    }
  });
});

describe("payload customerLogo của client cũ không lọt vào file xuất", () => {
  const cases = [
    ["webp", "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/vuUAAA="],
    ["png", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="],
  ];

  it.each(cases)("%s: file giống hệt về ô C3 và số media khi không gửi logo", async (_ext, customerLogo) => {
    const [baseBuf, legacyBuf] = await Promise.all([
      buildQuoteBuffer(makeQuote("clofull_decor")),
      buildQuoteBuffer(makeQuote("clofull_decor", { customerLogo })),
    ]);
    const base = new ExcelJS.Workbook(), legacy = new ExcelJS.Workbook();
    await Promise.all([base.xlsx.load(baseBuf), legacy.xlsx.load(legacyBuf)]);
    // C3 là richText khi báo giá có mã (dòng mã nghiêng cuối khối "Kính gửi") — so theo CHỮ.
    const chuO = (v) => (Array.isArray(v?.richText) ? v.richText.map((x) => x.text).join("") : String(v || ""));
    const baseC3 = chuO(base.worksheets[0].getCell("C3").value);
    const legacyC3 = chuO(legacy.worksheets[0].getCell("C3").value);
    expect(legacyC3).toBe(baseC3);
    expect(legacyC3).toContain("Kính gửi:");
    expect(legacyC3).not.toContain("logo cty khách hàng");
    expect(legacy.model.media).toHaveLength(base.model.media.length);
  });
});
