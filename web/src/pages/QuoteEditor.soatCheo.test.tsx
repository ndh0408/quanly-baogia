/** @vitest-environment jsdom */
//
// SOÁT CHÉO app#10 → app#15 (trình soạn báo giá): xung đột 409, bản giữ lại ":xungdot", giao/duyệt HN
// lúc còn thay đổi, nút "← Quay lại", và những nút còn bấm được trong lúc Lưu.
// Tệp RIÊNG (không nối vào QuoteEditor.chotChuaLuu.test.tsx) để khỏi đụng các ca nhánh khác đang thêm
// vào tệp đó. Cùng giàn dựng createRoot + act.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];
const MOC_CU = "2026-09-20T00:00:00.000Z";

const trang = (id: number, over: Record<string, unknown> = {}) => ({
  id, templateId: 1, name: `Trang ${id}`, groupSubtotal: false, extraTables: [],
  items: [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 1000 }], ...over,
});
const baoGia = (over: Record<string, unknown> = {}) => ({
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "sent", companyId: 7, createdById: 1,
  toCompany: "Khách cũ", vatPercent: 0, discount: 0, showTotals: true, quoteDate: "2026-09-20",
  updatedAt: MOC_CU, hnStatus: "submitted", hnTables: [], members: [],
  sheets: [trang(101)],
  ...over,
});

const h = vi.hoisted(() => ({
  updateQuote: null as unknown as ReturnType<typeof vi.fn>,
  getQuote: null as unknown as ReturnType<typeof vi.fn>,
  /** Trả lời lần lượt cho từng confirmModal; hết hàng thì dùng `macDinh`. */
  hang: [] as boolean[],
  macDinh: true,
}));

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
    updateQuote: vi.fn(async (_id: number, p: Record<string, unknown>) => baoGia({ toCompany: p.toCompany, updatedAt: "2026-09-21T00:00:00.000Z" })),
    hnReview: vi.fn(async () => ({})),
  };
  h.updateQuote = fns.updateQuote;
  h.getQuote = fns.getQuote;
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => ({
  ...(await goc<typeof import("../lib/ui")>()),
  toast: vi.fn(),
  confirmModal: vi.fn(async () => (h.hang.length ? h.hang.shift()! : h.macDinh)),
  promptModal: vi.fn(async () => "lý do"),
  modalChotBaoGia: vi.fn(async () => []),
}));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteEditorPage } from "./QuoteEditor";
import { ApiError } from "../lib/api";
import * as ui from "../lib/ui";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:hn:manage", "quote:read:all"] };
type WinDirty = Window & { __editorDirty?: boolean };

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
function dongEditor() { act(() => root!.unmount()); root = null; hop?.remove(); hop = null; }
const nut = (chu: string) => {
  const b = [...hop!.querySelectorAll("button")].find((x) => x.textContent?.includes(chu));
  if (!b) throw new Error("không thấy nút " + chu);
  return b as HTMLButtonElement;
};
const oTenKhach = () => hop!.querySelector('input[placeholder="Tên công ty khách"]') as HTMLInputElement;
function goTenKhach(chu: string) {
  act(() => { const el = oTenKhach(); el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const bam = async (b: HTMLButtonElement) => { await act(async () => { b.click(); }); await cho(10); };
const coKhoaXd = () => Object.keys(localStorage).some((k) => k.endsWith(":xungdot"));
const confirmMock = () => ui.confirmModal as unknown as ReturnType<typeof vi.fn>;
const loiHop = (tieuDe: string) => {
  const c = confirmMock().mock.calls.find((x) => x[0] === tieuDe);
  if (!c) throw new Error("không thấy hộp " + tieuDe);
  return String(c[1]);
};

/** 409 khi Lưu → chọn "Tải lại bản mới" → bản giữ lại nằm ở khoá ":xungdot". */
async function xungDotRoiTaiLai() {
  await moEditor();
  goTenKhach("Khách CỦA TÔI");
  h.updateQuote.mockImplementationOnce(async () => { throw new ApiError("xung đột", 409, {}); });
  await bam(nut("Lưu"));
  expect(coKhoaXd(), "phải giữ bản đang soạn trước khi tải lại").toBe(true);
  dongEditor();
  confirmMock().mockClear();
  h.updateQuote.mockClear();
}

beforeEach(() => {
  h.hang = []; h.macDinh = true;
  vi.clearAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
  (window as WinDirty).__editorDirty = false;
});
afterEach(async () => {
  await cho(1300);
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

// app#10: sau 409, người khác Lưu → máy chủ xoá-tạo-lại mọi trang, id trang đổi hết. Bản giữ lại mang
// id CŨ; mở nó rồi Lưu thì carrySheetState không ghép được id nào → mất khách duyệt / chữ ký / mã SX.
describe("app#10 — mở bản ':xungdot' phải mang id trang SỐNG của máy chủ", () => {
  it("máy chủ đã đổi id trang (101 → 202): Lưu gửi id 202, không gửi id cũ", async () => {
    await xungDotRoiTaiLai();
    h.getQuote.mockImplementationOnce(async () => baoGia({ toCompany: "Khách của NGƯỜI KHÁC", updatedAt: "2026-09-21T09:00:00.000Z", sheets: [trang(202, { custStatus: "rejected" })] }));
    await moEditor();
    expect(oTenKhach().value).toBe("Khách CỦA TÔI");
    await bam(nut("Lưu"));
    const p = h.updateQuote.mock.calls[0][1] as { sheets: { id?: number }[]; toCompany: string };
    expect(p.toCompany).toBe("Khách CỦA TÔI");
    expect(p.sheets.map((s) => s.id)).toEqual([202]);
  });

  it("số trang lệch → hộp nói rõ trạng thái trang sẽ mất, và trang không ghép được bị bỏ id", async () => {
    await xungDotRoiTaiLai();
    h.getQuote.mockImplementationOnce(async () => baoGia({ updatedAt: "2026-09-21T09:00:00.000Z", sheets: [trang(301), trang(302)] }));
    await moEditor();
    expect(loiHop("Bản bạn soạn trước khi bị xung đột")).toMatch(/không ghép được/);
    await bam(nut("Lưu"));
    const p = h.updateQuote.mock.calls[0][1] as { sheets: { id?: number }[] };
    expect(p.sheets).toHaveLength(1);
    expect(p.sheets[0].id).toBeUndefined();
  });
});

// app#11: giao/duyệt HN lúc đang dirty đẩy mốc updatedAt theo máy chủ mà không kiểm phần NGOÀI HN →
// bản người khác vừa lưu bị đè im lặng.
describe("app#11 — duyệt HN khi dirty không được nuốt lượt lưu của người khác", () => {
  it("người khác đã lưu (id trang đổi) trước khi duyệt HN → lần Lưu kế vẫn gửi mốc CŨ (để nhận 409)", async () => {
    await moEditor();
    goTenKhach("Khách MỚI");
    h.getQuote.mockImplementationOnce(async () => baoGia({ hnStatus: "approved", updatedAt: "2026-09-21T05:00:00.000Z", sheets: [trang(202)] }));
    await bam(nut("✓ Duyệt"));
    await bam(nut("Lưu"));
    const p = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    expect(p.baseUpdatedAt).toBe(MOC_CU);
    expect(p.toCompany).toBe("Khách MỚI");
  });

  it("người khác chỉ sửa phần đầu trang (id trang giữ nguyên) → vẫn giữ mốc CŨ", async () => {
    await moEditor();
    goTenKhach("Khách MỚI");
    h.getQuote.mockImplementationOnce(async () => baoGia({ hnStatus: "approved", toCompany: "Khách do S sửa", updatedAt: "2026-09-21T05:00:00.000Z" }));
    await bam(nut("✓ Duyệt"));
    await bam(nut("Lưu"));
    expect((h.updateQuote.mock.calls[0][1] as Record<string, unknown>).baseUpdatedAt).toBe(MOC_CU);
  });

  it("đối chứng: không ai khác lưu (chỉ phần HN đổi) → nhận mốc MỚI như FE-01b", async () => {
    await moEditor();
    goTenKhach("Khách MỚI");
    h.getQuote.mockImplementationOnce(async () => baoGia({ hnStatus: "approved", updatedAt: "2026-09-21T05:00:00.000Z" }));
    await bam(nut("✓ Duyệt"));
    await bam(nut("Lưu"));
    expect((h.updateQuote.mock.calls[0][1] as Record<string, unknown>).baseUpdatedAt).toBe("2026-09-21T05:00:00.000Z");
  });

  it("đối chứng: vừa tự Lưu (bản máy chủ mới) rồi duyệt HN khi dirty → nhận mốc MỚI", async () => {
    await moEditor();
    goTenKhach("Lần 1");
    await bam(nut("Lưu"));                                           // updatedAt → 2026-09-21T00…, toCompany "Lần 1"
    goTenKhach("Lần 2");
    h.getQuote.mockImplementationOnce(async () => baoGia({ hnStatus: "approved", toCompany: "Lần 1", updatedAt: "2026-09-21T06:00:00.000Z" }));
    await bam(nut("✓ Duyệt"));
    h.updateQuote.mockClear();
    await bam(nut("Lưu"));
    expect((h.updateQuote.mock.calls[0][1] as Record<string, unknown>).baseUpdatedAt).toBe("2026-09-21T06:00:00.000Z");
  });
});

// app#12: hộp 409 hứa "được GIỮ LẠI" mà không kiểm ghiBanNhap có ghi được không.
describe("app#12 — hộp 409 chỉ hứa giữ lại khi thật sự ghi được", () => {
  it("localStorage đầy → hộp nói phần chưa lưu SẼ MẤT, không hứa GIỮ LẠI", async () => {
    await moEditor();
    goTenKhach("Khách CỦA TÔI");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("đầy", "QuotaExceededError"); });
    h.updateQuote.mockImplementationOnce(async () => { throw new ApiError("xung đột", 409, {}); });
    h.hang = [false];                                                // Hủy — ở lại trang
    await bam(nut("Lưu"));
    const loi = loiHop("Báo giá đã bị người khác sửa");
    expect(loi).not.toMatch(/GIỮ LẠI/);
    expect(loi).toMatch(/sẽ mất/);
  });

  it("Hủy ở hộp 409 → không để lại khoá ':xungdot' (lần mở sau không hỏi một bản cũ)", async () => {
    await moEditor();
    goTenKhach("Khách CỦA TÔI");
    h.updateQuote.mockImplementationOnce(async () => { throw new ApiError("xung đột", 409, {}); });
    h.hang = [false];
    await bam(nut("Lưu"));
    expect(coKhoaXd()).toBe(false);
    expect(oTenKhach().value).toBe("Khách CỦA TÔI");
  });
});

// app#13: Hủy / Esc / bấm ra ngoài ở hộp "Mở bản của tôi" (tiêu điểm mặc định ở Hủy) xoá vĩnh viễn bản giữ lại.
describe("app#13 — Hủy ở hộp 'Mở bản của tôi' không được xoá bản giữ lại", () => {
  it("Hủy, rồi Hủy ở hộp 'Bỏ bản của bạn?' → khoá ':xungdot' còn nguyên", async () => {
    await xungDotRoiTaiLai();
    h.hang = [false, false];
    await moEditor();
    expect(coKhoaXd()).toBe(true);
    expect(oTenKhach().value).toBe("Khách cũ");
  });

  it("Hủy, rồi xác nhận 'Xoá bản này' → khoá bị xoá", async () => {
    await xungDotRoiTaiLai();
    h.hang = [false, true];
    await moEditor();
    expect(confirmMock().mock.calls.map((c) => c[0])).toContain("Bỏ bản của bạn?");
    expect(coKhoaXd()).toBe(false);
  });

  it("Mở bản của tôi → khoá bị xoá (bản nháp thường tiếp quản)", async () => {
    await xungDotRoiTaiLai();
    await moEditor();
    expect(oTenKhach().value).toBe("Khách CỦA TÔI");
    expect(coKhoaXd()).toBe(false);
  });
});

// app#14: "← Quay lại" → "Rời, bỏ thay đổi" xoá nháp + hạ dirtyRef nhưng để __editorDirty=true → Shell hỏi
// lần 2; Hủy ở lần 2 thì editor còn thay đổi mà mất nháp lẫn beforeunload.
describe("app#14 — '← Quay lại' chỉ hỏi một lần", () => {
  it("xác nhận rời → hạ cờ toàn cục TRƯỚC khi đổi hash (Shell không hỏi lại)", async () => {
    await moEditor();
    goTenKhach("Sẽ bỏ");
    expect((window as WinDirty).__editorDirty).toBe(true);
    let coLucDoiHash: boolean | undefined;
    const nghe = () => { coLucDoiHash = (window as WinDirty).__editorDirty; };
    window.addEventListener("hashchange", nghe);
    await bam(nut("← Quay lại"));
    await cho(10);
    window.removeEventListener("hashchange", nghe);
    expect(location.hash).toBe("#/list");
    expect(coLucDoiHash, "Shell đọc __editorDirty ở hashchange").toBe(false);
  });
});

// app#15: "+ Thêm sheet", "✕", "Nhập từ Excel" vẫn bấm được trong lúc PUT đang bay → bị bản máy chủ đè.
describe("app#15 — khoá thao tác trang trong lúc đang Lưu", () => {
  it("updateQuote treo: '+ Thêm sheet', '✕' và 'Nhập từ Excel' đều bị khoá", async () => {
    h.getQuote.mockImplementationOnce(async () => baoGia({ sheets: [trang(101), trang(102)] }));
    await moEditor();
    goTenKhach("Khách MỚI");
    let xong!: () => void;
    h.updateQuote.mockImplementationOnce(() => new Promise((r) => { xong = () => r(baoGia({ sheets: [trang(201), trang(202)], updatedAt: "2026-09-21T00:00:00.000Z" })); }));
    await bam(nut("Lưu"));
    expect(nut("+ Thêm sheet").disabled).toBe(true);
    expect(nut("Nhập từ Excel").disabled).toBe(true);
    expect((hop!.querySelector("button.rm-tab") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { xong(); });
    await cho(10);
    expect(nut("+ Thêm sheet").disabled).toBe(false);
  });
});
