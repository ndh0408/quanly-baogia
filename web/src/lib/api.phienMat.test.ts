// PHIÊN ĐÃ MẤT → KHÔNG GỌI MÁY CHỦ NỮA (api.ts `phienDaMat`) + KHÔNG THỬ LẠI 401/403 (query.tsx).
//
// Đo được 2026-09-24 trên máy thử: tài khoản bị xoá lúc trang Danh sách đang mở → lớp phủ "Phiên đăng
// nhập đã hết" hiện đúng, nhưng trang phía sau bị kích dựng lại liên tục và mỗi lần gọi /api/quotes +
// thử lại — ~2 request/giây tới khi tải lại trang. Chốt ở đây: sau 401 đầu tiên, lời gọi người-dùng bị
// chặn NGAY TẠI TRÌNH DUYỆT; /auth/* (đăng nhập lại) và nhịp tim nền (im401) vẫn đi; đăng nhập lại
// xong thì mọi thứ gọi bình thường. Cùng khuôn `window` giả tối thiểu với api401.test.ts (môi trường node).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const g = globalThis as unknown as Record<string, unknown>;
let suKien: string[] = [];
let cu: Record<string, unknown> = {};
let traLoi: (url: string) => Response;

beforeEach(() => {
  vi.resetModules();   // cờ phienDaMat + mã CSRF sống ở mức module
  suKien = [];
  cu = { fetch: g.fetch, window: g.window };
  g.window = { dispatchEvent: (e: { type: string }) => { suKien.push(e.type); return true; } };
  g.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/csrf-token")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    return traLoi(u);
  });
});
afterEach(() => {
  for (const [k, v] of Object.entries(cu)) { if (v === undefined) delete g[k]; else g[k] = v; }
  vi.restoreAllMocks();
});

const soLanGoi = (duong: string) => (g.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes(duong)).length;

describe("phiên đã mất → chặn tại trình duyệt", () => {
  it("401 đầu tiên → bật lớp phủ; các lời gọi SAU đó không tới máy chủ nữa (ném 401 tại chỗ)", async () => {
    const { api, laPhienDaMat } = await import("./api");
    traLoi = () => new Response(JSON.stringify({ error: "Chưa đăng nhập" }), { status: 401 });
    await expect(api.listQuotes({ page: 1, size: 20 })).rejects.toMatchObject({ status: 401 });
    expect(suKien).toContain("auth:expired");
    expect(laPhienDaMat()).toBe(true);
    const truoc = soLanGoi("/api/quotes");
    for (let i = 0; i < 5; i++) await expect(api.listQuotes({ page: 1, size: 20 })).rejects.toMatchObject({ status: 401 });
    await expect(api.getQuote(7)).rejects.toMatchObject({ status: 401 });
    expect(soLanGoi("/api/quotes"), "phiên đã mất mà vẫn gọi máy chủ").toBe(truoc);
  });

  it("vẫn để lọt: đăng nhập lại (/auth/*) và nhịp tim nền (im401); đăng nhập xong thì gọi bình thường", async () => {
    const { api, laPhienDaMat } = await import("./api");
    traLoi = () => new Response(JSON.stringify({ error: "Chưa đăng nhập" }), { status: 401 });
    await expect(api.listQuotes({ page: 1, size: 20 })).rejects.toThrow();
    expect(laPhienDaMat()).toBe(true);
    // nhịp tim nền vẫn đi (và thành công thì tự đóng lớp phủ — 401 muộn đua với lượt đăng nhập lại)
    traLoi = (u) => u.includes("/stream/presence") ? new Response(JSON.stringify({ editing: [] }), { status: 200 }) : new Response("{}", { status: 401 });
    await api.presence(7, "heartbeat");
    expect(soLanGoi("/stream/presence")).toBe(1);
    expect(laPhienDaMat(), "nhịp tim thành công = phiên còn sống").toBe(false);
    // mất lại, rồi đăng nhập lại qua lớp phủ
    traLoi = () => new Response(JSON.stringify({ error: "Chưa đăng nhập" }), { status: 401 });
    await expect(api.listQuotes({ page: 1, size: 20 })).rejects.toThrow();
    expect(laPhienDaMat()).toBe(true);
    traLoi = (u) => u.includes("/auth/login")
      ? new Response(JSON.stringify({ id: 1, username: "a", displayName: "A", role: "admin", permissions: [] }), { status: 200 })
      : new Response(JSON.stringify({ data: [], meta: { total: 0, page: 1, pageCount: 1 } }), { status: 200 });
    await api.login("a", "b");
    expect(laPhienDaMat()).toBe(false);
    await api.listQuotes({ page: 1, size: 20 });
    expect(soLanGoi("/api/quotes?")).toBeGreaterThan(0);
  });

  it("401 vì gõ SAI mật khẩu xác nhận (code xac_nhan_sai) → KHÔNG phải mất phiên: không lớp phủ, không chặn — diễn tập 2026-09-25", async () => {
    const { api, laPhienDaMat } = await import("./api");
    traLoi = (u) => u.includes("/auth/change-password") || u.includes("/mfa/")
      ? new Response(JSON.stringify({ error: "Mật khẩu không đúng", code: "xac_nhan_sai" }), { status: 401 })
      : new Response(JSON.stringify({ data: [], meta: { total: 0, page: 1, pageCount: 1 } }), { status: 200 });
    await expect(api.changePassword("sai", "MatKhauMoi123!")).rejects.toMatchObject({ status: 401 });
    expect(laPhienDaMat()).toBe(false);
    expect(suKien).not.toContain("auth:expired");
    await api.listQuotes({ page: 1, size: 20 });
    expect(soLanGoi("/api/quotes?"), "vẫn gọi máy chủ bình thường").toBe(1);
  });

  it("tab khác đăng nhập lại cùng người → phienSongLai gỡ chặn", async () => {
    const { api, laPhienDaMat, phienSongLai } = await import("./api");
    traLoi = () => new Response(JSON.stringify({ error: "Chưa đăng nhập" }), { status: 401 });
    await expect(api.listQuotes({ page: 1, size: 20 })).rejects.toThrow();
    expect(laPhienDaMat()).toBe(true);
    phienSongLai();
    expect(laPhienDaMat()).toBe(false);
    traLoi = () => new Response(JSON.stringify({ data: [], meta: { total: 0, page: 1, pageCount: 1 } }), { status: 200 });
    await api.listQuotes({ page: 1, size: 20 });
  });

  it("đang XEM THỬ quyền: Đăng xuất vẫn đi THẬT lên máy chủ (không làm giả) — diễn tập 2026-09-25", async () => {
    const { api, setPreviewMode } = await import("./api");
    traLoi = () => new Response("{}", { status: 200 });
    setPreviewMode(true);
    try {
      await api.logout();
      expect(soLanGoi("/api/auth/logout"), "đăng xuất bị làm giả — phiên không bị huỷ mà tab khác vẫn tải lại").toBe(1);
      const truoc = (g.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
      await api.updateSheetInvoice(5, "invoiceNo", "1");
      expect((g.fetch as ReturnType<typeof vi.fn>).mock.calls.length, "lệnh ghi khác lúc xem thử vẫn là giả").toBe(truoc);
    } finally { setPreviewMode(false); }
  });

  it("401 của nhịp tim nền (im401) KHÔNG bật cờ — không chặn nhầm người đang làm", async () => {
    const { api, laPhienDaMat } = await import("./api");
    traLoi = () => new Response("{}", { status: 401 });
    await expect(api.presence(7, "heartbeat")).rejects.toThrow();
    expect(laPhienDaMat()).toBe(false);
    expect(suKien).not.toContain("auth:expired");
  });
});

describe("thuLaiTruyVan — không thử lại lỗi đăng nhập / quyền", () => {
  it("401/403 → không thử lại; lỗi khác → thử lại đúng 1 lần như cũ", async () => {
    const { ApiError } = await import("./api");
    const { thuLaiTruyVan } = await import("./query");
    expect(thuLaiTruyVan(0, new ApiError("x", 401, {}))).toBe(false);
    expect(thuLaiTruyVan(0, new ApiError("x", 403, {}))).toBe(false);
    expect(thuLaiTruyVan(0, new ApiError("x", 500, {}))).toBe(true);
    expect(thuLaiTruyVan(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(thuLaiTruyVan(1, new ApiError("x", 500, {}))).toBe(false);
  });
});
