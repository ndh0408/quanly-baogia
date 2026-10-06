import { describe, it, expect } from "vitest";
import * as M from "./quoteMath";
import { coNhomNhanHeSo, coSauNhapExcel, khoaBatNhom, tbNhapTuBatNhom, TB_TU_BAT_NHOM, TB_TU_TAT_NHOM } from "./khoaThanhTienNhom";

// Luật khoá ô "Hiện Thành Tiền nhóm" là hàm THUẦN của (cờ, items) — kiểm riêng ở đây; đường nối vào lưới
// (gõ / dán / hoàn tác / ExtraTables / HnTables) nằm ở components/GridTable.khoaThanhTienNhom.test.tsx.
const it_ = (kind: M.Item["kind"], quantity: number, o: Partial<M.Item> = {}): M.Item =>
  ({ kind, name: "x", detail: "", unit: "", quantity, unitPrice: 100, days: null, notes: "", ...o }) as M.Item;

describe("coNhomNhanHeSo — có nhóm nào mà SL nhân THẬT vào tổng không", () => {
  it("nhóm / nhóm con SL > 1 → có", () => {
    expect(coNhomNhanHeSo([it_("section", 2), it_("item", 1)])).toBe(true);
    expect(coNhomNhanHeSo([it_("section", 1), it_("subsection", 3), it_("item", 1)])).toBe(true);
    expect(coNhomNhanHeSo([it_("section", 1.5)])).toBe(true);
  });

  it("nhóm SL 1 / 0 / bỏ trống → không (groupMult tối thiểu 1)", () => {
    expect(coNhomNhanHeSo([it_("section", 1), it_("item", 5)])).toBe(false);
    expect(coNhomNhanHeSo([it_("section", 0), it_("subsection", 0)])).toBe(false);
    expect(coNhomNhanHeSo([])).toBe(false);
  });

  it("SL 1,04 hiện là '1' (làm tròn 1 số lẻ như ô hiển thị) → không; SL 1,05 hiện '1,1' → có", () => {
    expect(coNhomNhanHeSo([it_("section", 1.04)])).toBe(false);
    expect(coNhomNhanHeSo([it_("section", 1.05)])).toBe(true);
    // Dòng SL chính xác 4 số lẻ nhân đúng số gốc.
    expect(coNhomNhanHeSo([it_("section", 1.04, { quantityExact: true })])).toBe(true);
  });

  it("hàng mục / dòng thông tin SL > 1 KHÔNG tính — chỉ hàng nhóm mới có hệ số", () => {
    expect(coNhomNhanHeSo([it_("item", 9), it_("sub", 9), it_("info", 9)])).toBe(false);
  });

  it("khớp đúng cái sheetSubtotalGrouped nhân: có nhóm SL > 1 ⇔ bật/tắt cờ đổi tổng", () => {
    const co = [it_("section", 3), it_("item", 2)];
    expect(M.sheetSubtotalGrouped(co, false, true)).not.toBe(M.sheetSubtotalGrouped(co, false, false));
    expect(coNhomNhanHeSo(co)).toBe(true);
    const khong = [it_("section", 1), it_("item", 2)];
    expect(M.sheetSubtotalGrouped(khong, false, true)).toBe(M.sheetSubtotalGrouped(khong, false, false));
    expect(coNhomNhanHeSo(khong)).toBe(false);
  });
});

describe("khoaBatNhom — khoá CHỈ ở trạng thái bật", () => {
  const co = [it_("section", 2), it_("item", 1)];
  const khong = [it_("section", 1), it_("item", 1)];
  it("bật + có nhóm SL > 1 → khoá", () => expect(khoaBatNhom(true, co)).toBe(true));
  it("bật + không có → tự do", () => expect(khoaBatNhom(true, khong)).toBe(false));
  it("TẮT + có nhóm SL > 1 (báo giá cũ) → KHÔNG khoá", () => expect(khoaBatNhom(false, co)).toBe(false));
  it("tắt + không có → tự do", () => expect(khoaBatNhom(false, khong)).toBe(false));
});

describe("coSauNhapExcel — nhập Excel TỰ BẬT ô khi bảng kết quả còn nhóm SL > 1", () => {
  const co = [it_("section", 3), it_("item", 2)];
  const khong = [it_("section", 1), it_("item", 2)];

  it("bảng MỚI: cờ theo FILE; file tắt + nhóm SL 3 → tự bật", () => {
    expect(coSauNhapExcel({ cheDo: "moi", coTheoFile: false }, co)).toEqual({ co: true, tuBat: true });
    expect(coSauNhapExcel({ cheDo: "moi", coTheoFile: true }, co)).toEqual({ co: true, tuBat: false });   // file đã bật: không phải "tự bật"
  });

  it("nhóm SL 1 / không có nhóm → KHÔNG bật (hệ số ×1 không đổi tổng), cờ giữ theo đường nạp", () => {
    expect(coSauNhapExcel({ cheDo: "moi", coTheoFile: false }, khong)).toEqual({ co: false, tuBat: false });
    expect(coSauNhapExcel({ cheDo: "moi", coTheoFile: false }, [it_("item", 5)])).toEqual({ co: false, tuBat: false });
    expect(coSauNhapExcel({ cheDo: "moi", coTheoFile: false }, [])).toEqual({ co: false, tuBat: false });
    expect(coSauNhapExcel({ cheDo: "noi", coCuaDich: true }, khong)).toEqual({ co: true, tuBat: false });
  });

  it("NỐI: cờ của bảng ĐÍCH (cờ trong file không đếm); đích tắt + kết quả có nhóm SL 3 → tự bật", () => {
    expect(coSauNhapExcel({ cheDo: "noi", coCuaDich: false, coTheoFile: true }, khong)).toEqual({ co: false, tuBat: false });
    expect(coSauNhapExcel({ cheDo: "noi", coCuaDich: false, coTheoFile: true }, co)).toEqual({ co: true, tuBat: true });
    expect(coSauNhapExcel({ cheDo: "noi", coCuaDich: true, coTheoFile: false }, co)).toEqual({ co: true, tuBat: false });
  });

  it("THAY ở trình soạn báo giá: theo FILE nhưng KHÔNG làm mất cờ BẬT của sheet đang bật", () => {
    expect(coSauNhapExcel({ cheDo: "thay", coCuaDich: true, coTheoFile: false }, khong)).toEqual({ co: true, tuBat: false });
    expect(coSauNhapExcel({ cheDo: "thay", coCuaDich: false, coTheoFile: true }, khong)).toEqual({ co: true, tuBat: false });
    expect(coSauNhapExcel({ cheDo: "thay", coCuaDich: false, coTheoFile: false }, khong)).toEqual({ co: false, tuBat: false });
    expect(coSauNhapExcel({ cheDo: "thay", coCuaDich: false, coTheoFile: false }, co)).toEqual({ co: true, tuBat: true });
  });

  it("THAY ở bảng Hà Nội (thayGiuCoCuaDich): cờ bảng ĐÍCH đứng nguyên, cờ file bị bỏ qua; vẫn tự bật khi còn nhóm SL > 1", () => {
    expect(coSauNhapExcel({ cheDo: "thay", thayGiuCoCuaDich: true, coCuaDich: false, coTheoFile: true }, khong)).toEqual({ co: false, tuBat: false });
    expect(coSauNhapExcel({ cheDo: "thay", thayGiuCoCuaDich: true, coCuaDich: true, coTheoFile: false }, khong)).toEqual({ co: true, tuBat: false });
    expect(coSauNhapExcel({ cheDo: "thay", thayGiuCoCuaDich: true, coCuaDich: false, coTheoFile: true }, co)).toEqual({ co: true, tuBat: true });
  });

  it("theo SỐ ĐANG HIỆN như ô lưới: SL 1,04 hiện '1' → không bật; dòng SL chính xác 1,04 nhân thật → bật", () => {
    expect(coSauNhapExcel({ cheDo: "moi" }, [it_("section", 1.04)])).toEqual({ co: false, tuBat: false });
    expect(coSauNhapExcel({ cheDo: "moi" }, [it_("subsection", 1.04, { quantityExact: true })])).toEqual({ co: true, tuBat: true });
  });

  it("bật xong thì ô bị khoá theo đúng luật khoá (khoaBatNhom) — nhập không sinh ra 'tắt + SL > 1' không khoá", () => {
    const { co: coMoi } = coSauNhapExcel({ cheDo: "moi", coTheoFile: false }, co);
    expect(khoaBatNhom(coMoi, co)).toBe(true);
  });

  it("tổng sau nạp theo cờ HIỆU LỰC nhân hệ số nhóm (đúng thứ mà xuất Excel sẽ ghi)", () => {
    const hang = [it_("section", 3), it_("item", 2, { unitPrice: 250_000 })];
    const { co: c } = coSauNhapExcel({ cheDo: "moi", coTheoFile: false }, hang);
    expect(M.sheetSubtotalGrouped(hang, false, c)).toBe(3 * 2 * 250_000);
    expect(M.sheetSubtotalGrouped(hang, false, false), "cờ theo file (tắt) thì tổng thiếu hệ số nhóm").toBe(2 * 250_000);
  });

  it("lời báo sau nạp nói số sheet và lý do", () => {
    expect(tbNhapTuBatNhom(2)).toMatch(/tự bật Thành Tiền nhóm ở 2 sheet/);
    expect(tbNhapTuBatNhom(1)).toMatch(/nhóm Số Lượng > 1/);
    expect(tbNhapTuBatNhom(1)).toMatch(/tổng đã nhân hệ số nhóm/);
  });

  it("bảng mà tổng KHÔNG BAO GIỜ nhân hệ số nhóm (Hà Nội — extraTableSum): không được nói 'tổng đã nhân hệ số nhóm'", () => {
    const loi = tbNhapTuBatNhom(1, true);
    expect(loi).toMatch(/tự bật Thành Tiền nhóm ở 1 sheet/);
    expect(loi).toMatch(/ô Thành Tiền của dòng nhóm/);
    expect(loi).not.toMatch(/tổng đã nhân hệ số nhóm/);
  });
});

describe("lời báo hoàn tác đổi trạng thái ô", () => {
  it("hai lời báo khác nhau và đều nói rõ hướng đổi (bật / tắt)", () => {
    expect(TB_TU_TAT_NHOM).not.toBe(TB_TU_BAT_NHOM);
    expect(TB_TU_TAT_NHOM).toMatch(/tắt/i);
    expect(TB_TU_BAT_NHOM).toMatch(/bật/i);
  });
});
