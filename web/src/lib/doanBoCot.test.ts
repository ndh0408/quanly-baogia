// Soát toàn diện L17 — doanBoCot chọn sai bố cục khi HOÀ ĐIỂM.
//
// Khối dán từ mẫu GN CÓ NGÀY (STT | Hạng mục | ĐVT | SL | Ngày | ĐG | TT) mà MỌI SL = 1 (nhân sự
// "1 người × N ngày"): đọc theo bố cục "CLF/GN không ngày" [_stt,name,detail,unit,quantity,…] cũng
// ra SL × ĐG = TT (Ngày bị hiểu thành SL) — hoà điểm với "GN có ngày", và bố cục đứng TRƯỚC trong
// BO_CUC_XUAT thắng. Dán vào sheet CLF có ngày ra: Chi Tiết "người", ĐVT "1", SL = số ngày, Ngày 1.
//   ĐÃ ĐO: [9] dán vào sheet CLF có ngày → {n:'MC', d:'người', u:'1', q:2, days:1}
// Tổng tiền vẫn đúng, nhưng cột lệch. Chỉ cần MỘT hàng SL ≠ 1 là GN có ngày thắng — ca hẹp mà có thật.
import { describe, expect, it } from "vitest";
import { BO_CUC_XUAT, diemBoCot, doanBoCot } from "./doanBoCot";

const [KHONG_NGAY, CLF_CO_NGAY, GN_CO_NGAY] = BO_CUC_XUAT;
const NHAN_SU = [
  ["A", "Nhân sự", "", "", "", "", "", ""],
  ["1", "MC", "người", "1", "2", "3,000,000", "6,000,000", ""],
  ["2", "Kỹ thuật âm thanh", "người", "1", "3", "1,500,000", "4,500,000", ""],
];

describe("L17: doanBoCot — hoà điểm thì bố cục đọc ĐVT ra SỐ phải thua", () => {
  it("khối GN có ngày toàn SL = 1 dán vào sheet CLF có ngày → nhận ra GN có ngày", () => {
    expect(doanBoCot(NHAN_SU, CLF_CO_NGAY)).toEqual(GN_CO_NGAY);
  });

  it("… dán vào sheet CLF / GN không ngày → cũng là GN có ngày (ĐVT '1' không bao giờ là ĐVT thật)", () => {
    expect(doanBoCot(NHAN_SU, KHONG_NGAY)).toEqual(GN_CO_NGAY);
  });

  it("dán vào chính sheet GN có ngày → giữ bố cục đích như cũ", () => {
    expect(doanBoCot(NHAN_SU, GN_CO_NGAY)).toEqual(GN_CO_NGAY);
  });

  it("hàng đọc ra ĐVT là số không được tính phiếu; ĐVT chữ hay trống vẫn tính", () => {
    expect(diemBoCot(NHAN_SU, KHONG_NGAY)).toBe(0);
    expect(diemBoCot(NHAN_SU, GN_CO_NGAY)).toBe(2);
    expect(diemBoCot([["", "Phí", "", "", "1", "500,000", "500,000", ""]], KHONG_NGAY)).toBe(1);
  });
});
