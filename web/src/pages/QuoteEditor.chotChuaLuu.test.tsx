/** @vitest-environment jsdom */
//
// FE-01: CHỐT / KHÔNG CHỐT / GIAO-DUYỆT PHẦN HN KHI CÒN THAY ĐỔI CHƯA LƯU.
//
// Máy chủ tính `convertedTotal` từ bản ĐÃ LƯU, hộp chốt thì cộng từ lưới ĐANG SOẠN. Bấm chốt khi còn
// thay đổi chưa lưu = xác nhận số X, hệ thống ghi số Y (không sửa được, nuôi KPI), rồi qRef bị thay
// bằng bản máy chủ và phần vừa sửa biến mất. Ba điều gác ở đây:
//   1. dirty → phải hỏi, và Lưu (updateQuote) phải chạy TRƯỚC markConverted/markLost.
//   2. Hủy hộp, hoặc Lưu thất bại (409 / lỗi) → KHÔNG chốt.
//   3. Giao / duyệt phần HN khi dirty → không đè phần đang soạn, và mốc updatedAt đi theo máy chủ
//      để lần Lưu sau không dính 409 giả.
// Cùng khuôn createRoot + act với GridTable.component.test.tsx (không @testing-library).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];

const baoGia = (over: Record<string, unknown> = {}) => ({
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "sent", companyId: 7, createdById: 1,
  toCompany: "Khách cũ", vatPercent: 0, discount: 0, showTotals: true, quoteDate: "2026-09-20",
  updatedAt: "2026-09-20T00:00:00.000Z", hnStatus: "submitted", hnTables: [], members: [],
  sheets: [{ id: 101, templateId: 1, name: "Trang 1", groupSubtotal: false, items: [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 1000 }], extraTables: [] }],
  ...over,
});

const thuTu: string[] = [];
const h = vi.hoisted(() => ({
  updateQuote: null as unknown as ReturnType<typeof vi.fn>,
  confirmTraVe: true,
}));

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
    updateQuote: vi.fn(async (_id: number, p: Record<string, unknown>) => { thuTu.push("updateQuote"); return baoGia({ toCompany: p.toCompany, updatedAt: "2026-09-21T00:00:00.000Z" }); }),
    markConverted: vi.fn(async () => { thuTu.push("markConverted"); return baoGia({ status: "converted", updatedAt: "2026-09-22T00:00:00.000Z" }); }),
    markLost: vi.fn(async () => { thuTu.push("markLost"); return baoGia({ status: "lost", updatedAt: "2026-09-22T00:00:00.000Z" }); }),
    sheetCustomerDecision: vi.fn(async () => ({ custStatus: "approved" })),
    hnReview: vi.fn(async () => { thuTu.push("hnReview"); return {}; }),
  };
  h.updateQuote = fns.updateQuote;
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => ({
  ...(await goc<typeof import("../lib/ui")>()),
  toast: vi.fn(),
  confirmModal: vi.fn(async () => h.confirmTraVe),
  promptModal: vi.fn(async () => "lý do"),
  modalChotBaoGia: vi.fn(async () => []),
}));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteEditorPage } from "./QuoteEditor";
import { api, ApiError } from "../lib/api";
import { khoaBanNhap, ghiBanNhap, docBanNhap } from "../lib/localDraft";
import * as ui from "../lib/ui";
import shellSrc from "../components/Shell.tsx?raw";

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
const oTenKhach = () => hop!.querySelector('input[placeholder="Tên công ty khách"]') as HTMLInputElement;
function goTenKhach(chu: string) {
  act(() => { const el = oTenKhach(); el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const bam = async (b: HTMLButtonElement) => { await act(async () => { b.click(); }); await cho(10); };

beforeEach(() => {
  thuTu.length = 0;
  h.confirmTraVe = true;
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(async () => {
  await cho(1300);   // hẹn giờ ghi bản nháp 1,2s — cho nổ trong act rồi mới tháo cây
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

describe("FE-01 — chốt khi còn thay đổi chưa lưu", () => {
  it("dirty → hỏi, Lưu CHẠY TRƯỚC markConverted, và payload Lưu mang đúng phần vừa gõ", async () => {
    await moEditor();
    goTenKhach("Khách MỚI");
    await bam(nut("Khách chốt cả báo giá"));
    expect(ui.confirmModal).toHaveBeenCalledWith("Còn thay đổi chưa lưu", expect.any(String), expect.objectContaining({ confirmText: "Lưu rồi tiếp tục" }));
    expect(thuTu).toEqual(["updateQuote", "markConverted"]);
    expect((h.updateQuote.mock.calls[0][1] as Record<string, unknown>).toCompany).toBe("Khách MỚI");
  });

  it("Hủy hộp → KHÔNG lưu, KHÔNG chốt", async () => {
    await moEditor();
    goTenKhach("Khách MỚI");
    h.confirmTraVe = false;
    await bam(nut("Khách chốt cả báo giá"));
    expect(thuTu).toEqual([]);
    expect(api.markConverted).not.toHaveBeenCalled();
  });

  it("Lưu dính 409 (người dùng bấm Hủy ở hộp xung đột) → KHÔNG chốt", async () => {
    await moEditor();
    goTenKhach("Khách MỚI");
    h.updateQuote.mockImplementationOnce(async () => { thuTu.push("updateQuote"); throw new ApiError("xung đột", 409, {}); });
    (ui.confirmModal as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () => true)     // "Lưu rồi tiếp tục"
      .mockImplementationOnce(async () => false);   // hộp 409: Hủy
    await bam(nut("Khách chốt cả báo giá"));
    expect(thuTu).toEqual(["updateQuote"]);
    expect(ui.confirmModal).toHaveBeenCalledTimes(2);   // đã tới đúng hộp 409, không phải nhánh lỗi thường
    expect(api.markConverted).not.toHaveBeenCalled();
  });

  it("KHÔNG dirty → chốt thẳng, không hỏi Lưu", async () => {
    await moEditor();
    await bam(nut("Khách chốt cả báo giá"));
    expect(thuTu).toEqual(["markConverted"]);
    expect(ui.confirmModal).not.toHaveBeenCalled();
  });

  it("Khách không chốt: dirty → Lưu chạy TRƯỚC markLost", async () => {
    await moEditor();
    goTenKhach("Khách MỚI");
    await bam(nut("Khách không chốt"));
    expect(thuTu).toEqual(["updateQuote", "markLost"]);
  });

  it("Khách không chốt: Hủy hộp Lưu → không gọi markLost", async () => {
    await moEditor();
    goTenKhach("Khách MỚI");
    h.confirmTraVe = false;
    await bam(nut("Khách không chốt"));
    expect(api.markLost).not.toHaveBeenCalled();
  });
});

describe("FE-01 — giao / duyệt phần Hà Nội khi còn thay đổi chưa lưu", () => {
  it("Duyệt HN khi dirty: phần đang soạn còn nguyên và lần Lưu sau gửi updatedAt MỚI (không 409 giả)", async () => {
    await moEditor();
    goTenKhach("Khách MỚI");
    (api.getQuote as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => baoGia({ hnStatus: "approved", updatedAt: "2026-09-21T05:00:00.000Z" }));
    await bam(nut("✓ Duyệt"));
    expect(api.hnReview).toHaveBeenCalled();
    expect(api.updateQuote).not.toHaveBeenCalled();         // không ép Lưu cho thao tác HN
    expect(oTenKhach().value).toBe("Khách MỚI");
    await bam(nut("Lưu"));
    const p = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    expect(p.toCompany).toBe("Khách MỚI");                  // bản cũ: qRef bị thay → gửi "Khách cũ"
    expect(p.baseUpdatedAt).toBe("2026-09-21T05:00:00.000Z");
    expect(p.hnStatus).toBe("approved");
  });
});

// GRID-08: 409 → "Tải lại bản mới" → phần đang soạn mất trắng (bản nháp mang mốc cũ bị bỏ qua).
describe("GRID-08 — xung đột 409 giữ lại phần đang soạn", () => {
  it("409 + Tải lại → giữ bản; mở lại editor → hỏi mở bản của tôi; Lưu gửi phần đã soạn với mốc MỚI", async () => {
    await moEditor();
    goTenKhach("Khách CỦA TÔI");
    h.updateQuote.mockImplementationOnce(async () => { throw new ApiError("xung đột", 409, {}); });
    await bam(nut("Lưu"));                                         // hộp 409 → mock trả true (Tải lại)
    expect(Object.keys(localStorage).some((k) => k.endsWith(":xungdot")), "phải giữ bản đang soạn trước khi tải lại").toBe(true);

    act(() => root!.unmount()); root = null; hop?.remove();
    (api.getQuote as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => baoGia({ toCompany: "Khách của NGƯỜI KHÁC", updatedAt: "2026-09-21T09:00:00.000Z" }));
    (ui.confirmModal as unknown as ReturnType<typeof vi.fn>).mockClear();
    await moEditor();
    expect(ui.confirmModal).toHaveBeenCalledWith("Bản bạn soạn trước khi bị xung đột", expect.any(String), expect.objectContaining({ confirmText: "Mở bản của tôi" }));
    expect(oTenKhach().value).toBe("Khách CỦA TÔI");
    expect(Object.keys(localStorage).some((k) => k.endsWith(":xungdot")), "hỏi xong thì xoá khoá").toBe(false);
    h.updateQuote.mockClear();
    await bam(nut("Lưu"));
    const p = h.updateQuote.mock.calls[0][1] as Record<string, unknown>;
    expect(p.toCompany).toBe("Khách CỦA TÔI");
    expect(p.baseUpdatedAt).toBe("2026-09-21T09:00:00.000Z");
  });
});

// FE-12: hẹn giờ ghi nháp không huỷ khi đổi báo giá trong CÙNG instance editor; "Rời, bỏ thay đổi"
// không xoá nháp.
describe("FE-12 — bản nháp khi đổi báo giá / khi chủ động bỏ", () => {
  it("đổi #11 → #12 lúc còn hẹn giờ ghi nháp: bản nháp của #12 KHÔNG bị ghi nội dung #11", async () => {
    const khoa12 = khoaBanNhap(12, 1);
    ghiBanNhap(khoa12, { ...baoGia({ id: 12, toCompany: "Nháp của 12" }) }, "2026-09-20T00:00:00.000Z", 1);
    await moEditor();
    goTenKhach("Chữ của 11");                                      // mark() → hẹn giờ 1,2s
    (api.getQuote as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => baoGia({ id: 12, toCompany: "Bản máy chủ 12" }));
    // Hộp "Khôi phục?" của #12 treo 1,5s — đúng cửa sổ mà hẹn giờ cũ bắn.
    (ui.confirmModal as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise((r) => setTimeout(() => r(false), 1500)));
    await act(async () => { root!.render(<QuoteEditorPage me={ME} quoteId={12} isNew={false} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 1300)); });
    const d = docBanNhap(khoa12, 1);
    expect((d?.quote as { toCompany?: string } | undefined)?.toCompany, "khoá #12 bị ghi đè bằng dữ liệu #11").toBe("Nháp của 12");
    await cho(400);
  });

  it("chọn 'Rời, bỏ thay đổi' (editor:discard) → bản nháp cục bộ bị xoá", async () => {
    await moEditor();
    goTenKhach("Sẽ bỏ");
    await cho(1300);                                               // bản nháp đã ghi
    expect(docBanNhap(khoaBanNhap(11, 1), 1)).not.toBeNull();
    await act(async () => { window.dispatchEvent(new Event("editor:discard")); });
    expect(docBanNhap(khoaBanNhap(11, 1), 1)).toBeNull();
  });

  it("FE-13: gõ rồi rời trang NGAY (pagehide, chưa đủ 1,2s) → bản nháp đã được ghi", async () => {
    await moEditor();
    goTenKhach("Gõ xong đóng tab");
    expect(docBanNhap(khoaBanNhap(11, 1), 1)).toBeNull();          // chưa tới hẹn giờ
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    const d = docBanNhap(khoaBanNhap(11, 1), 1);
    expect((d?.quote as { toCompany?: string } | undefined)?.toCompany).toBe("Gõ xong đóng tab");
  });

  it("dây nối: Shell.guardLeave bắn editor:discard khi người dùng chọn bỏ", () => {
    const i = shellSrc.indexOf("async function guardLeave");
    expect(shellSrc.slice(i, shellSrc.indexOf("\n}", i))).toMatch(/if \(ok\) \{[^}]*dispatchEvent\(new Event\("editor:discard"\)\)/);
  });
});

// GRID-17: Ctrl+S mở hộp "Lưu trang" của trình duyệt, báo giá không được lưu.
describe("GRID-17 — Ctrl/⌘+S lưu báo giá", () => {
  it("Ctrl+S → gọi updateQuote đúng một lần và chặn hộp lưu trang của trình duyệt", async () => {
    await moEditor();
    goTenKhach("Khách MỚI");
    const ev = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { oTenKhach().dispatchEvent(ev); });
    await cho(10);
    expect(ev.defaultPrevented).toBe(true);
    expect(h.updateQuote).toHaveBeenCalledTimes(1);
    expect((h.updateQuote.mock.calls[0][1] as Record<string, unknown>).toCompany).toBe("Khách MỚI");
  });
});

// GRID-07: gõ tiếp trong lúc PUT đang bay → phần gõ thêm không nằm trong payload, rồi bị bản máy chủ
// đè, cờ bẩn về false, bản nháp bị xoá. Nay lưới + ô meta khoá suốt lúc lưu.
describe("GRID-07 — không sửa được trong lúc đang Lưu", () => {
  it("trong lúc updateQuote treo: ô lưới và ô meta bị khoá; lưu xong mở lại", async () => {
    await moEditor();
    goTenKhach("Khách MỚI");
    let xong!: () => void;
    h.updateQuote.mockImplementationOnce((_id: number, p: Record<string, unknown>) => new Promise((r) => { xong = () => r(baoGia({ toCompany: p.toCompany, updatedAt: "2026-09-21T00:00:00.000Z" })); }));
    await bam(nut("Lưu"));
    const oGia = () => hop!.querySelector('tr[data-row="0"] [data-f="unitPrice"]') as HTMLInputElement;
    expect(oGia().disabled, "ô Đơn giá phải khoá trong lúc đang lưu").toBe(true);
    expect(oTenKhach().disabled, "ô meta phải khoá trong lúc đang lưu").toBe(true);
    await act(async () => { xong(); });
    await cho(10);
    expect(oGia().disabled).toBe(false);
    expect(oTenKhach().disabled).toBe(false);
  });
});
