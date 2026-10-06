// KHOẢN CHI — phần thuần phía trình duyệt (lib/khoanChi.ts): THÂN lệnh PUT khoản chi, ngày thuần, nhãn trạng thái.
//
// Hai lỗi đã gặp thật mà bài này chốt:
//   · gửi `paidProof: ""` để "gỡ ảnh" → máy chủ 400 (ExtraPayDialog cũ). Một ý nghĩa, một cách viết: gỡ ảnh là `null`.
//   · gửi lại cả bản ghi thay vì chỉ trường đã đổi → lần lưu sau 409 / realtime ghi đè ngược phần kế toán khác vừa sửa.
import { describe, it, expect } from "vitest";
import {
  thanKhoanChi, fmtNgayThuan, laNgayThuan, nhanTrangThaiHang, NHAN_TRANG_THAI_HANG, phiaCuaLoai, tenBangRieng, lyDoKhongTich,
  canhBaoKhoan, anhHienDuoc, fmtSoLuong, laNgayHoaDon, giaTriTruong, xungDotKhoanChi, moTaXungDot, type DongKhoanChi, type NhapKhoanChi,
} from "./khoanChi";
import type { TrangThaiHangDauVao } from "./api";

const ANH = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const DU_QUYEN = { canPay: true, canEdit: true };
const dong = (over: Partial<DongKhoanChi> = {}): DongKhoanChi => ({
  version: 3, paid: false, hasPaidProof: false, tienDoi: false, invoiceDate: null, accountingNote: null, ...over,
});

describe("thanKhoanChi — CHỈ trường đã đổi + baseVersion", () => {
  it("không đổi gì → null (không gửi lệnh rỗng); giá trị bằng dòng hiện tại cũng là không đổi", () => {
    expect(thanKhoanChi(dong(), {}, DU_QUYEN)).toBeNull();
    expect(thanKhoanChi(dong({ paid: true }), { paid: true }, DU_QUYEN)).toBeNull();
    expect(thanKhoanChi(dong({ invoiceDate: "2026-10-01" }), { invoiceDate: "2026-10-01" }, DU_QUYEN)).toBeNull();
    expect(thanKhoanChi(dong({ accountingNote: "Đã nhận HĐ" }), { accountingNote: "  Đã nhận HĐ  " }, DU_QUYEN), "so sau khi trim").toBeNull();
    expect(thanKhoanChi(dong(), { accountingNote: "   " }, DU_QUYEN), "khoảng trắng trên ô trống").toBeNull();
  });

  it("tích mới → paid:true; tích + ảnh trong MỘT lệnh; baseVersion = version của dòng", () => {
    expect(thanKhoanChi(dong(), { paid: true }, DU_QUYEN)).toEqual({ baseVersion: 3, paid: true });
    expect(thanKhoanChi(dong({ version: 0 }), { paid: true, anhMoi: ANH }, DU_QUYEN)).toEqual({ baseVersion: 0, paid: true, paidProof: ANH });
  });

  it("BỎ tích → đúng {paid:false}: không kèm ảnh mới, không kèm paidProof:null (máy chủ tự rút ảnh hiện tại)", () => {
    const than = thanKhoanChi(dong({ paid: true, hasPaidProof: true }), { paid: false, anhMoi: ANH, goAnh: true, xacNhanTien: true }, DU_QUYEN);
    expect(than).toEqual({ baseVersion: 3, paid: false });
    expect(Object.prototype.hasOwnProperty.call(than, "paidProof"), "bỏ tích KHÔNG có khoá paidProof").toBe(false);
  });

  it("khoản đã chi: thay ảnh (data-URL) / gỡ ảnh (null) — gỡ chỉ khi đang có ảnh; ảnh mới thắng lệnh gỡ", () => {
    expect(thanKhoanChi(dong({ paid: true, hasPaidProof: true }), { anhMoi: ANH }, DU_QUYEN)).toEqual({ baseVersion: 3, paidProof: ANH });
    expect(thanKhoanChi(dong({ paid: true, hasPaidProof: true }), { goAnh: true }, DU_QUYEN)).toEqual({ baseVersion: 3, paidProof: null });
    expect(thanKhoanChi(dong({ paid: true, hasPaidProof: false }), { goAnh: true }, DU_QUYEN), "không có ảnh thì gỡ là không đổi").toBeNull();
    expect(thanKhoanChi(dong({ paid: true, hasPaidProof: true }), { goAnh: true, anhMoi: ANH }, DU_QUYEN)).toEqual({ baseVersion: 3, paidProof: ANH });
  });

  it("ảnh trên khoản CHƯA chi (không tích kèm) không bao giờ đi — máy chủ sẽ 400 chua-danh-dau", () => {
    expect(thanKhoanChi(dong(), { anhMoi: ANH }, DU_QUYEN)).toBeNull();
    expect(thanKhoanChi(dong(), { goAnh: true }, DU_QUYEN)).toBeNull();
  });

  it("KHÔNG BAO GIỜ sinh paidProof \"\" — quét mọi tổ hợp đầu vào", () => {
    const giaTri = { paid: [undefined, true, false], anhMoi: [undefined, "", ANH], goAnh: [undefined, true, false], xacNhanTien: [undefined, true] };
    let soCa = 0;
    for (const rPaid of [true, false]) for (const rAnh of [true, false]) for (const tienDoi of [true, false])
      for (const paid of giaTri.paid) for (const anhMoi of giaTri.anhMoi) for (const goAnh of giaTri.goAnh) for (const xacNhanTien of giaTri.xacNhanTien) {
        const n: NhapKhoanChi = { paid, anhMoi, goAnh, xacNhanTien };
        const than = thanKhoanChi(dong({ paid: rPaid, hasPaidProof: rAnh, tienDoi }), n, DU_QUYEN);
        soCa++;
        if (!than) continue;
        expect(than.paidProof, JSON.stringify({ rPaid, rAnh, n })).not.toBe("");
        if (than.paidProof !== undefined) expect(than.paidProof === null || than.paidProof === ANH).toBe(true);
        if (than.paid === false) expect("paidProof" in than, "bỏ tích kèm ảnh là 400").toBe(false);
      }
    expect(soCa).toBe(2 * 2 * 2 * 3 * 3 * 3 * 2);
  });

  it("'Xác nhận số tiền hiện tại' gửi paid:true CHỈ khi khoản đã chi và số tiền đã đổi", () => {
    expect(thanKhoanChi(dong({ paid: true, tienDoi: true }), { xacNhanTien: true }, DU_QUYEN)).toEqual({ baseVersion: 3, paid: true });
    expect(thanKhoanChi(dong({ paid: true, tienDoi: false }), { xacNhanTien: true }, DU_QUYEN)).toBeNull();
    expect(thanKhoanChi(dong({ paid: false, tienDoi: true }), { xacNhanTien: true }, DU_QUYEN)).toBeNull();
  });

  it("Ngày HĐ gửi 'YYYY-MM-DD'; xoá trắng gửi null. Ghi chú trim; xoá trắng gửi null", () => {
    expect(thanKhoanChi(dong(), { invoiceDate: "2026-10-05" }, DU_QUYEN)).toEqual({ baseVersion: 3, invoiceDate: "2026-10-05" });
    expect(thanKhoanChi(dong({ invoiceDate: "2026-10-01" }), { invoiceDate: "" }, DU_QUYEN)).toEqual({ baseVersion: 3, invoiceDate: null });
    expect(thanKhoanChi(dong(), { accountingNote: "  HĐ số 123  " }, DU_QUYEN)).toEqual({ baseVersion: 3, accountingNote: "HĐ số 123" });
    expect(thanKhoanChi(dong({ accountingNote: "cũ" }), { accountingNote: "  " }, DU_QUYEN)).toEqual({ baseVersion: 3, accountingNote: null });
  });

  it("quyền THEO TRƯỜNG: thiếu invoice:input:pay thì tích / ảnh không vào thân; thiếu invoice:edit thì ngày / ghi chú không vào", () => {
    const n: NhapKhoanChi = { paid: true, anhMoi: ANH, invoiceDate: "2026-10-05", accountingNote: "x" };
    expect(thanKhoanChi(dong(), n, { canPay: false, canEdit: true })).toEqual({ baseVersion: 3, invoiceDate: "2026-10-05", accountingNote: "x" });
    expect(thanKhoanChi(dong(), n, { canPay: true, canEdit: false })).toEqual({ baseVersion: 3, paid: true, paidProof: ANH });
    expect(thanKhoanChi(dong(), n, { canPay: false, canEdit: false })).toBeNull();
  });

  it("dòng nạp lại (409 / realtime): ô CHƯA đụng không gửi, ô đã sửa so với giá trị MỚI + version mới", () => {
    // Người dùng chỉ sửa ghi chú; kế toán khác vừa ghi Ngày HĐ và đổi version 3 → 4.
    const moi = dong({ version: 4, invoiceDate: "2026-10-02", accountingNote: "của người kia" });
    expect(thanKhoanChi(moi, { accountingNote: "của tôi" }, DU_QUYEN)).toEqual({ baseVersion: 4, accountingNote: "của tôi" });
    // Người kia cũng vừa tích → lệnh "tích" của tôi thành không đổi, ảnh tôi chọn vẫn đi.
    expect(thanKhoanChi(dong({ version: 4, paid: true }), { paid: true, anhMoi: ANH }, DU_QUYEN)).toEqual({ baseVersion: 4, paidProof: ANH });
  });
});

describe("ngày thuần 'YYYY-MM-DD' (Ngày hóa đơn) — tách chuỗi, không qua múi giờ", () => {
  it("định dạng dd/mm/yyyy, đúng ngày (không lùi một ngày ở đầu năm / đầu tháng)", () => {
    expect(fmtNgayThuan("2026-10-05")).toBe("05/10/2026");
    expect(fmtNgayThuan("2026-01-01")).toBe("01/01/2026");
    expect(fmtNgayThuan("2028-02-29")).toBe("29/02/2028");
  });
  it("không phải ngày có thật / sai dạng → chuỗi rỗng", () => {
    for (const s of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "05/10/2026", "2026-10-5", "", null, undefined]) {
      expect(fmtNgayThuan(s as string | null | undefined), String(s)).toBe("");
    }
    expect(laNgayThuan("2000-02-29")).toBe(true);
    expect(laNgayThuan("1900-02-29")).toBe(false);
    expect(laNgayThuan(20261005)).toBe(false);
  });
});

describe("nhãn + luật hiển thị", () => {
  it("nhãn trạng thái hàng: đủ năm trạng thái máy chủ trả, không nhãn rỗng; giá trị lạ trả nguyên văn", () => {
    const ds: TrangThaiHangDauVao[] = ["binh-thuong", "chua-duyet", "hn-chua-duyet", "khong-con-hang", "bao-gia-da-xoa"];
    expect(Object.keys(NHAN_TRANG_THAI_HANG).sort()).toEqual([...ds].sort());
    for (const t of ds) expect(nhanTrangThaiHang(t).trim(), t).not.toBe("");
    expect(nhanTrangThaiHang("khong-con-hang")).toBe("Không còn trong báo giá");
    expect(nhanTrangThaiHang("la-hoac")).toBe("la-hoac");
  });

  it("lyDoKhongTich: chỉ TÍCH MỚI mới đòi hàng đã duyệt + còn trong báo giá; khoản đã chi luôn bỏ tích được", () => {
    expect(lyDoKhongTich({ paid: false, trangThaiHang: "binh-thuong" })).toBeNull();
    expect(lyDoKhongTich({ paid: true, trangThaiHang: "chua-duyet" })).toBeNull();
    expect(lyDoKhongTich({ paid: true, trangThaiHang: "khong-con-hang" })).toBeNull();
    expect(lyDoKhongTich({ paid: false, trangThaiHang: "chua-duyet" })).toMatch(/chưa được duyệt/);
    expect(lyDoKhongTich({ paid: false, trangThaiHang: "hn-chua-duyet" })).toMatch(/Hà Nội/);
    expect(lyDoKhongTich({ paid: false, trangThaiHang: "khong-con-hang" })).toMatch(/không còn trong báo giá/);
  });

  it("huy hiệu ⚠: trạng thái hàng khác bình thường, hoặc số tiền đổi sau khi chi (nêu cả hai con số)", () => {
    expect(canhBaoKhoan({ trangThaiHang: "binh-thuong", tienDoi: false, paidAmount: null, amount: 1000 })).toEqual([]);
    expect(canhBaoKhoan({ trangThaiHang: "chua-duyet", tienDoi: false, paidAmount: null, amount: 1000 })).toEqual(["Hàng chưa duyệt / đã bị bỏ duyệt"]);
    expect(canhBaoKhoan({ trangThaiHang: "binh-thuong", tienDoi: true, paidAmount: 1000000, amount: 1200000 }))
      .toEqual(["Số tiền đã đổi sau khi chi: đã chi 1.000.000 — hiện 1.200.000"]);
  });

  it("phía của loại bảng; tên bảng chỉ hiện khi khác tên mặc định (không phân biệt hoa thường)", () => {
    expect(phiaCuaLoai("hanoi")).toBe("hn");
    expect(phiaCuaLoai("hcm")).toBe("sheet");
    expect(phiaCuaLoai("khach")).toBe("sheet");
    expect(tenBangRieng("hcm", "Chi phí HCM")).toBeNull();
    expect(tenBangRieng("hcm", "  chi phí hcm ")).toBeNull();
    expect(tenBangRieng("hanoi", "Giá Hà Nội")).toBeNull();
    expect(tenBangRieng("hanoi", "Báo Giá Hà Nội"), "tên bảng HN cũ").toBeNull();
    expect(tenBangRieng("khach", "Phí khách hàng")).toBeNull();
    expect(tenBangRieng("hcm", "Thuê xe nâng")).toBe("Thuê xe nâng");
    expect(tenBangRieng("hcm", null)).toBeNull();
  });

  it("ảnh chỉ vào src khi là data-URL ảnh base64 khớp TOÀN CHUỖI", () => {
    expect(anhHienDuoc(ANH)).toBe(ANH);
    expect(anhHienDuoc('data:image/png;base64,AAA"><img src=x onerror=alert(1)>')).toBe("");
    expect(anhHienDuoc("https://evil.example/a.png")).toBe("");
    expect(anhHienDuoc(null)).toBe("");
  });

  it("số lượng: tối đa 4 chữ số lẻ, kiểu Việt", () => {
    expect(fmtSoLuong(2)).toBe("2");
    expect(fmtSoLuong(1.5)).toBe("1,5");
    expect(fmtSoLuong(1234.56789)).toBe("1.234,5679");
  });
});

// Soát 2026-10-06 (W6 · DT-2).
describe("laNgayHoaDon — ngày thuần có thật TRONG 2000–2100 (máy chủ 400 ngoài khoảng)", () => {
  it("min/max của ô ngày không chặn gõ tay — phải tự soát", () => {
    for (const s of ["2000-01-01", "2026-10-05", "2100-12-31", "2024-02-29"]) expect(laNgayHoaDon(s), s).toBe(true);
    for (const s of ["1999-12-31", "0026-10-05", "2101-01-01", "2026-02-30", "", null, "05/10/2026"]) expect(laNgayHoaDon(s), String(s)).toBe(false);
  });
});

describe("xungDotKhoanChi — người khác vừa sửa ĐÚNG ô mình đang sửa (realtime nạp lại không gây 409)", () => {
  const anh = (id: number, hienTai: boolean) => ({ id, uploadedAt: null, uploadedByName: null, retiredAt: null, retiredReason: null, source: "upload", hienTai });
  const r = (over: Record<string, unknown> = {}) => ({ paid: false, hasPaidProof: false, invoiceDate: null, accountingNote: null, proofs: [], ...over }) as Parameters<typeof giaTriTruong>[0];

  it("giaTriTruong: ảnh so theo id ảnh HIỆN TẠI (thay ảnh là đổi); ảnh JSON cũ chưa có id vẫn khác 'không ảnh'; ghi chú so sau khi cắt", () => {
    expect(giaTriTruong(r({ hasPaidProof: true, proofs: [anh(3, false), anh(7, true)] }), "anh")).toBe("7");
    expect(giaTriTruong(r({ hasPaidProof: true }), "anh")).not.toBe(giaTriTruong(r(), "anh"));
    expect(giaTriTruong(r({ accountingNote: "  a  " }), "accountingNote")).toBe("a");
    expect(giaTriTruong(r({ paid: true }), "paid")).toBe("1");
  });
  it("chỉ báo ô SẮP GHI mà đã đổi từ lúc mình bắt đầu sửa; ô chưa đụng (không có bản chụp) không bao giờ là xung đột", () => {
    const goc = { accountingNote: "Cũ", invoiceDate: "" };
    const nay = r({ accountingNote: "Của B", invoiceDate: "2026-10-01" });
    expect(xungDotKhoanChi(goc, nay, { baseVersion: 1, accountingNote: "Của tôi" })).toEqual(["accountingNote"]);
    expect(xungDotKhoanChi(goc, nay, { baseVersion: 1, invoiceDate: "2026-10-09" })).toEqual(["invoiceDate"]);
    expect(xungDotKhoanChi({}, nay, { baseVersion: 1, accountingNote: "x" }), "không có bản chụp").toEqual([]);
    expect(xungDotKhoanChi({ accountingNote: "Của B" }, nay, { baseVersion: 1, accountingNote: "x" }), "bắt đầu sửa SAU khi B lưu").toEqual([]);
    expect(xungDotKhoanChi({ paid: "0", anh: "" }, r({ paid: true, hasPaidProof: true, proofs: [anh(9, true)] }), { baseVersion: 2, paidProof: "data:x" })).toEqual(["anh"]);
  });
  it("moTaXungDot nêu giá trị MỚI người kia vừa ghi", () => {
    expect(moTaXungDot(r({ accountingNote: "Của B" }), "accountingNote")).toBe("Ghi chú kế toán → “Của B”");
    expect(moTaXungDot(r({ invoiceDate: "2026-10-01" }), "invoiceDate")).toBe("Ngày hóa đơn → 01/10/2026");
    expect(moTaXungDot(r(), "invoiceDate")).toBe("Ngày hóa đơn → (trống)");
    expect(moTaXungDot(r({ paid: true }), "paid")).toBe("Đã chi → Đã chi");
    expect(moTaXungDot(r({ accountingNote: "x".repeat(100) }), "accountingNote")).toMatch(/…”$/);
  });
});
