import { describe, it, expect } from "vitest";
import * as M from "./quoteMath";
import { doiChieuNhapExcel } from "./importApply";
import { extraTableSum } from "../components/ExtraTables";

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

// VÒNG 1 người soát (c12a051): ngưỡng dung sai của `lech` (2 đ hoặc 0,5 % tổng ghi trong file) vốn để nuốt SAI SỐ ĐỌC FILE. Phần
// chênh do hệ số nhóm — (a), (b), nhóm của file bị cộng theo cờ khác — là số tiền CHÍNH XÁC, tất định, nên không được nuốt: ở bản
// c12a051 nó nhỏ hơn 0,5 % là thẻ hiện xanh "Khớp" (tệp 1 tỷ: tới 5 triệu nhân thêm vẫn "Khớp"), dù "sau nạp" đã đúng số.
describe("doiChieuNhapExcel — ngưỡng dung sai chỉ nuốt sai số đọc file, KHÔNG nuốt phần chênh do hệ số nhóm", () => {
  const S = (ten: string, sl: number): M.Item => ({ kind: "section", name: ten, quantity: sl, unitPrice: 0 });
  const I = (ten: string, gia: number): M.Item => ({ kind: "item", name: ten, unit: "cái", quantity: 1, unitPrice: gia });
  const noi = (coDich: boolean, dich: M.Item[], tep: M.Item[], tong: number) => doiChieuNhapExcel({
    fs: fs(false, tong), mode: "append", target: { groupSubtotal: coDich }, hangSauNap: [...dich, ...tep], hangNap: tep, usesDays: false,
  });

  it("(b) nhỏ hơn ngưỡng: sheet TẮT [Nhóm cũ SL 2, Cũ 100.000], nối tệp 50 triệu mở đầu bằng nhóm riêng SL 1 → tổng tăng 50.100.000: KHÔNG 'Khớp'", () => {
    const t = noi(false, [S("Nhóm cũ", 2), I("Cũ", 100_000)], [S("Nhóm B", 1), I("Sân khấu", 50_000_000)], 50_000_000);
    expect(t).toMatchObject({ tuBat: true, importedTotal: 50_100_000, nhomCuoiNhan: null, hangSanCoDoi: { truoc: 100_000, sau: 200_000 } });
    expect(t.lechSauNap, "100.000 nhỏ hơn ngưỡng 250.000 — chính chỗ bản cũ nuốt").toBe(false);
    expect(t, "lệch do hệ số nhóm: vàng, không phải lệch thật").toMatchObject({ moneyMismatch: true, lechThat: false, lechDoHeSoNhom: true, lechDoCoTep: false });
  });

  it("(a) nhỏ hơn ngưỡng: sheet BẬT [Nhóm cũ SL 2, Cũ 1.000.000], tệp 100 triệu có 300.000 đứng trước dòng nhóm đầu → tổng tăng 100.300.000: KHÔNG 'Khớp'", () => {
    const t = noi(true, [S("Nhóm cũ", 2), I("Cũ", 1_000_000)], [I("Phí vận chuyển", 300_000), S("Nhóm B", 1), I("Sân khấu", 99_700_000)], 100_000_000);
    expect(t).toMatchObject({ importedTotal: 100_300_000, hangSanCoDoi: null, lechSauNap: false, moneyMismatch: true, lechThat: false, lechDoHeSoNhom: true });
    expect(t.nhomCuoiNhan).toMatchObject({ soLuong: "2", trongTep: 300_000, sauNap: 600_000, chiPhanDau: true });
  });

  it("biên: tệp 1 tỷ, nhóm cuối SL 2 — phần (a) từ 1 đ tới 5 triệu đều KHÔNG 'Khớp' (bản cũ: tới 5.000.000 vẫn 'Khớp')", () => {
    for (const dau of [1, 1_000, 2_000_000, 4_000_000, 5_000_000]) {
      const t = noi(true, [S("Nhóm cũ", 2), I("Cũ", 1)], [I("Đầu", dau), S("B", 1), I("Phần còn lại", 1_000_000_000 - dau)], 1_000_000_000);
      expect(t.importedTotal, `phần đầu ${dau}`).toBe(1_000_000_000 + dau);
      expect(t, `phần đầu ${dau}`).toMatchObject({ moneyMismatch: true, lechThat: false, lechDoHeSoNhom: true });
    }
  });

  it("THAY / sheet mới: nhóm CỦA FILE được nhân thêm 100.000 trên tệp 100 triệu (nhỏ hơn ngưỡng) → KHÔNG 'Khớp', vàng, lệch do cờ của file", () => {
    const tep = [I("Phí", 99_900_000), S("Nhóm", 2), I("Hàng", 100_000)];
    for (const target of [{ groupSubtotal: false }, { groupSubtotal: true }, null]) {
      const t = doiChieuNhapExcel({ fs: fs(false, 100_000_000), mode: "replace", target, hangSauNap: tep, hangNap: tep, usesDays: false });
      expect(t, `đích ${JSON.stringify(target)}`).toMatchObject({ co: true, importedTotal: 100_100_000, lechSauNap: false, moneyMismatch: true, lechThat: false, lechDoHeSoNhom: true, lechDoCoTep: true });
    }
  });

  it("file 'tắt' mà tổng ghi trong file ĐÃ nhân Số Lượng nhóm (bằng đúng tổng sau nạp) → vẫn 'Khớp', không bị coi là chênh do hệ số", () => {
    const tep = [I("Phí", 99_900_000), S("Nhóm", 2), I("Hàng", 100_000)];
    const t = doiChieuNhapExcel({ fs: fs(false, 100_100_000), mode: "replace", target: { groupSubtotal: false }, hangSauNap: tep, hangNap: tep, usesDays: false });
    expect(t).toMatchObject({ tuBat: true, importedTotal: 100_100_000, moneyMismatch: false, lechDoHeSoNhom: false, lechDoCoTep: false });
  });

  it("sai số đọc file vẫn được nuốt: tệp ghi 200.001 mà hàng cộng 200.000, không có hệ số nhóm nào đổi tiền → vẫn 'Khớp'; có (a) thì không che được", () => {
    expect(noi(false, [S("Nhóm cũ", 1), I("Cũ", 100_000)], [I("Mới", 200_000)], 200_001)).toMatchObject({ importedTotal: 200_000, moneyMismatch: false });
    expect(noi(true, [S("Nhóm cũ", 3), I("Cũ", 100_000)], [I("Mới", 200_000)], 200_001))
      .toMatchObject({ importedTotal: 600_000, moneyMismatch: true, lechThat: false, lechDoHeSoNhom: true });
  });

  it("lỗi tệp thật nhỏ hơn ngưỡng không bị đổi thành 'lệch do hệ số': không có hệ số nhóm nào → vẫn 'Khớp' như trước (ngưỡng giữ nguyên)", () => {
    // Tệp ghi 50.100.000 mà các hàng cộng 50.000.000 (lệch 100.000 < ngưỡng 250.500): bản trước cũng "Khớp" — cổng này chỉ siết phần hệ số.
    expect(noi(false, [S("Nhóm cũ", 1), I("Cũ", 100_000)], [I("Sân khấu", 50_000_000)], 50_100_000)).toMatchObject({ moneyMismatch: false });
  });
});

// VÒNG 1 người soát: bảng Hà Nội cộng bằng extraTableSum (AccountHnView: "Tổng tất cả … sheet Hà Nội"), KHÔNG bằng phép của lưới —
// khác nhau ở ca làm tròn ,5 (Math.round trên số double: 0,7 × 163.845 = 114.691,4999… → 114.691, lưới nhân chính xác ra 114.692) và
// Số Ngày ≤ 0 (bảng bỏ qua Số Ngày đó, lưới nhân luôn số âm). Hộp nhập truyền `tongBang` = extraTableSum: mọi tổng PHÍA BẢNG ĐÍCH đi
// theo nó; cách FILE tự cộng tổng vẫn là phép của lưới.
describe("doiChieuNhapExcel — bảng Hà Nội cộng bằng hàm tổng THẬT của nó (tongBang)", () => {
  const I = (ten: string, sl: number, gia: number, them: Partial<M.Item> = {}): M.Item => ({ kind: "item", name: ten, unit: "cái", quantity: sl, unitPrice: gia, ...them });
  const tongHn = (usesDays: boolean) => (hang: M.Item[]) => extraTableSum({ category: "hn", items: hang }, usesDays);
  const hn = (o: { dich: M.Item[]; tep: M.Item[]; tong: number | null; usesDays?: boolean; mode?: "append" | "replace" | "skip"; coFile?: boolean; coDich?: boolean }) => doiChieuNhapExcel({
    fs: fs(!!o.coFile, o.tong), mode: o.mode ?? "append", target: { groupSubtotal: !!o.coDich },
    hangSauNap: (o.mode ?? "append") === "append" ? [...o.dich, ...o.tep] : o.tep, hangNap: o.tep, usesDays: !!o.usesDays,
    thayGiuCoCuaDich: true, tongKhongNhanNhom: true, tongBang: tongHn(!!o.usesDays),
  });
  const cu = I("Cũ", 1, 100_000, { days: 1 });

  it("làm tròn ,5: nối [Khung 0,7 × 163.845], tệp ghi 114.692 → sau nạp 114.691 đúng như bảng HN cộng (lưới ra 114.692); lệch 1 đ trong ngưỡng → 'Khớp'", () => {
    const khung = I("Khung", 0.7, 163_845);
    expect(M.sheetSubtotalGrouped([khung], false, false), "phép của lưới").toBe(114_692);
    expect(extraTableSum({ category: "hn", items: [khung] }, false), "phép của bảng HN").toBe(114_691);
    const t = hn({ dich: [cu], tep: [khung], tong: 114_692 });
    expect(t).toMatchObject({ importedTotal: 114_691, tongHangTep: 114_691, tongSauNap: 214_691, moneyMismatch: false, nhomCuoiNhan: null, hangSanCoDoi: null });
  });

  it("Số Ngày −1 (mẫu có ngày): bảng HN bỏ qua Số Ngày ≤ 0 → sau nạp +50.000 (lưới ra −50.000); tổng bảng 100.000 → 150.000", () => {
    const hoan = I("Hoàn", 1, 50_000, { days: -1 });
    const t = hn({ dich: [cu], tep: [hoan], tong: null, usesDays: true });
    expect(t).toMatchObject({ importedTotal: 50_000, tongSauNap: 150_000, moneyMismatch: false });
    // Tệp tự cộng ra −50.000 (Excel nhân luôn Số Ngày âm) mà bảng HN sẽ cộng +50.000 → lệch THẬT: đỏ + hỏi xác nhận, không 'Khớp'.
    expect(hn({ dich: [cu], tep: [hoan], tong: -50_000, usesDays: true })).toMatchObject({ importedTotal: 50_000, moneyMismatch: true, lechThat: true, lechSauNap: true });
  });

  it("nối vào bảng HN có nhóm cuối SL 3 (cờ tắt / bật) → tổng HN không nhân nhóm: không (a) / (b), 'Khớp'", () => {
    for (const coDich of [false, true]) {
      const t = hn({ dich: [{ kind: "section", name: "Nhóm HN", quantity: 3, unitPrice: 0 }, cu], tep: [I("Mới", 1, 200_000)], tong: 200_000, coDich });
      expect(t, `cờ đích ${coDich}`).toMatchObject({ co: true, nhanSauNap: false, importedTotal: 200_000, tongSauNap: 300_000, moneyMismatch: false, nhomCuoiNhan: null, hangSanCoDoi: null });
    }
  });

  it("file BẬT, tổng file đã nhân ×3 → bảng HN không nhân: vàng 'lệch do cờ của file' như trước", () => {
    const t = hn({ dich: [], tep: hang3, tong: CO_NHAN_3, coFile: true, mode: "replace" });
    expect(t).toMatchObject({ importedTotal: KHONG_NHAN, moneyMismatch: true, lechThat: false, lechDoHeSoNhom: true, lechDoCoTep: true });
  });

  it("'Bỏ qua' chỉ để xem: mọi tổng theo cách của chính file (phép của lưới), không theo tongBang", () => {
    const t = hn({ dich: [cu], tep: [I("Khung", 0.7, 163_845)], tong: 114_692, mode: "skip" });
    expect(t).toMatchObject({ importedTotal: 114_692, moneyMismatch: false });
  });
});
