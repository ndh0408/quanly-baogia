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
