// Luật THUẦN của duyệt từng hàng bảng Hà Nội (src/hnDuyetHang.ts) + Hóa đơn đầu vào theo hàng (src/inputInvoices.ts).
// Không cần CSDL. Bài trên CSDL thật: tests/hn-duyet-tung-hang.test.js.
import { describe, it, expect } from "vitest";
import {
  trangThaiHangHn, dauDuyetHangHn, reconcileTrangThaiHn, apThaoTacHangHn, tomTatHn, vatChatHoaHn, phuTrangThaiHn,
} from "../src/hnDuyetHang.js";
import { hangHoaDonDauVao } from "../src/inputInvoices.js";

const hang = (over = {}) => ({ kind: "item", name: "Hàng", quantity: 1, unitPrice: 1000, days: null, approved: false, ...over });
const bang = (items, over = {}) => [{ name: "HN", templateId: null, items, ...over }];
const clone = (x) => JSON.parse(JSON.stringify(x));
const PHAN_DUYET = { hnStatus: "approved", hnReviewedAt: new Date("2026-09-25T01:00:00Z"), hnReviewerId: 9, hnRejectNote: null };

describe("trạng thái hiệu lực — dữ liệu cũ suy từ cả phần, cờ riêng thắng", () => {
  it("hàng chưa có trạng thái riêng: approved/submitted/rejected/khác → da-duyet/cho-duyet/tra-lai/dang-lam", () => {
    const it0 = hang();
    expect(trangThaiHangHn(it0, { hnStatus: "approved" })).toBe("da-duyet");
    expect(trangThaiHangHn(it0, { hnStatus: "submitted" })).toBe("cho-duyet");
    expect(trangThaiHangHn(it0, { hnStatus: "rejected" })).toBe("tra-lai");
    expect(trangThaiHangHn(it0, { hnStatus: "assigned" })).toBe("dang-lam");
    expect(trangThaiHangHn(it0, null)).toBe("dang-lam");
    expect(dauDuyetHangHn(it0, PHAN_DUYET)).toEqual({ approvedAt: "2026-09-25T01:00:00.000Z", approvedBy: 9, lyDoTra: null });
  });
  it("cờ riêng THẮNG: bỏ duyệt tường minh trên phần đã duyệt cả phần → đang làm; cờ `approved` cũ không phải nguồn", () => {
    expect(trangThaiHangHn(hang({ trangThaiDuyet: "dang-lam" }), PHAN_DUYET)).toBe("dang-lam");
    expect(trangThaiHangHn(hang({ approved: true }), { hnStatus: "assigned" })).toBe("dang-lam");
    expect(trangThaiHangHn(hang({ trangThaiDuyet: "bịa" }), PHAN_DUYET), "giá trị lạ = như vắng").toBe("da-duyet");
  });
  it("phuTrangThaiHn chỉ trình bày (không đụng bản gốc); vatChatHoaHn ghi tại chỗ; dòng nhóm không mang trạng thái", () => {
    const goc = bang([{ kind: "section", name: "N" }, hang({ rid: "a" })]);
    const tb = phuTrangThaiHn(goc, PHAN_DUYET);
    expect(tb[0].items[1]).toMatchObject({ trangThaiDuyet: "da-duyet", approved: true, approvedBy: 9 });
    expect(goc[0].items[1].trangThaiDuyet).toBeUndefined();
    vatChatHoaHn(goc, PHAN_DUYET);
    expect(goc[0].items[1].trangThaiDuyet).toBe("da-duyet");
    expect(goc[0].items[0].trangThaiDuyet).toBeUndefined();
  });
});

describe("reconcileTrangThaiHn — đường Lưu lấy trạng thái theo rid và KHOÁ hàng đã duyệt", () => {
  const db = () => bang([
    hang({ rid: "d", name: "Đã duyệt", trangThaiDuyet: "da-duyet", approved: true, approvedAt: "2026-10-01T00:00:00.000Z", approvedBy: 3 }),
    hang({ rid: "c", name: "Chờ", trangThaiDuyet: "cho-duyet" }),
    hang({ rid: "l", name: "Đang làm", trangThaiDuyet: "dang-lam" }),
  ]);
  it("payload giả trạng thái bị ghi đè theo CSDL; hàng mới = đang làm; bản sao rid thứ hai = hàng mới", () => {
    const pl = clone(db());
    pl[0].items[2].trangThaiDuyet = "da-duyet"; pl[0].items[2].approved = true;
    pl[0].items.push(hang({ name: "Mới", trangThaiDuyet: "da-duyet" }));
    reconcileTrangThaiHn(pl, db(), null);
    expect(pl[0].items.map((x) => x.trangThaiDuyet)).toEqual(["da-duyet", "cho-duyet", "dang-lam", "dang-lam"]);
    expect(pl[0].items[0]).toMatchObject({ approved: true, approvedBy: 3 });
    expect(pl[0].items[2].approved).toBe(false);
  });
  it("sửa / xoá / đổi tên bảng / đổi mẫu chứa hàng đã duyệt → 409 'hang-hn-da-khoa' (mọi người)", () => {
    for (const sua of [
      (p) => { p[0].items[0].unitPrice = 2; },
      (p) => { p[0].items[0].name = "khác"; },
      (p) => { p[0].items.splice(0, 1); },
      (p) => { p[0].name = "Bảng đổi tên"; },
      (p) => { p[0].templateId = 77; },
    ]) {
      const pl = clone(db()); sua(pl);
      let loi;
      try { reconcileTrangThaiHn(pl, db(), null); } catch (e) { loi = e; }
      expect(loi?.status).toBe(409);
      expect(loi?.code).toBe("hang-hn-da-khoa");
    }
  });
  it("hàng CHỜ DUYỆT: khoá khi khoaChoDuyet (Account HN / người không có quyền duyệt), mở với người duyệt", () => {
    const pl = clone(db()); pl[0].items[1].unitPrice = 5;
    expect(() => reconcileTrangThaiHn(clone(pl), db(), null, { khoaChoDuyet: true })).toThrow(/đã gửi duyệt/);
    expect(() => reconcileTrangThaiHn(clone(pl), db(), null)).not.toThrow();
  });
  it("Số Ngày ở bảng mẫu KHÔNG ngày không phải tiền: web gửi days:null cho hàng cũ còn days → không khoá oan", () => {
    const goc = bang([hang({ rid: "d", days: 3, trangThaiDuyet: "da-duyet" })]);
    const pl = clone(goc); pl[0].items[0].days = null;
    expect(() => reconcileTrangThaiHn(pl, goc, null, { coNgayDb: () => false })).not.toThrow();
    expect(() => reconcileTrangThaiHn(clone(pl), goc, null, { coNgayDb: () => true })).toThrow();
  });
  it("moCotNoiBo: NS · Chứng từ · Lưu kho của hàng đã duyệt sửa được (quản lý HN), tiền vẫn khoá", () => {
    const pl = clone(db()); Object.assign(pl[0].items[0], { ns: "x", chungTu: "VAT", luuKho: true });
    expect(() => reconcileTrangThaiHn(clone(pl), db(), null)).toThrow();
    expect(() => reconcileTrangThaiHn(clone(pl), db(), null, { moCotNoiBo: true })).not.toThrow();
    pl[0].items[0].quantity = 9;
    expect(() => reconcileTrangThaiHn(pl, db(), null, { moCotNoiBo: true })).toThrow();
  });
  it("DỮ LIỆU CŨ: phần đã duyệt cả phần → hàng giữ đã duyệt qua lần Lưu (vật chất hoá), kể cả hàng cũ THIẾU rid (khớp theo vị trí)", () => {
    const goc = bang([hang({ rid: "x" }), hang({ name: "thiếu rid" })]);
    const pl = clone(goc);
    reconcileTrangThaiHn(pl, goc, PHAN_DUYET);
    expect(pl[0].items.map((x) => x.trangThaiDuyet)).toEqual(["da-duyet", "da-duyet"]);
    expect(pl[0].items[1]).toMatchObject({ approvedBy: 9, approvedAt: "2026-09-25T01:00:00.000Z" });
    const sua = clone(goc); sua[0].items[1].unitPrice = 1;
    expect(() => reconcileTrangThaiHn(sua, goc, PHAN_DUYET)).toThrow();
  });
});

describe("apThaoTacHangHn + tomTatHn", () => {
  const goc = () => bang([
    hang({ rid: "a", trangThaiDuyet: "dang-lam" }), hang({ rid: "b", trangThaiDuyet: "tra-lai", lyDoTra: "x" }),
    hang({ rid: "c", trangThaiDuyet: "cho-duyet" }), hang({ rid: "d", trangThaiDuyet: "da-duyet" }),
  ]);
  const tt = (t) => t[0].items.map((x) => x.trangThaiDuyet);
  it("gửi hàng loạt = đang làm + bị trả; duyệt / trả hàng loạt = chỉ hàng chờ; bỏ duyệt cần chọn hàng", () => {
    let t = goc(); apThaoTacHangHn(t, "gui", { nguoi: 1, luc: "L" }); expect(tt(t)).toEqual(["cho-duyet", "cho-duyet", "cho-duyet", "da-duyet"]);
    t = goc(); apThaoTacHangHn(t, "duyet", { nguoi: 1, luc: "L" }); expect(tt(t)).toEqual(["dang-lam", "tra-lai", "da-duyet", "da-duyet"]);
    expect(t[0].items[2]).toMatchObject({ approved: true, approvedBy: 1, approvedAt: "L" });
    t = goc(); apThaoTacHangHn(t, "tra", { nguoi: 1, luc: "L", lyDo: "sai" }); expect(t[0].items[2]).toMatchObject({ trangThaiDuyet: "tra-lai", lyDoTra: "sai" });
    t = goc(); expect(apThaoTacHangHn(t, "bo-duyet", { nguoi: 1, luc: "L" }).ten).toEqual([]);
    t = goc(); apThaoTacHangHn(t, "bo-duyet", { rids: ["d"], nguoi: 1, luc: "L" }); expect(t[0].items[3]).toMatchObject({ trangThaiDuyet: "dang-lam", approved: false, approvedBy: null });
  });
  it("chọn hàng: duyệt thẳng được hàng chưa gửi, trả được hàng đã duyệt; hàng không hợp lệ bị bỏ qua", () => {
    const t = goc();
    expect(apThaoTacHangHn(t, "duyet", { rids: ["a", "d"], nguoi: 1, luc: "L" }).rids).toEqual(["a"]);
    expect(apThaoTacHangHn(t, "tra", { rids: ["d"], nguoi: 1, luc: "L" }).rids).toEqual(["d"]);
  });
  it("tóm tắt hnStatus", () => {
    expect(tomTatHn(goc(), true, null)).toBe("submitted");
    expect(tomTatHn(bang([hang({ trangThaiDuyet: "tra-lai" }), hang({ trangThaiDuyet: "da-duyet" })]), true, null)).toBe("rejected");
    expect(tomTatHn(bang([hang({ trangThaiDuyet: "da-duyet" })]), true, null)).toBe("approved");
    expect(tomTatHn(bang([hang({ trangThaiDuyet: "dang-lam" })]), true, null)).toBe("assigned");
    expect(tomTatHn(bang([hang({ trangThaiDuyet: "dang-lam" })]), false, null)).toBe(null);
    expect(tomTatHn([], true, "assigned")).toBe("assigned");
  });
});

describe("Hóa đơn đầu vào — hàng Hà Nội theo HÀNG", () => {
  const bg = { id: 5, companyId: 7, projectCode: "P", projectVersion: 1, quoteNumber: "Q", title: "T", status: "draft", hnStatus: "submitted", hnReviewedAt: null, hnReviewerId: null };
  const dung = (bangHn, quote = bg) => hangHoaDonDauVao({ quote, sheets: [], sheetTables: [], bangHn, dsMau: [], tenNguoi: new Map([[3, "Duyệt viên"], [9, "Người duyệt cả phần"]]) });
  it("hàng đã duyệt riêng vào NGAY dù phần chưa duyệt hết; ngày / người duyệt theo hàng", () => {
    const ds = dung(bang([hang({ rid: "a", name: "A", trangThaiDuyet: "da-duyet", approvedAt: "2026-10-06T02:00:00.000Z", approvedBy: 3 }), hang({ rid: "b", name: "B", trangThaiDuyet: "cho-duyet" })]));
    expect(ds.map((d) => d.name)).toEqual(["A"]);
    expect(ds[0]).toMatchObject({ trangThaiHang: "binh-thuong", approvedAt: "2026-10-06T02:00:00.000Z", approvedByName: "Duyệt viên" });
  });
  it("DỮ LIỆU CŨ hnStatus=approved: mọi hàng chưa có cờ riêng vào, người duyệt cả phần; hàng bỏ duyệt tường minh thì không", () => {
    const ds = dung(bang([hang({ rid: "a", name: "A" }), hang({ rid: "b", name: "B", trangThaiDuyet: "dang-lam" })]), { ...bg, ...PHAN_DUYET });
    expect(ds.map((d) => d.name)).toEqual(["A"]);
    expect(ds[0]).toMatchObject({ approvedByName: "Người duyệt cả phần", approvedAt: "2026-09-25T01:00:00.000Z" });
  });
});
