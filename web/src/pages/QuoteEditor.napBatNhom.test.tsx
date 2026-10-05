/** @vitest-environment jsdom */
//
// NHẬP EXCEL TỰ BẬT "Hiện Thành Tiền nhóm" — phần GHI CỜ của trình soạn báo giá (applyImport), đủ ba đường: THAY / NỐI /
// sheet MỚI. Chủ repo chốt 2026-09-30: nhập Số Lượng nhóm mà ô không bật thì tổng không nhân hệ số → xuất Excel ra SAI TIỀN.
// Nên nạp xong mà bảng kết quả còn nhóm SL > 1 (theo số đang hiện — `M.groupMult`) thì cờ của sheet đó = BẬT, và vì vậy ô tích
// bị khoá bật theo luật khoá của lưới. Chế độ THAY không được làm mất cờ BẬT của sheet đang bật. Còn báo giá CŨ đã lưu
// "tắt + nhóm SL > 1" thì MỞ ra vẫn không bị bật (chỉ khi người dùng nhập / sửa).
//
// Hộp "Nhập từ Excel" thật cần tệp xlsx + máy chủ đọc tệp (đã kiểm ở ImportExcelModal.tuBatNhom.test.tsx); ở đây thay hộp
// bằng một nút trao thẳng payload cho onApply — đúng chỗ hộp thật gọi sau khi người dùng bấm Nạp. Cùng giàn dựng với
// QuoteEditor.xoaSheet.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];

const nhom = (sl: number) => ({ kind: "section", name: "Nhóm A", unit: "", quantity: sl, unitPrice: 0 });
const muc = (ten = "Backdrop", sl = 2, gia = 250_000) => ({ kind: "item", name: ten, unit: "m2", quantity: sl, unitPrice: gia });
const trang = (id: number, ten: string, groupSubtotal: boolean, items: unknown[]) => ({ id, templateId: 1, name: ten, groupSubtotal, extraTables: [], discount: 0, items });
const baoGia = (sheets: unknown[]) => ({
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "sent", companyId: 7, createdById: 1,
  toCompany: "Khách", vatPercent: 0, discount: 0, showTotals: true, quoteDate: "2026-09-20",
  updatedAt: "2026-09-20T00:00:00.000Z", hnStatus: null, hnTables: [], members: [], sheets,
});

const h = vi.hoisted(() => ({
  doc: null as unknown as () => unknown,
  updateQuote: null as unknown as ReturnType<typeof vi.fn>,
  napExcel: null as unknown,   // payload mà hộp "Nhập từ Excel" giả trao cho onApply
  propsHop: null as Record<string, unknown> | null,   // props trình soạn truyền cho hộp
}));

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => h.doc()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
    updateQuote: vi.fn(async (_id: number, p: Record<string, unknown>) => ({ ...(h.doc() as object), ...JSON.parse(JSON.stringify(p)), updatedAt: "2026-09-21T00:00:00.000Z" })),
  };
  h.updateQuote = fns.updateQuote;
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => ({
  ...(await goc<typeof import("../lib/ui")>()),
  toast: vi.fn(),
  confirmModal: vi.fn(async () => true),
  promptModal: vi.fn(async () => "lý do"),
  modalChotBaoGia: vi.fn(async () => []),
}));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));
vi.mock("../components/ImportExcelModal", async (goc) => {
  const that = await goc<typeof import("../components/ImportExcelModal")>();
  const { createElement } = await import("react");
  return { ...that, ImportExcelModal: (p: { onApply: (x: unknown) => void }) => { h.propsHop = p as unknown as Record<string, unknown>; return createElement("button", { type: "button", onClick: () => p.onApply(h.napExcel) }, "Nạp giả"); } };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteEditorPage } from "./QuoteEditor";
import { NEW_SHEET } from "../components/ImportExcelModal";
import { TB_TU_BAT_NHOM, tbNhapTuBatNhom } from "../lib/khoaThanhTienNhom";
import * as ui from "../lib/ui";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:hn:manage", "quote:read:all"] };

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

async function moEditor(sheets: unknown[]) {
  h.doc = () => baoGia(sheets);
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={ME} quoteId={11} isNew={false} />); });
  await cho(10);
}
const nut = (chu: string) => {
  const b = [...hop!.querySelectorAll("button")].find((x) => x.textContent?.includes(chu));
  if (!b) throw new Error("không thấy nút " + chu);
  return b as HTMLButtonElement;
};
const bam = async (el: HTMLElement) => { await act(async () => { el.click(); }); await cho(10); };
const tab = (i: number) => hop!.querySelectorAll(".sheet-tab")[i] as HTMLElement;
const oTich = () => hop!.querySelector<HTMLInputElement>('label.gf-group-sub input[type="checkbox"]')!;
const trangThaiO = () => [oTich().checked, oTich().disabled];

const ke = (ten: string, targetIndex: number, items: unknown[], o: { mode?: string; coFile?: boolean } = {}) =>
  ({ file: { name: ten, groupSubtotal: !!o.coFile }, targetIndex, mode: o.mode ?? "replace", templateId: 1, items });
async function napExcel(...plans: unknown[]) {
  h.napExcel = { plans };
  await bam(nut("Nhập từ Excel"));
  await bam(nut("Nạp giả"));
}
/** Bấm Lưu và đọc cờ `groupSubtotal` của từng sheet trong gói gửi máy chủ. */
async function coDaLuu() {
  await bam(nut("Lưu"));
  const p = h.updateQuote.mock.calls.at(-1)![1] as { sheets: { name: string; groupSubtotal: boolean }[] };
  return p.sheets.map((s) => s.groupSubtotal);
}
const thongBao = () => (ui.toast as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); h.propsHop = null; });
afterEach(async () => {
  await cho(1300);
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

describe("hộp nhập của trình soạn tính theo luật của SHEET CHÍNH", () => {
  it("không truyền hai cờ riêng của bảng Hà Nội: Thay lấy cờ theo file (không làm mất cờ bật), tổng sheet NHÂN hệ số nhóm khi cờ bật", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()])]);
    await bam(nut("Nhập từ Excel"));
    expect(h.propsHop, "hộp nhập không được mở").toBeTruthy();
    expect(h.propsHop!.thayGiuCoNhomCuaDich).toBeFalsy();
    expect(h.propsHop!.tongKhongNhanNhom).toBeFalsy();
  });
});

describe("nạp Excel THAY toàn bộ vào sheet đang có", () => {
  it("sheet TẮT, file tắt + nhóm SL 3 → cờ BẬT, ô khoá, Lưu ghi true, toast nói đã tự bật", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()])]);
    await napExcel(ke("A", 0, [nhom(3), muc()]));
    expect(trangThaiO(), "nạp xong ô phải bật + khoá").toEqual([true, true]);
    expect(thongBao().some((t) => t.includes(tbNhapTuBatNhom(1)))).toBe(true);
    expect(await coDaLuu()).toEqual([true]);
  });

  it("sheet TẮT, file tắt + nhóm SL 1 (×1 không đổi tổng) → cờ vẫn TẮT, ô không khoá, không toast tự bật", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()])]);
    await napExcel(ke("A", 0, [nhom(1), muc()]));
    expect(trangThaiO()).toEqual([false, false]);
    expect(thongBao().some((t) => t.includes("tự bật Thành Tiền nhóm"))).toBe(false);
    expect(await coDaLuu()).toEqual([false]);
  });

  it("sheet BẬT, file tắt + nhóm SL 1 → KHÔNG làm mất cờ bật (Thay giữ bật), ô nhả khoá vì hết nhóm SL > 1", async () => {
    await moEditor([trang(101, "A", true, [nhom(2), muc()])]);
    expect(trangThaiO()).toEqual([true, true]);
    await napExcel(ke("A", 0, [nhom(1), muc()]));
    expect(trangThaiO()).toEqual([true, false]);
    expect(await coDaLuu()).toEqual([true]);
  });

  it("sheet BẬT, file tắt + nhóm SL 3 → giữ bật (không phải 'tự bật' nên không có toast đó)", async () => {
    await moEditor([trang(101, "A", true, [nhom(2), muc()])]);
    await napExcel(ke("A", 0, [nhom(3), muc()]));
    expect(trangThaiO()).toEqual([true, true]);
    expect(thongBao().some((t) => t.includes("tự bật Thành Tiền nhóm"))).toBe(false);
    expect(await coDaLuu()).toEqual([true]);
  });

  it("sheet TẮT, file BẬT (dòng nhóm có Thành Tiền) → cờ bật theo file", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()])]);
    await napExcel(ke("A", 0, [nhom(3), muc()], { coFile: true }));
    expect(trangThaiO()).toEqual([true, true]);
    expect(await coDaLuu()).toEqual([true]);
  });

  it("nhóm CON SL 2 cũng bật (không chỉ nhóm chính)", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()])]);
    await napExcel(ke("A", 0, [nhom(1), { kind: "subsection", name: "Con", unit: "", quantity: 2, unitPrice: 0 }, muc()]));
    expect(await coDaLuu()).toEqual([true]);
  });

  it("SL nhóm 1,04 hiện '1' (làm tròn 1 số lẻ như ô hiển thị) → không bật", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()])]);
    await napExcel(ke("A", 0, [nhom(1.04), muc()]));
    expect(await coDaLuu()).toEqual([false]);
  });
});

describe("nạp Excel NỐI vào cuối sheet đang có", () => {
  it("đích TẮT + file mang nhóm SL 3 → cờ BẬT (dù file ghi cờ tắt), ô khoá", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()])]);
    await napExcel(ke("A", 0, [nhom(3), muc("Standee", 1, 100_000)], { mode: "append" }));
    expect(trangThaiO()).toEqual([true, true]);
    expect(await coDaLuu()).toEqual([true]);
  });

  it("đích TẮT + file chỉ có nhóm SL 1 → cờ đích đứng nguyên (tắt)", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()])]);
    await napExcel(ke("A", 0, [nhom(1), muc("Standee", 1, 100_000)], { mode: "append" }));
    expect(await coDaLuu()).toEqual([false]);
  });

  it("đích BẬT → giữ bật (file ghi cờ tắt cũng không đổi)", async () => {
    await moEditor([trang(101, "A", true, [nhom(2), muc()])]);
    await napExcel(ke("A", 0, [nhom(1), muc("Standee", 1, 100_000)], { mode: "append" }));
    expect(await coDaLuu()).toEqual([true]);
  });
});

describe("nạp Excel vào sheet MỚI", () => {
  it("file tắt + nhóm SL 3 → sheet mới BẬT; sheet cũ không đụng; toast nói đã tự bật ở 1 sheet", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()])]);
    await napExcel(ke("Decal", NEW_SHEET, [nhom(3), muc("Decal", 1, 100_000)]));
    expect(await coDaLuu()).toEqual([false, true]);
    expect(thongBao().some((t) => t.includes(tbNhapTuBatNhom(1)))).toBe(true);
  });

  it("file tắt + nhóm SL 1 → sheet mới TẮT", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()])]);
    await napExcel(ke("Decal", NEW_SHEET, [nhom(1), muc("Decal", 1, 100_000)]));
    expect(await coDaLuu()).toEqual([false, false]);
  });

  it("file BẬT → sheet mới bật theo file (không phải 'tự bật')", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()])]);
    await napExcel(ke("Decal", NEW_SHEET, [nhom(3), muc("Decal", 1, 100_000)], { coFile: true }));
    expect(await coDaLuu()).toEqual([false, true]);
    expect(thongBao().some((t) => t.includes("tự bật Thành Tiền nhóm"))).toBe(false);
  });
});

describe("nhiều sheet một lượt nạp", () => {
  it("chỉ sheet có nhóm SL > 1 bị bật; toast đếm đúng số sheet đã tự bật", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()]), trang(102, "B", false, [nhom(1), muc()]), trang(103, "C", false, [nhom(1), muc()])]);
    await napExcel(ke("A", 0, [nhom(3), muc()]), ke("B", 1, [nhom(1), muc()]), ke("C", 2, [nhom(2), muc()]));
    expect(await coDaLuu()).toEqual([true, false, true]);
    expect(thongBao().some((t) => t.includes(tbNhapTuBatNhom(2)))).toBe(true);
  });
});

describe("bảng PHỤ (Chi phí HCM / Phí khách hàng) không có đường nhập Excel", () => {
  it("nạp Excel vào sheet chính không đụng bảng phụ: bảng phụ 'tắt + nhóm SL 3' vẫn tắt, hàng vẫn nguyên", async () => {
    const phu = { category: "hcm", templateId: 1, name: "Chi phí", groupSubtotal: false, items: [nhom(3), muc("Chi phí X", 1, 50_000)] };
    await moEditor([{ ...trang(101, "A", false, [nhom(1), muc()]), extraTables: [phu] }]);
    await napExcel(ke("A", 0, [nhom(3), muc()]));
    await bam(nut("Lưu"));
    const goi = h.updateQuote.mock.calls.at(-1)![1] as { sheets: { groupSubtotal: boolean; extraTables: { groupSubtotal: boolean; items: unknown[] }[] }[] };
    expect(goi.sheets[0].groupSubtotal, "sheet chính được bật").toBe(true);
    expect(goi.sheets[0].extraTables[0].groupSubtotal, "bảng phụ không nằm trong lượt nạp — không bị bật hộ").toBe(false);
    expect(goi.sheets[0].extraTables[0].items).toHaveLength(2);
  });
});

describe("MỞ báo giá cũ 'tắt + nhóm SL > 1' KHÔNG tự bật (chỉ nhập / sửa mới bật)", () => {
  it("mở ra: ô tắt và MỞ khoá; Lưu ngay vẫn ghi false; không toast", async () => {
    await moEditor([trang(101, "A", false, [nhom(3), muc()])]);
    await cho(300);
    expect(trangThaiO()).toEqual([false, false]);
    expect(thongBao().some((t) => t === TB_TU_BAT_NHOM || t.includes("tự bật Thành Tiền nhóm"))).toBe(false);
    expect(await coDaLuu()).toEqual([false]);
  });

  it("đối chứng: nạp Excel vào chính sheet đó (nhóm SL 3) thì MỚI bật", async () => {
    await moEditor([trang(101, "A", false, [nhom(3), muc()])]);
    await napExcel(ke("A", 0, [nhom(3), muc()]));
    expect(trangThaiO()).toEqual([true, true]);
  });

  it("sheet khác không nằm trong lượt nạp giữ nguyên cờ (tab kia vẫn tắt + SL 3, không bị bật hộ)", async () => {
    await moEditor([trang(101, "A", false, [nhom(1), muc()]), trang(102, "B", false, [nhom(3), muc()])]);
    await napExcel(ke("A", 0, [nhom(2), muc()]));
    await bam(tab(1));
    expect(trangThaiO()).toEqual([false, false]);
    expect(await coDaLuu()).toEqual([true, false]);
  });
});
