/** @vitest-environment jsdom */
//
// NHẬP EXCEL TỰ BẬT "Hiện Thành Tiền nhóm" — phần GHI CỜ của màn Account Hà Nội (applyImport của AccountHnView).
// Cùng luật với trình soạn báo giá (xem QuoteEditor.napBatNhom.test.tsx): nạp xong mà bảng kết quả còn nhóm SL > 1 thì cờ của
// bảng đó = BẬT, ô tích vì vậy bị khoá bật — cùng luật khoá của lưới. Khác ở hai chỗ: màn này KHÔNG gán cờ theo file lúc THAY
// (cờ của bảng đích đứng nguyên; chỉ tự bật khi cần, không bao giờ tắt vì nhập), và tổng bảng HN là extraTableSum — KHÔNG BAO
// GIỜ nhân Số Lượng nhóm, bảng HN cũng không xuất Excel — nên lời báo không được nói "tổng đã nhân hệ số nhóm".
// Hộp "Nhập từ Excel" thật đã kiểm ở ImportExcelModal.tuBatNhom.test.tsx; ở đây thay bằng nút trao thẳng payload cho onApply.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gnk", name: "GN (không ngày)", companyId: 7, layout: { hasDays: false } }];
const nhom = (sl: number) => ({ kind: "section", name: "Nhóm HN", unit: "", quantity: sl, unitPrice: 0 });
const muc = (ten = "Khung backdrop", sl = 2, gia = 250_000) => ({ kind: "item", name: ten, unit: "m2", quantity: sl, unitPrice: gia });
const bang = (name: string, groupSubtotal: boolean, items: unknown[]) => ({ name, templateId: 1, groupSubtotal, items });

const h = vi.hoisted(() => ({
  bang: [] as unknown[],
  saveHn: null as unknown as ReturnType<typeof vi.fn>,
  napExcel: null as unknown,   // payload mà hộp "Nhập từ Excel" giả trao cho onApply
  propsHop: null as Record<string, unknown> | null,   // props màn này truyền cho hộp — để chốt hai cờ riêng của bảng HN
}));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const saveHn = vi.fn(async () => ({}));
  h.saveHn = saveHn;
  return {
    ...that,
    isPreviewMode: () => false,
    api: {
      ...that.api,
      metaTemplates: vi.fn(async () => MAU),
      getQuote: vi.fn(async () => ({
        id: 11, quoteNumber: "GN26D011", title: "Giao HN", companyId: 7, hnStatus: "assigned",
        updatedAt: "2026-09-16T00:00:00.000Z", hnRev: "a".repeat(32), hnTables: JSON.parse(JSON.stringify(h.bang)),
      })),
      saveHn,
      submitHn: vi.fn(async () => ({})),
    },
  };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn(), confirmModal: vi.fn(async () => true) }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../components/ImportExcelModal", async (goc) => {
  const that = await goc<typeof import("../components/ImportExcelModal")>();
  const { createElement } = await import("react");
  return { ...that, ImportExcelModal: (p: { onApply: (x: unknown) => void }) => { h.propsHop = p as unknown as Record<string, unknown>; return createElement("button", { type: "button", onClick: () => p.onApply(h.napExcel) }, "Nạp giả"); } };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { AccountHnView } from "./AccountHnView";
import { NEW_SHEET } from "../components/ImportExcelModal";
import { tbNhapTuBatNhom } from "../lib/khoaThanhTienNhom";
import * as ui from "../lib/ui";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
async function mo(bangHn: unknown[]) {
  h.bang = bangHn;
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<AccountHnView quoteId={11} meId={5} />); });
  await cho(30);
}
const nutTheoChu = (chu: string) => [...host!.querySelectorAll("button")].find((b) => (b.textContent || "").includes(chu)) as HTMLButtonElement;
const bam = async (el: HTMLElement) => { await act(async () => { el.click(); }); await cho(10); };
const oTich = (i: number) => host!.querySelectorAll<HTMLInputElement>('label.gf-group-sub input[type="checkbox"]')[i];
const trangThaiO = (i: number) => [oTich(i).checked, oTich(i).disabled];
const ke = (ten: string, targetIndex: number, items: unknown[], o: { mode?: string; coFile?: boolean } = {}) =>
  ({ file: { name: ten, groupSubtotal: !!o.coFile }, targetIndex, mode: o.mode ?? "replace", templateId: 1, items });
async function napExcel(...plans: unknown[]) {
  h.napExcel = { plans };
  await bam(nutTheoChu("Nhập từ Excel"));
  await bam(nutTheoChu("Nạp giả"));
}
/** Bấm Lưu và đọc cờ `groupSubtotal` của từng bảng trong gói gửi máy chủ. */
async function coDaLuu() {
  const luu = [...host!.querySelectorAll("button")].find((b) => /Lưu/.test(b.textContent || "") && !/Gửi/.test(b.textContent || "")) as HTMLButtonElement;
  await bam(luu);
  const goi = h.saveHn.mock.calls.at(-1)![1] as { groupSubtotal: boolean }[];
  return goi.map((t) => t.groupSubtotal);
}
const thongBao = () => (ui.toast as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); h.propsHop = null; });
afterEach(async () => { await cho(1300); if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; document.body.innerHTML = ""; });

describe("hộp nhập của màn HN được báo đúng hai điều riêng của bảng HN", () => {
  it("Thay giữ cờ bảng đích (thayGiuCoNhomCuaDich) và tổng bảng không nhân hệ số nhóm (tongKhongNhanNhom) — hộp tính xem trước theo đó", async () => {
    await mo([bang("Giá thuê HN", false, [nhom(1), muc()])]);
    await bam(nutTheoChu("Nhập từ Excel"));
    expect(h.propsHop, "hộp nhập không được mở").toBeTruthy();
    expect(h.propsHop!.thayGiuCoNhomCuaDich).toBe(true);
    expect(h.propsHop!.tongKhongNhanNhom).toBe(true);
  });
});

describe("nạp Excel vào bảng HÀ NỘI — THAY (cờ bảng đích đứng nguyên, chỉ tự bật)", () => {
  it("bảng TẮT + file mang nhóm SL 3 (kể cả file ghi cờ BẬT) → cờ BẬT, ô khoá, Lưu ghi true, toast nói đã tự bật", async () => {
    await mo([bang("Giá thuê HN", false, [nhom(1), muc()])]);
    await napExcel(ke("Giá thuê HN", 0, [nhom(3), muc()], { coFile: true }));
    expect(trangThaiO(0), "nạp xong ô phải bật + khoá").toEqual([true, true]);
    expect(thongBao().some((t) => t.includes(tbNhapTuBatNhom(1, true)))).toBe(true);
    expect(thongBao().some((t) => /tổng đã nhân hệ số nhóm/.test(t)), "tổng bảng HN không bao giờ nhân hệ số — toast không được nói thế").toBe(false);
    expect(await coDaLuu()).toEqual([true]);
  });

  it("bảng TẮT + file chỉ có nhóm SL 1 (dù file ghi cờ BẬT) → cờ đứng nguyên TẮT (màn này không lấy cờ theo file)", async () => {
    await mo([bang("Giá thuê HN", false, [nhom(1), muc()])]);
    await napExcel(ke("Giá thuê HN", 0, [nhom(1), muc()], { coFile: true }));
    expect(trangThaiO(0)).toEqual([false, false]);
    expect(thongBao().some((t) => t.includes("tự bật Thành Tiền nhóm"))).toBe(false);
    expect(await coDaLuu()).toEqual([false]);
  });

  it("bảng BẬT + file tắt + nhóm SL 1 → giữ BẬT (nhập không bao giờ tắt cờ), ô nhả khoá vì hết nhóm SL > 1", async () => {
    await mo([bang("Giá thuê HN", true, [nhom(2), muc()])]);
    expect(trangThaiO(0)).toEqual([true, true]);
    await napExcel(ke("Giá thuê HN", 0, [nhom(1), muc()]));
    expect(trangThaiO(0)).toEqual([true, false]);
    expect(await coDaLuu()).toEqual([true]);
  });

  it("bảng BẬT + file nhóm SL 3 → giữ bật, không có toast 'tự bật' (đã bật sẵn)", async () => {
    await mo([bang("Giá thuê HN", true, [nhom(2), muc()])]);
    await napExcel(ke("Giá thuê HN", 0, [nhom(3), muc()]));
    expect(trangThaiO(0)).toEqual([true, true]);
    expect(thongBao().some((t) => t.includes("tự bật Thành Tiền nhóm"))).toBe(false);
  });
});

describe("nạp Excel vào bảng HÀ NỘI — NỐI và bảng MỚI", () => {
  it("NỐI: bảng TẮT + file mang nhóm SL 3 → cờ BẬT", async () => {
    await mo([bang("Giá thuê HN", false, [nhom(1), muc()])]);
    await napExcel(ke("Giá thuê HN", 0, [nhom(3), muc("Standee", 1, 100_000)], { mode: "append" }));
    expect(trangThaiO(0)).toEqual([true, true]);
    expect(await coDaLuu()).toEqual([true]);
  });

  it("NỐI: bảng TẮT + file chỉ có nhóm SL 1 → đứng nguyên TẮT", async () => {
    await mo([bang("Giá thuê HN", false, [nhom(1), muc()])]);
    await napExcel(ke("Giá thuê HN", 0, [nhom(1), muc("Standee", 1, 100_000)], { mode: "append" }));
    expect(await coDaLuu()).toEqual([false]);
  });

  it("bảng MỚI: file tắt + nhóm SL 3 → bảng mới BẬT, bảng cũ không đụng", async () => {
    await mo([bang("Giá thuê HN", false, [nhom(1), muc()])]);
    await napExcel(ke("Bảng mới", NEW_SHEET, [nhom(3), muc("Decal", 1, 100_000)]));
    expect(await coDaLuu()).toEqual([false, true]);
    expect(thongBao().some((t) => t.includes(tbNhapTuBatNhom(1, true)))).toBe(true);
  });

  it("bảng MỚI: file tắt + nhóm SL 1 → TẮT; file BẬT → bật theo file", async () => {
    await mo([bang("Giá thuê HN", false, [nhom(1), muc()])]);
    await napExcel(ke("Mới 1", NEW_SHEET, [nhom(1), muc("Decal", 1, 100_000)]), ke("Mới 2", NEW_SHEET, [nhom(3), muc("Decal", 1, 100_000)], { coFile: true }));
    expect(await coDaLuu()).toEqual([false, false, true]);
    expect(thongBao().some((t) => t.includes("tự bật Thành Tiền nhóm"))).toBe(false);
  });
});

describe("MỞ bảng HN cũ 'tắt + nhóm SL > 1' KHÔNG tự bật", () => {
  it("mở ra: ô tắt và mở khoá; Lưu ngay vẫn ghi false", async () => {
    await mo([bang("Giá thuê HN", false, [nhom(3), muc()])]);
    await cho(300);
    expect(trangThaiO(0)).toEqual([false, false]);
    expect(await coDaLuu()).toEqual([false]);
  });

  it("bảng khác không nằm trong lượt nạp giữ nguyên cờ", async () => {
    await mo([bang("Bảng 1", false, [nhom(1), muc()]), bang("Bảng 2", false, [nhom(3), muc()])]);
    await napExcel(ke("Bảng 1", 0, [nhom(2), muc()]));
    await bam(host!.querySelectorAll<HTMLElement>(".sheet-tab")[1]);   // chỉ lưới của tab đang mở được vẽ
    expect(trangThaiO(0)).toEqual([false, false]);
    expect(await coDaLuu()).toEqual([true, false]);
  });
});
