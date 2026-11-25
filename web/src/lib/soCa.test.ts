// MẪU CINETOUR — phần thuần của cột SỐ CA ở web (chủ repo 2026-11-25). ĐỎ trên 7a6ce18: lineAmount chưa nhân Số Ca,
// sơ đồ chữ cột / thứ tự mẫu / bộ dán / bộ nạp Excel chưa biết cột này.
import { describe, it, expect, vi } from "vitest";
vi.mock("./ui", async (goc) => ({ ...(await goc<typeof import("./ui")>()), toast: () => {}, confirmModal: vi.fn(async () => true) }));

import * as M from "./quoteMath";
import { soDoDiaChi, chuCot } from "./soDoDiaChi";
import { sapMauHienThi, nhomMau, mauMacDinhMoi } from "./thuTuMau";
import { doanBoCot } from "./doanBoCot";
import { headerToRoles, reconstructExportRows } from "./clipboard";
import { addrFields, toGridItems, autoTargetIndexes, diffItems, doiChieuNhapExcel } from "./importApply";
import { demHangCoSoCa, hoiDoiMauBoSoCa } from "./soCa";
import { extraTableSum } from "../components/ExtraTables";
import { confirmModal } from "./ui";
import type { EditorTemplate, ImportedItem } from "./api";

const it0 = (o: Partial<M.Item>): M.Item => ({ kind: "item", name: "x", quantity: 1, unitPrice: 0, ...o });

describe("lineAmount — Số Ca", () => {
  it("không ngày: SL × Số Ca × Đơn Giá", () => {
    expect(M.lineAmount(it0({ quantity: 2, unitPrice: 150_000, shifts: 3 }), false, true)).toBe(900_000);
  });
  it("có ngày: SL × Số Ngày × Số Ca × Đơn Giá", () => {
    expect(M.lineAmount(it0({ quantity: 2, days: 3, unitPrice: 150_000, shifts: 2 }), true, true)).toBe(1_800_000);
  });
  it.each([null, undefined, 0])("Số Ca trống (%s) = ×1 — như Số Ngày", (s) => {
    expect(M.lineAmount(it0({ quantity: 2, unitPrice: 150_000, shifts: s as number }), false, true)).toBe(300_000);
    expect(M.lineAmount(it0({ quantity: 2, days: null, unitPrice: 150_000, shifts: s as number }), true, true)).toBe(300_000);
  });
  it("mẫu KHÔNG có cột Số Ca (mặc định): không nhân, dù hàng còn giữ số ca", () => {
    expect(M.lineAmount(it0({ quantity: 2, unitPrice: 150_000, shifts: 3 }), false)).toBe(300_000);
    expect(M.lineAmount(it0({ quantity: 2, days: 2, unitPrice: 150_000, shifts: 3 }), true)).toBe(600_000);
  });
  it("làm tròn nửa-lên MỘT lần trên tích chính xác (0,5 ca × 3 × 15 = 22,5 → 23)", () => {
    expect(M.lineAmount(it0({ quantity: 3, unitPrice: 15, shifts: 0.5 }), false, true)).toBe(23);
    expect(M.lineAmount(it0({ quantity: 4.1, unitPrice: 15, shifts: 1 }), false, true)).toBe(62);   // 61,5 → 62 như Decimal
  });
  it("nhóm × Số Ca: sheetTotals nhân hệ số nhóm SAU khi nhân Số Ca từng dòng", () => {
    const items: M.Item[] = [
      { kind: "section", name: "A", quantity: 2, unitPrice: 0 },
      it0({ quantity: 1, unitPrice: 100_000, shifts: 3 }),
      it0({ quantity: 2, unitPrice: 50_000, shifts: null }),
    ];
    expect(M.sheetTotals({ items, groupSubtotal: true, discount: 0 }, false, true).gross).toBe((300_000 + 100_000) * 2);
    expect(M.sheetTotals({ items, groupSubtotal: false, discount: 0 }, false, true).gross).toBe(400_000);
    expect(M.sheetTotals({ items, groupSubtotal: true, discount: 0 }, false).gross, "mẫu thường").toBe(200_000 * 2);
  });
  it("hàng mới của mẫu CINETOUR mang Số Ca = 1; mẫu thường không có khoá shifts", () => {
    expect(M.blankItem(false, true).shifts).toBe(1);
    expect("shifts" in M.blankItem(true)).toBe(false);
  });
});

describe("sơ đồ chữ cột — Số Ca đứng sau Số Ngày / Số Lượng, mẫu cũ không đổi chữ nào", () => {
  it("không ngày CINETOUR: E = Số Ca, F = Đơn Giá", () => {
    const so = soDoDiaChi({ giuChiTiet: false, usesDays: false, usesShifts: true, internalNote: true });
    expect(["quantity", "shifts", "unitPrice", "_amount", "notes"].map((f) => chuCot(so, f))).toEqual(["D", "E", "F", "G", "H"]);
  });
  it("có ngày CINETOUR (CLF, có khe Chi Tiết): F SL · G Ngày · H Ca · I Đơn Giá", () => {
    const so = soDoDiaChi({ giuChiTiet: true, usesDays: true, usesShifts: true, internalNote: true });
    expect(["quantity", "days", "shifts", "unitPrice", "_amount"].map((f) => chuCot(so, f))).toEqual(["E", "F", "G", "H", "I"]);
  });
  it("mẫu cũ: y hệt trước (không khai usesShifts)", () => {
    const so = soDoDiaChi({ giuChiTiet: true, usesDays: false, internalNote: true });
    expect(chuCot(so, "shifts")).toBe("");
    expect(["quantity", "unitPrice", "_amount"].map((f) => chuCot(so, f))).toEqual(["E", "F", "G"]);
  });
  it("addrFields của bộ nạp Excel khớp sơ đồ của lưới", () => {
    for (const cfg of [{ addrDetail: false, usesDays: false, usesShifts: true }, { addrDetail: true, usesDays: true, usesShifts: true }]) {
      const so = soDoDiaChi({ giuChiTiet: cfg.addrDetail, usesDays: cfg.usesDays, usesShifts: cfg.usesShifts, internalNote: false });
      expect(addrFields(cfg)).toEqual(so.map((c) => c.f));
    }
  });
});

const mau = (id: number, code: string, name: string, companyId: number, hasDays: boolean, hasShifts = false) =>
  ({ id, code, name, companyId, layout: { hasDays, hasShifts, hasDetail: false, reserveDetail: false, numberSubsections: false } }) as EditorTemplate;
// Đúng thứ tự API (ORDER BY name, collation en_US.utf8 — "(" đứng trước chữ cái) sau khi có bốn mẫu CINETOUR.
const API: EditorTemplate[] = [
  mau(6, "clofull_conngay", "CLF (có ngày)", 2, true),
  mau(4, "clofull_decor", "CLF (không ngày)", 2, false),
  mau(5, "clofull_banner", "CLF Banner (không ngày)", 2, false),
  mau(10, "clofull_cinetour_conngay", "CLF CINETOUR (có ngày)", 2, true, true),
  mau(9, "clofull_cinetour", "CLF CINETOUR (không ngày)", 2, false, true),
  mau(2, "unibenfood", "GN (có ngày)", 1, true),
  mau(1, "marico_decor", "GN (không ngày)", 1, false),
  mau(3, "gn_banner", "GN Banner (không ngày)", 1, false),
  mau(8, "gn_cinetour_conngay", "GN CINETOUR (có ngày)", 1, true, true),
  mau(7, "gn_cinetour", "GN CINETOUR (không ngày)", 1, false, true),
];

describe("thứ tự ô chọn mẫu — Không ngày → Banner → Có ngày → CINETOUR Không ngày → CINETOUR Có ngày", () => {
  it("GN và CLF", () => {
    expect(sapMauHienThi(API.filter((t) => t.companyId === 1)).map((t) => t.name)).toEqual(
      ["GN (không ngày)", "GN Banner (không ngày)", "GN (có ngày)", "GN CINETOUR (không ngày)", "GN CINETOUR (có ngày)"]);
    expect(sapMauHienThi(API.filter((t) => t.companyId === 2)).map((t) => t.name)).toEqual(
      ["CLF (không ngày)", "CLF Banner (không ngày)", "CLF (có ngày)", "CLF CINETOUR (không ngày)", "CLF CINETOUR (có ngày)"]);
  });
  it("nhóm 3 / 4 theo cột Số Ca, kể cả khi tên có chữ banner", () => {
    expect(nhomMau({ code: "x", name: "X", layout: { hasShifts: true } })).toBe(3);
    expect(nhomMau({ code: "x", name: "X", layout: { hasShifts: true, hasDays: true } })).toBe(4);
    expect(nhomMau({ code: "x_banner", name: "X", layout: { hasShifts: true } })).toBe(3);
  });
  it("mẫu chọn sẵn cho sheet / bảng MỚI vẫn là mẫu Không ngày thường, KHÔNG phải CINETOUR", () => {
    expect(mauMacDinhMoi(API, 1)?.code).toBe("marico_decor");
    expect(mauMacDinhMoi(API, 2)?.code).toBe("clofull_decor");
  });
});

describe("dán khối & nạp Excel nhận cột SỐ CA", () => {
  it("hàng tiêu đề \"SỐ CA\" → vai trò shifts; khối dựng lại đọc Số Ca là số đo", () => {
    const roles = headerToRoles(["STT", "Hạng Mục", "ĐVT", "SỐ LƯỢNG", "SỐ CA", "ĐƠN GIÁ", "THÀNH TIỀN", "GHI CHÚ"]);
    expect(roles).toEqual(["_stt", "name", "unit", "quantity", "shifts", "unitPrice", "_amount", "notes"]);
    const [b] = reconstructExportRows([["1", "Bảo vệ", "người", "2", "1,5", "300.000", "900.000", ""]], roles, new Set(["quantity", "unitPrice", "days", "shifts"]));
    expect(b.shifts).toBe(1.5);
    expect(b.unitPrice).toBe(300_000);
  });
  it("khối không tiêu đề từ tệp CLF CINETOUR có ngày dán vào sheet CLF thường → đoán đúng bố cục 10 cột", () => {
    const dong = [["1", "Bảo vệ", "ca đêm", "người", "2", "3", "2", "100000", "1200000", ""], ["2", "Lễ tân", "", "người", "1", "1", "3", "50000", "150000", ""]];
    const thuong = ["_stt", "name", "detail", "unit", "quantity", "unitPrice", "_amount", "notes"];
    expect(doanBoCot(dong, thuong)).toEqual(["_stt", "name", "detail", "unit", "quantity", "days", "shifts", "unitPrice", "_amount", "notes"]);
  });
  it("khối GN CINETOUR không ngày dán vào sheet CÙNG mẫu: hoà điểm với bố cục GN có ngày thì GIỮ bố cục đích (Số Ca)", () => {
    const dong = [["1", "Bảo vệ", "người", "2", "3", "100000", "600000", ""]];
    const dich = ["_stt", "name", "unit", "quantity", "shifts", "unitPrice", "_amount", "notes"];
    expect(doanBoCot(dong, dich)).toEqual(dich);
  });
  it("toGridItems: mẫu đích có Số Ca → nạp (trống = 1) và dịch công thức {shifts:n} sang chữ cột lưới", () => {
    const nap: ImportedItem[] = [
      { kind: "item", name: "A", unit: "người", quantity: 2, unitPrice: 100, shifts: 3, row: 12 },
      { kind: "item", name: "B", unit: "người", quantity: 1, unitPrice: 100, shifts: null, formulas: { unitPrice: "={shifts:1}*1000" }, row: 13 },
    ];
    const r = toGridItems(nap, { addrDetail: false, usesDays: false, usesShifts: true });
    expect(r.items.map((x) => x.shifts)).toEqual([3, 1]);
    expect(r.items[1].formulas?.unitPrice).toBe("=E1*1000");
    const r2 = toGridItems(nap, { addrDetail: true, usesDays: false });
    expect("shifts" in r2.items[0], "mẫu thường không mang khoá Số Ca").toBe(false);
    expect(r2.droppedFormulas, "công thức trỏ cột Số Ca không có ở mẫu đích → bỏ, giữ số").toBe(1);
  });
  it("ghép sheet tệp ngoài theo cấu trúc: tệp có Số Ca chỉ vào sheet mẫu có Số Ca", () => {
    const targets = [{ name: "GN", templateId: 1, items: [] }, { name: "Cine", templateId: 7, items: [] }];
    const kq = autoTargetIndexes([{ name: "x", templateCode: null, hasDays: false, hasShifts: true, numberSubs: false }], targets as never, API);
    expect(kq).toEqual([1]);
  });
  it("bảng đối chiếu nạp Excel thấy Số Ca đổi; tổng đối chiếu nhân Số Ca", () => {
    const truoc = [it0({ name: "A", unit: "người", quantity: 1, unitPrice: 100_000, shifts: 1 })];
    const sau = [it0({ name: "A", unit: "người", quantity: 1, unitPrice: 100_000, shifts: 2 })];
    const dong = diffItems(truoc, sau, false, undefined, false, true);
    expect(dong[0].kind).toBe("changed");
    expect(dong[0].fields.map((f) => f.field)).toEqual(["shifts"]);
    const t = doiChieuNhapExcel({ fs: { groupSubtotal: false, totals: { subtotal: 200_000 } }, mode: "replace", target: { groupSubtotal: false }, hangSauNap: sau, hangNap: sau, usesDays: false, usesShifts: true });
    expect(t.tongSauNap).toBe(200_000);
  });
});

describe("bảng nội bộ & đổi mẫu", () => {
  it("extraTableSum (web) nhân Số Ca như máy chủ; false = không nhân", () => {
    const t = { category: "hn", items: [{ kind: "item", name: "a", quantity: 2, unitPrice: 100_000, shifts: 3, days: 2 }] } as never;
    expect(extraTableSum(t, true, true)).toBe(1_200_000);
    expect(extraTableSum(t, true, false)).toBe(400_000);
    expect(extraTableSum(t, false, true)).toBe(600_000);
  });
  it("demHangCoSoCa: chỉ đếm hàng Số Ca khác 1 (trống / 0 / 1 là ×1), bỏ nhóm và dòng thông tin", () => {
    expect(demHangCoSoCa([it0({ shifts: 2 }), it0({ shifts: 1 }), it0({ shifts: null }), it0({ shifts: 0 }), it0({ kind: "section", shifts: 3 }), it0({ shifts: 0.5 })])).toBe(2);
  });
  it("hoiDoiMauBoSoCa: chỉ hỏi khi rời mẫu có Số Ca sang mẫu không có VÀ còn hàng Số Ca ≠ 1", async () => {
    const items = [it0({ shifts: 2 })];
    expect(hoiDoiMauBoSoCa(items, true, true, "X")).toBeNull();
    expect(hoiDoiMauBoSoCa(items, false, false, "X")).toBeNull();
    expect(hoiDoiMauBoSoCa([it0({ shifts: 1 })], true, false, "X")).toBeNull();
    const hoi = hoiDoiMauBoSoCa(items, true, false, "GN (không ngày)");
    expect(hoi).toBeInstanceOf(Promise);
    await hoi;
    expect(vi.mocked(confirmModal)).toHaveBeenCalledWith(expect.stringContaining("Số Ca"), expect.stringContaining("GN (không ngày)"), expect.anything());
  });
});
