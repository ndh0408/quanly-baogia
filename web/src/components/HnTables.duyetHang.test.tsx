/** @vitest-environment jsdom */
/**
 * CỘT DUYỆT TỪNG HÀNG của bảng Hà Nội (chủ repo 2026-10-06: "Thêm cột Duyệt từng hàng … cái nào đã duyệt thì không cho
 * sửa nhé"). Chốt ở mức component:
 *   · cột DUYỆT hiện trạng thái từng hàng (Đang làm / Chờ duyệt / Đã duyệt / Bị trả + lý do);
 *   · hàng ĐÃ DUYỆT: mọi ô tắt, không có nút xoá hàng — kể cả với người có quyền duyệt; hàng chờ duyệt khoá với Account HN;
 *   · trình soạn (người có quyền duyệt): ô tích Duyệt + "↩ Trả" gọi `onHanhDong(loai, [rid])`; Account HN: nút "Gửi";
 *   · hàng mới chưa lưu (chưa có rid) không có nút — "chưa lưu";
 *   · sửa lọt vào hàng khoá bằng đường nhiều ô (dán, kéo điền, Ctrl+Z…) bị HOÀN LẠI ngay ở lần báo đổi kế tiếp;
 *   · sheet có hàng đã duyệt không xoá được, tên sheet / mẫu khoá.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HnTables, hangHnBiKhoa, gopTrangThaiHn, hnCoThayDoi, type HnTable } from "./HnTables";
import { nextK, type ItemK } from "../lib/gridShared";
import type { EditorTemplate } from "../lib/api";

vi.mock("../lib/venueCatalog", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/venueCatalog")>();
  return { ...goc, loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) };
});
const toastGoi: string[] = [];
vi.mock("../lib/ui", async (nhapGoc) => {
  const goc = await nhapGoc<typeof import("../lib/ui")>();
  return { ...goc, toast: (m: string) => { toastGoi.push(m); }, confirmModal: async () => true };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MAU: EditorTemplate[] = [
  { id: 1, code: "gn", name: "GN (không ngày)", companyId: 1, layout: { hasDetail: false, reserveDetail: false, hasDays: false, numberSubsections: false } } as EditorTemplate,
];
const hang = (name: string, over: Record<string, unknown> = {}): ItemK =>
  ({ _k: nextK(), kind: "item", name, unit: "bộ", quantity: 1, unitPrice: 1000, notes: "", ...over }) as unknown as ItemK;
const bangMau = (): HnTable[] => [{ _k: nextK(), templateId: 1, name: "HN", groupSubtotal: false, items: [
  hang("Đã duyệt", { rid: "d", trangThaiDuyet: "da-duyet", approved: true, approvedAt: "2026-10-06T02:00:00.000Z" }),
  hang("Chờ", { rid: "c", trangThaiDuyet: "cho-duyet" }),
  hang("Bị trả", { rid: "t", trangThaiDuyet: "tra-lai", lyDoTra: "Giá cao" }),
  hang("Đang làm", { rid: "l", trangThaiDuyet: "dang-lam" }),
  hang("Mới chưa lưu"),
] } as unknown as HnTable];

let thung: HTMLDivElement, goc: Root;
beforeEach(() => { toastGoi.length = 0; thung = document.createElement("div"); document.body.appendChild(thung); goc = createRoot(thung); });
afterEach(() => { act(() => goc.unmount()); thung.remove(); document.body.innerHTML = ""; });

type Opt = { cheDo?: "chu" | "account"; canApprove?: boolean; onHanhDong?: (l: string, r: string[]) => void; onMarkDirty?: () => void };
function dung(tables: HnTable[], o: Opt = {}) {
  act(() => {
    goc.render(<HnTables moMacDinh tables={tables} templates={MAU} companyId={1} editable canApprove={o.canApprove}
      cheDo={o.cheDo} onHanhDong={o.onHanhDong as never} onMarkDirty={o.onMarkDirty ?? (() => {})} />);
  });
}
const dong = (ten: string) => [...thung.querySelectorAll<HTMLTableRowElement>("tr[data-row]")]
  .find((tr) => (tr.querySelector<HTMLTextAreaElement>('textarea[name="name"]')?.value ?? "") === ten)!;
const oGia = (ten: string) => dong(ten).querySelector<HTMLInputElement>('input[name="unitPrice"]')!;
const oDuyet = (ten: string) => dong(ten).querySelector(".col-approve")!;

describe("Bảng HN — cột DUYỆT từng hàng", () => {
  it("có cột DUYỆT, mỗi hàng hiện trạng thái; lý do trả hiện ngay", () => {
    dung(bangMau(), { canApprove: true });
    expect([...thung.querySelectorAll("th")].map((x) => x.textContent)).toContain("DUYỆT");
    expect(oDuyet("Đã duyệt").textContent).toContain("Đã duyệt");
    expect(oDuyet("Chờ").textContent).toContain("Chờ duyệt");
    expect(oDuyet("Bị trả").textContent).toContain("Giá cao");
    expect(oDuyet("Đang làm").textContent).toContain("Đang làm");
  });

  it("hàng ĐÃ DUYỆT khoá với cả người có quyền duyệt: ô tắt, không nút xoá; hàng khác sửa được", () => {
    dung(bangMau(), { canApprove: true, cheDo: "chu" });
    expect(oGia("Đã duyệt").disabled).toBe(true);
    expect(dong("Đã duyệt").querySelector<HTMLTextAreaElement>('textarea[name="name"]')!.disabled).toBe(true);
    expect(dong("Đã duyệt").querySelector(".rm-row")).toBeNull();
    expect(oGia("Chờ").disabled, "người duyệt sửa được hàng đang chờ").toBe(false);
    expect(oGia("Đang làm").disabled).toBe(false);
    expect(dong("Đang làm").querySelector(".rm-row")).not.toBeNull();
  });

  it("Account HN: hàng chờ duyệt cũng khoá; nút 'Gửi' chỉ ở hàng đang làm / bị trả ĐÃ LƯU; không có ô Duyệt", () => {
    const goi: [string, string[]][] = [];
    dung(bangMau(), { cheDo: "account", canApprove: false, onHanhDong: (l, r) => goi.push([l, r]) });
    expect(oGia("Chờ").disabled).toBe(true);
    expect(oGia("Bị trả").disabled).toBe(false);
    expect(thung.querySelector('.col-approve input[name="approved"]')).toBeNull();
    expect(oDuyet("Đã duyệt").querySelector(".hn-nut-gui")).toBeNull();
    expect(oDuyet("Chờ").querySelector(".hn-nut-gui")).toBeNull();
    expect(oDuyet("Mới chưa lưu").textContent).toContain("chưa lưu");
    expect(oDuyet("Mới chưa lưu").querySelector("button")).toBeNull();
    act(() => { oDuyet("Bị trả").querySelector<HTMLButtonElement>(".hn-nut-gui")!.click(); });
    expect(goi).toEqual([["gui", ["t"]]]);
  });

  it("người duyệt: tích Duyệt → 'duyet', bỏ tích → 'bo-duyet', '↩ Trả' → 'tra' (gọi máy chủ, không sửa model tại chỗ)", () => {
    const goi: [string, string[]][] = [];
    const tables = bangMau();
    dung(tables, { cheDo: "chu", canApprove: true, onHanhDong: (l, r) => goi.push([l, r]) });
    act(() => { oDuyet("Chờ").querySelector<HTMLInputElement>('input[name="approved"]')!.click(); });
    act(() => { oDuyet("Đã duyệt").querySelector<HTMLInputElement>('input[name="approved"]')!.click(); });
    act(() => { oDuyet("Chờ").querySelector<HTMLButtonElement>(".hn-nut-tra")!.click(); });
    expect(goi).toEqual([["duyet", ["c"]], ["bo-duyet", ["d"]], ["tra", ["c"]]]);
    expect((tables[0].items[1] as unknown as { trangThaiDuyet: string }).trangThaiDuyet, "trạng thái chỉ đổi khi máy chủ trả về").toBe("cho-duyet");
  });

  it("không có quyền duyệt (trình soạn): không ô Duyệt; hàng chờ duyệt khoá như máy chủ", () => {
    dung(bangMau(), { cheDo: "chu", canApprove: false, onHanhDong: () => {} });
    expect(thung.querySelector('.col-approve input[name="approved"]')).toBeNull();
    expect(oGia("Chờ").disabled).toBe(true);
  });

  it("sửa LỌT vào hàng khoá (đường nhiều ô) → hoàn lại ở lần báo đổi kế tiếp, kể cả hàng bị xoá; cờ 'chưa lưu' bật", () => {
    const tables = bangMau();
    dung(tables, { cheDo: "chu", canApprove: true });
    const items = tables[0].items as unknown as Record<string, unknown>[];
    // Mô phỏng dán đè giá + xoá hàng đã duyệt rồi lưới báo đổi (gõ vào hàng đang làm).
    items[0].unitPrice = 999_999;
    // Báo đổi NGAY (ô Lưu kho gọi onChange thẳng, không hẹn giờ như ô gõ).
    const baoDoi = () => act(() => { dong("Đang làm").querySelector<HTMLInputElement>('input[name="luuKho"]')!.click(); });
    baoDoi();
    expect(items[0].unitPrice).toBe(1000);
    expect(toastGoi.some((m) => /bị khoá/.test(m))).toBe(true);
    const daDuyet = items.splice(0, 1)[0];
    baoDoi();
    expect(items.find((x) => x.rid === "d"), "hàng đã duyệt bị xoá phải được chèn lại").toMatchObject({ name: daDuyet.name, unitPrice: 1000 });
    expect(hnCoThayDoi(tables)).toBe(true);
  });

  it("sheet có hàng đã duyệt: tên sheet khoá, không đổi mẫu", () => {
    dung(bangMau(), { cheDo: "chu", canApprove: true });
    expect(thung.querySelector<HTMLInputElement>('input[name="tenSheet"]')!.disabled).toBe(true);
    expect(thung.querySelector('select[name="templateId"]')).toBeNull();
  });
});

describe("luật thuần của HnTables", () => {
  it("hangHnBiKhoa khớp máy chủ; dòng nhóm không bao giờ khoá", () => {
    expect(hangHnBiKhoa({ trangThaiDuyet: "da-duyet" }, "chu", true)).toBe(true);
    expect(hangHnBiKhoa({ trangThaiDuyet: "cho-duyet" }, "chu", true)).toBe(false);
    expect(hangHnBiKhoa({ trangThaiDuyet: "cho-duyet" }, "chu", false)).toBe(true);
    expect(hangHnBiKhoa({ trangThaiDuyet: "cho-duyet" }, "account", true)).toBe(true);
    expect(hangHnBiKhoa({ trangThaiDuyet: "tra-lai" }, "account", false)).toBe(false);
    expect(hangHnBiKhoa({ kind: "section", trangThaiDuyet: "da-duyet" }, "chu", true)).toBe(false);
  });
  it("gopTrangThaiHn: lấy trạng thái theo rid, không đụng nội dung đang soạn", () => {
    const dich = [{ items: [{ rid: "a", name: "đang sửa", trangThaiDuyet: "cho-duyet" }] }] as unknown as HnTable[];
    gopTrangThaiHn(dich, [{ items: [{ rid: "a", name: "bản máy chủ", trangThaiDuyet: "da-duyet", approved: true }] }]);
    expect(dich[0].items[0]).toMatchObject({ name: "đang sửa", trangThaiDuyet: "da-duyet", approved: true });
  });
});
