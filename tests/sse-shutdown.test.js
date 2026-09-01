// SSE giữ kết nối làm việc tắt máy có kiểm soát KHÔNG BAO GIỜ hoàn tất — chốt hồi quy.
//
// ── LỖI ─────────────────────────────────────────────────────────────────────
// `server.close()` chờ MỌI kết nối đang mở kết thúc. Kết nối SSE thì theo thiết kế là KHÔNG BAO GIỜ
// kết thúc. Nên callback của `server.close()` không bao giờ chạy, và tiến trình chỉ thoát nhờ bộ
// đếm giờ cưỡng bức 10 giây — với MÃ THOÁT 1.
//
// Hai hậu quả, cả hai xảy ra ở MỖI LẦN DEPLOY khi có ít nhất một tab đang mở:
//   1. Tắt CỨNG: request đang xử lý dở bị cắt ngang giữa chừng.
//   2. Orchestrator (Docker/k8s) đọc mã thoát 1 là "container hỏng", không phải "dừng có kiểm soát".
//
// ĐÃ ĐO trên artifact production thật, với đúng một kết nối SSE đang mở:
//   trước khi vá:  10.094 ms, mã thoát 1
//   sau khi vá:       109 ms, mã thoát 0
import { describe, it, expect } from "vitest";
import { attach, closeAllSse } from "../src/sse.js";
import { sseClients } from "../src/observability.js";

/** Giả lập tối thiểu cặp req/res mà `attach` cần. */
function gia() {
  const res = {
    headers: {},
    daGhi: [],
    daKetThuc: false,
    setHeader(k, v) { this.headers[k] = v; },
    flushHeaders() {},
    write(s) { if (this.daKetThuc) throw new Error("ghi sau khi đóng"); this.daGhi.push(s); return true; },
    end() { this.daKetThuc = true; },
  };
  const handlers = {};
  const req = { on(ev, fn) { handlers[ev] = fn; } };
  return { req, res, dongSocket: () => handlers.close?.() };
}

describe("closeAllSse", () => {
  it("đóng mọi kết nối đang mở và dọn sạch bộ đếm", async () => {
    const a = gia(), b = gia(), c = gia();
    attach(a.req, a.res, 1);
    attach(b.req, b.res, 1); // cùng người dùng, hai tab
    attach(c.req, c.res, 2);

    const n = closeAllSse();
    expect(n, "phải đóng cả ba kết nối").toBe(3);
    for (const x of [a, b, c]) {
      expect(x.res.daKetThuc, "socket phải được end()").toBe(true);
      // Client cần biết vì sao mất kết nối để tự nối lại, thay vì bị ngắt im lặng.
      expect(x.res.daGhi.join("")).toContain("event: shutdown");
    }
    expect((await sseClients.get()).values[0].value, "số liệu sse_clients phải về 0").toBe(0);
  });

  it("gọi khi KHÔNG có kết nối nào → 0, không ném", () => {
    expect(closeAllSse()).toBe(0);
    expect(() => closeAllSse()).not.toThrow();
  });

  it("socket đã hỏng không làm hỏng cả lượt đóng", () => {
    const tot = gia();
    const hong = gia();
    attach(tot.req, tot.res, 3);
    attach(hong.req, hong.res, 4);
    // Làm hỏng SAU khi attach — attach() cũng ghi (": connected"), hỏng từ đầu thì lỗi
    // xảy ra ở attach chứ không phải ở closeAllSse, tức là test đo nhầm chỗ.
    hong.res.write = () => { throw new Error("EPIPE"); };

    expect(() => closeAllSse()).not.toThrow();
    expect(tot.res.daKetThuc, "kết nối tốt vẫn phải được đóng").toBe(true);
  });

  it("kết nối MỚI sau khi đóng vẫn hoạt động (không phải trạng thái một-chiều)", () => {
    closeAllSse();
    const x = gia();
    attach(x.req, x.res, 5);
    expect(x.res.daGhi.join("")).toContain(": connected");
    expect(closeAllSse()).toBe(1);
  });
});
