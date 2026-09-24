/** @vitest-environment jsdom */
//
// L72 (phần mạng): lần mở trình soạn ĐẦU TIÊN của phiên (cache `_companies` / `_templates` mức module
// còn trống) từng chờ xong `metaCompanies` + `metaTemplates` rồi MỚI gọi `getQuote` — thêm trọn một vòng
// mạng trước khi thấy báo giá. Nay `getQuote` bắt đầu SONG SONG với meta; thứ tự xử lý phía sau (bản
// nháp, khoá) giữ nguyên, lỗi thật vẫn vào catch.
//
// Tệp RIÊNG và nạp lại module cho mỗi bài (vi.resetModules): cache meta là biến MỨC MODULE, tệp khác đã
// nạp nó thì không còn "lần mở đầu" nào để đo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const MAU = [{ id: 1, code: "gn", name: "GN", companyId: 7, layout: { hasDays: false } }];
const CTY = [{ id: 7, name: "Gia Nguyễn" }];
const baoGia = () => ({
  id: 11, quoteNumber: "GN26011", title: "Sự kiện", status: "sent", companyId: 7, createdById: 1,
  toCompany: "Khách song song", vatPercent: 0, discount: 0, showTotals: true, quoteDate: "2026-09-20",
  updatedAt: "2026-09-20T00:00:00.000Z", hnTables: [], members: [],
  sheets: [{ id: 101, templateId: 1, name: "Trang 1", groupSubtotal: false, extraTables: [], items: [{ kind: "item", name: "Backdrop", unit: "cái", quantity: 1, unitPrice: 1000 }] }],
});

const h = vi.hoisted(() => ({
  thuTu: [] as string[],
  cong: null as Promise<void> | null,
  xongMeta: null as (() => void) | null,
  loiMeta: null as ((thongBao: string) => void) | null,
  /** Có chữ → getQuote ném ApiError 404 với chữ đó. */
  loiGetQuote: null as string | null,
}));
vi.mock("../lib/api", async (goc) => {
  const that = await goc<typeof import("../lib/api")>();
  // Hai lời gọi meta chung MỘT cổng: bài test mở cổng khi muốn (giả mạng chậm ở lần mở đầu phiên).
  // Lỗi dựng bằng ApiError của CHÍNH module này — cùng lớp mà editor `instanceof`.
  const choCong = () => (h.cong ??= new Promise<void>((ok, hong) => { h.xongMeta = ok; h.loiMeta = (m) => hong(new that.ApiError(m, 503, null)); }));
  const fns: Record<string, ReturnType<typeof vi.fn>> = {
    metaCompanies: vi.fn(async () => { h.thuTu.push("metaCompanies"); await choCong(); return CTY; }),
    metaTemplates: vi.fn(async () => { h.thuTu.push("metaTemplates"); await choCong(); return MAU; }),
    // HÀM TRẦN, không vi.fn: spy của vitest tự gắn `.then` vào promise trả về để ghi settledResults →
    // promise bị từ chối không bao giờ thành "unhandled", bài kiểm unhandled rejection bên dưới mù.
    getQuote: (async () => { h.thuTu.push("getQuote"); if (h.loiGetQuote) throw new that.ApiError(h.loiGetQuote, 404, null); return baoGia(); }) as unknown as ReturnType<typeof vi.fn>,
    presence: vi.fn(async () => ({ editing: [] })),
  };
  const api = new Proxy(fns, { get: (t, k: string) => t[k] ?? (t[k] = vi.fn(async () => ({}))) });
  return { ...that, api };
});
vi.mock("../lib/ui", async (goc) => ({ ...(await goc<typeof import("../lib/ui")>()), toast: vi.fn(), confirmModal: vi.fn(async () => true) }));
vi.mock("../lib/venueCatalog", async (goc) => ({ ...(await goc<typeof import("../lib/venueCatalog")>()), loadCatalog: () => Promise.resolve({ entries: [], venues: [] }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = { id: 1, username: "a", displayName: "A", role: "admin", permissions: ["quote:send", "quote:update:all", "quote:read:all"] };
let root: Root | null = null;
let hop: HTMLDivElement | null = null;
const cho = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const khongXuLy: unknown[] = [];
const batKhongXuLy = (lyDo: unknown) => { khongXuLy.push(lyDo); };   // chữ ký của process "unhandledRejection"
// `process` của Node (vitest chạy trong Node) — tsconfig của web không có kiểu Node, lấy qua globalThis
// như toastKhongDeNut.test.ts.
type NgheLoi = (su: "unhandledRejection", f: (lyDo: unknown) => void) => void;
const tienTrinh = (globalThis as unknown as { process: { on: NgheLoi; off: NgheLoi } }).process;

async function moEditor(isNew = false) {
  // Nạp MỚI module editor → cache meta trống như lần mở đầu tiên của phiên.
  vi.resetModules();
  const { QuoteEditorPage } = await import("./QuoteEditor");
  hop = document.createElement("div"); document.body.appendChild(hop);
  root = createRoot(hop);
  await act(async () => { root!.render(<QuoteEditorPage me={ME as never} quoteId={isNew ? undefined : 11} isNew={isNew} />); });
  await cho(10);
}
const moCongMeta = async () => { await act(async () => { h.xongMeta!(); }); await cho(10); };

beforeEach(() => {
  h.thuTu = []; h.cong = null; h.xongMeta = null; h.loiMeta = null; h.loiGetQuote = null; khongXuLy.length = 0;
  localStorage.clear();
  tienTrinh.on("unhandledRejection", batKhongXuLy);
});
afterEach(async () => {
  await cho(20);
  tienTrinh.off("unhandledRejection", batKhongXuLy);
  if (root) act(() => root!.unmount());
  root = null; hop?.remove(); hop = null; document.body.innerHTML = "";
});

describe("L72 — lần mở đầu phiên: getQuote chạy SONG SONG với meta", () => {
  it("meta còn đang bay thì getQuote(11) ĐÃ được gọi; mở cổng meta là thấy báo giá", async () => {
    await moEditor();
    expect(h.xongMeta, "chưa gọi meta").not.toBeNull();
    expect(h.thuTu, "getQuote phải bắt đầu trước khi meta xong").toContain("getQuote");
    expect(hop!.querySelector(".skeleton-wrap"), "chưa đủ meta mà đã vẽ editor").not.toBeNull();
    await moCongMeta();
    expect((hop!.querySelector('input[placeholder="Tên công ty khách"]') as HTMLInputElement).value).toBe("Khách song song");
  });

  it("getQuote lỗi TRONG LÚC meta còn bay → vẫn vào catch (hiện lỗi), không thành unhandled rejection", async () => {
    h.loiGetQuote = "Không tìm thấy báo giá";
    await moEditor();
    await cho(10);
    await moCongMeta();
    expect(hop!.textContent).toContain("Không tìm thấy báo giá");
    expect(khongXuLy, "promise getQuote bị bỏ rơi").toEqual([]);
  });

  it("meta lỗi trong khi getQuote cũng lỗi → hiện lỗi meta, promise getQuote không thành unhandled rejection", async () => {
    h.loiGetQuote = "Không tìm thấy báo giá";
    await moEditor();
    await act(async () => { h.loiMeta!("Mất mạng"); });
    await cho(20);
    expect(hop!.textContent).toContain("Mất mạng");
    expect(khongXuLy, "promise getQuote bị bỏ rơi").toEqual([]);
  });

  it("báo giá MỚI (#/rnew) không gọi getQuote", async () => {
    await moEditor(true);
    await moCongMeta();
    expect(h.thuTu).not.toContain("getQuote");
  });
});
