// MỘT 401 BẤT KỲ LÀM MẤT TOÀN BỘ BÁO GIÁ ĐANG SOẠN — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `web/src/lib/api.ts` bắn `window.dispatchEvent(new Event("auth:expired"))` cho MỌI phản hồi 401,
// kể cả lời gọi NỀN. `web/src/App.tsx` nghe sự kiện đó và chạy `setMe(null)`, mà ngay dưới có
// `if (!me) return <Login/>` — nghĩa là <Shell> và <QuoteEditor> bị GỠ khỏi cây React. Toàn bộ báo
// giá đang soạn sống trong state của QuoteEditor nên bay sạch.
//
// Không có bản nháp nào cứu được: `web/src/lib/pendingQuote.ts` chỉ giữ một biến in-memory, và
// cleanup của editor còn xoá cờ `__editorDirty` nên `beforeunload` cũng không kịp cảnh báo.
//
// Nguồn 401 KHÔNG do người dùng bấm là có thật:
//   - `src/middleware.ts` chặn khi tài khoản bị khoá / bị vô hiệu,
//   - và chặn khi `passwordChangedAt` mới hơn thời điểm đăng nhập của phiên,
//   - cộng với NHỊP TIM presence chạy mỗi 30 giây (`QuoteEditor.tsx`) vẫn nện vào server suốt lúc
//     người dùng đang gõ, dù họ không thao tác gì.
// Kết quả: gõ nửa tiếng, một tick nhịp tim rơi vào đúng lúc phiên hết hạn, mất trắng, không hỏi.
//
// ── CÁCH VÁ ─────────────────────────────────────────────────────────────────
// Hai lớp:
//   1. Cờ `im401` cho lời gọi NỀN (`api.presence`) — 401 ở đó chỉ dọn mã CSRF rồi im lặng.
//      Người dùng chỉ cần biết mất phiên vào ĐÚNG lúc họ làm một việc thật.
//   2. `App.tsx` không `setMe(null)` nữa mà bật lớp phủ đăng nhập lại ĐÈ LÊN cây đang mount →
//      QuoteEditor không unmount → dữ liệu còn nguyên.
// Bài này chốt lớp (1) ở mức mạng thật: chặn `fetch`, đếm sự kiện `auth:expired`.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Ép kiểu lỏng CÓ CHỦ Ý: bài này chạy ở môi trường node (repo không cài jsdom — mọi test web hiện
// có đều là logic thuần). Ta dựng `window` giả tối thiểu vừa đủ cho api.ts, nên không thể — và
// không cần — thoả nguyên giao diện `Window` của lib DOM.
const g = globalThis as unknown as Record<string, unknown>;

let suKien: string[] = [];
let fetchCu: unknown;
let windowCu: unknown;
let coWindowCu = false;
let status = 200;
let body = "{}";

/** `window` tối thiểu — chỉ phần api.ts dùng tới (`dispatchEvent`). `Event` node ≥18 có sẵn. */
const gaWindow = () => ({ dispatchEvent: (e: { type: string }) => { suKien.push(e.type); return true; } });

beforeEach(() => {
  // Mã CSRF được NHỚ ở mức module (biến `csrfToken` trong api.ts). Không nạp lại module thì bài sau
  // thừa hưởng mã bài trước cache, và các bài đếm số lần xin mã sẽ đo nhầm.
  vi.resetModules();
  suKien = [];
  status = 200;
  body = "{}";
  fetchCu = g.fetch;
  coWindowCu = "window" in g;
  windowCu = g.window;
  g.window = gaWindow();
  g.fetch = vi.fn(async (url: unknown) => {
    // Endpoint cấp mã CSRF phải LUÔN trả 200, nếu không thì layCsrf() nuốt lỗi và ta đo nhầm chỗ.
    if (String(url).includes("/csrf-token")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    return new Response(body, { status });
  });
});

afterEach(() => {
  g.fetch = fetchCu;
  if (coWindowCu) g.window = windowCu; else delete g.window;
  vi.restoreAllMocks();
});

describe("401 ở lời gọi NỀN không được kéo cả ứng dụng về màn đăng nhập", () => {
  it("api.presence (nhịp tim 30 giây) gặp 401 → KHÔNG bắn auth:expired", async () => {
    const { api } = await import("./api");
    status = 401;
    body = JSON.stringify({ error: "Chưa đăng nhập" });

    await expect(api.presence(7, "heartbeat")).rejects.toThrow();   // vẫn phải NÉM để chỗ gọi biết
    // Trước khi vá: mảng này là ["auth:expired"] → App setMe(null) → QuoteEditor unmount → mất sạch.
    expect(suKien, "nhịp tim nền KHÔNG được kéo lớp phủ mất-phiên lên").toEqual([]);
  });

  it("cả ba hành động presence (open/heartbeat/close) đều im lặng", async () => {
    const { api } = await import("./api");
    status = 401;
    for (const act of ["open", "heartbeat", "close"] as const) {
      await expect(api.presence(7, act)).rejects.toThrow();
    }
    expect(suKien).toEqual([]);
  });

  it("lời gọi DO NGƯỜI DÙNG bấm gặp 401 → VẪN bắn auth:expired (không lỡ tay tắt hết)", async () => {
    const { api } = await import("./api");
    status = 401;
    body = JSON.stringify({ error: "Chưa đăng nhập" });

    await expect(api.me()).rejects.toThrow();
    // Đây mới là lúc người dùng cần biết — và lúc này lớp phủ giữ nguyên dữ liệu cho họ.
    expect(suKien).toEqual(["auth:expired"]);
  });

  it("lưu báo giá gặp 401 → bắn auth:expired ĐÚNG MỘT LẦN (không nhân đôi do thử lại CSRF)", async () => {
    const { api } = await import("./api");
    status = 401;
    body = JSON.stringify({ error: "Chưa đăng nhập" });

    await expect(api.updateQuote(7, { title: "x" } as never)).rejects.toThrow();
    expect(suKien).toEqual(["auth:expired"]);
  });

  it("presence THÀNH CÔNG vẫn chạy bình thường (cờ im401 không phá đường đi đúng)", async () => {
    const { api } = await import("./api");
    status = 200;
    body = JSON.stringify({ editing: [{ id: 3, name: "Anh A" }] });

    const r = await api.presence(7, "open");
    expect(r.editing).toEqual([{ id: 3, name: "Anh A" }]);
    expect(suKien).toEqual([]);
  });

  // ── Mã CSRF phải chết theo phiên ────────────────────────────────────────────
  // Chú thích ở `resetCsrfToken` (api.ts) khẳng định "Đăng nhập/đăng xuất làm mới phiên → mã cũ hết
  // giá trị", nhưng KHÔNG chỗ nào gọi nó ở hai đường đó — mã cũ nằm lại trong biến module. Lần GHI
  // kế tiếp ăn 403, rồi `req` lấy mã mới và GỬI LẠI NGUYÊN THÂN request. Đường thử-lại cứu được
  // tính đúng đắn nên lỗi này không lộ ra, nhưng ngay sau khi đăng nhập lại qua lớp phủ mất-phiên,
  // việc đầu tiên người ta làm thường là bấm Lưu một báo giá vài MB — tức tải lên HAI LẦN.
  it("đăng nhập xong → lấy mã CSRF MỚI cho lần ghi kế tiếp, không dùng lại mã của phiên đã chết", async () => {
    const { api } = await import("./api");
    const duongDan = () => (g.fetch as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));

    // 1) Một lần GHI để api.ts nạp và NHỚ mã CSRF của phiên hiện tại.
    status = 200; body = JSON.stringify({ ok: true });
    await api.markConverted(7);
    expect(duongDan().filter((u) => u.includes("/csrf-token")).length, "lần ghi đầu phải xin mã").toBe(1);

    // 2) Đăng nhập (phiên MỚI ở server → bí mật CSRF cũ chết theo).
    body = JSON.stringify({ id: 1, username: "a", displayName: "A", role: "admin", permissions: [] });
    await api.login("a", "b");

    // 3) Lần GHI kế tiếp PHẢI đi xin mã lần nữa.
    body = JSON.stringify({ ok: true });
    await api.markConverted(7);
    expect(duongDan().filter((u) => u.includes("/csrf-token")).length, "sau đăng nhập phải xin mã MỚI").toBe(2);
  });

  it("đăng xuất cũng dọn mã CSRF", async () => {
    const { api } = await import("./api");
    const demMa = () => (g.fetch as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => String(c[0]).includes("/csrf-token")).length;
    status = 200; body = JSON.stringify({ ok: true });
    await api.markConverted(7);
    expect(demMa()).toBe(1);
    await api.logout();
    await api.markConverted(7);
    expect(demMa()).toBe(2);
  });

  // ── Thân KHÔNG PHẢI JSON (proxy trả HTML) ──────────────────────────────────
  // `JSON.parse` trần ném SyntaxError NGAY tại chỗ đọc thân, nhảy qua HẾT phần xử lý phía sau:
  // nhánh thử lại CSRF (403), nhánh mất phiên (401), và cả việc dựng ApiError có `status`. Mà thân
  // HTML là chuyện bình thường ở production: nginx/Coolify trả trang HTML cho 502/504/413.
  it("502 kèm trang HTML → vẫn là ApiError có status, KHÔNG phải SyntaxError", async () => {
    const { api, ApiError } = await import("./api");
    status = 502;
    body = "<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>";

    const loi = await api.me().then(() => null, (e) => e);
    expect(loi, "trước khi vá: SyntaxError, chỗ gọi không nhận ra").toBeInstanceOf(ApiError);
    expect((loi as InstanceType<typeof ApiError>).status).toBe(502);
    expect(String((loi as Error).message), "thông báo phải nói được điều gì đó có ích").toMatch(/502/);
  });

  it("401 kèm trang HTML (proxy nuốt JSON) → VẪN bắn auth:expired", async () => {
    const { api } = await import("./api");
    status = 401;
    body = "<html>401 Unauthorized</html>";
    await expect(api.me()).rejects.toThrow();
    // Trước khi vá: SyntaxError ném trước dòng dispatchEvent → người dùng kẹt ở màn hình chết,
    // bấm gì cũng lỗi mà không hề được mời đăng nhập lại.
    expect(suKien).toEqual(["auth:expired"]);
  });

  it("200 kèm thân rỗng vẫn trả null như cũ (không lỡ tay đổi hành vi đúng)", async () => {
    const { api } = await import("./api");
    status = 200; body = "";
    await expect(api.me()).resolves.toBe(null);
  });

  it("lỗi KHÁC 401 (403/500) không bắn auth:expired ở bất kỳ đường nào", async () => {
    const { api } = await import("./api");
    for (const st of [403, 500]) {
      status = st;
      body = JSON.stringify({ error: "Lỗi" });
      await expect(api.me()).rejects.toThrow();
      await expect(api.presence(7, "heartbeat")).rejects.toThrow();
    }
    expect(suKien).toEqual([]);
  });
});
