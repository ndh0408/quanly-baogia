// Bộ đếm LỆNH GHI ĐANG BAY (api.ts `soLenhGhiDangBay`) — dải "Có bản mới" (lib/phienBan.ts) chờ số
// này về 0 rồi mới tải lại trang, và không tự tải khi nó > 0. Soát 2026-09-24: trang Hóa đơn lưu ô khi
// blur — chuyển tab vừa bắn lệnh PUT vừa kích hoạt lượt tự tải; tải lại trước khi PUT kịp đi là số vừa
// gõ mất im lặng. Cùng khuôn `window` giả tối thiểu với api401.test.ts (môi trường node).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const g = globalThis as unknown as Record<string, unknown>;
let fetchCu: unknown;
let windowCu: unknown;
let coWindowCu = false;
let traLoi: ((r: Response) => void) | null = null;
let status = 200;

beforeEach(() => {
  vi.resetModules();   // biến đếm + mã CSRF sống ở mức module
  status = 200;
  fetchCu = g.fetch;
  coWindowCu = "window" in g;
  windowCu = g.window;
  g.window = { dispatchEvent: () => true };
  g.fetch = vi.fn(async (url: unknown) => {
    if (String(url).includes("/csrf-token")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    // Lệnh chính: treo tới khi test cho trả lời — để đo được lúc "đang bay".
    return new Promise<Response>((r) => { traLoi = r; });
  });
});
afterEach(() => {
  g.fetch = fetchCu;
  if (coWindowCu) g.window = windowCu; else delete g.window;
  traLoi = null;
});

/** Chờ tới khi lệnh chính đã gửi đi (qua bước xin mã CSRF) và đang treo. */
const choGui = async () => { for (let i = 0; i < 50 && !traLoi; i++) await new Promise((r) => setTimeout(r, 1)); };

describe("soLenhGhiDangBay", () => {
  it("lệnh GHI (PUT) được đếm TỪ LÚC gọi — kể cả chặng xin mã CSRF — tới lúc xong", async () => {
    const { api, soLenhGhiDangBay } = await import("./api");
    expect(soLenhGhiDangBay()).toBe(0);
    const hua = api.updateSheetInvoice(5, "invoiceNo", "0012");
    expect(soLenhGhiDangBay(), "đếm ngay khi gọi, trước cả lượt xin mã CSRF").toBe(1);
    await choGui();
    expect(soLenhGhiDangBay()).toBe(1);
    traLoi!(new Response("{}", { status: 200 }));
    await hua;
    expect(soLenhGhiDangBay()).toBe(0);
  });

  it("lệnh ghi HỎNG (409 / lỗi) cũng trả bộ đếm về 0", async () => {
    const { api, soLenhGhiDangBay } = await import("./api");
    status = 409;
    const hua = api.updateSheetInvoice(5, "invoiceNo", "0012");
    await choGui();
    traLoi!(new Response(JSON.stringify({ error: "xung đột" }), { status }));
    await expect(hua).rejects.toThrow();
    expect(soLenhGhiDangBay()).toBe(0);
  });

  it("lệnh ĐỌC (GET) và nhịp tim NỀN (presence, im401) không đếm", async () => {
    const { api, soLenhGhiDangBay } = await import("./api");
    const doc = api.getQuote(5);
    await choGui();
    expect(soLenhGhiDangBay()).toBe(0);
    traLoi!(new Response("{}", { status: 200 }));
    await doc;
    traLoi = null;
    const nhip = api.presence(5, "heartbeat");
    await choGui();
    expect(soLenhGhiDangBay(), "nhịp tim chạy suốt — đếm nó thì không bao giờ tự tải được").toBe(0);
    traLoi!(new Response(JSON.stringify({ editing: [] }), { status: 200 }));
    await nhip;
  });
});
