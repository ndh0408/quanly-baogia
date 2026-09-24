/** @vitest-environment jsdom */
//
// Trình soạn báo giá × dải "Có bản mới" (../lib/phienBan.ts). Soát 2026-09-24 bắt được: tự tải lại khi
// tab nằm nền xoá im lặng báo giá MỚI vừa ra khỏi wizard (#/rnew — chưa gõ gì nên cờ chưa-lưu còn tắt,
// mà phần điền ở wizard chỉ nằm trong bộ nhớ). Chốt ở đây:
//   1. Báo giá đã có, chưa sửa → trình soạn khai "bấm tay tải lại khỏi hỏi" nhưng KHÔNG cho tự tải (tự
//      tải mất sheet đang mở, vị trí cuộn, lịch sử Ctrl+Z — soát vòng 2); sửa một ô → hết an toàn.
//   2. Báo giá MỚI (#/rnew) → KHÔNG BAO GIỜ khai an toàn, kể cả lúc chưa gõ gì.
//   3. Còn thay đổi chưa lưu → hộp "Tải lại trang?" của trình duyệt LUÔN còn (soát vòng 2: bản trước hạ
//      chốt đó sau khi ghi bản nháp, mà bản nháp lệch mốc / bị bóc ảnh thì không khôi phục được).
// Cùng khuôn giàn dựng với QuoteEditor.chotChuaLuu.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];
const baoGia = (over: Record<string, unknown> = {}) => ({
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "draft", companyId: 7, createdById: 1,
  toCompany: "Khách cũ", vatPercent: 0, discount: 0, showTotals: true, quoteDate: "2026-09-20",
  updatedAt: "2026-09-20T00:00:00.000Z", hnTables: [], members: [],
  sheets: [{ id: 101, templateId: 1, name: "Trang 1", groupSubtotal: false, items: [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 1000 }], extraTables: [] }],
  ...over,
});

vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => CTY),
    metaTemplates: vi.fn(async () => MAU),
    getQuote: vi.fn(async () => baoGia()),
    presence: vi.fn(async () => ({ editing: [] })),
    hnAccounts: vi.fn(async () => ({ data: [] })),
  };
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn(), confirmModal: vi.fn(async () => true) }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { QuoteEditorPage } from "./QuoteEditor";
import type { QuoteFull } from "../lib/api";
import { setPendingNewQuote } from "../lib/pendingQuote";
import { khoaBanNhap, docBanNhap } from "../lib/localDraft";
import { laTrangAnToan, dangDo, _datLai } from "../lib/phienBan";

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:read:all", "quote:create"] };
type WinDirty = Window & { __editorDirty?: boolean };

let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
async function mo(isNew: boolean) {
  hop = document.createElement("div");
  document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={ME} quoteId={isNew ? undefined : 11} isNew={isNew} />); });
  await cho(10);
}
function goTenKhach(chu: string) {
  act(() => {
    const el = hop!.querySelector('input[placeholder="Tên công ty khách"]') as HTMLInputElement;
    el.value = chu; el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** beforeunload có bị chặn (trình duyệt sẽ hỏi "Tải lại trang?") không. */
const trinhDuyetHoi = () => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };

beforeEach(() => { _datLai(); vi.clearAllMocks(); localStorage.clear(); (window as WinDirty).__editorDirty = false; });
afterEach(async () => {
  await cho(1300);
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

describe("trình soạn × dải 'Có bản mới'", () => {
  it("báo giá đã có, chưa sửa → bấm tay khỏi hỏi nhưng KHÔNG tự tải; sửa một ô → hết an toàn (đang có thay đổi chưa lưu)", async () => {
    await mo(false);
    expect(laTrangAnToan()).toBe(true);
    expect(laTrangAnToan(true), "không cho TỰ tải trình soạn").toBe(false);
    goTenKhach("Khách MỚI");
    expect(laTrangAnToan()).toBe(false);
    expect(dangDo()).toBe("chua-luu");
  });

  it("báo giá MỚI vừa ra khỏi wizard (#/rnew), CHƯA gõ gì → không bao giờ khai an toàn (tự tải là mất trắng phần điền ở wizard)", async () => {
    setPendingNewQuote({ id: 0, _new: true, status: "draft", title: "Từ wizard", quoteNumber: "", companyId: 7, toCompany: "Khách wizard", sheets: [{ templateId: 1, groupSubtotal: true, items: [], extraTables: [] }] } as unknown as QuoteFull);
    await mo(true);
    expect((window as WinDirty).__editorDirty, "chưa gõ gì — cờ chưa-lưu vẫn tắt").toBeFalsy();
    expect(laTrangAnToan()).toBe(false);
    expect(dangDo()).toBe("chua-ro");
  });

  it("còn thay đổi chưa lưu → hộp 'Tải lại trang?' của trình duyệt LUÔN còn; rời trang (pagehide) vẫn ghi bản nháp như mọi lần F5", async () => {
    await mo(false);
    goTenKhach("Khách MỚI");
    expect(trinhDuyetHoi()).toBe(true);
    // Sự kiện cũ của bản trước (hạ chốt sau khi ghi nháp) không còn ai nghe — bắn thử cũng không hạ được chốt.
    await act(async () => { window.dispatchEvent(new Event("phien-ban:truoc-tai")); });
    expect(trinhDuyetHoi(), "không cơ chế nào được hạ chốt cuối").toBe(true);
    const khoa = khoaBanNhap(11, 1);
    await act(async () => { window.dispatchEvent(new Event("pagehide")); });
    expect((docBanNhap(khoa, 1)?.quote as { toCompany?: string } | undefined)?.toCompany).toBe("Khách MỚI");
  });
});
