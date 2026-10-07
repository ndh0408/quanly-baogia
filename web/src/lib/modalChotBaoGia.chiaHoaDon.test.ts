/** @vitest-environment jsdom */
//
// CHIA HÓA ĐƠN NGAY TRONG HỘP "✓ KHÁCH CHỐT CẢ BÁO GIÁ" (chủ repo 2026-10-07: "không nó phải nằm ở chỗ duyệt cơ", "ở
// trong phần báo giá luôn á"). Mỗi trang thêm ô chọn Hóa đơn 1/2/…/Để sau/Không xuất, khung xem trước mã _01/_02 + Trước /
// Sau VAT từng mã — CÙNG hàm nhomHoaDon với trang Hóa đơn đầu ra; tiền mỗi mã CHỈ cộng trang chọn vào mã đó.
// Kết quả hộp mang `chiaHoaDon` CHỈ khi người dùng đổi so với hiện có — chưa chia mà không đổi gì thì không gửi (giữ
// nghĩa cũ). Báo giá 1 trang: hộp y như cũ.
// ĐỎ trên 643b491: hộp không có ô chọn / khung xem trước, không trả `chiaHoaDon`.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { modalChotBaoGia, type KetQuaChot } from "./ui";
import type { ProjectQuote } from "./api";

const TRANG = [
  { id: 1, ten: "1. Banner", net: 1_000_000, custStatus: "approved" as string | null },
  { id: 2, ten: "2. Ticketbox", net: 2_000_000, custStatus: "approved" as string | null },
  { id: 3, ten: "3. Lightbox", net: 4_000_000, custStatus: "approved" as string | null },
];
const bg = (over: Partial<ProjectQuote> = {}): ProjectQuote => ({
  id: 5, title: "Sự kiện", status: "converted", vatPercent: 8, projectCode: "FP_5",
  sheets: TRANG.map((t, i) => ({ id: t.id, codeNo: i + 1, name: t.ten.slice(3), subtotal: t.net, custStatus: t.custStatus, invoiceGroup: null, invoiceHold: null })),
  ...over,
});

const hop = () => document.querySelector(".modal-backdrop") as HTMLElement;
const oChon = (id: number) => hop().querySelector(`select[name="chotHoaDon-${id}"]`) as HTMLSelectElement;
const doi = (id: number, v: string) => { const o = oChon(id); o.value = v; o.dispatchEvent(new Event("change", { bubbles: true })); };
const xem = () => hop().querySelector("[data-xem-chia]")?.textContent || "";
const tien = (n: number) => Math.round(n).toLocaleString("vi-VN") + " đ";

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { document.body.innerHTML = ""; });

describe("modalChotBaoGia — chia hóa đơn lúc chốt", () => {
  it("mỗi trang một ô chọn; mặc định chưa chia = mỗi trang một hóa đơn theo số mã cũ", () => {
    modalChotBaoGia("GN26005", TRANG, 8, { quote: bg() });
    expect([1, 2, 3].map((id) => oChon(id).value)).toEqual(["1", "2", "3"]);
    expect(oChon(1).getAttribute("autocomplete")).toBe("off");
    expect(xem()).toContain("FP_5_01");
    expect(xem()).toContain("FP_5_03");
  });

  it("S1+S2 → _01, S3 → Để sau: _01 = S1+S2 (trước VAT 3tr, sau VAT 3,24tr); S3 chỉ ở Để sau; chốt trả về phép chia", async () => {
    const p = modalChotBaoGia("GN26005", TRANG, 8, { quote: bg() });
    doi(2, "1");
    doi(3, "later");
    expect(xem()).toContain("FP_5_01");
    expect(xem()).toContain(`trước VAT ${tien(3_000_000)}`);
    expect(xem()).toContain(`sau VAT ${tien(3_240_000)}`);
    expect(xem()).toContain("Để sau: Lightbox");
    expect(xem(), "không có mã thứ hai — S3 không cộng vào đâu").not.toContain("FP_5_02");
    (hop().querySelector("[data-yes]") as HTMLButtonElement).click();
    const kq = (await p) as KetQuaChot;
    expect(kq.chiaHoaDon).toEqual([
      { sheetId: 1, group: 1, hold: null }, { sheetId: 2, group: 1, hold: null }, { sheetId: 3, group: null, hold: "later" },
    ]);
  });

  it("không đổi gì (báo giá chưa chia) → KHÔNG có chiaHoaDon: 'chưa chia' giữ nghĩa cũ", async () => {
    const p = modalChotBaoGia("GN26005", TRANG, 8, { quote: bg() });
    (hop().querySelector("[data-yes]") as HTMLButtonElement).click();
    const kq = await p;
    expect(kq).toEqual([]);
    expect(kq!.chiaHoaDon).toBeUndefined();
  });

  it("báo giá ĐÃ chia sẵn → hộp mở đúng phép chia đang có", () => {
    const q = bg();
    q.sheets = q.sheets!.map((s) => ({ ...s, invoiceGroup: s.id === 3 ? null : 1, invoiceHold: s.id === 3 ? "skip" : null }));
    modalChotBaoGia("GN26005", TRANG, 8, { quote: q });
    expect([1, 2, 3].map((id) => oChon(id).value)).toEqual(["1", "1", "skip"]);
    expect(xem()).toContain("Không xuất: Lightbox");
  });

  it("trang khách không duyệt: mặc định Không xuất, không vào tiền xem trước; đồng ý lại → về hóa đơn của nó", () => {
    const trang = TRANG.map((t) => (t.id === 2 ? { ...t, custStatus: "rejected" } : t));
    modalChotBaoGia("GN26005", trang, 8, { quote: bg() });
    expect(oChon(2).value).toBe("skip");
    expect(xem()).not.toContain("Ticketbox");
    (hop().querySelector('[data-dat="2|approved"]') as HTMLButtonElement).click();
    expect(oChon(2).value).toBe("2");
    expect(xem()).toContain("FP_5_02");
  });

  it("báo giá 1 trang: không ô chọn, không khung xem trước — y như cũ", async () => {
    const mot = [TRANG[0]];
    const p = modalChotBaoGia("GN26005", mot, 8, { quote: bg({ sheets: bg().sheets!.slice(0, 1) }) });
    expect(hop().querySelector("select")).toBeNull();
    expect(hop().querySelector("[data-xem-chia]")).toBeNull();
    (hop().querySelector("[data-yes]") as HTMLButtonElement).click();
    expect(await p).toEqual([]);
  });
});
