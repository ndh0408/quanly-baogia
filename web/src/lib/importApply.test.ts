import { describe, expect, it } from "vitest";
import type { EditorTemplate, ImportedSheet } from "./api";
import { autoTargetIndexes, NEW_IMPORT_SHEET, sapXepTheoFile, toGridItems } from "./importApply";

const templates: EditorTemplate[] = [
  { id: 1, code: "marico_decor", name: "GN (không ngày)", layout: { hasDays: false, numberSubsections: false } },
  { id: 2, code: "gn_banner", name: "GN Banner", layout: { hasDays: false, numberSubsections: true } },
  { id: 3, code: "unibenfood", name: "GN (có ngày)", layout: { hasDays: true, numberSubsections: false } },
];

const file = (templateCode: string | null, hasDays = false, numberSubs = false) => ({
  name: templateCode || "File ngoài", templateCode, hasDays, numberSubs,
}) as Pick<ImportedSheet, "name" | "templateCode" | "hasDays" | "numberSubs">;

describe("autoTargetIndexes", () => {
  it("ghép theo template thay vì ghép mù theo thứ tự sheet", () => {
    const files = [file("gn_banner", false, true), file("gn_banner", false, true), file("marico_decor"), file("marico_decor")];
    const targets = [{ templateId: 1 }, { templateId: 2 }, { templateId: 2 }];
    expect(autoTargetIndexes(files, targets, templates)).toEqual([1, 2, 0, NEW_IMPORT_SHEET]);
  });

  it("file ngoài chưa nhận ra mã mẫu chỉ ghép vào cấu trúc tương thích", () => {
    const files = [file(null, true, false), file(null, false, true)];
    const targets = [{ templateId: 1 }, { templateId: 3 }, { templateId: 2 }];
    expect(autoTargetIndexes(files, targets, templates)).toEqual([1, 2]);
  });

  it("không ép sheet đã nhận đúng mã mẫu vào template khác", () => {
    expect(autoTargetIndexes([file("gn_banner", false, true)], [{ templateId: 1 }], templates))
      .toEqual([NEW_IMPORT_SHEET]);
  });

  it("ưu tiên sheet trùng tên khi nhiều sheet dùng cùng template", () => {
    const files = [
      { ...file("marico_decor"), name: "Booth container" },
      { ...file("marico_decor"), name: "2. Backdrop" },
    ];
    const targets = [{ templateId: 1, name: "Backdrop" }];
    expect(autoTargetIndexes(files, targets, templates)).toEqual([NEW_IMPORT_SHEET, 0]);
  });
});

describe("toGridItems — dịch công thức giữa cột Excel và cột web", () => {
  const imported = [
    { kind: "item" as const, name: "A", unit: "cái", quantity: 2, unitPrice: 100_000, row: 12 },
    {
      kind: "item" as const, name: "B", unit: "cái", quantity: 1, unitPrice: 200_000, row: 13,
      formulas: { unitPrice: "={quantity:1}*100000" },
    },
  ];

  it("chừa cột Chi Tiết ẩn của mẫu GN cũ nên Số Lượng vẫn là cột E trên web", () => {
    const out = toGridItems(imported, { usesDays: false, addrDetail: true });
    expect(out.items[1].formulas).toEqual({ unitPrice: "=E1*100000" });
  });

  it("mẫu có Số Ngày đổi Số Lượng sang cột D nhưng công thức vẫn trỏ đúng trường", () => {
    const out = toGridItems(imported, { usesDays: true, addrDetail: false });
    expect(out.items[1].formulas).toEqual({ unitPrice: "=D1*100000" });
  });

  it("nạp nối thì dời số dòng tham chiếu theo vị trí khối mới", () => {
    const out = toGridItems(imported, { usesDays: false, addrDetail: true, baseRow: 5 });
    expect(out.items[1].formulas).toEqual({ unitPrice: "=E6*100000" });
  });

  it("mẫu đích thiếu cột công thức thì giữ số và bỏ ref chết", () => {
    const rows = [{
      kind: "item" as const, name: "A", quantity: 1, unitPrice: 100_000, days: 2, row: 12,
      formulas: { days: "={quantity:1}+1" },
    }];
    const out = toGridItems(rows, { usesDays: false, addrDetail: true });
    expect(out.items[0].formulas).toBeUndefined();
    expect(out.items[0].unitPrice).toBe(100_000);
    expect(out.droppedFormulas).toBe(1);
  });

  it("giữ cờ Số Lượng chính xác từ kết quả đọc Excel", () => {
    const rows = [{ kind: "item" as const, name: "A", quantity: 0.9075, quantityExact: true, unitPrice: 2_200_000, row: 12 }];
    const out = toGridItems(rows, { usesDays: false, addrDetail: true });
    expect(out.items[0]).toMatchObject({ quantity: 0.9075, quantityExact: true });
  });
});

// LỖI THẬT (2026-09-07, file BaoGia_GN26073): nạp file 10 sheet vào báo giá MỚI (đang có đúng một
// sheet trắng). autoTargetIndexes ghép sheet thứ 3 của file vào chỗ trống đó (khớp tên+mẫu), 9
// sheet còn lại được NỐI VÀO CUỐI → thứ tự hiện ra là [3, 1, 2, 4, 5, …]. Người dùng thấy tab đầu
// mang tên mẫu "GN (không ngày)" còn các tab sau là "1. Banner", "2. Ticketbox", "4. LCD"…
describe("sapXepTheoFile — trả các sheet đến từ file về đúng thứ tự trong file", () => {
  it("sheet thứ 3 của file ghép vào chỗ trống, 9 sheet kia nối đuôi → sắp lại thành 1..10", () => {
    const trong = { id: "trong" };                                  // sheet trắng của báo giá mới
    const moi = Array.from({ length: 9 }, (_, i) => ({ id: `moi${i}` }));
    const sheets = [trong, ...moi];                                  // đúng trạng thái sau vòng nạp
    // Thứ tự TRONG FILE: f0, f1 là hai sheet mới đầu tiên; f2 chính là cái ghép vào chỗ trống.
    const theoFile = [moi[0], moi[1], trong, ...moi.slice(2)];
    sapXepTheoFile(sheets, theoFile);
    expect(sheets).toEqual(theoFile);
    expect(sheets[2]).toBe(trong);
    expect(sheets).toHaveLength(10);                                 // hoán vị: không thêm/bớt
  });

  it("sheet KHÔNG dính tới lượt nạp thì không xê dịch", () => {
    const a = { id: "a" }, b = { id: "b" }, c = { id: "c" }, d = { id: "d" };
    const sheets = [a, b, c, d];
    sapXepTheoFile(sheets, [c, b]);        // chỉ b và c đến từ file, và file xếp c trước b
    expect(sheets).toEqual([a, c, b, d]);  // a, d đứng yên; b/c hoán đổi trong đúng hai chỗ cũ
  });

  it("đã đúng thứ tự thì không đổi gì", () => {
    const a = { id: "a" }, b = { id: "b" };
    const sheets = [a, b];
    sapXepTheoFile(sheets, [a, b]);
    expect(sheets).toEqual([a, b]);
  });

  it("dưới 2 sheet, hoặc có sheet đã bị xoá khỏi mảng → không đụng vào", () => {
    const a = { id: "a" }, b = { id: "b" }, ngoai = { id: "ngoai" };
    const s1 = [a, b];
    sapXepTheoFile(s1, [b]);            // 1 phần tử
    expect(s1).toEqual([a, b]);
    sapXepTheoFile(s1, [b, ngoai]);     // `ngoai` không còn trong mảng (đã bị xoá)
    expect(s1).toEqual([a, b]);
  });
});
