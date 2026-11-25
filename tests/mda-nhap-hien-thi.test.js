// BÁO GIÁ CHƯA CHỐT HIỆN "NHÁP <số báo giá>" — chủ repo 2026-11-25: mã dự án chỉ cấp lúc khách chốt (src/maDuAn.ts),
// nên báo giá chưa chốt có projectCode = null. Mọi chỗ hiển thị mã phải ra "NHÁP GN26045" (kèm số BG để hai file nháp
// vẫn phân biệt được) — không "null", không "_01" trơ trọi, không lùi im về số BG như thể đó là mã dự án.
//
// Ngoại lệ CỐ Ý: báo giá ĐÃ CHỐT mà không mã (người tạo không có tiền tố) giữ hành vi cũ — mã hiển thị là số BG, vì trang
// Nhân sự lưu cứng chuỗi đó và tra BẰNG-ĐÚNG. Vắng `status` (chỗ gọi chỉ đọc báo giá đã chốt) = hành vi cũ.
// ĐỎ trên 7a6ce18: codeLabel lùi về số BG cho mọi báo giá không mã; tên file / ô mã Excel / PDF không có chữ NHÁP.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import * as SV from "../src/quoteCode.js";
import * as WEB from "../shared/quote-math.js";
import { tenFileXuat } from "../src/quoteUtils.js";
import { buildQuoteBuffer } from "../src/excel.js";
import { renderQuotePdf } from "../src/pdf.js";

const nhap = { projectCode: null, projectVersion: 1, quoteNumber: "GN26045", status: "draft" };

describe("nhãn mã dự án — báo giá chưa chốt", () => {
  for (const [ten, M] of [["máy chủ (src/quoteCode.ts)", SV], ["web (shared/quote-math.ts)", WEB]]) {
    it(`${ten}: chưa chốt + không mã → "NHÁP <số BG>", nhiều sheet thêm hậu tố sau đó`, () => {
      expect(M.codeLabel(nhap)).toBe("NHÁP GN26045");
      expect(M.sheetCode(nhap, 2, 3)).toBe("NHÁP GN26045_02");
      expect(M.sheetCode(nhap, 1, 1)).toBe("NHÁP GN26045");
      for (const status of ["pending", "approved", "rejected", "sent", "lost"]) expect(M.codeLabel({ ...nhap, status })).toBe("NHÁP GN26045");
      // Nháp là PHIÊN BẢN mới của dự án (projectVersion còn từ dữ liệu cũ): không gắn _vN vào chữ NHÁP.
      expect(M.codeLabel({ ...nhap, projectVersion: 3 })).toBe("NHÁP GN26045");
      expect(M.codeLabel({ ...nhap, quoteNumber: "" })).toBe("NHÁP");
      expect(M.laNhap(nhap)).toBe(true);
    });
    it(`${ten}: đã chốt / có mã / không biết trạng thái → như cũ`, () => {
      expect(M.codeLabel({ ...nhap, status: "converted" }), "đã chốt không mã: mã hiển thị là số BG (Nhân sự tra bằng chuỗi này)").toBe("GN26045");
      expect(M.codeLabel({ ...nhap, status: undefined })).toBe("GN26045");
      expect(M.codeLabel({ ...nhap, projectCode: "FP_A26_001", status: "converted", projectVersion: 2 })).toBe("FP_A26_001_v2");
      // Dữ liệu cũ chưa dọn: nháp VẪN mang mã → hiện mã (công cụ donMaDuAn gỡ sau).
      expect(M.codeLabel({ ...nhap, projectCode: "FP_A26_009" })).toBe("FP_A26_009");
      expect(M.laNhap({ ...nhap, status: "converted" })).toBe(false);
    });
  }
});

describe("tên file xuất", () => {
  it("nháp: mở đầu NHAP_<số BG>; không mã KH / tiêu đề thì chỉ NHAP_<số BG>", () => {
    const q = { ...nhap, customer: { code: "KH01" }, shortTitle: "Lễ khai trương" };
    expect(tenFileXuat(q, 5, "xlsx")).toMatch(/^NHAP_GN26045_KH01_Le_khai_truong_\d{4}\.xlsx$/);
    expect(tenFileXuat({ ...nhap }, 5, "pdf")).toBe("NHAP_GN26045.pdf");
  });
  it("đã chốt: y như trước (không chữ NHÁP)", () => {
    const q = { ...nhap, status: "converted", projectCode: "FP_A26_001", customer: { code: "KH01" }, shortTitle: "Le" };
    expect(tenFileXuat(q, 5, "xlsx")).toMatch(/^KH01_Le_\d{4}\.xlsx$/);
    expect(tenFileXuat({ ...nhap, status: "converted" }, 5, "xlsx")).toBe("GN26045.xlsx");
  });
});

const baoGiaXuat = (extra = {}) => ({
  id: 1, quoteNumber: "GN26045", projectCode: null, projectVersion: 1, status: "draft",
  title: "Thử NHÁP", toCompany: "Khách", toContact: "Mr. A", fromContact: "B", fromAddress: "1 Thử", city: "TP. Hồ Chí Minh",
  quoteDate: new Date("2026-11-25T00:00:00Z"), vatPercent: 8, hnTables: [], company: { name: "Cty" },
  subtotal: 0, vat: 0, total: 0,
  sheets: [1, 2].map((n) => ({
    id: n, name: `Trang ${n}`, order: n, codeNo: n, templateCode: "marico_decor", groupSubtotal: false, discount: 0, extraTables: [],
    items: [{ order: 1, kind: "item", name: `HM ${n}`, unit: "bộ", quantity: 1, unitPrice: 100_000 }],
  })),
  ...extra,
});

describe("ô mã trong file Excel", () => {
  const moChu = async (q) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuoteBuffer(q));
    const ds = [];
    const chuOi = (v) => (v && typeof v === "object" && Array.isArray(v.richText) ? v.richText.map((x) => x.text).join("") : typeof v === "string" ? v : "");
    // Ô phụ của vùng gộp: `.text` của ExcelJS ném lỗi — chỉ đọc ô chủ.
    for (const ws of wb.worksheets) ws.eachRow((r) => r.eachCell((c) => { if (!c.isMerged || c.master === c) ds.push(chuOi(c.value)); }));
    return ds;
  };
  it("nháp: mỗi tab ghi (Số://NHÁP GN26045_01) / _02 — không 'null', không '_01' trơ trọi", async () => {
    const chu = await moChu(baoGiaXuat());
    expect(chu).toContain("(Số://NHÁP GN26045_01)");
    expect(chu).toContain("(Số://NHÁP GN26045_02)");
    expect(chu.some((t) => /null|\(Số:\/\/_\d/.test(t))).toBe(false);
  }, 30_000);
  it("đã chốt: ô mã là mã sản xuất như cũ", async () => {
    const chu = await moChu(baoGiaXuat({ status: "converted", projectCode: "FP_A26_007" }));
    expect(chu).toContain("(Số://FP_A26_007_01)");
  }, 30_000);
});

describe("dòng Số: trong PDF", () => {
  let chu = [];
  beforeEach(() => {
    chu = [];
    const goc = PDFDocument.prototype.text;
    vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (t, ...rest) {
      chu.push(String(t));
      return goc.call(this, t, ...rest);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("nháp: 'Số: NHÁP GN26045' (số BG không in lặp lần hai), mỗi sheet mang NHÁP GN26045_0n", async () => {
    await renderQuotePdf(baoGiaXuat());
    expect(chu).toContain("Số: NHÁP GN26045");
    expect(chu.some((t) => t.includes("Trang 2 — NHÁP GN26045_02"))).toBe(true);
  }, 30_000);
  it("đã chốt: 'Số: <mã> · <số BG>' như cũ", async () => {
    await renderQuotePdf(baoGiaXuat({ status: "converted", projectCode: "FP_A26_007" }));
    expect(chu).toContain("Số: FP_A26_007 · GN26045");
  }, 30_000);
});
