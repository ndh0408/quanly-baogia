// Phần THUẦN của bộ lọc Danh sách báo giá (chủ repo 2026-09-30: "bộ lọc … chưa đầy đủ và thông minh").
import { describe, it, expect } from "vitest";
import { LOC_RONG, demBoLoc, docTuUrl, ghiLenUrl, thamSoApi, parseTien, hienTien, khoangNgay, mauNgayDangKhop, ngayCucBo, MAU_NGAY, type BoLocDS } from "./locDanhSach";

const day: BoLocDS = { q: "sao mai", status: ["draft", "converted"], cty: [1, 2], nguoi: [7], tu: "2026-09-01", den: "2026-09-30", tienTu: "100000000", tienDen: "1500000000", ghiChu: "has", mau: ["red", "blue"] };

describe("parseTien — đọc số tiền người Việt gõ", () => {
  it.each([
    ["100tr", 100_000_000], ["100 tr", 100_000_000], ["100 triệu", 100_000_000], ["100trieu", 100_000_000], ["100m", 100_000_000], ["100M", 100_000_000],
    ["1,5 tỷ", 1_500_000_000], ["1.5 tỷ", 1_500_000_000], ["1,5ty", 1_500_000_000], ["2 tỷ", 2_000_000_000], ["0,5 tỷ", 500_000_000],
    ["500k", 500_000], ["500 nghìn", 500_000], ["500 ngàn", 500_000], ["2,5k", 2_500],
    ["1.250.000", 1_250_000], ["1250000", 1_250_000], ["1,250,000", 1_250_000], ["35.000.000đ", 35_000_000], ["35tr đ", 35_000_000], ["35 triệu đồng".replace("đồng", "vnd"), 35_000_000],
    ["1 500 000", 1_500_000],   // dấu cách làm ngăn cách hàng nghìn (gõ kiểu bảng tính)
    ["1.250 tr", 1_250_000],   // CÓ đơn vị thì dấu chấm/phẩy LUÔN là thập phân (1,25 triệu) — "1,125 tỷ" mới đọc đúng là 1 tỷ 125 triệu
    ["1,125 tỷ", 1_125_000_000],
  ])("%s → %i", (vao, ra) => { expect(parseTien(vao)).toBe(ra); });

  it("không hiểu → null (không đoán bừa): rỗng, chữ, số âm, đơn vị lạ, đơn vị đứng trước số", () => {
    for (const x of ["", "   ", "abc", "-5", "tr", "100 xyz", "1,5,5 tỷ x", "--", "tỷ 5"]) expect(parseTien(x), JSON.stringify(x)).toBeNull();
  });

  it("CÓ đơn vị thì dấu phẩy là THẬP PHÂN, KHÔNG có đơn vị thì là ngăn cách hàng nghìn — '1,5 tỷ' là 1,5 tỷ chứ không phải 15 tỷ", () => {
    expect(parseTien("1,5 tỷ")).toBe(1_500_000_000);
    expect(parseTien("1,5")).toBe(15);   // không đơn vị: dấu phẩy bị bỏ như ngăn cách — gõ "1,5" trần là việc hiếm, và "15" còn hơn đoán sai
  });
});

describe("hienTien", () => {
  it("chữ số → có dấu chấm ngăn hàng nghìn (vi-VN); rỗng → rỗng", () => {
    expect(hienTien("100000000")).toBe("100.000.000");
    expect(hienTien("")).toBe("");
  });
});

describe("đếm + URL + API", () => {
  it("demBoLoc: đếm NHÓM — ngày, tiền, ghi chú+màu mỗi thứ MỘT nhóm dù có hai đầu/nhiều màu", () => {
    expect(demBoLoc(LOC_RONG)).toBe(0);
    expect(demBoLoc(day)).toBe(7);
    expect(demBoLoc({ ...LOC_RONG, tu: "2026-01-01" })).toBe(1);
    expect(demBoLoc({ ...LOC_RONG, mau: ["red", "blue"], ghiChu: "has" })).toBe(1);
    expect(demBoLoc({ ...LOC_RONG, q: "   " }), "ô tìm toàn khoảng trắng không phải bộ lọc").toBe(0);
  });

  it("ghiLenUrl ↔ docTuUrl là hai chiều của nhau; bộ lọc rỗng → URL rỗng", () => {
    expect(ghiLenUrl(LOC_RONG).toString()).toBe("");
    expect(docTuUrl(ghiLenUrl(day))).toEqual(day);
    expect(docTuUrl(new URLSearchParams())).toEqual(LOC_RONG);
  });

  it("docTuUrl BỎ giá trị rác thay vì làm hỏng trang (link cũ / gõ tay)", () => {
    const b = docTuUrl(new URLSearchParams("company=1,x,-2,3&creator=abc&from=hom-qua&to=2026-13-99x&min=12a&max=5&note=maybe&color=hotpink,red&status=draft,,"));
    expect(b.cty).toEqual([1, 3]);
    expect(b.nguoi).toEqual([]);
    expect(b.tu).toBe("");
    expect(b.den).toBe("");
    expect(b.tienTu).toBe("");
    expect(b.tienDen).toBe("5");
    expect(b.ghiChu).toBe("");
    expect(b.mau).toEqual(["red"]);
    expect(b.status).toEqual(["draft"]);
  });

  it("thamSoApi: tên khoá ĐÚNG theo máy chủ (companyId/creator/from/to/minTotal/maxTotal/note/noteColor), chỉ khoá có giá trị", () => {
    expect(thamSoApi(LOC_RONG)).toEqual({});
    expect(thamSoApi(day)).toEqual({
      q: "sao mai", status: "draft,converted", companyId: "1,2", creator: "7", from: "2026-09-01", to: "2026-09-30",
      minTotal: "100000000", maxTotal: "1500000000", note: "has", noteColor: "red,blue",
    });
    expect(thamSoApi({ ...LOC_RONG, q: "  khách  " }).q, "cắt khoảng trắng hai đầu").toBe("khách");
  });
});

describe("mẫu ngày nhanh (tính theo giờ máy, gồm cả hai đầu)", () => {
  const nay = new Date(2026, 8, 30, 9, 0);   // 30/09/2026 (tháng 9 → quý 3)
  it("từng mẫu", () => {
    expect(khoangNgay("homnay", nay)).toEqual({ tu: "2026-09-30", den: "2026-09-30" });
    expect(khoangNgay("7ngay", nay)).toEqual({ tu: "2026-09-24", den: "2026-09-30" });
    expect(khoangNgay("30ngay", nay)).toEqual({ tu: "2026-09-01", den: "2026-09-30" });
    expect(khoangNgay("thangnay", nay)).toEqual({ tu: "2026-09-01", den: "2026-09-30" });
    expect(khoangNgay("thangtruoc", nay)).toEqual({ tu: "2026-08-01", den: "2026-08-31" });
    expect(khoangNgay("quynay", nay)).toEqual({ tu: "2026-07-01", den: "2026-09-30" });
    expect(khoangNgay("namnay", nay)).toEqual({ tu: "2026-01-01", den: "2026-12-31" });
  });
  it("ranh giới: đầu năm (tháng trước = tháng 12 năm ngoái), tháng 2 nhuận / không nhuận, đầu quý", () => {
    expect(khoangNgay("thangtruoc", new Date(2026, 0, 15))).toEqual({ tu: "2025-12-01", den: "2025-12-31" });
    expect(khoangNgay("thangnay", new Date(2028, 1, 10))).toEqual({ tu: "2028-02-01", den: "2028-02-29" });
    expect(khoangNgay("thangnay", new Date(2027, 1, 10))).toEqual({ tu: "2027-02-01", den: "2027-02-28" });
    expect(khoangNgay("quynay", new Date(2026, 9, 1))).toEqual({ tu: "2026-10-01", den: "2026-12-31" });
    expect(khoangNgay("7ngay", new Date(2026, 0, 3))).toEqual({ tu: "2025-12-28", den: "2026-01-03" });
  });
  it("ngày cục bộ KHÔNG bị lệch sang hôm trước dù `toISOString` (UTC) sẽ lùi — đo ở 01:00 sáng giờ máy", () => {
    const saoMai = new Date(2026, 8, 30, 1, 0);
    expect(ngayCucBo(saoMai)).toBe("2026-09-30");
    expect(khoangNgay("homnay", saoMai).tu).toBe("2026-09-30");
  });
  it("mauNgayDangKhop nhận ra mẫu đang áp (để ô chọn hiện đúng tên) và trả rỗng khi tự chọn ngày", () => {
    for (const m of MAU_NGAY) { const k = khoangNgay(m.khoa, nay); expect(mauNgayDangKhop(k.tu, k.den, nay), m.khoa).toBe(
      // "30 ngày qua" và "Tháng này" trùng nhau đúng ngày 30/9 → mẫu ĐẦU danh sách thắng; chỉ cần khẳng định nhận ra MỘT mẫu hợp lệ.
      MAU_NGAY.find((x) => { const y = khoangNgay(x.khoa, nay); return y.tu === k.tu && y.den === k.den; })!.khoa); }
    expect(mauNgayDangKhop("2026-09-02", "2026-09-05", nay)).toBe("");
    expect(mauNgayDangKhop("", "", nay)).toBe("");
  });
});
