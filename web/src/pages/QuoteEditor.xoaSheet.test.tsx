/** @vitest-environment jsdom */
//
// SOÁT TOÀN DIỆN L53 · L0 · L55 · L5 · L54 — XOÁ SHEET TRONG TRÌNH SOẠN BÁO GIÁ.
//
// Lưới chính từng mang key `main-${ai}-${templateId}`: chỉ theo CHỈ SỐ và mẫu, không theo danh tính
// sheet. Xoá sheet đang mở (hoặc một sheet đứng trước nó) mà chỉ số + mẫu giữ nguyên thì React giữ
// lại instance lưới cũ cùng ngăn Ctrl+Z của sheet cũ; `restore()` chép ảnh chụp đó lên items của
// sheet KHÁC → bấm Lưu là máy chủ ghi hàng sai vào sheet id kia. Cùng gốc: ô Discount (input không
// kiểm soát) vẫn hiện số của sheet vừa xoá, và xoá tab đứng trước làm màn nhảy sang sheet sau.
// Cùng giàn dựng createRoot + act với QuoteEditor.soatCheo.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];

const trang = (id: number, ten: string, hang: string, gia: number, over: Record<string, unknown> = {}) => ({
  id, templateId: 1, name: ten, groupSubtotal: false, extraTables: [], discount: 0,
  items: [{ kind: "item", name: hang, unit: "cái", quantity: 1, unitPrice: gia }], ...over,
});
const baoGia = (over: Record<string, unknown> = {}) => ({
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "sent", companyId: 7, createdById: 1,
  toCompany: "Khách", vatPercent: 0, discount: 0, showTotals: true, quoteDate: "2026-09-20",
  updatedAt: "2026-09-20T00:00:00.000Z", hnStatus: null, hnTables: [], members: [],
  sheets: [trang(101, "A", "Backdrop A", 1000), trang(102, "B", "Banner B", 5000), trang(103, "C", "Standee C", 7000)],
  ...over,
});

const h = vi.hoisted(() => ({
  updateQuote: null as unknown as ReturnType<typeof vi.fn>,
  getQuote: null as unknown as ReturnType<typeof vi.fn>,
  napExcel: null as unknown,   // payload mà hộp "Nhập từ Excel" giả trao cho onApply
}));

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
    // Máy chủ thật trả JSON MỚI — sao sâu để editor không vô tình sửa lên chính payload đã ghi nhận.
    updateQuote: vi.fn(async (_id: number, p: Record<string, unknown>) => ({ ...baoGia(), ...JSON.parse(JSON.stringify(p)), updatedAt: "2026-09-21T00:00:00.000Z" })),
  };
  h.updateQuote = fns.updateQuote;
  h.getQuote = fns.getQuote;
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
// Hộp "Nhập từ Excel" thật cần tệp xlsx + máy chủ đọc tệp; thứ cần kiểm là applyImport của editor, nên
// thay hộp bằng một nút trao thẳng payload cho onApply — đúng chỗ hộp thật gọi sau khi người dùng bấm Nạp.
vi.mock("../components/ImportExcelModal", async (goc) => {
  const that = await goc<typeof import("../components/ImportExcelModal")>();
  const { createElement } = await import("react");
  return { ...that, ImportExcelModal: (p: { onApply: (x: unknown) => void }) => createElement("button", { type: "button", onClick: () => p.onApply(h.napExcel) }, "Nạp giả") };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteEditorPage } from "./QuoteEditor";
import { khoaBanNhap, ghiBanNhap } from "../lib/localDraft";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:hn:manage", "quote:read:all"] };

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

async function moEditor() {
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
const o = (row: number, f: string) => hop!.querySelector(`.editor tr[data-row="${row}"] [data-f="${f}"]`) as HTMLInputElement | HTMLTextAreaElement;
const tabDangMo = () => (hop!.querySelector(".sheet-tab.active span") as HTMLElement).textContent || "";
const tab = (i: number) => hop!.querySelectorAll(".sheet-tab")[i] as HTMLElement;
const xoaSheet = async (i: number) => bam(hop!.querySelector(`button[aria-label="Xóa sheet ${i + 1}"]`) as HTMLButtonElement);

/** Sửa ô Tên hàng 0 của lưới đang mở theo đúng đường người dùng gõ → lưới ghi một mốc hoàn tác. */
async function suaTen(chu: string) {
  const el = o(0, "name");
  act(() => { el.focus(); });
  act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: chu[0], bubbles: true, cancelable: true })); });
  act(() => { el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => { el.blur(); });
  await cho(250);
}
async function ctrlZ() {
  const el = o(0, "unit");
  act(() => { el.focus(); });
  act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })); });
  await cho(250);
}
async function luuVaDocPayload() {
  await bam(nut("Lưu"));
  const p = h.updateQuote.mock.calls.at(-1)![1] as { sheets: { id?: number; name: string; items: { name: string }[] }[] };
  return p.sheets.map((s) => `${s.id}:${s.name}:${s.items.map((it) => it.name).join("|")}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(async () => {
  await cho(1300);
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

describe("L53/L0 — xoá sheet rồi Ctrl+Z không được ghi đè sheet KHÁC", () => {
  it("đang ở A, sửa A, xoá A → sang B; Ctrl+Z KHÔNG chép hàng của A vào B, Lưu giữ nguyên B và C", async () => {
    await moEditor();
    await suaTen("Backdrop A đã sửa");
    await xoaSheet(0);
    expect(tabDangMo()).toContain("B");
    expect(o(0, "name").value).toBe("Banner B");
    await ctrlZ();
    expect(o(0, "name").value, "Ctrl+Z chép hàng của sheet đã xoá vào sheet đang hiện").toBe("Banner B");
    expect(await luuVaDocPayload()).toEqual(["102:B:Banner B", "103:C:Standee C"]);
  });

  it("ca (c) 2 sheet: sửa A, xoá A, sửa B, Ctrl+Z hai lần → B chỉ lùi phần của B, không thành hàng của A", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ sheets: [trang(101, "A", "Backdrop A", 1000), trang(102, "B", "Banner B", 5000)] }));
    await moEditor();
    await suaTen("Backdrop A đã sửa");
    await xoaSheet(0);
    await suaTen("Banner B đã sửa");
    await ctrlZ();
    await ctrlZ();
    expect(o(0, "name").value).toBe("Banner B");
    expect(await luuVaDocPayload()).toEqual(["102:B:Banner B"]);
  });

  it("đối chứng: sửa A rồi Ctrl+Z ngay (không xoá gì) vẫn lùi được như cũ", async () => {
    await moEditor();
    await suaTen("Backdrop A đã sửa");
    expect(o(0, "name").value).toBe("Backdrop A đã sửa");
    await ctrlZ();
    expect(o(0, "name").value).toBe("Backdrop A");
  });

  it("đối chứng: sửa A, Lưu (qRef thay bằng bản máy chủ) rồi Ctrl+Z → vẫn lùi được trên A như trước", async () => {
    await moEditor();
    await suaTen("Backdrop A đã sửa");
    await bam(nut("Lưu"));
    await ctrlZ();
    expect(o(0, "name").value).toBe("Backdrop A");
    expect(tabDangMo()).toContain("A");
  });
});

describe("L53 — `_k` đi kèm bản nháp (phiên trước) không được dùng làm danh tính sheet", () => {
  it("bản nháp khôi phục mang `_k` trùng nhau / trùng bộ đếm phiên này → xoá A rồi Ctrl+Z vẫn không đè B", async () => {
    // Bản nháp là JSON của qRef phiên TRƯỚC — `_k` trong đó đếm theo bộ đếm của phiên ấy, có thể trùng
    // `_k` phiên này cấp cho sheet khác. Dựng thẳng ca xấu nhất: hai sheet cùng một `_k`.
    const nhap = baoGia({ sheets: [
      { ...trang(101, "A", "Backdrop A", 1000), _k: 42 },
      { ...trang(102, "B", "Banner B", 5000), _k: 42 },
    ] });
    ghiBanNhap(khoaBanNhap(11, 1), nhap, "2026-09-20T00:00:00.000Z", 1);
    await moEditor();                                                // confirmModal → true: Khôi phục
    await suaTen("Backdrop A đã sửa");
    await xoaSheet(0);
    await ctrlZ();
    expect(o(0, "name").value).toBe("Banner B");
    expect(await luuVaDocPayload()).toEqual(["102:B:Banner B"]);
  });
});

describe("L55/L5 — xoá sheet đứng TRƯỚC sheet đang mở", () => {
  it("đang ở B (thứ 2), xoá A → vẫn đứng ở B, không nhảy sang C", async () => {
    await moEditor();
    await bam(tab(1));
    expect(tabDangMo()).toContain("B");
    await xoaSheet(0);
    expect(tabDangMo(), "xoá tab bên trái làm màn nhảy sang sheet khác").toContain("B");
    expect(o(0, "name").value).toBe("Banner B");
  });

  it("đang ở B, sửa B, xoá A rồi Ctrl+Z → chỉ lùi trên B, C còn nguyên", async () => {
    await moEditor();
    await bam(tab(1));
    await suaTen("Banner B đã sửa");
    await xoaSheet(0);
    await ctrlZ();
    expect(o(0, "name").value).toBe("Banner B");
    expect(await luuVaDocPayload()).toEqual(["102:B:Banner B", "103:C:Standee C"]);
  });

  it("đối chứng: đang ở C (cuối), xoá A → vẫn ở C", async () => {
    await moEditor();
    await bam(tab(2));
    await xoaSheet(0);
    expect(tabDangMo()).toContain("C");
  });
});

describe("L54 — ô Discount theo danh tính sheet", () => {
  it("A giảm 2.000.000, B giảm 0; xoá A (đang mở) → ô Discount hiện 0 của B, không phải số của A", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ sheets: [trang(101, "A", "Backdrop A", 10_000_000, { discount: 2_000_000 }), trang(102, "B", "Banner B", 5_000_000)] }));
    await moEditor();
    const oDisc = () => hop!.querySelector(".sheet-discount-input") as HTMLInputElement;
    expect(oDisc().value).toBe("2.000.000");
    await xoaSheet(0);
    expect(tabDangMo()).toContain("B");
    expect(oDisc().value, "ô Discount còn số của sheet vừa xoá").toBe("0");
  });

  it("sheet thêm bằng '+ Thêm sheet' cũng có danh tính: gõ Discount ở sheet mới N, xoá N (đang mở) → ô hiện số của sheet trượt lên", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ sheets: [trang(101, "A", "Backdrop A", 10_000_000)] }));
    await moEditor();
    await bam(nut("+ Thêm sheet"));                                  // N ở vị trí 2
    await bam(nut("+ Thêm sheet"));                                  // M ở vị trí 3
    await bam(tab(1));
    const oDisc = () => hop!.querySelector(".sheet-discount-input") as HTMLInputElement;
    act(() => { const el = oDisc(); el.value = "300000"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(oDisc().value).toBe("300.000");
    await xoaSheet(1);
    expect(tab(1).className).toContain("active");
    expect(oDisc().value, "ô Discount của M còn số của N vừa xoá").toBe("0");
  });
});

// L5 (phần applyImport): nạp Excel có xoá / sắp lại / thêm sheet thì màn phải đi THEO sheet đang mở tới
// chỗ mới của nó; trước đây chỉ kẹp chỉ số nên nhảy sang sheet khác, và lưới cũ (key theo chỉ số) mang
// ngăn Ctrl+Z của sheet cũ sang.
describe("L5 — nạp Excel xoá / sắp lại / thêm sheet vẫn đứng ở sheet đang mở", () => {
  const hang = (ten: string, gia: number) => ({ kind: "item", name: ten, unit: "cái", quantity: 1, unitPrice: gia });
  const ke = (ten: string, targetIndex: number, items: unknown[], mode = "replace") => ({ file: { name: ten, groupSubtotal: false }, targetIndex, mode, templateId: 1, items });
  async function napExcel(payload: unknown) {
    h.napExcel = payload;
    await bam(nut("Nhập từ Excel"));
    await bam(nut("Nạp giả"));
  }

  it("đang ở B, file không còn A (xoá A) → vẫn ở B", async () => {
    await moEditor();
    await bam(tab(1));
    await napExcel({ plans: [ke("B", 1, [hang("Banner B", 5000)]), ke("C", 2, [hang("Standee C", 7000)])], removeTargetIndexes: [0] });
    expect(tabDangMo(), "nạp xoá sheet đứng trước làm màn nhảy sang sheet khác").toContain("B");
    expect(o(0, "name").value).toBe("Banner B");
  });

  it("đang ở C, file đưa C lên đầu (sắp lại) → vẫn ở C, giờ là tab 1", async () => {
    await moEditor();
    await bam(tab(2));
    await napExcel({ plans: [ke("C", 2, [hang("Standee C", 7000)]), ke("A", 0, [hang("Backdrop A", 1000)]), ke("B", 1, [hang("Banner B", 5000)])] });
    expect(tabDangMo()).toBe("1. C");
    expect(o(0, "name").value).toBe("Standee C");
  });

  it("đang ở B, file có thêm sheet MỚI đứng trước B → vẫn ở B", async () => {
    await moEditor();
    await bam(tab(1));
    await napExcel({ plans: [ke("D", -1, [hang("Decal D", 9000)]), ke("B", 1, [hang("Banner B", 5000)], "append")] });
    expect(tabDangMo()).toContain("B");
    expect(o(0, "name").value).toBe("Banner B");
  });

  it("đang ở B, sửa B, file xoá chính B → sang C; Ctrl+Z không chép hàng của B vào C, Lưu giữ nguyên A và C", async () => {
    await moEditor();
    await bam(tab(1));
    await suaTen("Banner B đã sửa");
    await napExcel({ plans: [ke("A", 0, [hang("Backdrop A", 1000)]), ke("C", 2, [hang("Standee C", 7000)])], removeTargetIndexes: [1] });
    expect(tabDangMo()).toContain("C");
    await ctrlZ();
    expect(o(0, "name").value).toBe("Standee C");
    expect(await luuVaDocPayload()).toEqual(["101:A:Backdrop A", "103:C:Standee C"]);
  });
});

describe("L53 — đối chứng: Ctrl+Z qua mốc Lưu trên sheet KHÔNG phải sheet đầu", () => {
  it("đang ở C, sửa C, Lưu rồi Ctrl+Z → lùi được trên C (`_k` nối theo vị trí sau Lưu)", async () => {
    await moEditor();
    await bam(tab(2));
    await suaTen("Standee C đã sửa");
    await bam(nut("Lưu"));
    expect(tabDangMo()).toContain("C");
    await ctrlZ();
    expect(o(0, "name").value).toBe("Standee C");
  });
});

describe("Payload Lưu không mang khoá nội bộ `_k` của sheet lên máy chủ", () => {
  it("không sheet nào trong payload có trường _k", async () => {
    await moEditor();
    await bam(nut("+ Thêm sheet"));
    await bam(nut("Lưu"));
    const p = h.updateQuote.mock.calls.at(-1)![1] as { sheets: Record<string, unknown>[] };
    expect(p.sheets.some((s) => "_k" in s)).toBe(false);
  });
});
