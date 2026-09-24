/** @vitest-environment jsdom */
//
// KÉO ĐỔI THỨ TỰ SHEET TRONG TRÌNH SOẠN BÁO GIÁ (yêu cầu chủ repo 2026-09-24: "các sheet chưa kéo đổi vị
// trí được"; "thứ tự luôn, id luôn" — số thứ tự và mã sản xuất _01/_02 đổi theo vị trí mới).
//
// Kiểm: kéo tab bằng chuột (HTML5 drag & drop), Alt+←/→ bằng bàn phím, sheet đang mở giữ nguyên theo
// đối tượng, payload Lưu mang thứ tự mới + id cũ (máy chủ ghép trạng thái theo id) + cờ danhLaiMaSheet,
// mã "Số: …" hiện theo vị trí mới, và báo khi máy chủ giữ nguyên mã. Cùng giàn dựng với
// QuoteEditor.xoaSheet.test.tsx.
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
const tenTab = () => [...hop!.querySelectorAll(".sheet-tab > span:first-child")].map((x) => (x.textContent || "").trim());
const tab = (i: number) => hop!.querySelectorAll(".sheet-tab")[i] as HTMLElement;
const tabDangMo = () => (hop!.querySelector(".sheet-tab.active span") as HTMLElement).textContent || "";
const soMa = () => (hop!.querySelector(".quote-no") as HTMLElement).textContent || "";

/** Giả lập kéo tab `tu` thả lên nửa trái/phải của tab `vao`. jsdom không có DataTransfer, và mọi
 *  getBoundingClientRect đều 0 — gán khung giả cho tab đích để phép chia nửa trái/phải có nghĩa. */
async function keo(tu: number, vao: number, nua: "trai" | "phai") {
  const dt = { effectAllowed: "", dropEffect: "", setData: () => {}, getData: () => "" };
  const su = (type: string, el: HTMLElement, clientX = 0) => {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown; clientX: number };
    Object.defineProperty(ev, "dataTransfer", { value: dt });
    Object.defineProperty(ev, "clientX", { value: clientX });
    el.dispatchEvent(ev);
  };
  const dich = tab(vao);
  dich.getBoundingClientRect = () => ({ left: 100, width: 80, right: 180, top: 0, bottom: 30, height: 30, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;
  const x = nua === "trai" ? 110 : 170;
  await act(async () => { su("dragstart", tab(tu)); });
  await act(async () => { su("dragover", dich, x); });
  await act(async () => { su("drop", dich, x); });
  await act(async () => { su("dragend", tab(tu)); });
  await cho(10);
}
async function luuVaDocPayload() {
  await bam(nut("Lưu"));
  return h.updateQuote.mock.calls.at(-1)![1] as { danhLaiMaSheet?: boolean; sheets: { id?: number; name: string; order: number }[] };
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

describe("Kéo đổi thứ tự sheet", () => {
  it("kéo C thả lên nửa trái của A → C, A, B; số trên tab đánh lại 1-2-3", async () => {
    await moEditor();
    expect(tenTab()).toEqual(["1. A", "2. B", "3. C"]);
    await keo(2, 0, "trai");
    expect(tenTab()).toEqual(["1. C", "2. A", "3. B"]);
  });

  it("kéo A thả lên nửa phải của C → B, C, A (kéo từ trái sang phải trừ đúng một chỉ số)", async () => {
    await moEditor();
    await keo(0, 2, "phai");
    expect(tenTab()).toEqual(["1. B", "2. C", "3. A"]);
  });

  it("thả lên chính nó / nửa trái của tab ngay sau → không đổi gì, không bật cờ bẩn", async () => {
    await moEditor();
    await keo(1, 1, "trai");
    await keo(1, 2, "trai");
    expect(tenTab()).toEqual(["1. A", "2. B", "3. C"]);
    expect((window as unknown as { __editorDirty?: boolean }).__editorDirty ?? false).toBe(false);
  });

  it("sheet ĐANG MỞ vẫn là sheet đang mở sau khi đổi chỗ (theo đối tượng, không theo chỉ số)", async () => {
    await moEditor();
    await bam(tab(1));   // mở B
    expect(tabDangMo()).toContain("B");
    await keo(2, 0, "trai");   // C lên đầu → B thành vị trí 3
    expect(tabDangMo()).toContain("B");
    expect(tabDangMo()).toContain("3.");
    const o = hop!.querySelector('.editor tr[data-row="0"] [data-f="name"]') as HTMLTextAreaElement;
    expect(o.value, "lưới đang hiện hàng của sheet khác").toBe("Banner B");
  });

  it("Alt+→ trên tab A đẩy A sang phải một bậc, tiêu điểm đi theo tab vừa dời", async () => {
    await moEditor();
    act(() => { tab(0).focus(); });
    await act(async () => { tab(0).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true })); });
    await cho(30);
    expect(tenTab()).toEqual(["1. B", "2. A", "3. C"]);
    expect(document.activeElement, "tiêu điểm không đi theo tab").toBe(tab(1));
    await act(async () => { tab(1).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, bubbles: true, cancelable: true })); });
    await cho(30);
    expect(tenTab()).toEqual(["1. A", "2. B", "3. C"]);
  });

  it("Lưu gửi thứ tự mới + id CŨ của từng sheet (máy chủ ghép trạng thái theo id) + cờ danhLaiMaSheet", async () => {
    await moEditor();
    await keo(2, 0, "trai");
    const p = await luuVaDocPayload();
    expect(p.sheets.map((s) => `${s.id}:${s.name}:${s.order}`)).toEqual(["103:C:1", "101:A:2", "102:B:3"]);
    expect(p.danhLaiMaSheet).toBe(true);
  });

  it("KHÔNG kéo thì Lưu không xin đánh lại mã", async () => {
    await moEditor();
    const p = await luuVaDocPayload();
    expect(p.danhLaiMaSheet).toBeUndefined();
  });

  it("mã 'Số: …' hiện theo vị trí mới ngay sau khi kéo (sheet đang mở A thành _02)", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ projectCode: "FP_A26_018", sheets: [
      trang(101, "A", "Backdrop A", 1000, { codeNo: 1 }), trang(102, "B", "Banner B", 5000, { codeNo: 2 }), trang(103, "C", "Standee C", 7000, { codeNo: 3 }),
    ] }));
    await moEditor();
    expect(soMa()).toContain("FP_A26_018_01");
    await keo(1, 0, "trai");   // B lên đầu, A (đang mở) thành vị trí 2
    expect(soMa()).toContain("FP_A26_018_02");
  });

  it("máy chủ GIỮ NGUYÊN mã (đã dùng trên hoá đơn) → báo cho người dùng biết", async () => {
    const ui = await import("../lib/ui");
    await moEditor();
    h.updateQuote.mockImplementationOnce(async (_id: number, p: Record<string, unknown>) => ({
      ...baoGia(), ...JSON.parse(JSON.stringify(p)), updatedAt: "2026-09-21T00:00:00.000Z",
      sheets: (p.sheets as Record<string, unknown>[]).map((s) => ({ ...s, codeNo: Number(s.id) - 100 })),   // C giữ số 3
    }));
    await keo(2, 0, "trai");
    await luuVaDocPayload();
    const chu = (ui.toast as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(chu.some((x) => x.includes("GIỮ NGUYÊN")), chu.join(" | ")).toBe(true);
  });

  it("báo giá một sheet: tab không kéo được", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ sheets: [trang(101, "A", "Backdrop A", 1000)] }));
    await moEditor();
    expect(tab(0).getAttribute("draggable")).toBe("false");
  });
});
