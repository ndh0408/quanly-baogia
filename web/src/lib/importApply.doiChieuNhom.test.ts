import { describe, it, expect } from "vitest";
import * as M from "./quoteMath";
import { doiChieuNhapExcel } from "./importApply";

// ĐỐI CHIẾU TIỀN của hộp "Nhập từ Excel" sau luật "nhập Excel TỰ BẬT Thành Tiền nhóm" (chủ repo chốt 2026-09-30). Hàm thuần
// dùng chung cho bảng xem trước và hộp xác nhận lúc nạp (ImportExcelModal) — phần giao diện có bài ở
// components/ImportExcelModal.tuBatNhom.test.tsx. Ba kẽ hở của bản đầu được chốt ở đây:
//   · "Bỏ qua" chỉ để xem mà tổng lại tính theo cờ "sẽ bật" → báo "Tổng tiền chưa khớp" oan;
//   · sheet đích ĐANG BẬT (Thay / Nối không tắt nó) mà file không nhân hệ số → lệch chỉ do hệ số nhóm bị coi là lệch THẬT,
//     đỏ + hỏi xác nhận — trong khi ca TỰ BẬT y hệt thì chỉ cảnh báo;
//   · bảng Hà Nội: tổng là extraTableSum, KHÔNG BAO GIỜ nhân hệ số nhóm — hộp không được tính / nói "tổng đã nhân hệ số".

const nhom = (sl: number): M.Item => ({ kind: "section", name: "Nhóm A", quantity: sl, unitPrice: 0 });
const muc: M.Item = { kind: "item", name: "Backdrop", unit: "m2", quantity: 2, unitPrice: 250_000 };
const KHONG_NHAN = 2 * 250_000;
const CO_NHAN_3 = 3 * KHONG_NHAN;
const hang3 = [nhom(3), muc];
const fs = (coFile: boolean, tong: number | null) => ({ groupSubtotal: coFile, ...(tong != null ? { totals: { subtotal: tong } } : {}) });
const goi = (o: Partial<Parameters<typeof doiChieuNhapExcel>[0]> & { coFile?: boolean; tong?: number | null }) => doiChieuNhapExcel({
  fs: fs(!!o.coFile, o.tong ?? null), mode: o.mode ?? "replace", target: o.target === undefined ? { groupSubtotal: false } : o.target,
  hangSauNap: o.hangSauNap ?? hang3, hangNap: o.hangNap ?? hang3, usesDays: false,
  thayGiuCoCuaDich: o.thayGiuCoCuaDich, tongKhongNhanNhom: o.tongKhongNhanNhom,
});

describe("doiChieuNhapExcel — tự bật (sheet chính)", () => {
  it("file tắt + nhóm SL 3, tổng file KHÔNG nhân → tự bật, tổng nhân ×3, lệch CHỈ do hệ số nhóm (cảnh báo, không chặn)", () => {
    const t = goi({ tong: KHONG_NHAN });
    expect(t).toMatchObject({ co: true, tuBat: true, nhanSauNap: true, importedTotal: CO_NHAN_3, moneyMismatch: true, lechDoHeSoNhom: true, nguonNhom: "file" });
  });

  it("tự bật mà tổng file sai THẬT (khác cả tổng không nhân) → lệch thật, không được nhận là do hệ số", () => {
    expect(goi({ tong: 400_000 })).toMatchObject({ tuBat: true, moneyMismatch: true, lechDoHeSoNhom: false });
  });

  it("nhóm SL 1 → không bật, không lệch", () => {
    expect(goi({ hangNap: [nhom(1), muc], hangSauNap: [nhom(1), muc], tong: KHONG_NHAN }))
      .toMatchObject({ co: false, tuBat: false, importedTotal: KHONG_NHAN, moneyMismatch: false, lechDoHeSoNhom: false });
  });
});

describe("doiChieuNhapExcel — sheet đích ĐANG BẬT, file không nhân hệ số (không phải 'tự bật' nhưng lệch y hệt)", () => {
  it("THAY: giữ bật (không làm mất cờ), tổng nhân ×3, lệch chỉ do hệ số → cảnh báo, không chặn", () => {
    const t = goi({ target: { groupSubtotal: true }, tong: KHONG_NHAN });
    expect(t).toMatchObject({ co: true, tuBat: false, nhanSauNap: true, importedTotal: CO_NHAN_3, moneyMismatch: true, lechDoHeSoNhom: true });
  });

  it("NỐI: cờ đích bật → như trên", () => {
    const t = goi({ mode: "append", target: { groupSubtotal: true }, hangSauNap: [muc, ...hang3], tong: KHONG_NHAN });
    expect(t).toMatchObject({ co: true, tuBat: false, moneyMismatch: true, lechDoHeSoNhom: true });
  });

  it("đích bật mà tổng file sai thật → vẫn là lệch thật", () => {
    expect(goi({ target: { groupSubtotal: true }, tong: 400_000 })).toMatchObject({ moneyMismatch: true, lechDoHeSoNhom: false });
  });
});

describe("doiChieuNhapExcel — 'Bỏ qua' chỉ để xem", () => {
  it("không bật, mọi tổng theo cờ của chính file → file tự khớp thì KHÔNG báo lệch", () => {
    const t = goi({ mode: "skip", tong: KHONG_NHAN });
    expect(t).toMatchObject({ co: false, tuBat: false, nhanSauNap: false, importedTotal: KHONG_NHAN, moneyMismatch: false });
  });

  it("file bật (tổng nhân ×3) → bỏ qua vẫn khớp theo file", () => {
    expect(goi({ mode: "skip", coFile: true, tong: CO_NHAN_3 })).toMatchObject({ co: true, tuBat: false, importedTotal: CO_NHAN_3, moneyMismatch: false });
  });
});

describe("doiChieuNhapExcel — bảng Hà Nội (tongKhongNhanNhom: tổng là extraTableSum, không bao giờ nhân hệ số nhóm)", () => {
  const hn = { thayGiuCoCuaDich: true, tongKhongNhanNhom: true };

  it("file tắt + nhóm SL 3 → cờ vẫn TỰ BẬT (luật chung), nhưng tổng KHÔNG nhân → khớp tổng không nhân của file", () => {
    const t = goi({ ...hn, tong: KHONG_NHAN });
    expect(t).toMatchObject({ co: true, tuBat: true, nhanSauNap: false, importedTotal: KHONG_NHAN, moneyMismatch: false, lechDoHeSoNhom: false });
  });

  it("file BẬT, tổng file đã nhân ×3 → bảng HN không nhân nên khác, nhưng chỉ do hệ số → cảnh báo, không chặn", () => {
    const t = goi({ ...hn, coFile: true, tong: CO_NHAN_3 });
    expect(t).toMatchObject({ co: true, nhanSauNap: false, importedTotal: KHONG_NHAN, moneyMismatch: true, lechDoHeSoNhom: true });
  });

  it("tổng file sai thật → lệch thật", () => {
    expect(goi({ ...hn, tong: 400_000 })).toMatchObject({ moneyMismatch: true, lechDoHeSoNhom: false });
  });

  it("bảng đích đang bật vẫn bật (Thay giữ cờ đích), tổng vẫn không nhân", () => {
    expect(goi({ ...hn, target: { groupSubtotal: true }, tong: KHONG_NHAN })).toMatchObject({ co: true, tuBat: false, importedTotal: KHONG_NHAN, moneyMismatch: false });
  });
});

// NỐI VÀO CUỐI (người soát độc lập báo): sheet cũ "tắt" [Nhóm cũ (SL 3), Cũ 1×100.000], nối tệp CHỈ có hạng mục [Mới 1×200.000],
// tệp ghi tổng 200.000. Cờ tự bật (đúng luật); hàng "Mới" nằm dưới "Nhóm cũ" nên đóng góp 600.000, tổng sheet 100.000 → 900.000.
// Bản cũ cộng RIÊNG hàng của tệp với hệ số bắt đầu ×1 nên báo "Khớp 200.000". "Sau nạp" của Nối phải là phần tổng sheet THẬT SỰ
// tăng thêm = tổng(sau nạp, cờ sau) − tổng(trước nạp, cờ trước) — đúng hàm tổng của lưới — kèm hai nguyên nhân (a) hàng nối vào
// nằm trong nhóm cuối ×N, (b) cờ vừa bật làm đổi tổng các hàng sẵn có. Không đổi cách tính tổng, không đổi ngữ nghĩa nối.
describe("doiChieuNhapExcel — NỐI: 'sau nạp' là phần tổng sheet thật sự tăng thêm", () => {
  const nhomCu = (sl: number): M.Item => ({ kind: "section", name: "Nhóm cũ", quantity: sl, unitPrice: 0 });
  const cu: M.Item = { kind: "item", name: "Cũ", unit: "cái", quantity: 1, unitPrice: 100_000 };
  const moi: M.Item = { kind: "item", name: "Mới", unit: "cái", quantity: 1, unitPrice: 200_000 };
  const noi = (o: { coDich: boolean; dich: M.Item[]; tep: M.Item[]; tong?: number | null; coFile?: boolean; hn?: boolean }) => doiChieuNhapExcel({
    fs: fs(!!o.coFile, o.tong === undefined ? 200_000 : o.tong), mode: "append", target: { groupSubtotal: o.coDich },
    hangSauNap: [...o.dich, ...o.tep], hangNap: o.tep, usesDays: false,
    ...(o.hn ? { thayGiuCoCuaDich: true, tongKhongNhanNhom: true } : {}),
  });
  const tongThat = (hang: M.Item[], co: boolean) => M.sheetSubtotalGrouped(hang, false, co);

  it("ca người soát: tắt + nhóm cuối SL 3, tệp không có dòng nhóm → sau nạp 800.000 (không 'khớp'), có (a) 200.000 → 600.000 và (b) 100.000 → 300.000", () => {
    const t = noi({ coDich: false, dich: [nhomCu(3), cu], tep: [moi] });
    expect(tongThat([nhomCu(3), cu, moi], true) - tongThat([nhomCu(3), cu], false), "đúng con số lưới sẽ đổi").toBe(800_000);
    expect(t).toMatchObject({ co: true, tuBat: true, nhanSauNap: true, importedTotal: 800_000, tongHangTep: 200_000, fileTotal: 200_000, moneyMismatch: true, lechSauNap: true, lechThat: false, nguonNhom: "sheet đích" });
    expect(t.nhomCuoiNhan).toEqual({ ten: "Nhóm cũ", nhomPhu: false, soLuong: "3", trongTep: 200_000, sauNap: 600_000, chiPhanDau: false });
    expect(t.hangSanCoDoi).toEqual({ truoc: 100_000, sau: 300_000 });
    expect(t.lechDoHeSoNhom, "tệp tự khớp (200.000) → lệch chỉ do hệ số nhóm: cảnh báo vàng, không chặn").toBe(true);
    expect(t.lechDoCoTep, "tệp không có nhóm nào → không phải lệch do cờ của tệp").toBe(false);
  });

  it("sheet đích ĐANG BẬT + nhóm cuối SL 3 → chỉ (a): sau nạp 600.000, hàng sẵn có không đổi", () => {
    const t = noi({ coDich: true, dich: [nhomCu(3), cu], tep: [moi] });
    expect(t).toMatchObject({ co: true, tuBat: false, importedTotal: 600_000, moneyMismatch: true, lechDoHeSoNhom: true, lechDoCoTep: false, hangSanCoDoi: null });
    expect(t.nhomCuoiNhan).toMatchObject({ soLuong: "3", trongTep: 200_000, sauNap: 600_000 });
  });

  it("tệp MỞ ĐẦU bằng dòng nhóm của chính nó → không có (a); chỉ (b) khi cờ đổi", () => {
    const tep = [{ kind: "section", name: "Nhóm mới", quantity: 1, unitPrice: 0 } as M.Item, moi];
    const tat = noi({ coDich: false, dich: [nhomCu(3), cu], tep });
    expect(tat).toMatchObject({ tuBat: true, importedTotal: 400_000, nhomCuoiNhan: null, hangSanCoDoi: { truoc: 100_000, sau: 300_000 }, moneyMismatch: true, lechDoHeSoNhom: true });
    const bat = noi({ coDich: true, dich: [nhomCu(3), cu], tep });
    expect(bat).toMatchObject({ importedTotal: 200_000, nhomCuoiNhan: null, hangSanCoDoi: null, moneyMismatch: false });
  });

  it("nhóm cuối SL 1 → không bật, không nhân: sau nạp 200.000, khớp như cũ", () => {
    for (const coDich of [false, true]) {
      expect(noi({ coDich, dich: [nhomCu(1), cu], tep: [moi] }), `cờ đích ${coDich}`)
        .toMatchObject({ tuBat: false, importedTotal: 200_000, moneyMismatch: false, nhomCuoiNhan: null, hangSanCoDoi: null });
    }
  });

  it("bảng HÀ NỘI (tổng không bao giờ nhân hệ số nhóm) → không có (a) / (b), sau nạp 200.000 khớp tệp", () => {
    for (const coDich of [false, true]) {
      expect(noi({ coDich, dich: [nhomCu(3), cu], tep: [moi], hn: true }), `cờ đích ${coDich}`)
        .toMatchObject({ co: true, nhanSauNap: false, importedTotal: 200_000, moneyMismatch: false, lechDoHeSoNhom: false, nhomCuoiNhan: null, hangSanCoDoi: null });
    }
  });

  it("lỗi tệp THẬT (tệp ghi 150.000 mà hàng cộng ra 200.000) → vẫn là lệch thật dù có (a) / (b) — không bị nuốt", () => {
    const t = noi({ coDich: false, dich: [nhomCu(3), cu], tep: [moi], tong: 150_000 });
    expect(t).toMatchObject({ importedTotal: 800_000, tongHangTep: 200_000, moneyMismatch: true, lechThat: true, lechDoHeSoNhom: false, lechDoCoTep: false });
    expect(t.nhomCuoiNhan).not.toBeNull();
    expect(t.hangSanCoDoi).not.toBeNull();
  });

  it("(a) TÌNH CỜ bù đúng phần đọc thiếu (tệp ghi 400.000, đọc được 1 hàng 200.000, nối vào nhóm cuối SL 2 → sau nạp 400.000) → vẫn là lệch thật, không thành 'khớp'", () => {
    const t = noi({ coDich: true, dich: [nhomCu(2), cu], tep: [moi], tong: 400_000 });
    expect(t).toMatchObject({ importedTotal: 400_000, tongHangTep: 200_000, lechSauNap: false, lechThat: true, moneyMismatch: true, lechDoHeSoNhom: false });
    expect(t.nhomCuoiNhan).toMatchObject({ soLuong: "2", trongTep: 200_000, sauNap: 400_000 });
  });

  it("tệp có hạng mục đầu RỒI mới tới nhóm riêng (SL 2, tệp không nhân) → (a) chỉ cho phần đầu, kèm lệch do cờ của tệp", () => {
    const tep = [moi, { kind: "section", name: "Nhóm B", quantity: 2, unitPrice: 0 } as M.Item, { kind: "item", name: "X", unit: "cái", quantity: 1, unitPrice: 50_000 } as M.Item];
    const t = noi({ coDich: true, dich: [nhomCu(3), cu], tep, tong: 250_000 });
    expect(t).toMatchObject({ importedTotal: 700_000, moneyMismatch: true, lechDoHeSoNhom: true, lechDoCoTep: true, hangSanCoDoi: null });
    expect(t.nhomCuoiNhan).toMatchObject({ trongTep: 200_000, sauNap: 600_000, chiPhanDau: true });
  });

  it("nhóm cuối là NHÓM PHỤ (SL 2) → hệ số của nhóm phụ (lưới thay hệ số ở mỗi dòng nhóm)", () => {
    const dich = [nhomCu(3), { kind: "subsection", name: "Con", quantity: 2, unitPrice: 0 } as M.Item, cu];
    const t = noi({ coDich: true, dich, tep: [moi] });
    expect(t.importedTotal).toBe(tongThat([...dich, moi], true) - tongThat(dich, true));
    expect(t.nhomCuoiNhan).toMatchObject({ ten: "Con", nhomPhu: true, soLuong: "2", trongTep: 200_000, sauNap: 400_000 });
  });

  it("THAY / sheet mới không có hàng sẵn có để nhập chung nhóm → công thức cũ giữ nguyên, không có (a) / (b)", () => {
    const thay = doiChieuNhapExcel({ fs: fs(false, 200_000), mode: "replace", target: { groupSubtotal: false }, hangSauNap: [moi], hangNap: [moi], usesDays: false });
    expect(thay).toMatchObject({ importedTotal: 200_000, moneyMismatch: false, nhomCuoiNhan: null, hangSanCoDoi: null });
    const moiSheet = doiChieuNhapExcel({ fs: fs(false, KHONG_NHAN), mode: "replace", target: null, hangSauNap: hang3, hangNap: hang3, usesDays: false });
    expect(moiSheet).toMatchObject({ tuBat: true, importedTotal: CO_NHAN_3, nhomCuoiNhan: null, hangSanCoDoi: null, lechDoHeSoNhom: true, lechDoCoTep: true });
  });
});
