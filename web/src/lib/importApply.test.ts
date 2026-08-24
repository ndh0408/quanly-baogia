import { describe, expect, it } from "vitest";
import type { EditorTemplate, ImportedSheet } from "./api";
import { autoTargetIndexes, NEW_IMPORT_SHEET, toGridItems } from "./importApply";

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
